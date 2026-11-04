// Sign-in, sessions, first-time setup and two-factor authentication.
import {
  randomToken, sha256Hex, hashPassword, verifyPassword, newTotpSecret, verifyTotp, otpauthUri,
  newRecoveryCode, normalizeRecoveryCode,
} from "./crypto.js";
import { fail, json, now, addMinutes, str } from "./http.js";
import { verifyTurnstile, turnstileMatches, allowedHostsOf } from "../turnstile.js";

const SESSION_FULL_MIN = 12 * 60;   // absolute lifetime of a signed-in session
const SESSION_IDLE_MIN = 120;       // signed out after two hours without activity
const SESSION_MFA_MIN = 10;         // time allowed to enter the code after the password
const SESSION_SETUP_MIN = 30;       // time allowed to finish password and 2FA setup
const MAX_FAILED = 8;               // failed passwords before a 15-minute lock
const LOCK_MIN = 15;
const MFA_MAX_FAILED = 5;           // failed authenticator or recovery codes before a lock
const MFA_LOCK_MAX_MIN = 24 * 60;   // code lockouts double each time, up to 24 hours
const SETUP_RESUME_HOURS = 24;      // a password set from a link can be used to finish 2FA setup for 24 hours
export const TOKEN_DAYS = { setup: 7, reset: 3 };
const MIN_PASSWORD = 10;

// ---------- Cookies ----------

// Local preview (npm run dev) sets PORTAL_ORIGIN to http://127.0.0.1:8787. There the cookie cannot be
// Secure, because the preview is plain http. In production PORTAL_ORIGIN is unset, and any value that
// is not a localhost address is ignored, so a mistaken setting can never weaken the cookie.
const isLocalHttp = (env) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(env.PORTAL_ORIGIN || ""));
const cookieName = (env) => (isLocalHttp(env) ? "xsim_session" : "__Host-xsim_session");

function sessionCookie(env, value, maxAgeSec) {
  const secure = isLocalHttp(env) ? "" : "; Secure";
  return `${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

// Links always point at the canonical site (first ALLOWED_HOSTS entry), never at whatever host a request came in on.
export const portalOrigin = (env) => (isLocalHttp(env) ? env.PORTAL_ORIGIN : `https://${allowedHostsOf(env)[0]}`);

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

// ---------- Sessions ----------

export async function createSession(env, url, userId, stage) {
  const token = randomToken(32);
  const minutes = stage === "full" ? SESSION_FULL_MIN : stage === "mfa" ? SESSION_MFA_MIN : SESSION_SETUP_MIN;
  const t = now();
  await env.DB.prepare(
    "INSERT INTO sessions (id_hash, user_id, stage, created_at, expires_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?4)"
  ).bind(await sha256Hex(token), userId, stage, t, addMinutes(minutes)).run();
  return sessionCookie(env, token, minutes * 60);
}

export function clearCookie(env) {
  return sessionCookie(env, "", 0);
}

// Returns { session, user } or null. Expired and idle sessions are removed.
export async function loadSession(request, env, url) {
  const token = readCookie(request, cookieName(env));
  if (!token || token.length > 100) return null;
  const idHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id_hash, s.stage, s.expires_at, s.last_seen_at, c.internal AS company_internal, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id WHERE s.id_hash = ?1`
  ).bind(idHash).first();
  if (!row) return null;
  const t = Date.now();
  const idle = row.stage === "full" && t - Date.parse(row.last_seen_at) > SESSION_IDLE_MIN * 60000;
  if (Date.parse(row.expires_at) < t || idle || row.status === "disabled") {
    await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(idHash).run();
    return null;
  }
  // Refresh last-seen at most once a minute to limit writes.
  if (t - Date.parse(row.last_seen_at) > 60000) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE id_hash = ?2").bind(now(), idHash).run();
  }
  const { id_hash, stage, expires_at, last_seen_at, company_internal, ...user } = row;
  // Defense in depth: staff roles count only for members of the xSim company, whatever the user row says.
  if (!company_internal) {
    user.is_admin = 0;
    user.is_editor = 0;
  }
  return { session: { idHash: id_hash, stage }, user };
}

export async function endSession(env, idHash) {
  await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(idHash).run();
}

export async function endAllSessions(env, userId) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).run();
}

// The view of a user the browser gets. Never includes secrets.
export function publicUser(u, company) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    company_id: u.company_id,
    company: company ?? u.company_name ?? null,
    lang: u.lang,
    roles: {
      admin: !!u.is_admin,
      editor: !!u.is_editor,
      viewer: !!u.is_viewer,
      respondent: !!u.is_respondent,
    },
    status: u.status,
    mfa: !!u.totp_secret,
    last_login_at: u.last_login_at || null,
    created_at: u.created_at,
  };
}

export async function audit(env, actorId, action, targetId = null, detail = null) {
  try {
    await env.DB.prepare("INSERT INTO audit_log (at, actor_id, action, target_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(now(), actorId, action, targetId, detail ? JSON.stringify(detail) : null)
      .run();
  } catch (e) {
    console.error("audit failed", e && e.message);
  }
}

// ---------- Link tokens (setup and reset) ----------

export async function issueLinkToken(env, userId, purpose, actorId) {
  const token = randomToken(32);
  // Any earlier unused link for this user stops working.
  await env.DB.prepare("UPDATE auth_tokens SET used_at = ?1 WHERE user_id = ?2 AND used_at IS NULL").bind(now(), userId).run();
  await env.DB.prepare(
    "INSERT INTO auth_tokens (token_hash, user_id, purpose, created_at, expires_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
  ).bind(await sha256Hex(token), userId, purpose, now(), addMinutes(TOKEN_DAYS[purpose] * 24 * 60), actorId).run();
  return token;
}

export function linkFor(env, url, lang, token) {
  const base = lang === "he" ? "/he/app/" : "/app/";
  return `${portalOrigin(env)}${base}#/setup/${token}`;
}

async function findToken(env, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT t.token_hash, t.purpose, t.expires_at, t.used_at, u.id AS user_id, u.email, u.name, u.status, u.lang
       FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?1`
  ).bind(hash).first();
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now() || row.status === "disabled") return null;
  return row;
}

// ---------- Helpers ----------

// Counters are incremented in SQL (not read-modify-write) so parallel requests cannot slip past the limit.
async function registerFailure(env, user) {
  const r = await env.DB.prepare(
    `UPDATE users SET failed_logins = failed_logins + 1,
            locked_until = CASE WHEN failed_logins + 1 >= ?1 THEN ?2 ELSE locked_until END
      WHERE id = ?3 RETURNING failed_logins`
  ).bind(MAX_FAILED, addMinutes(LOCK_MIN), user.id).first();
  if (r && r.failed_logins >= MAX_FAILED) {
    await env.DB.prepare("UPDATE users SET failed_logins = 0 WHERE id = ?1").bind(user.id).run();
    await audit(env, user.id, "account_locked", user.id);
  }
}

// Wrong authenticator or recovery codes. Someone who reaches this step already has the password,
// so each lockout is twice as long as the last (15 min, 30, 60, ... 24 h) until a successful sign-in.
async function registerMfaFailure(env, user) {
  const r = await env.DB.prepare("UPDATE users SET mfa_failures = mfa_failures + 1 WHERE id = ?1 RETURNING mfa_failures, mfa_locks")
    .bind(user.id).first();
  if (r && r.mfa_failures >= MFA_MAX_FAILED) {
    const minutes = Math.min(LOCK_MIN * 2 ** r.mfa_locks, MFA_LOCK_MAX_MIN);
    await env.DB.prepare("UPDATE users SET mfa_failures = 0, mfa_locks = mfa_locks + 1, mfa_locked_until = ?1 WHERE id = ?2")
      .bind(addMinutes(minutes), user.id).run();
    // A second-factor lockout means someone may have the password: end every session for this user.
    await endAllSessions(env, user.id);
    await audit(env, user.id, "mfa_locked", user.id, { minutes });
  }
}

const isLocked = (u) => u.locked_until && Date.parse(u.locked_until) > Date.now();
const isMfaLocked = (u) => u.mfa_locked_until && Date.parse(u.mfa_locked_until) > Date.now();

// Accepts a TOTP code at most once: the step is recorded atomically, so two requests with the same code cannot both pass.
async function useTotp(env, user, code) {
  const step = await verifyTotp(user.totp_secret, code, user.totp_last_step);
  if (!step) return false;
  const r = await env.DB.prepare("UPDATE users SET totp_last_step = ?1 WHERE id = ?2 AND totp_last_step < ?1").bind(step, user.id).run();
  return !!(r.meta && r.meta.changes === 1);
}

function checkPasswordStrength(pw, email) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) fail(422, "password_short");
  if (pw.length > 200) fail(422, "too_long");
  const local = String(email || "").split("@")[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local) && pw.length < 16) fail(422, "password_weak");
  if (new Set(pw).size < 5) fail(422, "password_weak");
}

async function makeRecoveryCodes(env, userId) {
  await env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?1").bind(userId).run();
  const codes = [];
  const stmts = [];
  for (let i = 0; i < 8; i++) {
    const c = newRecoveryCode();
    codes.push(c);
    stmts.push(
      env.DB.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?1, ?2)").bind(userId, await sha256Hex(normalizeRecoveryCode(c)))
    );
  }
  await env.DB.batch(stmts);
  return codes;
}

// ---------- Route handlers ----------

export async function routeAuth(ctx) {
  const { request, env, url, path, method, body, auth } = ctx;

  // POST /login  { email, password, turnstile }
  if (path === "login" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ts = await verifyTurnstile(String(body.turnstile || ""), ip, env);
    if (!ts.ok || !turnstileMatches(ts, env, allowedHostsOf(env), "login")) fail(403, "verification_failed");
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const user = email ? await env.DB.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first() : null;
    // A pending user who already chose a password (but has not finished 2FA) may sign in to finish setup.
    if (!user || user.status === "disabled" || !user.password_hash) {
      // Same answer whether or not the account exists. Spend comparable time.
      await verifyPassword(password || "x", "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
      fail(401, "bad_credentials");
    }
    if (isLocked(user)) fail(429, "locked");
    if (!(await verifyPassword(password, user.password_hash))) {
      await registerFailure(env, user);
      fail(401, "bad_credentials");
    }
    if (isMfaLocked(user)) fail(429, "mfa_locked");
    const stage = user.totp_secret ? "mfa" : "setup";
    if (stage === "setup") {
      // Password set from a link but 2FA never confirmed: setup may be resumed for a limited time only,
      // so an account can never sit for long with a password and no second factor.
      const setAt = Date.parse(user.password_set_at || "");
      if (!Number.isFinite(setAt) || Date.now() - setAt > SETUP_RESUME_HOURS * 3600000) fail(403, "setup_expired");
      await ensurePendingTotp(env, user);
    }
    const cookie = await createSession(env, url, user.id, stage);
    return json({ ok: true, next: stage }, 200, { "Set-Cookie": cookie });
  }

  // POST /login/mfa  { code } or { recovery }
  if (path === "login/mfa" && method === "POST") {
    if (!auth || auth.session.stage !== "mfa") fail(401, "no_session");
    const user = auth.user;
    if (isMfaLocked(user)) fail(429, "mfa_locked");
    let ok = false;
    if (body.recovery) {
      const h = await sha256Hex(normalizeRecoveryCode(body.recovery));
      const r = await env.DB.prepare("UPDATE recovery_codes SET used_at = ?1 WHERE user_id = ?2 AND code_hash = ?3 AND used_at IS NULL")
        .bind(now(), user.id, h).run();
      ok = r.meta && r.meta.changes === 1;
      if (ok) await audit(env, user.id, "recovery_code_used", user.id);
    } else {
      ok = await useTotp(env, user, body.code);
    }
    if (!ok) {
      await registerMfaFailure(env, user);
      fail(401, "bad_code");
    }
    await env.DB.prepare(
      "UPDATE users SET failed_logins = 0, locked_until = NULL, mfa_failures = 0, mfa_locks = 0, mfa_locked_until = NULL, last_login_at = ?1 WHERE id = ?2"
    ).bind(now(), user.id).run();
    await endSession(env, auth.session.idHash);
    const cookie = await createSession(env, url, user.id, "full");
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  }

  if (path === "logout" && method === "POST") {
    if (auth) await endSession(env, auth.session.idHash);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(env) });
  }

  // POST /setup/check { token } -> who the link is for
  if (path === "setup/check" && method === "POST") {
    const t = await findToken(env, body.token);
    if (!t) fail(404, "link_invalid");
    return json({ ok: true, email: t.email, name: t.name, purpose: t.purpose, lang: t.lang });
  }

  // POST /setup/password { token, password } -> password saved, 2FA setup begins
  if (path === "setup/password" && method === "POST") {
    const t = await findToken(env, body.token);
    if (!t) fail(404, "link_invalid");
    checkPasswordStrength(body.password, t.email);
    const hash = await hashPassword(body.password);
    const secret = newTotpSecret();
    const r = await env.DB.prepare("UPDATE auth_tokens SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL").bind(now(), t.token_hash).run();
    if (!r.meta || r.meta.changes !== 1) fail(404, "link_invalid");
    await env.DB.prepare(
      `UPDATE users SET password_hash = ?1, totp_secret = NULL, totp_pending = ?2, totp_last_step = 0, password_set_at = ?4,
              status = 'pending', failed_logins = 0, locked_until = NULL, mfa_failures = 0, mfa_locks = 0, mfa_locked_until = NULL WHERE id = ?3`
    ).bind(hash, secret, t.user_id, now()).run();
    await endAllSessions(env, t.user_id);
    await audit(env, t.user_id, "password_set", t.user_id, { purpose: t.purpose });
    const cookie = await createSession(env, url, t.user_id, "setup");
    return json({ ok: true, next: "setup" }, 200, { "Set-Cookie": cookie });
  }

  // GET /setup/totp -> secret and otpauth URI for the authenticator app
  if (path === "setup/totp" && method === "GET") {
    if (!auth || auth.session.stage !== "setup") fail(401, "no_session");
    const secret = await ensurePendingTotp(env, auth.user);
    return json({ ok: true, secret, uri: otpauthUri(secret, auth.user.email) });
  }

  // POST /setup/totp { code } -> 2FA confirmed, account active, recovery codes returned once
  if (path === "setup/totp" && method === "POST") {
    if (!auth || auth.session.stage !== "setup") fail(401, "no_session");
    const user = auth.user;
    if (!user.totp_pending) fail(409, "no_pending_setup");
    const step = await verifyTotp(user.totp_pending, body.code, 0);
    if (!step) fail(401, "bad_code");
    await env.DB.prepare(
      `UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ?1, status = 'active',
              failed_logins = 0, locked_until = NULL, last_login_at = ?2 WHERE id = ?3`
    ).bind(step, now(), user.id).run();
    const codes = await makeRecoveryCodes(env, user.id);
    await audit(env, user.id, "mfa_enabled", user.id);
    await endSession(env, auth.session.idHash);
    const cookie = await createSession(env, url, user.id, "full");
    return json({ ok: true, recovery: codes }, 200, { "Set-Cookie": cookie });
  }

  // POST /account/password { current, password }
  if (path === "account/password" && method === "POST") {
    if (!auth || auth.session.stage !== "full") fail(401, "no_session");
    if (isLocked(auth.user)) fail(429, "locked");
    if (!(await verifyPassword(String(body.current || ""), auth.user.password_hash))) {
      await registerFailure(env, auth.user);
      fail(401, "bad_credentials");
    }
    checkPasswordStrength(body.password, auth.user.email);
    await env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await hashPassword(body.password), auth.user.id).run();
    // Sign out other devices.
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND id_hash != ?2").bind(auth.user.id, auth.session.idHash).run();
    await audit(env, auth.user.id, "password_changed", auth.user.id);
    return json({ ok: true });
  }

  // POST /account/recovery { code } -> new set of recovery codes (needs a current authenticator code)
  if (path === "account/recovery" && method === "POST") {
    if (!auth || auth.session.stage !== "full") fail(401, "no_session");
    if (isMfaLocked(auth.user)) fail(429, "mfa_locked");
    if (!(await useTotp(env, auth.user, body.code))) {
      await registerMfaFailure(env, auth.user);
      fail(401, "bad_code");
    }
    const codes = await makeRecoveryCodes(env, auth.user.id);
    await audit(env, auth.user.id, "recovery_codes_regenerated", auth.user.id);
    return json({ ok: true, recovery: codes });
  }

  // POST /account/lang { lang }
  if (path === "account/lang" && method === "POST") {
    if (!auth || auth.session.stage !== "full") fail(401, "no_session");
    const lang = body.lang === "he" ? "he" : "en";
    await env.DB.prepare("UPDATE users SET lang = ?1 WHERE id = ?2").bind(lang, auth.user.id).run();
    return json({ ok: true });
  }

  return null;
}

async function ensurePendingTotp(env, user) {
  if (user.totp_pending) return user.totp_pending;
  const secret = newTotpSecret();
  await env.DB.prepare("UPDATE users SET totp_pending = ?1 WHERE id = ?2").bind(secret, user.id).run();
  user.totp_pending = secret;
  return secret;
}
