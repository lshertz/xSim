// Builds the static site into ./public from src/content/*.json + src/templates.mjs.
// No dependencies beyond Node 18+. Run: npm run build
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { home, thanks, contactError, notFound, privacy } from "./src/templates.mjs";

const OUT = "public";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const site = read("src/content/site.json");

// Local preview (`npm run dev` passes --dev): use Cloudflare's dummy Turnstile site key.
// Its dummy token is accepted by the dummy secret in .dev.vars; a real site key's token
// is rejected by the dummy secret, which is why the form failed locally.
const DEV = process.argv.includes("--dev");
if (DEV) site.turnstileSiteKey = "1x00000000000000000000AA";
const langs = { en: read("src/content/en.json"), he: read("src/content/he.json") };

// Cache-busting id from the CSS/JS contents
site.buildId = createHash("sha1")
  .update(readFileSync("site/static/assets/css/site.css"))
  .update(readFileSync("site/static/assets/js/site.js"))
  .digest("hex")
  .slice(0, 10);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync("site/static", OUT, { recursive: true });

const write = (rel, html) => {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
};

for (const [code, t] of Object.entries(langs)) {
  const prefix = code === "en" ? "" : `${code}/`;
  write(`${prefix}index.html`, home(t, site));
  write(`${prefix}thanks/index.html`, thanks(t, site));
  write(`${prefix}contact-error/index.html`, contactError(t, site));
  write(`${prefix}privacy/index.html`, privacy(t, site));
  write(`${prefix}404.html`, notFound(t, site));
}

// Sitemap
const urls = ["/", "/he/", "/privacy/", "/he/privacy/"];
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls
  .map((u) => {
    const en = u.replace(/^\/he\//, "/");
    const he = u.startsWith("/he/") ? u : "/he" + u;
    return `  <url><loc>${site.domain}${u}</loc><xhtml:link rel="alternate" hreflang="en" href="${site.domain}${en}"/><xhtml:link rel="alternate" hreflang="he" href="${site.domain}${he}"/></url>`;
  })
  .join("\n")}
</urlset>
`
);

// Guard rails: house style forbids em dashes in prepared content.
const banned = [/\u2014/];
for (const [code, t] of Object.entries(langs)) {
  const s = JSON.stringify(t);
  for (const re of banned) if (re.test(s)) console.warn(`WARNING: em dash found in src/content/${code}.json`);
}
if (!DEV && site.turnstileSiteKey.startsWith("1x000")) {
  console.warn("NOTE: using the Turnstile TEST site key. Put the real site key in src/content/site.json before going live.");
}
if (!existsSync(join(OUT, "assets/img/og-en.png"))) {
  console.warn("NOTE: social preview image missing (assets/img/og-en.png).");
}
console.log(`Built ${OUT}/ (buildId ${site.buildId})${DEV ? " [local preview: Turnstile test keys]" : ""}`);
