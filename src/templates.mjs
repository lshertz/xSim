// HTML templates for xsim.dev. All copy lives in src/content/<lang>.json.
// Every value is HTML-escaped unless passed through raw().

import { ICONS } from "./icons.mjs";

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const base = (t) => (t.lang === "he" ? "/he/" : "/");
const otherBase = (t) => (t.lang === "he" ? "/" : "/he/");

// ---------- Brand marks ----------

// Brand logo: the hand-written "xSim" on a yellow sticky note (source files in
// SharedGDriveMirror/Graphics/logo; web sizes in site/static/assets/img/logo).
// Natural aspect ratio of the trimmed note is 1290 x 1155.
export function logo(size = "sm") {
  const h = size === "lg" ? 72 : 58;
  const w = Math.round((h * 1290) / 1155);
  return `<img class="logo logo--${size}" src="/assets/img/logo/note-yellow-96.webp" srcset="/assets/img/logo/note-yellow-96.webp 96w, /assets/img/logo/note-yellow-192.webp 192w" sizes="${w}px" width="${w}" height="${h}" alt="xSim">`;
}

// A colored logo note for the small utility pages (thank-you, error, 404).
function pageNote(color) {
  return `<img class="page-note" src="/assets/img/logo/note-${color}-240.webp" srcset="/assets/img/logo/note-${color}-240.webp 240w, /assets/img/logo/note-${color}-480.webp 480w" sizes="140px" width="140" height="140" alt="" aria-hidden="true">`;
}

// Hero diagram: the capability architecture. The six capabilities build Execution, and
// Execution builds business performance. Labels come from t.hero.diagram; icons from src/icons.mjs.
function architectureDiagram(t) {
  const d = t.hero.diagram;
  const rtl = t.dir === "rtl";
  const dirAttr = rtl ? ' direction="rtl"' : "";
  const icon = (name, x, y, size = 24) =>
    `<svg class="arch-icon" x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  // A box with an icon and up to two centred-vertically lines of text.
  const box = (cls, name, x, y, w, h, lines) => {
    const ix = rtl ? x + w - 14 - 22 : x + 14;
    const tx = rtl ? x + w - 44 : x + 44;
    const lh = 18;
    const y0 = y + h / 2 - ((lines.length - 1) * lh) / 2 + 5;
    const text = lines
      .map((l, i) => `<text class="arch-label" x="${tx}" y="${y0 + i * lh}" text-anchor="start"${dirAttr}>${esc(l)}</text>`)
      .join("");
    return `<g class="arch-box ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" />${icon(name, ix, y + h / 2 - 11, 22)}${text}</g>`;
  };
  const arrow = (x1, y1, x2, y2) => `<line class="arch-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arch-arrow)" />`;
  const line = (x1, y1, x2, y2) => `<line class="arch-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;

  // Geometry (viewBox 520 x 532). Columns mirror in RTL by reversing each row.
  const r1x = [0, 178, 356], r1w = 164, r1y = 234, r1h = 74;
  const r2x = [50, 270], r2w = 200, r2y = 342, r2h = 74;
  const order = (arr) => (rtl ? [...arr].reverse() : arr);
  const r1 = order([["information", "arch-box--blue"], ["decision", "arch-box--green"], ["adapt", "arch-box--pink"]]);
  const r1t = order(d.row1);
  const r2 = order([["align", "arch-box--orange"], ["lead", "arch-box--blue"]]);
  const r2t = order(d.row2);
  const c1 = r1x.map((x) => x + r1w / 2);
  const c2 = r2x.map((x) => x + r2w / 2);

  // Performance pill
  const px = 120, py = 8, pw = 280, ph = 48;
  const pix = rtl ? px + pw - 22 - 24 : px + 22;
  const ptx = rtl ? px + pw - 58 : px + 58;
  const perf = `<g class="arch-perf"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="24" />${icon("performance", pix, py + 12)}<text class="arch-perf__label" x="${ptx}" y="${py + 30}" text-anchor="start"${dirAttr}>${esc(d.performance[0])}</text></g>`;

  // Execution box
  const ex = 120, ey = 92, ew = 280, eh = 104;
  const eix = rtl ? ex + ew - 18 - 26 : ex + 18;
  const etx = rtl ? ex + ew - 60 : ex + 60;
  const exec = `<g class="arch-box arch-box--yellow"><rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" rx="10" />${icon("execution", eix, ey + 18, 26)}<text class="arch-exec__title" x="${etx}" y="${ey + 36}" text-anchor="start"${dirAttr}>${esc(d.execution.title)}</text>${d.execution.lines
    .map((l, i) => `<text class="arch-exec__line" x="${etx}" y="${ey + 59 + i * 17}" text-anchor="start"${dirAttr}>${esc(l)}</text>`)
    .join("")}</g>`;

  const cust = box("arch-box--green", "customer", 130, 452, 260, 74, d.customer);

  const connectors = [
    arrow(260, ey, 260, py + ph + 4), // Execution up to performance
    line(260, ey + eh, 260, 214),
    line(c1[0], 214, c1[2], 214),
    ...c1.map((c) => arrow(c, 214, c, r1y - 3)),
    ...c1.map((c) => line(c, r1y + r1h, c, 324)),
    line(c1[0], 324, c1[2], 324),
    ...c2.map((c) => arrow(c, 324, c, r2y - 3)),
    ...c2.map((c) => line(c, r2y + r2h, c, 432)),
    line(c2[0], 432, c2[1], 432),
    arrow(260, 432, 260, 452 - 3),
  ].join("");

  return `<svg class="hero__diagram arch" viewBox="0 0 520 532" role="img" aria-labelledby="arch-title">
<title id="arch-title">${esc(d.title)}</title>
<defs><marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="arch-arrowhead" /></marker></defs>
${connectors}
${perf}
${exec}
${r1.map(([n, cls], i) => box(cls, n, r1x[i], r1y, r1w, r1h, r1t[i])).join("")}
${r2.map(([n, cls], i) => box(cls, n, r2x[i], r2y, r2w, r2h, r2t[i])).join("")}
${cust}
</svg>`;
}

// ---------- Layout ----------

export function layout(t, site, { title, description, path, body, noindex = false }) {
  const url = site.domain + path;
  const enPath = t.lang === "he" ? path.replace(/^\/he\//, "/") : path;
  const hePath = t.lang === "he" ? path : "/he" + path;
  const otherPath = t.lang === "he" ? enPath : hePath;
  return `<!doctype html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" hreflang="en" href="${esc(site.domain + enPath)}">
<link rel="alternate" hreflang="he" href="${esc(site.domain + hePath)}">
<link rel="alternate" hreflang="x-default" href="${esc(site.domain + enPath)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="xSim">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(site.domain)}/assets/img/og-${t.lang}.png">
<meta property="og:image:alt" content="${esc(t.meta.ogAlt)}">
<meta property="og:locale" content="${t.lang === "he" ? "he_IL" : "en_US"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0B1A36">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-48.png" sizes="48x48" type="image/png">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/${t.lang === "he" ? "ibm-plex-sans-hebrew-hebrew-400-normal" : "ibm-plex-sans-latin-400-normal"}.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css?v=${site.buildId}">
<script src="/assets/js/site.js?v=${site.buildId}" defer></script>
</head>
<body>
<a class="skip" href="#main">${esc(t.nav.skip)}</a>
<header class="topbar" data-topbar>
  <div class="wrap topbar__inner">
    <a class="topbar__brand" href="${base(t)}">${logo("sm")}</a>
    <nav class="topbar__nav" id="site-nav" aria-label="Main">
      <a href="${base(t)}#approach">${esc(t.nav.approach)}</a>
      <a href="${base(t)}#capabilities">${esc(t.nav.capabilities)}</a>
      <a href="${base(t)}#engagement">${esc(t.nav.engagement)}</a>
      <a href="${base(t)}#faq">${esc(t.nav.faq)}</a>
      <a class="topbar__lang" href="${esc(otherPath)}" hreflang="${t.otherLang.code}" lang="${t.otherLang.code}" aria-label="${esc(t.otherLang.aria)}">${esc(t.otherLang.label)}</a>
      <a class="btn btn--primary btn--sm" href="${base(t)}#contact">${esc(t.nav.cta)}</a>
    </nav>
    <button class="topbar__toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
      <span class="sr-only" data-label-open="${esc(t.nav.menu)}" data-label-close="${esc(t.nav.close)}">${esc(t.nav.menu)}</span>
      <span class="topbar__bars" aria-hidden="true"></span>
    </button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap footer__inner">
    <div>
      <a class="footer__brand" href="${base(t)}">${logo("lg")}</a>
      <p class="footer__tag">${esc(t.footer.tagline)}</p>
    </div>
    <nav class="footer__links" aria-label="Footer">
      <a href="mailto:${esc(site.contactEmail)}" dir="ltr">${esc(site.contactEmail)}</a>
      <a href="${base(t)}privacy/">${esc(t.footer.privacy)}</a>
      <a href="${esc(otherPath)}" hreflang="${t.otherLang.code}" lang="${t.otherLang.code}">${esc(t.otherLang.label)}</a>
    </nav>
    <p class="footer__legal">© ${site.year} xSim. ${esc(t.footer.rights)}</p>
  </div>
</footer>
</body>
</html>
`;
}

// ---------- Home ----------

export function home(t, site) {
  const c = t.contact;
  const f = c.fields;
  const opt = (obj, sel) =>
    Object.entries(obj)
      .map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}${v === "" ? " disabled" : ""}>${esc(l)}</option>`)
      .join("");

  const body = `
<section class="hero">
  <div class="wrap hero__grid">
    <div class="hero__copy">
      <p class="eyebrow">${esc(t.hero.eyebrow)}</p>
      <h1 class="hero__title">${esc(t.hero.title)}</h1>
      <svg class="brush" viewBox="0 0 300 24" aria-hidden="true" focusable="false"><path d="M4 19 C 70 8, 160 4, 296 6" /><path class="brush__thin" d="M60 15 C 130 9, 200 7, 280 9" /></svg>
      <p class="hero__lead">${esc(t.hero.lead)}</p>
      <div class="hero__ctas">
        <a class="btn btn--primary" href="#contact">${esc(t.hero.ctaPrimary)}</a>
        <a class="btn btn--ghost" href="#engagement">${esc(t.hero.ctaSecondary)}</a>
      </div>
      <p class="hero__note">${esc(t.hero.note)}</p>
    </div>
    <div class="hero__visual">${architectureDiagram(t)}</div>
  </div>
</section>

<section class="section section--tight" aria-labelledby="problem-title">
  <div class="wrap">
    <div class="section__head">
      <p class="eyebrow">${esc(t.problem.eyebrow)}</p>
      <h2 id="problem-title">${esc(t.problem.title)}</h2>
      <p class="section__intro">${esc(t.problem.intro)}</p>
    </div>
    <ol class="ste">
      ${t.problem.items
        .map(
          (it, i) => `<li class="ste__item${i === 2 ? " ste__item--focus" : ""}"><span class="ste__label">${esc(it.label)}</span><p>${esc(it.text)}</p></li>`
        )
        .join("")}
    </ol>
    <p class="callout">${esc(t.problem.closing)}</p>
  </div>
</section>

<section class="section section--ink" id="approach" aria-labelledby="approach-title">
  <div class="wrap">
    <div class="split">
      <div>
        <p class="eyebrow eyebrow--light">${esc(t.approach.eyebrow)}</p>
        <h2 id="approach-title">${esc(t.approach.title)}</h2>
      </div>
      <div class="prose prose--light">${t.approach.body.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
    </div>
    <ol class="pillars">
      ${t.approach.pillars
        .map(
          (p, i) => `<li class="pillar"><span class="pillar__n">0${i + 1}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`
        )
        .join("")}
    </ol>
    <p class="footnote footnote--light">${esc(t.approach.footnote)}</p>
  </div>
</section>

<section class="section" id="capabilities" aria-labelledby="cap-title">
  <div class="wrap">
    <div class="section__head">
      <p class="eyebrow">${esc(t.capabilities.eyebrow)}</p>
      <h2 id="cap-title">${esc(t.capabilities.title)}</h2>
      <p class="section__intro">${esc(t.capabilities.intro)}</p>
    </div>
    <ul class="caps">
      ${t.capabilities.items
        .map(
          (it) => `<li class="cap"><p class="cap__tag"><span>${esc(it.n)}</span> ${esc(it.k)}</p><h3>${esc(it.title)}</h3><p class="cap__q">${esc(it.q)}</p></li>`
        )
        .join("")}
    </ul>
    <div class="execute">
      <p class="execute__tag">${esc(t.capabilities.execute.k)}</p>
      <p class="execute__text">${esc(t.capabilities.execute.text)}</p>
    </div>
  </div>
</section>

<section class="section section--paper2" id="engagement" aria-labelledby="eng-title">
  <div class="wrap">
    <div class="section__head">
      <p class="eyebrow">${esc(t.engagement.eyebrow)}</p>
      <h2 id="eng-title">${esc(t.engagement.title)}</h2>
      <p class="section__intro">${esc(t.engagement.intro)}</p>
    </div>
    <ol class="phases">
      ${t.engagement.phases
        .map(
          (p, i) => `<li class="phase phase--${["yellow", "blue", "green"][i % 3]}">
        <div class="phase__head"><span class="phase__n">${esc(p.n)}</span><h3>${esc(p.k)}</h3><p class="phase__when">${esc(p.when)}</p></div>
        <ul class="phase__points">${p.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </li>`
        )
        .join("")}
    </ol>
  </div>
</section>

<section class="section" aria-labelledby="sim-title">
  <div class="wrap">
    <div class="section__head">
      <p class="eyebrow">${esc(t.simulations.eyebrow)}</p>
      <h2 id="sim-title">${esc(t.simulations.title)}</h2>
      <p class="section__intro">${esc(t.simulations.intro)}</p>
    </div>
    <ul class="sims">
      ${t.simulations.items
        .map(
          (s, i) => `<li class="sim sim--${["orange", "pink", "blue", "green"][i % 4]}"><p class="sim__cap">${esc(s.cap)}</p><h3>${esc(s.name)}</h3><p>${esc(s.text)}</p></li>`
        )
        .join("")}
    </ul>
    <p class="footnote">${esc(t.simulations.note)}</p>
  </div>
</section>

<section class="section section--ink" aria-labelledby="ops-title">
  <div class="wrap split split--ops">
    <div>
      <p class="eyebrow eyebrow--light">${esc(t.operators.eyebrow)}</p>
      <h2 id="ops-title">${esc(t.operators.title)}</h2>
      <div class="prose prose--light"><p>${esc(t.operators.body)}</p><p>${esc(t.operators.closing)}</p><p class="ops__lang">${esc(t.operators.bilingual)}</p></div>
      <p class="ops__team"><a class="btn btn--note" href="${base(t)}team/">${esc(t.operators.teamLink)} <span aria-hidden="true">${t.dir === "rtl" ? "&larr;" : "&rarr;"}</span></a></p>
    </div>
    <div class="stat">
      <p class="stat__n">${esc(t.operators.stat)}</p>
      <p class="stat__label">${esc(t.operators.statLabel)}</p>
      <p class="stat__text">${esc(t.operators.statText)}</p>
    </div>
  </div>
</section>

<section class="section section--paper2" aria-labelledby="models-title">
  <div class="wrap">
    <div class="section__head">
      <p class="eyebrow">${esc(t.models.eyebrow)}</p>
      <h2 id="models-title">${esc(t.models.title)}</h2>
    </div>
    <ul class="models">
      ${t.models.items
        .map((m) => `<li class="model"><h3>${esc(m.title)}</h3><p class="model__sub">${esc(m.sub)}</p><p>${esc(m.text)}</p></li>`)
        .join("")}
      <li class="model model--cost"><h3>${esc(t.models.costTitle)}</h3><p>${esc(t.models.cost)}</p></li>
    </ul>
  </div>
</section>

<section class="section" id="faq" aria-labelledby="faq-title">
  <div class="wrap split split--faq">
    <div>
      <p class="eyebrow">${esc(t.faq.eyebrow)}</p>
      <h2 id="faq-title">${esc(t.faq.title)}</h2>
    </div>
    <div class="faq">
      ${t.faq.items.map((it) => `<details class="faq__item"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join("")}
    </div>
  </div>
</section>

<section class="section section--ink section--contact" id="contact" aria-labelledby="contact-title">
  <div class="wrap split split--contact">
    <div>
      <p class="eyebrow eyebrow--light">${esc(c.eyebrow)}</p>
      <h2 id="contact-title">${esc(c.title)}</h2>
      <p class="prose prose--light">${esc(c.intro)}</p>
      <p class="contact__alt">${esc(c.altEmail)} <a href="mailto:${esc(site.contactEmail)}" dir="ltr">${esc(site.contactEmail)}</a></p>
    </div>
    <form class="form" action="/api/lead" method="post" novalidate data-lead-form
      data-msg-required="${esc(c.errors.required)}" data-msg-email="${esc(c.errors.email)}"
      data-msg-consent="${esc(c.errors.consent)}" data-msg-verification="${esc(c.errors.verification)}"
      data-msg-server="${esc(c.errors.server)} ${esc(site.contactEmail)}" data-msg-sending="${esc(c.sending)}"
      data-msg-success="${esc(c.success)}">
      <input type="hidden" name="page_language" value="${t.lang}">
      <div class="form__grid">
        <div class="field"><label for="f-name">${esc(f.name)}</label><input id="f-name" name="name" type="text" autocomplete="name" maxlength="120" required></div>
        <div class="field"><label for="f-email">${esc(f.email)}</label><input id="f-email" name="email" type="email" autocomplete="email" maxlength="200" required dir="ltr"></div>
        <div class="field"><label for="f-company">${esc(f.company)}</label><input id="f-company" name="company" type="text" autocomplete="organization" maxlength="160" required></div>
        <div class="field"><label for="f-role">${esc(f.role)}</label><input id="f-role" name="role" type="text" autocomplete="organization-title" maxlength="120" required></div>
        <div class="field"><label for="f-team">${esc(f.teamSize)} <span class="field__opt">(${esc(f.optional)})</span></label><select id="f-team" name="team_size">${opt(f.teamSizeOptions, "")}</select></div>
        <div class="field"><label for="f-lang">${esc(f.prefLanguage)}</label><select id="f-lang" name="pref_language">${opt(f.prefLanguageOptions, t.lang)}</select></div>
        <div class="field field--wide"><label for="f-phone">${esc(f.phone)} <span class="field__opt">(${esc(f.optional)})</span></label><input id="f-phone" name="phone" type="tel" autocomplete="tel" maxlength="40" dir="ltr"></div>
        <div class="field field--wide"><label for="f-msg">${esc(f.message)} <span class="field__opt">(${esc(f.optional)})</span></label><textarea id="f-msg" name="message" rows="4" maxlength="3000" aria-describedby="f-msg-hint"></textarea><p class="field__hint" id="f-msg-hint">${esc(f.messageHint)}</p></div>
        <div class="field field--hp" aria-hidden="true"><label for="f-website">${esc(f.honeypot)}</label><input id="f-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
        <div class="field field--wide field--check"><input id="f-consent" name="consent" type="checkbox" required><label for="f-consent">${esc(f.consentPre)}<a href="${base(t)}privacy/">${esc(f.consentLink)}</a>.</label></div>
      </div>
      <div class="cf-turnstile" data-sitekey="${esc(site.turnstileSiteKey)}" data-action="lead" data-language="${t.lang}" data-theme="light" data-size="flexible"></div>
      <div class="form__actions">
        <button class="btn btn--primary btn--note" type="submit">${esc(c.submit)}</button>
        <p class="form__status" role="status" aria-live="polite" data-status></p>
      </div>
    </form>
  </div>
</section>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
`;
  return layout(t, site, { title: t.meta.title, description: t.meta.description, path: base(t), body });
}

// ---------- Simple pages ----------

function simple(t, site, { path, title, body, noindex = true, description }) {
  return layout(t, site, {
    title: `${title} | xSim`,
    description: description || t.meta.description,
    path,
    noindex,
    body: `<section class="section section--page"><div class="wrap wrap--narrow">${body}</div></section>`,
  });
}

export function thanks(t, site) {
  return simple(t, site, {
    path: base(t) + "thanks/",
    title: t.thanks.title,
    body: `${pageNote("green")}<h1>${esc(t.thanks.title)}</h1><p class="lead">${esc(t.thanks.body)}</p><p><a class="btn btn--ghost" href="${base(t)}">${esc(t.thanks.back)}</a></p>`,
  });
}

export function contactError(t, site) {
  return simple(t, site, {
    path: base(t) + "contact-error/",
    title: t.contactError.title,
    body: `${pageNote("orange")}<h1>${esc(t.contactError.title)}</h1><p class="lead">${esc(t.contactError.body)} <a href="mailto:${esc(site.contactEmail)}" dir="ltr">${esc(site.contactEmail)}</a>.</p><p><a class="btn btn--ghost" href="${base(t)}#contact">${esc(t.contactError.back)}</a></p>`,
  });
}

export function notFound(t, site) {
  return simple(t, site, {
    path: base(t) + "404",
    title: t.notFound.title,
    body: `${pageNote("pink")}<h1>${esc(t.notFound.title)}</h1><p class="lead">${esc(t.notFound.body)}</p><p><a class="btn btn--ghost" href="${base(t)}">${esc(t.notFound.back)}</a></p>`,
  });
}

export function team(t, site) {
  const people = t.team.people
    .map(
      (p) => `<article class="person"><h2 class="person__name">${esc(p.name)}</h2><p class="person__role">${esc(p.role)}</p><p class="person__bio">${esc(p.bio)}</p></article>`
    )
    .join("");
  return simple(t, site, {
    path: base(t) + "team/",
    title: t.team.title.replace(/\.$/, ""),
    noindex: false,
    body: `<p class="eyebrow">${esc(t.operators.eyebrow)}</p><h1>${esc(t.team.title)}</h1><p class="lead">${esc(t.team.intro)}</p><div class="people">${people}</div><p class="team__actions"><a class="btn btn--primary" href="${base(t)}#contact">${esc(t.team.cta)}</a> <a class="btn btn--ghost" href="${base(t)}">${esc(t.team.back)}</a></p>`,
  });
}

export function privacy(t, site) {
  const mail = `<a href="mailto:${esc(site.contactEmail)}" dir="ltr">${esc(site.contactEmail)}</a>`;
  const sections = t.privacy.sections
    .map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((p) => `<p>${esc(p).replace("{email}", mail)}</p>`).join("")}`)
    .join("");
  return simple(t, site, {
    path: base(t) + "privacy/",
    title: t.privacy.title,
    noindex: false,
    body: `<div class="legal"><h1>${esc(t.privacy.title)}</h1><p class="legal__updated">${esc(t.privacy.updated)}</p>${sections}</div>`,
  });
}

// ---------- Client portal (/app/ and /he/app/) ----------
// A static shell; site/static/assets/js/portal.js renders every view in the browser.
// Strings come from src/content/portal/<lang>.json.

export function portal(t, p, site) {
  const appBase = t.lang === "he" ? "/he/app/" : "/app/";
  const otherApp = t.lang === "he" ? "/app/" : "/he/app/";
  const config = { lang: t.lang, turnstileSiteKey: site.turnstileSiteKey, t: p };
  // JSON inside a script element: escape "<" so the content can never close the element.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(p.meta.title)}</title>
<meta name="theme-color" content="#0B1A36">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/${t.lang === "he" ? "ibm-plex-sans-hebrew-hebrew-400-normal" : "ibm-plex-sans-latin-400-normal"}.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css?v=${site.buildId}">
<link rel="stylesheet" href="/assets/css/portal.css?v=${site.buildId}">
<script type="application/json" id="portal-config">${json}</script>
<script src="/assets/js/vendor/qrcode.js?v=${site.buildId}" defer></script>
<script src="/assets/js/portal.js?v=${site.buildId}" defer></script>
</head>
<body class="portal">
<a class="skip" href="#app">${esc(t.nav.skip)}</a>
<header class="ptop">
  <div class="wrap ptop__inner">
    <a class="ptop__brand" href="${appBase}#/">${logo("sm")}<span class="ptop__label">${esc(p.meta.label)}</span></a>
    <nav class="ptop__nav" id="portal-nav" aria-label="${esc(p.nav.label)}"></nav>
    <a class="ptop__lang" data-portal-lang href="${otherApp}" hreflang="${t.otherLang.code}" lang="${t.otherLang.code}" aria-label="${esc(t.otherLang.aria)}">${esc(t.otherLang.label)}</a>
  </div>
</header>
<main id="app" class="wrap pmain" tabindex="-1">
<noscript><p class="notice">${esc(p.meta.noscript)}</p></noscript>
</main>
<div id="portal-live" class="toast" role="status" aria-live="polite"></div>
<footer class="pfoot">
  <div class="wrap pfoot__inner">
    <span>© ${site.year} xSim</span>
    <a href="mailto:${esc(site.contactEmail)}" dir="ltr">${esc(site.contactEmail)}</a>
    <a href="${base(t)}privacy/">${esc(t.footer.privacy)}</a>
    <a href="${base(t)}">xsim.dev</a>
  </div>
</footer>
</body>
</html>
`;
}
