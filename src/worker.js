/**
 * xsim.dev Worker
 *
 * Pages are static assets (served free, never touch this code).
 * This Worker only handles POST /api/lead:
 *   1. origin + size checks
 *   2. honeypot
 *   3. field validation
 *   4. Cloudflare Turnstile server-side verification (hostname + action checked)
 *   5. store in D1
 *   6. notification email to a verified address
 */

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "lead";
const MAX_BODY_BYTES = 16 * 1024;

const LIMITS = {
  name: 120,
  email: 200,
  company: 160,
  role: 120,
  team_size: 20,
  phone: 40,
  message: 3000,
  pref_language: 10,
  page_language: 5,
};

const TEAM_SIZES = new Set(["", "lt6", "6-10", "11-15", "16plus"]);
const LANGS = new Set(["en", "he"]);
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lead") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });
      }
      try {
        return await handleLead(request, env, url);
      } catch (err) {
        console.error("lead handler failed", err && err.stack ? err.stack : err);
        return respond(request, url, { ok: false, error: "server_error" }, 500);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "not_found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleLead(request, env, url) {
  const allowedHosts = (env.ALLOWED_HOSTS || "xsim.dev,www.xsim.dev")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  // 1. Origin check (blocks cross-site form posts from other domains)
  const origin = request.headers.get("Origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch (_) {}
    if (!allowedHosts.includes(originHost)) {
      console.warn("blocked origin", originHost);
      return respond(request, url, { ok: false, error: "forbidden_origin" }, 403);
    }
  }

  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > MAX_BODY_BYTES) {
    return respond(request, url, { ok: false, error: "too_large" }, 413);
  }

  const data = await readBody(request);
  if (!data) return respond(request, url, { ok: false, error: "bad_request" }, 400);

  const pageLang = LANGS.has(clean(data.page_language)) ? clean(data.page_language) : "en";

  // 2. Honeypot: real people never see or fill this field. Pretend success.
  if (clean(data.website)) {
    return respond(request, url, { ok: true }, 200, pageLang);
  }

  // 3. Validate
  const lead = {
    name: clean(data.name),
    email: clean(data.email).toLowerCase(),
    company: clean(data.company),
    role: clean(data.role),
    team_size: clean(data.team_size),
    phone: clean(data.phone),
    message: cleanMultiline(data.message),
    pref_language: clean(data.pref_language),
    page_language: pageLang,
    consent: data.consent === "on" || data.consent === "true" || data.consent === true,
  };

  const errors = [];
  for (const f of ["name", "email", "company", "role"]) if (!lead[f]) errors.push(f);
  for (const [f, max] of Object.entries(LIMITS)) {
    if (lead[f] && lead[f].length > max) errors.push(f);
  }
  if (lead.email && !EMAIL_RE.test(lead.email)) errors.push("email");
  if (!TEAM_SIZES.has(lead.team_size)) errors.push("team_size");
  if (lead.pref_language && !LANGS.has(lead.pref_language)) errors.push("pref_language");
  if (lead.phone && !/^[+()\d\s.-]{6,40}$/.test(lead.phone)) errors.push("phone");
  if (!lead.consent) errors.push("consent");
  if (errors.length) {
    return respond(request, url, { ok: false, error: "invalid", fields: [...new Set(errors)] }, 422, pageLang);
  }

  // 4. Turnstile
  const token = clean(data["cf-turnstile-response"]);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ts = await verifyTurnstile(token, ip, env);
  if (!ts.ok) {
    console.warn("turnstile rejected", ts.reason);
    return respond(request, url, { ok: false, error: "verification_failed" }, 403, pageLang);
  }
  // Hostname/action checks. Turnstile test keys return hostname "example.com", so only
  // enforce the hostname when a real secret is configured.
  const isTestSecret = (env.TURNSTILE_SECRET_KEY || "").startsWith("1x0000000000000000000000000000000AA");
  if (!isTestSecret) {
    if (ts.hostname && !allowedHosts.includes(String(ts.hostname).toLowerCase())) {
      console.warn("turnstile hostname mismatch", ts.hostname);
      return respond(request, url, { ok: false, error: "verification_failed" }, 403, pageLang);
    }
    if (ts.action && ts.action !== TURNSTILE_ACTION) {
      console.warn("turnstile action mismatch", ts.action);
      return respond(request, url, { ok: false, error: "verification_failed" }, 403, pageLang);
    }
  }

  // 5. Store
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const country = (request.cf && request.cf.country) || null;
  let stored = false;
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO leads (id, created_at, name, email, company, role, team_size, phone, message,
                            pref_language, page_language, country, consent)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
      )
        .bind(
          id, createdAt, lead.name, lead.email, lead.company, lead.role,
          lead.team_size || null, lead.phone || null, lead.message || null,
          lead.pref_language || null, lead.page_language, country, lead.consent ? 1 : 0
        )
        .run();
      stored = true;
    } catch (err) {
      console.error("D1 insert failed", err && err.message);
    }
  }

  // 6. Notify. NOTIFY_TO is a comma-separated list; each address must be a verified
  // Email Routing destination. Sent one by one so a problem with one recipient
  // does not stop the others.
  let emailed = false;
  const recipients = String(env.NOTIFY_TO || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (env.EMAIL && recipients.length && env.NOTIFY_FROM) {
    const message = {
      from: { email: env.NOTIFY_FROM, name: "xSim website" },
      // Replies go to the shared xSim inbox, not to the lead.
      replyTo: { email: env.REPLY_TO || "hello@xsim.dev", name: "xSim" },
      subject: `New xSim briefing request: ${lead.company} (${lead.name})`,
      text: notificationText(lead, id, createdAt, country),
    };
    for (const to of recipients) {
      try {
        await env.EMAIL.send({ ...message, to });
        emailed = true;
      } catch (err) {
        console.error("notification email failed", to, err && (err.code || err.message));
      }
    }
    if (emailed && stored) {
      await env.DB.prepare("UPDATE leads SET emailed = 1 WHERE id = ?1").bind(id).run();
    }
  }

  if (!stored && !emailed) {
    // Nothing persisted anywhere: tell the visitor so they can use the fallback email.
    // The full lead is still in the Worker logs (Observability) as a last resort.
    console.error("LEAD NOT PERSISTED", JSON.stringify({ id, createdAt, ...lead }));
    return respond(request, url, { ok: false, error: "server_error" }, 500, pageLang);
  }

  return respond(request, url, { ok: true }, 200, pageLang);
}

async function readBody(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  try {
    if (type.includes("application/json")) {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return null;
      const obj = JSON.parse(text);
      return obj && typeof obj === "object" ? obj : null;
    }
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const fd = await request.formData();
      const obj = {};
      for (const [k, v] of fd.entries()) if (typeof v === "string") obj[k] = v;
      return obj;
    }
  } catch (_) {}
  return null;
}

async function verifyTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: false, reason: "missing_secret" };
  if (!token || token.length > 2048) return { ok: false, reason: "missing_token" };
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  body.append("idempotency_key", crypto.randomUUID());
  try {
    // TURNSTILE_VERIFY_URL override exists only for local testing (.dev.vars); never set it in production.
    const res = await fetch(env.TURNSTILE_VERIFY_URL || TURNSTILE_VERIFY_URL, { method: "POST", body });
    const out = await res.json();
    if (!out.success) return { ok: false, reason: (out["error-codes"] || []).join(",") || "rejected" };
    return { ok: true, hostname: out.hostname, action: out.action };
  } catch (err) {
    return { ok: false, reason: "siteverify_unreachable" };
  }
}

function clean(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanMultiline(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TEAM_SIZE_LABELS = { lt6: "Fewer than 6", "6-10": "6 to 10", "11-15": "11 to 15", "16plus": "16 or more" };

function notificationText(lead, id, createdAt, country) {
  return [
    "New briefing request from xsim.dev",
    "",
    `Name:          ${lead.name}`,
    `Role:          ${lead.role}`,
    `Company:       ${lead.company}`,
    `Email:         ${lead.email}`,
    `Phone:         ${lead.phone || "-"}`,
    `Team size:     ${TEAM_SIZE_LABELS[lead.team_size] || "-"}`,
    `Meeting lang:  ${lead.pref_language === "he" ? "Hebrew" : lead.pref_language === "en" ? "English" : "-"}`,
    `Page lang:     ${lead.page_language}`,
    `Country:       ${country || "-"}`,
    "",
    "What prompted them to reach out:",
    lead.message || "-",
    "",
    `Lead ID: ${id}`,
    `Received: ${createdAt}`,
  ].join("\n");
}

function wantsJson(request) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json");
}

// JSON for the JS-enhanced form; redirects for the no-JS fallback.
function respond(request, url, payload, status, lang = "en") {
  if (wantsJson(request)) return json(payload, status);
  const base = lang === "he" ? "/he" : "";
  const target = payload.ok ? `${base}/thanks/` : `${base}/contact-error/`;
  return Response.redirect(new URL(target, url.origin).toString(), 303);
}

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
