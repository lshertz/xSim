// Creates the first portal admin (or issues a fresh setup link for an existing one) and prints the setup link.
//
//   npm run portal:admin -- you@example.com "Full Name" "+972 50 000 0000"          (live database)
//   npm run portal:admin:local -- you@example.com "Full Name" "+972 50 000 0000"    (local preview database)
//
// Optional 4th argument: he, for a Hebrew setup page. Only needed until the first admin can sign in;
// after that, admins create users in the portal.
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const [email, name, phone, lang = "en"] = args.filter((a) => !a.startsWith("--"));
if (!email || !name || !phone) {
  console.error('Usage: npm run portal:admin -- email "Full Name" "phone" [en|he]');
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const companyId = randomUUID();
const userId = randomUUID();
const em = email.trim().toLowerCase();

// Idempotent: reuses the xSim company and an existing user with this email (made admin and editor, set to pending).
const sql = `
INSERT OR IGNORE INTO companies (id, name, created_at, internal) VALUES (${q(companyId)}, 'xSim', ${q(now)}, 1);
UPDATE companies SET internal = 1 WHERE name = 'xSim';
INSERT OR IGNORE INTO users (id, email, name, phone, company_id, lang, is_admin, is_editor, status, created_at)
  VALUES (${q(userId)}, ${q(em)}, ${q(name)}, ${q(phone)}, (SELECT id FROM companies WHERE name = 'xSim'), ${q(lang === "he" ? "he" : "en")}, 1, 1, 'pending', ${q(now)});
UPDATE users SET is_admin = 1, is_editor = 1, status = CASE WHEN status = 'active' THEN 'active' ELSE 'pending' END WHERE email = ${q(em)};
UPDATE auth_tokens SET used_at = ${q(now)} WHERE used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = ${q(em)});
INSERT INTO auth_tokens (token_hash, user_id, purpose, created_at, expires_at)
  VALUES (${q(tokenHash)}, (SELECT id FROM users WHERE email = ${q(em)}), CASE WHEN (SELECT password_hash FROM users WHERE email = ${q(em)}) IS NULL THEN 'setup' ELSE 'reset' END, ${q(now)}, ${q(expires)});
INSERT INTO audit_log (at, action, target_id, detail) VALUES (${q(now)}, 'admin_bootstrap', (SELECT id FROM users WHERE email = ${q(em)}), NULL);
`;

const dir = mkdtempSync(join(tmpdir(), "xsim-"));
const file = join(dir, "bootstrap.sql");
writeFileSync(file, sql);
const r = spawnSync("npx", ["wrangler", "d1", "execute", "xsim-leads", remote ? "--remote" : "--local", "--file", file], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
rmSync(dir, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status || 1);

const origin = remote ? "https://xsim.dev" : "http://127.0.0.1:8787";
console.log(`\nSetup link for ${em} (single use, valid 7 days). If the account already had a password, it is replaced when the link is used:\n\n  ${origin}${lang === "he" ? "/he" : ""}/app/#/setup/${token}\n`);
