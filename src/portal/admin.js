// Admin-only user management: create, edit, disable, enable, reset password, reissue setup link.
import { fail, json, now, uid, str, EMAIL_RE, PHONE_RE, bool } from "./http.js";
import { publicUser, issueLinkToken, linkFor, endAllSessions, audit, TOKEN_DAYS } from "./auth.js";
import { deliverLink } from "./mail.js";

// Admin and Editor see every customer's data, so those roles are allowed only for the xSim company.
async function checkStaffRoles(env, companyId, roles) {
  if (!roles || (!roles.admin && !roles.editor)) return;
  const c = await env.DB.prepare("SELECT internal FROM companies WHERE id = ?1").bind(companyId).first();
  if (!c || !c.internal) fail(422, "staff_roles_internal");
}

export async function companyIdFor(env, name) {
  const n = str(name, 160);
  if (!n) fail(422, "invalid", { fields: ["company"] });
  const existing = await env.DB.prepare("SELECT id FROM companies WHERE name = ?1").bind(n).first();
  if (existing) return existing.id;
  const id = uid();
  await env.DB.prepare("INSERT INTO companies (id, name, created_at) VALUES (?1, ?2, ?3)").bind(id, n, now()).run();
  return id;
}

function readUserFields(body, partial = false) {
  const f = {};
  const errors = [];
  if (!partial || "email" in body) {
    f.email = str(body.email, 200).toLowerCase();
    if (!EMAIL_RE.test(f.email)) errors.push("email");
  }
  if (!partial || "name" in body) {
    f.name = str(body.name, 120);
    if (!f.name) errors.push("name");
  }
  if (!partial || "phone" in body) {
    f.phone = str(body.phone, 40);
    if (!PHONE_RE.test(f.phone)) errors.push("phone");
  }
  if (!partial || "company" in body) {
    f.company = str(body.company, 160);
    if (!f.company) errors.push("company");
  }
  if (!partial || "lang" in body) f.lang = body.lang === "he" ? "he" : "en";
  if (!partial || "roles" in body) {
    const r = body.roles && typeof body.roles === "object" ? body.roles : {};
    f.roles = { admin: bool(r.admin), editor: bool(r.editor), viewer: bool(r.viewer), respondent: bool(r.respondent) };
    if (!Object.values(f.roles).some(Boolean)) errors.push("roles");
  }
  if (errors.length) fail(422, "invalid", { fields: errors });
  return f;
}

async function getUser(env, id) {
  const u = await env.DB.prepare("SELECT u.*, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?1")
    .bind(id).first();
  if (!u) fail(404, "not_found");
  return u;
}

async function activeAdminCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND status != 'disabled'").first();
  return r.n;
}

async function sendLink(env, url, user, purpose, actorId) {
  const token = await issueLinkToken(env, user.id, purpose, actorId);
  const link = linkFor(env, url, user.lang, token);
  const out = await deliverLink(env, user, purpose, link, TOKEN_DAYS[purpose]);
  return { ...out, days: TOKEN_DAYS[purpose] };
}

export async function routeAdmin(ctx) {
  const { env, url, path, method, body, me } = ctx;
  if (!path.startsWith("admin/")) return null;
  if (!me.is_admin) fail(403, "forbidden");
  const sub = path.slice(6);

  // GET admin/users
  if (sub === "users" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT u.*, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id ORDER BY c.name COLLATE NOCASE, u.name COLLATE NOCASE"
    ).all();
    return json({ ok: true, users: rows.results.map((u) => publicUser(u)) });
  }

  // POST admin/users
  if (sub === "users" && method === "POST") {
    const f = readUserFields(body);
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(f.email).first();
    if (exists) fail(409, "email_taken");
    const companyId = await companyIdFor(env, f.company);
    await checkStaffRoles(env, companyId, f.roles);
    const id = uid();
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, phone, company_id, lang, is_admin, is_editor, is_viewer, is_respondent, status, created_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', ?11, ?12)`
    ).bind(id, f.email, f.name, f.phone, companyId, f.lang, +f.roles.admin, +f.roles.editor, +f.roles.viewer, +f.roles.respondent, now(), me.id).run();
    const user = await getUser(env, id);
    const delivery = await sendLink(env, url, user, "setup", me.id);
    await audit(env, me.id, "user_created", id, { roles: f.roles, emailed: delivery.emailed });
    return json({ ok: true, user: publicUser(user), delivery }, 201);
  }

  // ---------- Companies ----------

  // GET admin/companies -> every company with counts
  if (sub === "companies" && method === "GET") {
    const r = await env.DB.prepare(
      `SELECT c.id, c.name, c.created_at, c.internal,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status != 'disabled') AS users,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status != 'disabled' AND u.is_respondent = 1) AS respondents,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status != 'disabled' AND u.is_viewer = 1) AS viewers,
              (SELECT COUNT(*) FROM surveys s WHERE s.company_id = c.id) AS surveys
         FROM companies c ORDER BY c.name COLLATE NOCASE`
    ).all();
    return json({ ok: true, companies: r.results });
  }

  // POST admin/companies { name }
  if (sub === "companies" && method === "POST") {
    const name = str(body.name, 160);
    if (!name) fail(422, "invalid", { fields: ["company"] });
    if (await env.DB.prepare("SELECT 1 FROM companies WHERE name = ?1").bind(name).first()) fail(409, "company_taken");
    const id = uid();
    await env.DB.prepare("INSERT INTO companies (id, name, created_at, internal) VALUES (?1, ?2, ?3, 0)").bind(id, name, now()).run();
    await audit(env, me.id, "company_created", null, { company: id, name });
    return json({ ok: true, company: { id, name } }, 201);
  }

  const mc = sub.match(/^companies\/([0-9a-f-]{36})$/);
  if (mc) {
    const c = await env.DB.prepare("SELECT * FROM companies WHERE id = ?1").bind(mc[1]).first();
    if (!c) fail(404, "not_found");
    // PATCH admin/companies/:id { name } -> rename
    if (method === "PATCH") {
      const name = str(body.name, 160);
      if (!name) fail(422, "invalid", { fields: ["company"] });
      if (c.internal) fail(409, "company_protected");
      if (await env.DB.prepare("SELECT 1 FROM companies WHERE name = ?1 AND id != ?2").bind(name, c.id).first()) fail(409, "company_taken");
      await env.DB.prepare("UPDATE companies SET name = ?1 WHERE id = ?2").bind(name, c.id).run();
      await audit(env, me.id, "company_renamed", null, { company: c.id, from: c.name, to: name });
      return json({ ok: true });
    }
    // DELETE admin/companies/:id -> only when it has no users (of any status) and no surveys
    if (method === "DELETE") {
      if (c.internal) fail(409, "company_protected");
      const u = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE company_id = ?1").bind(c.id).first();
      const sv = await env.DB.prepare("SELECT COUNT(*) AS n FROM surveys WHERE company_id = ?1").bind(c.id).first();
      if (u.n || sv.n) fail(409, "company_in_use");
      await env.DB.prepare("DELETE FROM companies WHERE id = ?1").bind(c.id).run();
      await audit(env, me.id, "company_deleted", null, { company: c.id, name: c.name });
      return json({ ok: true });
    }
    return null;
  }

  const m = sub.match(/^users\/([0-9a-f-]{36})(?:\/(disable|enable|reset|link))?$/);
  if (!m) return null;
  const target = await getUser(env, m[1]);
  const action = m[2];

  // PATCH admin/users/:id
  if (!action && method === "PATCH") {
    const f = readUserFields(body, true);
    if (f.email && f.email !== target.email.toLowerCase()) {
      const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?1 AND id != ?2").bind(f.email, target.id).first();
      if (exists) fail(409, "email_taken");
    }
    if (f.roles && target.is_admin && !f.roles.admin && (await activeAdminCount(env)) <= 1) fail(409, "last_admin");
    if (f.roles && target.id === me.id && !f.roles.admin) fail(409, "self_demote");
    const companyId = f.company ? await companyIdFor(env, f.company) : target.company_id;
    const roles = f.roles || { admin: !!target.is_admin, editor: !!target.is_editor, viewer: !!target.is_viewer, respondent: !!target.is_respondent };
    await checkStaffRoles(env, companyId, roles);
    await env.DB.prepare(
      `UPDATE users SET email = ?1, name = ?2, phone = ?3, company_id = ?4, lang = ?5,
              is_admin = ?6, is_editor = ?7, is_viewer = ?8, is_respondent = ?9 WHERE id = ?10`
    ).bind(
      f.email ?? target.email, f.name ?? target.name, f.phone ?? target.phone, companyId, f.lang ?? target.lang,
      +roles.admin, +roles.editor, +roles.viewer, +roles.respondent, target.id
    ).run();
    // A change of role or company takes effect at the next sign-in.
    if (f.roles || companyId !== target.company_id || (f.email && f.email !== target.email)) await endAllSessions(env, target.id);
    // Someone moved to another company keeps no access to the old company's surveys (answers already given stay).
    if (companyId !== target.company_id) {
      await env.DB.prepare(
        `DELETE FROM survey_assignments WHERE user_id = ?1 AND submitted_at IS NULL AND started_at IS NULL
           AND survey_id IN (SELECT id FROM surveys WHERE company_id != ?2)`
      ).bind(target.id, companyId).run();
    }
    await audit(env, me.id, "user_updated", target.id, { fields: Object.keys(f) });
    return json({ ok: true, user: publicUser(await getUser(env, target.id)) });
  }

  if (method !== "POST") return null;

  if (action === "disable") {
    if (target.id === me.id) fail(409, "self_disable");
    if (target.is_admin && (await activeAdminCount(env)) <= 1) fail(409, "last_admin");
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?1").bind(target.id).run();
    await env.DB.prepare("UPDATE auth_tokens SET used_at = ?1 WHERE user_id = ?2 AND used_at IS NULL").bind(now(), target.id).run();
    await endAllSessions(env, target.id);
    await audit(env, me.id, "user_disabled", target.id);
    return json({ ok: true, user: publicUser(await getUser(env, target.id)) });
  }

  if (action === "enable") {
    const status = target.password_hash && target.totp_secret ? "active" : "pending";
    await env.DB.prepare(
      "UPDATE users SET status = ?1, failed_logins = 0, locked_until = NULL, mfa_failures = 0, mfa_locks = 0, mfa_locked_until = NULL WHERE id = ?2"
    ).bind(status, target.id).run();
    await audit(env, me.id, "user_enabled", target.id);
    return json({ ok: true, user: publicUser(await getUser(env, target.id)) });
  }

  // Reset: password and 2FA are cleared, every session ends, and a new setup link is issued.
  if (action === "reset") {
    if (target.status === "disabled") fail(409, "user_disabled");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET password_hash = NULL, totp_secret = NULL, totp_pending = NULL, totp_last_step = 0, password_set_at = NULL,
                status = 'pending', failed_logins = 0, locked_until = NULL, mfa_failures = 0, mfa_locks = 0, mfa_locked_until = NULL WHERE id = ?1`
      ).bind(target.id),
      env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?1").bind(target.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(target.id),
    ]);
    const delivery = await sendLink(env, url, target, "reset", me.id);
    await audit(env, me.id, "password_reset", target.id, { emailed: delivery.emailed });
    return json({ ok: true, user: publicUser(await getUser(env, target.id)), delivery });
  }

  // New setup link for someone who has not finished setup (for example, the first link expired).
  if (action === "link") {
    if (target.status !== "pending") fail(409, "not_pending");
    const delivery = await sendLink(env, url, target, "setup", me.id);
    await audit(env, me.id, "setup_link_issued", target.id, { emailed: delivery.emailed });
    return json({ ok: true, delivery });
  }

  return null;
}

// GET audit (admin)
export async function listAudit(env) {
  const rows = await env.DB.prepare(
    `SELECT a.at, a.action, a.detail, a.actor_id, a.target_id, ua.name AS actor_name, ut.name AS target_name
       FROM audit_log a LEFT JOIN users ua ON ua.id = a.actor_id LEFT JOIN users ut ON ut.id = a.target_id
      ORDER BY a.id DESC LIMIT 200`
  ).all();
  return rows.results;
}
