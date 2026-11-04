// Client portal API: everything under /api/app/.
//
// Security model
// - Server-side sessions in D1; the cookie is HttpOnly, Secure, SameSite=Strict.
// - Every state-changing request must carry the X-XSim header (forces a CORS preflight, which this
//   Worker never answers, so other sites cannot send one) and, when present, an allowed Origin.
// - A session is "full" only after the password and a current authenticator code (or recovery code).
import { HttpError, fail, json, readJson } from "./http.js";
import { loadSession, routeAuth, publicUser } from "./auth.js";
import { routeAdmin, listAudit } from "./admin.js";
import { routeSurveys } from "./surveys.js";
import { routeResults } from "./results.js";
import { allowedHostsOf } from "../turnstile.js";

// Routes that work without a full session.
const PUBLIC = new Set(["login", "login/mfa", "logout", "setup/check", "setup/password", "setup/totp", "me"]);

export async function handlePortal(request, env, url) {
  try {
    if (!env.DB) fail(503, "unavailable");
    const method = request.method;
    const path = url.pathname.slice("/api/app/".length).replace(/\/+$/, "");

    if (method !== "GET" && method !== "HEAD") {
      if (request.headers.get("X-XSim") !== "1") fail(403, "forbidden");
      const origin = request.headers.get("Origin");
      if (origin) {
        let host = "";
        try { host = new URL(origin).hostname.toLowerCase(); } catch (_) {}
        if (!allowedHostsOf(env).includes(host)) fail(403, "forbidden_origin");
      }
    }

    const auth = await loadSession(request, env, url);
    const isLogoUpload = /^surveys\/[0-9a-f-]{36}\/logo$/.test(path) && method === "PUT";
    const body = method === "POST" || method === "PATCH" || (method === "PUT" && !isLogoUpload) ? await readJson(request) : {};
    const ctx = { request, env, url, path, method, body, auth };

    if (path === "me" && method === "GET") {
      if (!auth) return json({ ok: false, error: "no_session" }, 401);
      const c = await env.DB.prepare("SELECT name FROM companies WHERE id = ?1").bind(auth.user.company_id).first();
      return json({ ok: true, stage: auth.session.stage, user: publicUser(auth.user, c && c.name) });
    }

    if (PUBLIC.has(path)) {
      const r = await routeAuth(ctx);
      if (r) return r;
      fail(404, "not_found");
    }

    if (!auth || auth.session.stage !== "full") fail(401, "no_session");
    ctx.me = auth.user;

    const r =
      (await routeAuth(ctx)) ||
      (await routeAdmin(ctx)) ||
      (path === "audit" && method === "GET" && auth.user.is_admin ? json({ ok: true, entries: await listAudit(env) }) : null) ||
      (await routeResults(ctx)) ||
      (await routeSurveys(ctx));
    if (r) return r;
    fail(404, "not_found");
  } catch (err) {
    if (err instanceof HttpError) return json({ ok: false, error: err.code, ...err.extra }, err.status);
    // A schema older than the code (a migration not yet applied) shows up as a missing table or column.
    if (/no such (column|table)/i.test(String(err && err.message))) {
      console.error("portal database is missing a migration: run npm run db:migrate (or db:migrate:local)", err.message);
      return json({ ok: false, error: "db_outdated" }, 503);
    }
    console.error("portal error", err && err.stack ? err.stack : err);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
