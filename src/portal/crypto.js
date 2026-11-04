// Crypto helpers for the client portal. Everything uses the Workers WebCrypto API; no dependencies.

const enc = new TextEncoder();

// PBKDF2-SHA256 iteration count. It is stored inside each hash, so it can be raised later
// without breaking existing passwords (old hashes keep verifying with their own count).
export const PBKDF2_ITERATIONS = 100000;

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function b64url(bytes) {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Constant-time comparison of two equal-length strings.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [alg, iter, salt, hash] = String(stored).split("$");
  if (alg !== "pbkdf2-sha256") return false;
  const got = await pbkdf2(password, fromB64url(salt), Number(iter));
  return safeEqual(b64url(got), hash);
}

// ---------- TOTP (RFC 6238: SHA-1, 6 digits, 30-second steps) ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

async function hotp(secretB32, counter) {
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = mac[mac.length - 1] & 0xf;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1000000).padStart(6, "0");
}

// Returns the matching time step (allowing one step of clock drift either way), or 0 if no match.
// Steps at or before lastStep are rejected so a code cannot be used twice.
export async function verifyTotp(secretB32, code, lastStep = 0, now = Date.now()) {
  const c = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c) || !secretB32) return 0;
  const step = Math.floor(now / 1000 / 30);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue;
    if (safeEqual(await hotp(secretB32, s), c)) return s;
  }
  return 0;
}

export function otpauthUri(secret, email, issuer = "xSim") {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Recovery codes: 10 characters from an unambiguous alphabet, shown as XXXXX-XXXXX.
const RC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newRecoveryCode() {
  const b = randomBytes(10);
  let s = "";
  for (const x of b) s += RC[x % RC.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
export function normalizeRecoveryCode(c) {
  return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
