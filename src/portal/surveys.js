// Surveys: building (admins and editors), assigning respondents, answering.
import { fail, json, now, uid, str, text, bool } from "./http.js";
import { audit } from "./auth.js";
import { CAPABILITIES, TYPES, normalizeConfig, structureOf, validateAnswer, isComplete } from "./schema.js";
import pulse from "./templates/pulse.json";

export const MAX_LOGO_BYTES = 256 * 1024;
const TEMPLATES = { pulse };

// ---------- Access ----------

// What the signed-in user may do with one survey.
export async function access(env, me, surveyId) {
  const s = await env.DB.prepare(
    "SELECT s.id, s.company_id, s.title_en, s.title_he, s.intro_en, s.intro_he, s.status, s.closes_at, s.logo_type, s.created_by, s.created_at, s.updated_at, c.name AS company_name FROM surveys s JOIN companies c ON c.id = s.company_id WHERE s.id = ?1"
  ).bind(surveyId).first();
  if (!s) fail(404, "not_found");
  const can = { edit: false, own: false, results: null, respond: false, view: false };
  if (me.is_admin) {
    Object.assign(can, { edit: true, own: true, results: "full" });
  } else if (me.is_editor) {
    const collab = s.created_by === me.id || (await env.DB.prepare("SELECT 1 FROM survey_editors WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, me.id).first());
    if (collab) Object.assign(can, { edit: true, own: s.created_by === me.id, results: "full" });
  }
  if (!can.results && me.is_viewer && me.company_id === s.company_id && s.status !== "draft") can.results = "aggregate";
  // Respondents answer only their own company's surveys, even if an old assignment survives a company change.
  if (me.is_respondent && s.status !== "draft" && me.company_id === s.company_id) {
    const a = await env.DB.prepare("SELECT 1 FROM survey_assignments WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, me.id).first();
    if (a) can.respond = true;
  }
  can.view = can.edit || !!can.results || can.respond;
  if (!can.view) fail(404, "not_found");
  return { survey: s, can };
}

export const isOpenFor = (s) => s.status === "open" && (!s.closes_at || Date.parse(s.closes_at) > Date.now());

async function answerCount(env, surveyId) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM survey_answers WHERE survey_id = ?1").bind(surveyId).first();
  return r.n;
}

const touch = (env, id) => env.DB.prepare("UPDATE surveys SET updated_at = ?1 WHERE id = ?2").bind(now(), id).run();

// Full structure of a survey: sections with their questions.
export async function loadStructure(env, surveyId) {
  const [secs, qs] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM survey_sections WHERE survey_id = ?1 ORDER BY position").bind(surveyId),
    env.DB.prepare("SELECT * FROM survey_questions WHERE survey_id = ?1 ORDER BY position").bind(surveyId),
  ]);
  const sections = secs.results.map((s) => ({ ...s, questions: [] }));
  const byId = new Map(sections.map((s) => [s.id, s]));
  for (const q of qs.results) {
    const sec = byId.get(q.section_id);
    if (sec) sec.questions.push({ ...q, config: JSON.parse(q.config || "{}"), required: !!q.required });
  }
  return sections;
}

const surveyOut = (s, can, extra = {}) => ({
  id: s.id, company_id: s.company_id, company: s.company_name, title_en: s.title_en, title_he: s.title_he,
  intro_en: s.intro_en, intro_he: s.intro_he, status: s.status, closes_at: s.closes_at, has_logo: !!s.logo_type,
  created_by: s.created_by, created_at: s.created_at, updated_at: s.updated_at, open: isOpenFor(s), can, ...extra,
});

// ---------- Survey list ----------

async function listSurveys(env, me) {
  const out = new Map();
  const cols = "s.id, s.company_id, s.title_en, s.title_he, s.status, s.closes_at, s.logo_type, s.created_by, s.created_at, s.updated_at, c.name AS company_name, u.name AS creator_name";
  const from = "FROM surveys s JOIN companies c ON c.id = s.company_id LEFT JOIN users u ON u.id = s.created_by";
  const add = (rows, can) => {
    for (const s of rows) {
      const prev = out.get(s.id);
      const merged = prev ? { ...prev.can } : { edit: false, own: false, results: null, respond: false };
      for (const [k, v] of Object.entries(can(s))) if (v) merged[k] = v;
      out.set(s.id, { ...s, can: merged });
    }
  };
  if (me.is_admin) {
    add((await env.DB.prepare(`SELECT ${cols} ${from}`).all()).results, () => ({ edit: true, own: true, results: "full" }));
  } else if (me.is_editor) {
    const r = await env.DB.prepare(
      `SELECT ${cols} ${from} WHERE s.created_by = ?1 OR s.id IN (SELECT survey_id FROM survey_editors WHERE user_id = ?1)`
    ).bind(me.id).all();
    add(r.results, (s) => ({ edit: true, own: s.created_by === me.id, results: "full" }));
  }
  if (me.is_viewer) {
    const r = await env.DB.prepare(`SELECT ${cols} ${from} WHERE s.company_id = ?1 AND s.status != 'draft'`).bind(me.company_id).all();
    add(r.results, () => ({ results: "aggregate" }));
  }
  if (me.is_respondent) {
    const r = await env.DB.prepare(
      `SELECT ${cols}, a.submitted_at, a.started_at ${from} JOIN survey_assignments a ON a.survey_id = s.id AND a.user_id = ?1
        WHERE s.status != 'draft' AND s.company_id = ?2`
    ).bind(me.id, me.company_id).all();
    add(r.results, () => ({ respond: true }));
  }
  // Response counts for the people who may see results.
  const ids = [...out.values()].filter((s) => s.can.results).map((s) => s.id);
  const counts = new Map();
  if (ids.length) {
    // One grouped query (D1 limits the number of bound parameters, so no long IN lists).
    const wanted = new Set(ids);
    const r = await env.DB.prepare(
      "SELECT survey_id, COUNT(*) AS assigned, SUM(submitted_at IS NOT NULL) AS submitted FROM survey_assignments GROUP BY survey_id"
    ).all();
    for (const c of r.results) if (wanted.has(c.survey_id)) counts.set(c.survey_id, c);
  }
  return [...out.values()]
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .map((s) => ({
      id: s.id, company_id: s.company_id, company: s.company_name, title_en: s.title_en, title_he: s.title_he, status: s.status,
      closes_at: s.closes_at, open: isOpenFor(s), has_logo: !!s.logo_type, created_by: s.created_by, creator: s.creator_name,
      updated_at: s.updated_at, can: s.can,
      mine: s.can.respond ? { started_at: s.started_at || null, submitted_at: s.submitted_at || null } : undefined,
      counts: s.can.results ? { assigned: counts.get(s.id)?.assigned || 0, submitted: counts.get(s.id)?.submitted || 0 } : undefined,
    }));
}

// ---------- Creating and copying ----------

async function insertStructure(env, surveyId, sections, actorId) {
  const stmts = [];
  sections.forEach((sec, si) => {
    const secId = uid();
    stmts.push(
      env.DB.prepare(
        "INSERT INTO survey_sections (id, survey_id, position, title_en, title_he, intro_en, intro_he, capability, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
      ).bind(secId, surveyId, si, sec.title_en || "", sec.title_he || "", sec.intro_en || "", sec.intro_he || "", CAPABILITIES.includes(sec.capability) ? sec.capability : null, actorId)
    );
    (sec.questions || []).forEach((q, qi) => {
      const config = normalizeConfig(q.type, q.config);
      stmts.push(
        env.DB.prepare(
          "INSERT INTO survey_questions (id, survey_id, section_id, position, type, text_en, text_he, help_en, help_he, required, config, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
        ).bind(uid(), surveyId, secId, qi, q.type, q.text_en || "", q.text_he || "", q.help_en || "", q.help_he || "", q.required ? 1 : 0, JSON.stringify(config), actorId)
      );
    });
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function createSurvey(env, me, body) {
  const company = await env.DB.prepare("SELECT id FROM companies WHERE id = ?1").bind(str(body.company_id, 40)).first();
  if (!company) fail(422, "invalid", { fields: ["company"] });
  const tpl = body.template ? TEMPLATES[body.template] : null;
  if (body.template && !tpl) fail(422, "invalid", { fields: ["template"] });
  const t = now();
  const id = uid();
  const title_en = str(body.title_en, 200) || (tpl ? tpl.title_en : "");
  const title_he = str(body.title_he, 200) || (tpl ? tpl.title_he : "");
  if (!title_en && !title_he) fail(422, "invalid", { fields: ["title"] });
  await env.DB.prepare(
    "INSERT INTO surveys (id, company_id, title_en, title_he, intro_en, intro_he, status, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, ?8)"
  ).bind(id, company.id, title_en, title_he, tpl ? tpl.intro_en : "", tpl ? tpl.intro_he : "", me.id, t).run();
  if (tpl) await insertStructure(env, id, tpl.sections, me.id);
  await audit(env, me.id, "survey_created", id, { template: body.template || null });
  return id;
}

async function duplicateSurvey(env, me, s, body) {
  const sections = await loadStructure(env, s.id);
  let companyId = s.company_id;
  if (body.company_id) {
    const c = await env.DB.prepare("SELECT id FROM companies WHERE id = ?1").bind(str(body.company_id, 40)).first();
    if (!c) fail(422, "invalid", { fields: ["company"] });
    companyId = c.id;
  }
  const full = await env.DB.prepare("SELECT logo, logo_type FROM surveys WHERE id = ?1").bind(s.id).first();
  const id = uid();
  const t = now();
  const copy = (x) => (x ? `${x} (copy)` : "");
  await env.DB.prepare(
    "INSERT INTO surveys (id, company_id, title_en, title_he, intro_en, intro_he, status, logo, logo_type, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, ?9, ?10, ?10)"
  ).bind(id, companyId, copy(s.title_en), s.title_he ? `${s.title_he} (עותק)` : "", s.intro_en, s.intro_he,
    companyId === s.company_id && full.logo ? Uint8Array.from(full.logo) : null, companyId === s.company_id ? full.logo_type : null, me.id, t).run();
  await insertStructure(env, id, sections, me.id);
  await audit(env, me.id, "survey_duplicated", id, { from: s.id });
  return id;
}

// ---------- Logo ----------

function sniffImage(bytes) {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

// ---------- Router ----------

export async function routeSurveys(ctx) {
  const { request, env, path, method, me } = ctx;
  let body = ctx.body;

  if (path === "companies" && method === "GET") {
    if (!me.is_admin && !me.is_editor) fail(403, "forbidden");
    const r = await env.DB.prepare(
      `SELECT c.id, c.name, c.internal, COUNT(u.id) AS users, SUM(u.is_respondent) AS respondents
         FROM companies c LEFT JOIN users u ON u.company_id = c.id AND u.status != 'disabled' GROUP BY c.id ORDER BY c.name COLLATE NOCASE`
    ).all();
    return json({ ok: true, companies: r.results });
  }

  if (path === "templates" && method === "GET") {
    if (!me.is_admin && !me.is_editor) fail(403, "forbidden");
    return json({ ok: true, templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, title_en: t.title_en, title_he: t.title_he })) });
  }

  if (path === "surveys" && method === "GET") return json({ ok: true, surveys: await listSurveys(env, me) });

  if (path === "surveys" && method === "POST") {
    if (!me.is_admin && !me.is_editor) fail(403, "forbidden");
    const id = await createSurvey(env, me, body);
    return json({ ok: true, id }, 201);
  }

  // Section and question routes
  let m = path.match(/^sections\/([0-9a-f-]{36})(\/questions|\/move)?$/);
  if (m) return routeSection(ctx, m[1], m[2]);
  m = path.match(/^questions\/([0-9a-f-]{36})(\/move)?$/);
  if (m) return routeQuestion(ctx, m[1], m[2]);

  m = path.match(/^surveys\/([0-9a-f-]{36})(?:\/([a-z]+))?(?:\/([0-9a-f-]{36}))?$/);
  if (!m) return null;
  const [, sid, sub, subId] = m;
  const { survey: s, can } = await access(env, me, sid);

  // GET surveys/:id -> structure (+ the caller's own answers when they are a respondent)
  if (!sub && method === "GET") {
    const sections = await loadStructure(env, s.id);
    const extra = { sections, answered: can.edit ? (await answerCount(env, s.id)) > 0 : undefined };
    if (can.respond) {
      const a = await env.DB.prepare("SELECT * FROM survey_assignments WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, me.id).first();
      const ans = await env.DB.prepare("SELECT question_id, value FROM survey_answers WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, me.id).all();
      extra.mine = {
        started_at: a.started_at, submitted_at: a.submitted_at, answer_lang: a.answer_lang,
        answers: Object.fromEntries(ans.results.map((r) => [r.question_id, JSON.parse(r.value)])),
      };
    }
    if (can.edit) {
      const eds = await env.DB.prepare(
        "SELECT u.id, u.name, u.email FROM survey_editors e JOIN users u ON u.id = e.user_id WHERE e.survey_id = ?1 ORDER BY u.name"
      ).bind(s.id).all();
      const creator = await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?1").bind(s.created_by).first();
      extra.creator = creator;
      extra.editors = eds.results;
    }
    return json({ ok: true, survey: surveyOut(s, can, extra) });
  }

  // PATCH surveys/:id -> titles, intros, status, closing date
  if (!sub && method === "PATCH") {
    if (!can.edit) fail(403, "forbidden");
    const f = {};
    for (const k of ["title_en", "title_he"]) if (k in body) f[k] = str(body[k], 200);
    for (const k of ["intro_en", "intro_he"]) if (k in body) f[k] = text(body[k], 4000);
    if ("closes_at" in body) {
      if (!body.closes_at) f.closes_at = null;
      else {
        const d = Date.parse(body.closes_at);
        if (!Number.isFinite(d)) fail(422, "invalid", { fields: ["closes_at"] });
        f.closes_at = new Date(d).toISOString();
      }
    }
    if ("status" in body) {
      const st = body.status;
      if (!["draft", "open", "closed"].includes(st)) fail(422, "invalid", { fields: ["status"] });
      if (st === "open") {
        const q = await env.DB.prepare("SELECT COUNT(*) AS n FROM survey_questions WHERE survey_id = ?1").bind(s.id).first();
        if (!q.n) fail(409, "no_questions");
      }
      if (st === "draft" && s.status !== "draft" && (await answerCount(env, s.id)) > 0) fail(409, "has_answers");
      f.status = st;
    }
    if ("title_en" in f || "title_he" in f) {
      if (!(f.title_en ?? s.title_en) && !(f.title_he ?? s.title_he)) fail(422, "invalid", { fields: ["title"] });
    }
    const keys = Object.keys(f);
    if (keys.length) {
      await env.DB.prepare(`UPDATE surveys SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(", ")}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
        .bind(...keys.map((k) => f[k]), now(), s.id).run();
      if (f.status) await audit(env, me.id, "survey_status", s.id, { status: f.status });
    }
    return json({ ok: true });
  }

  // DELETE surveys/:id -> creator (no answers yet) or admin
  if (!sub && method === "DELETE") {
    if (!can.own) fail(403, "forbidden");
    if (!me.is_admin && (await answerCount(env, s.id)) > 0) fail(409, "has_answers");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM survey_answers WHERE survey_id = ?1").bind(s.id),
      env.DB.prepare("DELETE FROM survey_assignments WHERE survey_id = ?1").bind(s.id),
      env.DB.prepare("DELETE FROM survey_editors WHERE survey_id = ?1").bind(s.id),
      env.DB.prepare("DELETE FROM survey_questions WHERE survey_id = ?1").bind(s.id),
      env.DB.prepare("DELETE FROM survey_sections WHERE survey_id = ?1").bind(s.id),
      env.DB.prepare("DELETE FROM surveys WHERE id = ?1").bind(s.id),
    ]);
    await audit(env, me.id, "survey_deleted", s.id, { title: s.title_en || s.title_he });
    return json({ ok: true });
  }

  if (sub === "duplicate" && method === "POST") {
    if (!can.edit) fail(403, "forbidden");
    return json({ ok: true, id: await duplicateSurvey(env, me, s, body) }, 201);
  }

  // Logo: GET (anyone who can see the survey), PUT raw image body, DELETE
  if (sub === "logo") {
    if (method === "GET") {
      const r = await env.DB.prepare("SELECT logo, logo_type FROM surveys WHERE id = ?1").bind(s.id).first();
      if (!r || !r.logo) fail(404, "not_found");
      // D1 returns BLOBs as an array of byte values.
      const bytes = r.logo instanceof ArrayBuffer ? new Uint8Array(r.logo) : Uint8Array.from(r.logo);
      return new Response(bytes, {
        headers: {
          "Content-Type": r.logo_type,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
        },
      });
    }
    if (!can.edit) fail(403, "forbidden");
    if (method === "PUT") {
      const len = Number(request.headers.get("Content-Length") || "0");
      if (len > MAX_LOGO_BYTES) fail(413, "logo_too_large");
      const buf = new Uint8Array(await request.arrayBuffer());
      if (buf.length > MAX_LOGO_BYTES) fail(413, "logo_too_large");
      const type = sniffImage(buf);
      if (!type) fail(415, "logo_type");
      await env.DB.prepare("UPDATE surveys SET logo = ?1, logo_type = ?2, updated_at = ?3 WHERE id = ?4").bind(buf, type, now(), s.id).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare("UPDATE surveys SET logo = NULL, logo_type = NULL, updated_at = ?1 WHERE id = ?2").bind(now(), s.id).run();
      return json({ ok: true });
    }
  }

  // POST surveys/:id/sections -> new section at the end
  if (sub === "sections" && method === "POST") {
    if (!can.edit) fail(403, "forbidden");
    const pos = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM survey_sections WHERE survey_id = ?1").bind(s.id).first();
    const id = uid();
    await env.DB.prepare(
      "INSERT INTO survey_sections (id, survey_id, position, title_en, title_he, intro_en, intro_he, capability, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
    ).bind(id, s.id, pos.p, str(body.title_en, 200), str(body.title_he, 200), text(body.intro_en, 2000), text(body.intro_he, 2000),
      CAPABILITIES.includes(body.capability) ? body.capability : null, me.id).run();
    await touch(env, s.id);
    return json({ ok: true, id }, 201);
  }

  // People: collaborators and respondents
  if (sub === "people" && method === "GET") {
    if (!can.edit) fail(403, "forbidden");
    const [assigned, eligible, editors] = await env.DB.batch([
      env.DB.prepare(
        `SELECT a.user_id AS id, u.name, u.email, u.status, a.is_ceo, a.assigned_at, a.started_at, a.submitted_at, a.answer_lang
           FROM survey_assignments a JOIN users u ON u.id = a.user_id WHERE a.survey_id = ?1 ORDER BY u.name COLLATE NOCASE`
      ).bind(s.id),
      env.DB.prepare(
        "SELECT id, name, email, status FROM users WHERE company_id = ?1 AND is_respondent = 1 AND status != 'disabled' ORDER BY name COLLATE NOCASE"
      ).bind(s.company_id),
      env.DB.prepare(
        "SELECT u.id, u.name, u.email FROM users u JOIN companies c ON c.id = u.company_id WHERE u.is_editor = 1 AND u.status != 'disabled' AND c.internal = 1 ORDER BY u.name COLLATE NOCASE"
      ),
    ]);
    return json({ ok: true, assigned: assigned.results, eligible: eligible.results, editors: editors.results });
  }

  if (sub === "editors") {
    if (!can.edit) fail(403, "forbidden");
    if (method === "POST") {
      const u = await env.DB.prepare(
        "SELECT u.id FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?1 AND u.is_editor = 1 AND u.status != 'disabled' AND c.internal = 1"
      ).bind(str(body.user_id, 40)).first();
      if (!u) fail(422, "invalid", { fields: ["user"] });
      if (u.id === s.created_by) return json({ ok: true });
      await env.DB.prepare("INSERT OR IGNORE INTO survey_editors (survey_id, user_id, added_by, added_at) VALUES (?1, ?2, ?3, ?4)").bind(s.id, u.id, me.id, now()).run();
      await audit(env, me.id, "editor_added", s.id, { user: u.id });
      return json({ ok: true });
    }
    if (method === "DELETE" && subId) {
      // The creator and admins may remove anyone; a collaborator may remove only themselves.
      if (!can.own && subId !== me.id) fail(403, "forbidden");
      await env.DB.prepare("DELETE FROM survey_editors WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, subId).run();
      await audit(env, me.id, "editor_removed", s.id, { user: subId });
      return json({ ok: true });
    }
  }

  if (sub === "assignments") {
    if (!can.edit) fail(403, "forbidden");
    if (method === "POST") {
      const ids = Array.isArray(body.user_ids) ? body.user_ids.slice(0, 200) : [str(body.user_id, 40)];
      const stmts = [];
      for (const id of ids) {
        const u = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 AND company_id = ?2 AND is_respondent = 1 AND status != 'disabled'")
          .bind(String(id), s.company_id).first();
        if (!u) fail(422, "invalid", { fields: ["user"] });
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO survey_assignments (survey_id, user_id, assigned_at) VALUES (?1, ?2, ?3)").bind(s.id, u.id, now()));
      }
      if (stmts.length) await env.DB.batch(stmts);
      await audit(env, me.id, "respondents_assigned", s.id, { count: stmts.length });
      return json({ ok: true });
    }
    if (method === "PATCH" && subId) {
      // Only one CEO per survey.
      const ceo = bool(body.is_ceo);
      const stmts = [];
      if (ceo) stmts.push(env.DB.prepare("UPDATE survey_assignments SET is_ceo = 0 WHERE survey_id = ?1").bind(s.id));
      stmts.push(env.DB.prepare("UPDATE survey_assignments SET is_ceo = ?1 WHERE survey_id = ?2 AND user_id = ?3").bind(ceo ? 1 : 0, s.id, subId));
      await env.DB.batch(stmts);
      return json({ ok: true });
    }
    if (method === "DELETE" && subId) {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM survey_answers WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, subId).first();
      if (n.n && !me.is_admin) fail(409, "has_answers");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM survey_answers WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, subId),
        env.DB.prepare("DELETE FROM survey_assignments WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, subId),
      ]);
      await audit(env, me.id, "respondent_removed", s.id, { user: subId, answers: n.n });
      return json({ ok: true });
    }
  }

  // PUT surveys/:id/answers { answers: { questionId: value }, lang } -> autosave
  if (sub === "answers" && method === "PUT") {
    if (!can.respond) fail(403, "forbidden");
    if (!isOpenFor(s)) fail(409, "survey_closed");
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const sections = await loadStructure(env, s.id);
    const qs = new Map(sections.flatMap((sec) => sec.questions).map((q) => [q.id, q]));
    const t = now();
    const stmts = [];
    for (const [qid, v] of Object.entries(answers).slice(0, 500)) {
      const q = qs.get(qid);
      if (!q) continue;
      const value = validateAnswer(q, v);
      if (value === null) stmts.push(env.DB.prepare("DELETE FROM survey_answers WHERE survey_id = ?1 AND user_id = ?2 AND question_id = ?3").bind(s.id, me.id, qid));
      else stmts.push(
        env.DB.prepare(
          `INSERT INTO survey_answers (survey_id, user_id, question_id, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (survey_id, user_id, question_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).bind(s.id, me.id, qid, JSON.stringify(value), t)
      );
    }
    const lang = body.lang === "he" ? "he" : "en";
    stmts.push(env.DB.prepare("UPDATE survey_assignments SET started_at = COALESCE(started_at, ?1), answer_lang = ?2 WHERE survey_id = ?3 AND user_id = ?4").bind(t, lang, s.id, me.id));
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    return json({ ok: true, saved_at: t });
  }

  // POST surveys/:id/submit -> checks required questions, marks submitted (answers stay editable while open)
  if (sub === "submit" && method === "POST") {
    if (!can.respond) fail(403, "forbidden");
    if (!isOpenFor(s)) fail(409, "survey_closed");
    const sections = await loadStructure(env, s.id);
    const ans = await env.DB.prepare("SELECT question_id, value FROM survey_answers WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, me.id).all();
    const map = new Map(ans.results.map((r) => [r.question_id, JSON.parse(r.value)]));
    const missing = sections.flatMap((sec) => sec.questions).filter((q) => q.required && !isComplete(q, map.get(q.id))).map((q) => q.id);
    if (missing.length) fail(422, "required_missing", { questions: missing });
    const t = now();
    await env.DB.prepare("UPDATE survey_assignments SET submitted_at = ?1, started_at = COALESCE(started_at, ?1) WHERE survey_id = ?2 AND user_id = ?3").bind(t, s.id, me.id).run();
    return json({ ok: true, submitted_at: t });
  }

  return null;
}

// ---------- Sections ----------

async function routeSection(ctx, secId, sub) {
  const { env, method, me, body } = ctx;
  const sec = await env.DB.prepare("SELECT * FROM survey_sections WHERE id = ?1").bind(secId).first();
  if (!sec) fail(404, "not_found");
  const { survey: s, can } = await access(env, me, sec.survey_id);
  if (!can.edit) fail(403, "forbidden");
  const locked = (await answerCount(env, s.id)) > 0;

  if (!sub && method === "PATCH") {
    if ("capability" in body && locked && (body.capability || null) !== sec.capability) fail(409, "structure_locked");
    await env.DB.prepare("UPDATE survey_sections SET title_en = ?1, title_he = ?2, intro_en = ?3, intro_he = ?4, capability = ?5 WHERE id = ?6")
      .bind(
        "title_en" in body ? str(body.title_en, 200) : sec.title_en,
        "title_he" in body ? str(body.title_he, 200) : sec.title_he,
        "intro_en" in body ? text(body.intro_en, 2000) : sec.intro_en,
        "intro_he" in body ? text(body.intro_he, 2000) : sec.intro_he,
        "capability" in body ? (CAPABILITIES.includes(body.capability) ? body.capability : null) : sec.capability,
        sec.id
      ).run();
    await touch(env, s.id);
    return json({ ok: true });
  }

  // Editors may delete a section they created, if every question in it is also theirs.
  if (!sub && method === "DELETE") {
    if (locked) fail(409, "structure_locked");
    if (!me.is_admin) {
      if (sec.created_by !== me.id) fail(403, "not_creator");
      const other = await env.DB.prepare("SELECT 1 FROM survey_questions WHERE section_id = ?1 AND created_by != ?2 LIMIT 1").bind(sec.id, me.id).first();
      if (other) fail(403, "not_creator");
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM survey_questions WHERE section_id = ?1").bind(sec.id),
      env.DB.prepare("DELETE FROM survey_sections WHERE id = ?1").bind(sec.id),
    ]);
    await renumber(env, "survey_sections", "survey_id", s.id);
    await touch(env, s.id);
    return json({ ok: true });
  }

  if (sub === "/move" && method === "POST") {
    await move(env, "survey_sections", "survey_id", s.id, sec.id, body.dir);
    await touch(env, s.id);
    return json({ ok: true });
  }

  // POST sections/:id/questions -> new question at the end of the section
  if (sub === "/questions" && method === "POST") {
    if (locked) fail(409, "structure_locked");
    const type = TYPES.includes(body.type) ? body.type : fail(422, "bad_type");
    const config = normalizeConfig(type, body.config || defaultConfig(type));
    const pos = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM survey_questions WHERE section_id = ?1").bind(sec.id).first();
    const id = uid();
    await env.DB.prepare(
      "INSERT INTO survey_questions (id, survey_id, section_id, position, type, text_en, text_he, help_en, help_he, required, config, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
    ).bind(id, s.id, sec.id, pos.p, type, text(body.text_en, 1000), text(body.text_he, 1000), text(body.help_en, 1000), text(body.help_he, 1000),
      bool(body.required) ? 1 : 0, JSON.stringify(config), me.id).run();
    await touch(env, s.id);
    return json({ ok: true, id }, 201);
  }
  return null;
}

function defaultConfig(type) {
  const opt = (en, he) => ({ en, he });
  switch (type) {
    case "single": case "multi": case "rank": return { options: [opt("Option 1", "אפשרות 1"), opt("Option 2", "אפשרות 2")] };
    case "grid": return { rows: [opt("Row 1", "שורה 1")], points: 5, start: 1 };
    case "slider": return { start: 0, units: 10, left: opt("Not at all", "בכלל לא"), right: opt("Completely", "במידה מלאה") };
    default: return {};
  }
}

// ---------- Questions ----------

async function routeQuestion(ctx, qid, sub) {
  const { env, method, me, body } = ctx;
  const q = await env.DB.prepare("SELECT * FROM survey_questions WHERE id = ?1").bind(qid).first();
  if (!q) fail(404, "not_found");
  const { survey: s, can } = await access(env, me, q.survey_id);
  if (!can.edit) fail(403, "forbidden");
  const locked = (await answerCount(env, s.id)) > 0;

  if (!sub && method === "PATCH") {
    const type = "type" in body ? (TYPES.includes(body.type) ? body.type : fail(422, "bad_type")) : q.type;
    const oldCfg = JSON.parse(q.config || "{}");
    const config = "config" in body || type !== q.type ? normalizeConfig(type, "config" in body ? body.config : defaultConfig(type)) : oldCfg;
    if (locked && structureOf(type, config) !== structureOf(q.type, oldCfg)) fail(409, "structure_locked");
    let sectionId = q.section_id;
    if (body.section_id && body.section_id !== q.section_id) {
      const sec = await env.DB.prepare("SELECT id FROM survey_sections WHERE id = ?1 AND survey_id = ?2").bind(str(body.section_id, 40), s.id).first();
      if (!sec) fail(422, "invalid", { fields: ["section"] });
      sectionId = sec.id;
    }
    await env.DB.prepare(
      "UPDATE survey_questions SET type = ?1, text_en = ?2, text_he = ?3, help_en = ?4, help_he = ?5, required = ?6, config = ?7, section_id = ?8 WHERE id = ?9"
    ).bind(
      type,
      "text_en" in body ? text(body.text_en, 1000) : q.text_en,
      "text_he" in body ? text(body.text_he, 1000) : q.text_he,
      "help_en" in body ? text(body.help_en, 1000) : q.help_en,
      "help_he" in body ? text(body.help_he, 1000) : q.help_he,
      "required" in body ? (bool(body.required) ? 1 : 0) : q.required,
      JSON.stringify(config),
      sectionId,
      q.id
    ).run();
    if (sectionId !== q.section_id) {
      const pos = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM survey_questions WHERE section_id = ?1 AND id != ?2").bind(sectionId, q.id).first();
      await env.DB.prepare("UPDATE survey_questions SET position = ?1 WHERE id = ?2").bind(pos.p, q.id).run();
      await renumber(env, "survey_questions", "section_id", q.section_id);
    }
    await touch(env, s.id);
    return json({ ok: true, config });
  }

  // Editors may delete only questions they created.
  if (!sub && method === "DELETE") {
    if (locked) fail(409, "structure_locked");
    if (!me.is_admin && q.created_by !== me.id) fail(403, "not_creator");
    await env.DB.prepare("DELETE FROM survey_questions WHERE id = ?1").bind(q.id).run();
    await renumber(env, "survey_questions", "section_id", q.section_id);
    await touch(env, s.id);
    return json({ ok: true });
  }

  if (sub === "/move" && method === "POST") {
    await move(env, "survey_questions", "section_id", q.section_id, q.id, body.dir);
    await touch(env, s.id);
    return json({ ok: true });
  }
  return null;
}

// ---------- Ordering ----------

async function renumber(env, table, parentCol, parentId) {
  const r = await env.DB.prepare(`SELECT id FROM ${table} WHERE ${parentCol} = ?1 ORDER BY position`).bind(parentId).all();
  const stmts = r.results.map((row, i) => env.DB.prepare(`UPDATE ${table} SET position = ?1 WHERE id = ?2`).bind(i, row.id));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function move(env, table, parentCol, parentId, id, dir) {
  const r = await env.DB.prepare(`SELECT id FROM ${table} WHERE ${parentCol} = ?1 ORDER BY position`).bind(parentId).all();
  const ids = r.results.map((x) => x.id);
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await env.DB.batch(ids.map((x, k) => env.DB.prepare(`UPDATE ${table} SET position = ?1 WHERE id = ?2`).bind(k, x)));
}
