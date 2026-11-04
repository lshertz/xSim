// Cloudflare Turnstile server-side verification, shared by the briefing form and the portal sign-in.
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token, ip, env) {
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

// Hostname and action checks. Turnstile test keys return hostname "example.com", so these
// are enforced only when a real secret is configured.
export function turnstileMatches(ts, env, allowedHosts, action) {
  const isTestSecret = (env.TURNSTILE_SECRET_KEY || "").startsWith("1x0000000000000000000000000000000AA");
  if (isTestSecret) return true;
  if (ts.hostname && !allowedHosts.includes(String(ts.hostname).toLowerCase())) return false;
  if (ts.action && ts.action !== action) return false;
  return true;
}

export function allowedHostsOf(env) {
  return (env.ALLOWED_HOSTS || "xsim.dev,www.xsim.dev")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
