// Request/response helpers for the portal API.

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const fail = (status, code, extra) => {
  throw new HttpError(status, code, extra);
};

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export async function readJson(request, max = 64 * 1024) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (Number(request.headers.get("Content-Length") || "0") > max) fail(413, "too_large");
  const text = await request.text();
  if (!text) return {};
  if (!type.includes("application/json")) fail(415, "json_required");
  if (text.length > max) fail(413, "too_large");
  try {
    const obj = JSON.parse(text || "{}");
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) fail(400, "bad_request");
    return obj;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(400, "bad_request");
  }
}

export const now = () => new Date().toISOString();
export const addMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();
export const uid = () => crypto.randomUUID();

// Single-line string, control characters removed, trimmed, length-limited.
export function str(v, max = 200) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" && typeof v !== "number") fail(400, "bad_request");
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) fail(422, "too_long");
  return s;
}

// Multi-line string (keeps line breaks).
export function text(v, max = 4000) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") fail(400, "bad_request");
  const s = v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > max) fail(422, "too_long");
  return s;
}

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const PHONE_RE = /^[+()\d\s.-]{6,40}$/;

export const bool = (v) => v === true || v === 1 || v === "1" || v === "true" || v === "on";

export function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  // Prefix formula-like values so spreadsheet apps do not execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
