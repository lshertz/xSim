// HTML templates for xsim.dev. All copy lives in src/content/<lang>.json.
// Every value is HTML-escaped unless passed through raw().

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

export function wordmark() {
  // Typographic wordmark: an "x" built from two strokes (one deliberately broken:
  // the signal that gets lost), followed by "Sim".
  return `<span class="wordmark" aria-label="xSim"><svg class="wordmark__x" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4 L20 20" /><path d="M20 4 L14.2 9.8 M9.8 14.2 L4 20" /></svg><span class="wordmark__sim" aria-hidden="true">Sim</span></span>`;
}

function capabilityDiagram(t) {
  const items = t.capabilities.items;
  const cx = 240, cy = 240, r = 168;
  const rtl = t.dir === "rtl";
  const nodes = items.map((it, i) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    return { ...it, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a };
  });
  const ring = nodes
    .map((n, i) => {
      const m = nodes[(i + 1) % nodes.length];
      // One link drawn as broken: information decay.
      const cls = i === 1 ? "dg-link dg-link--broken" : "dg-link";
      return `<line class="${cls}" x1="${n.x.toFixed(1)}" y1="${n.y.toFixed(1)}" x2="${m.x.toFixed(1)}" y2="${m.y.toFixed(1)}" />`;
    })
    .join("");
  const spokes = nodes
    .map((n) => `<line class="dg-spoke" x1="${cx}" y1="${cy}" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}" />`)
    .join("");
  const dots = nodes
    .map((n) => {
      const lx = cx + (r + 36) * Math.cos(n.a);
      const ly = cy + (r + 36) * Math.sin(n.a);
      const cos = Math.cos(n.a);
      let anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
      // With direction="rtl", SVG start/end are mirrored; swap so labels sit outside the ring.
      if (rtl && anchor !== "middle") anchor = anchor === "start" ? "end" : "start";
      const dy = Math.sin(n.a) < -0.5 ? -4 : Math.sin(n.a) > 0.5 ? 14 : 5;
      return `<g class="dg-node"><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="22" /><text class="dg-num" x="${n.x.toFixed(1)}" y="${(n.y + 5).toFixed(1)}" text-anchor="middle">${esc(n.n)}</text><text class="dg-label" x="${lx.toFixed(1)}" y="${(ly + dy).toFixed(1)}" text-anchor="${anchor}"${rtl ? ' direction="rtl"' : ""}>${esc(n.k)}</text></g>`;
    })
    .join("");
  return `<svg class="hero__diagram" viewBox="-70 0 620 480" role="img" aria-labelledby="dg-title">
<title id="dg-title">${esc(t.hero.diagramTitle)}</title>
<circle class="dg-orbit" cx="${cx}" cy="${cy}" r="${r}" />
${spokes}${ring}
<g class="dg-core"><circle cx="${cx}" cy="${cy}" r="58" /><text x="${cx}" y="${cy + 5}" text-anchor="middle">${esc(t.hero.diagramCenter)}</text></g>
${dots}
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
<meta name="theme-color" content="#0E1726">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/${t.lang === "he" ? "ibm-plex-sans-hebrew-hebrew-400-normal" : "ibm-plex-sans-latin-400-normal"}.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css?v=${site.buildId}">
<script src="/assets/js/site.js?v=${site.buildId}" defer></script>
</head>
<body>
<a class="skip" href="#main">${esc(t.nav.skip)}</a>
<header class="topbar" data-topbar>
  <div class="wrap topbar__inner">
    <a class="topbar__brand" href="${base(t)}">${wordmark()}</a>
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
      <a class="footer__brand" href="${base(t)}">${wordmark()}</a>
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
      <p class="hero__lead">${esc(t.hero.lead)}</p>
      <div class="hero__ctas">
        <a class="btn btn--primary" href="#contact">${esc(t.hero.ctaPrimary)}</a>
        <a class="btn btn--ghost" href="#engagement">${esc(t.hero.ctaSecondary)}</a>
      </div>
      <p class="hero__note">${esc(t.hero.note)}</p>
    </div>
    <div class="hero__visual">${capabilityDiagram(t)}</div>
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
          (p) => `<li class="phase">
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
          (s) => `<li class="sim"><p class="sim__cap">${esc(s.cap)}</p><h3>${esc(s.name)}</h3><p>${esc(s.text)}</p></li>`
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
    </div>
    <div class="stat">
      <p class="stat__n">${esc(t.operators.stat)}</p>
      <p class="stat__label">${esc(t.operators.statLabel)}</p>
      <p class="stat__text">${esc(t.operators.statText)}</p>
    </div>
  </div>
</section>

<section class="section section--tight" aria-labelledby="trust-title">
  <div class="wrap split">
    <div>
      <p class="eyebrow">${esc(t.trust.eyebrow)}</p>
      <h2 id="trust-title">${esc(t.trust.title)}</h2>
    </div>
    <ul class="checks">${t.trust.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
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
        <button class="btn btn--primary" type="submit">${esc(c.submit)}</button>
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
    body: `<h1>${esc(t.thanks.title)}</h1><p class="lead">${esc(t.thanks.body)}</p><p><a class="btn btn--ghost" href="${base(t)}">${esc(t.thanks.back)}</a></p>`,
  });
}

export function contactError(t, site) {
  return simple(t, site, {
    path: base(t) + "contact-error/",
    title: t.contactError.title,
    body: `<h1>${esc(t.contactError.title)}</h1><p class="lead">${esc(t.contactError.body)} <a href="mailto:${esc(site.contactEmail)}" dir="ltr">${esc(site.contactEmail)}</a>.</p><p><a class="btn btn--ghost" href="${base(t)}#contact">${esc(t.contactError.back)}</a></p>`,
  });
}

export function notFound(t, site) {
  return simple(t, site, {
    path: base(t) + "404",
    title: t.notFound.title,
    body: `<h1>${esc(t.notFound.title)}</h1><p class="lead">${esc(t.notFound.body)}</p><p><a class="btn btn--ghost" href="${base(t)}">${esc(t.notFound.back)}</a></p>`,
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
