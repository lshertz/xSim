/* xSim client portal (single page, hash routes). No framework; every element is built with the DOM API,
   so no user-supplied text is ever parsed as HTML. Strings come from src/content/<lang>.json ("portal"). */
(() => {
  "use strict";

  const CFG = JSON.parse(document.getElementById("portal-config").textContent);
  const T = CFG.t;
  const LANG = CFG.lang;
  const OTHER = LANG === "he" ? "en" : "he";
  const BASE = LANG === "he" ? "/he/app/" : "/app/";
  const OTHER_BASE = LANG === "he" ? "/app/" : "/he/app/";
  const CAPS = ["info", "decide", "adapt", "align", "lead", "customer", "execute"];
  const TYPES = ["likert", "single", "multi", "slider", "grid", "rank", "yesno", "text", "longtext", "number"];
  const app = document.getElementById("app");
  const state = { me: null, stage: null };

  // ---------- Strings ----------

  function t(key, vars) {
    let s = key.split(".").reduce((o, p) => (o && o[p] !== undefined ? o[p] : undefined), T);
    if (typeof s !== "string") s = key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] !== undefined ? String(vars[n]) : m));
    return s;
  }
  // Bilingual content: the page language first, the other language as a fallback.
  const B = (o) => (o ? o[LANG] || o[OTHER] || "" : "");
  const F = (o, base) => (o ? o[`${base}_${LANG}`] || o[`${base}_${OTHER}`] || "" : "");
  const errText = (e) => {
    const code = (e && e.message) || "server_error";
    const s = t("errors." + code);
    return s === "errors." + code ? t("errors.generic") : s;
  };
  const fmtDate = (iso, withTime = true) => {
    if (!iso) return "";
    const o = withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" };
    try {
      return new Intl.DateTimeFormat(LANG === "he" ? "he-IL" : "en-GB", { ...o, timeZone: "Asia/Jerusalem" }).format(new Date(iso));
    } catch (_) {
      return iso;
    }
  };
  const num = (x) => (x === null || x === undefined ? "–" : String(Math.round(Number(x) * 100) / 100));

  // ---------- DOM ----------

  function h(tag, a, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (["value", "checked", "disabled", "selected", "required", "multiple", "indeterminate"].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, a = {}, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    for (const kid of kids) el.append(kid);
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
  let uidSeq = 0;
  const nid = (p = "f") => `${p}${++uidSeq}`;

  // Bilingual text input pair (English left, Hebrew right in LTR; mirrored in RTL).
  function biField(label, obj, enKey, heKey, { multiline = false, max = 1000, onInput, disabled = false } = {}) {
    const mk = (lang, key) => {
      const id = nid();
      const attrs = { id, lang, dir: lang === "he" ? "rtl" : "ltr", maxlength: String(max), disabled, value: obj[key] || "",
        oninput: (e) => { obj[key] = e.target.value; onInput && onInput(); } };
      return h("div", { class: "bi__half" },
        h("label", { class: "bi__lang", for: id, text: lang === "he" ? "עברית" : "English" }),
        multiline ? h("textarea", { ...attrs, rows: "3" }) : h("input", { ...attrs, type: "text" }));
    };
    return h("fieldset", { class: "bi" }, h("legend", { text: label }), h("div", { class: "bi__row" }, mk("en", enKey), mk("he", heKey)));
  }

  function field(label, input, hint) {
    const id = input.id || (input.id = nid());
    return h("div", { class: "field" }, h("label", { for: id, text: label }), input, hint ? h("p", { class: "hint", text: hint }) : null);
  }

  function btn(label, onclick, cls = "btn btn--ghost btn--sm", attrs = {}) {
    return h("button", { type: "button", class: cls, onclick, ...attrs }, label);
  }

  // ---------- Messages and dialogs ----------

  const live = document.getElementById("portal-live");
  let toastTimer;
  function toast(msg, kind = "ok") {
    live.textContent = msg;
    live.className = `toast toast--${kind} is-on`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => live.classList.remove("is-on"), 4000);
  }

  function dialog(title, body, actions) {
    return new Promise((resolve) => {
      const d = h("dialog", { class: "dlg", "aria-labelledby": "dlg-title" });
      const close = (v) => { d.close(); d.remove(); resolve(v); };
      d.append(
        h("h2", { id: "dlg-title", class: "dlg__title", text: title }),
        h("div", { class: "dlg__body" }, body),
        h("div", { class: "dlg__actions" }, actions.map((a) => btn(a.label, () => close(a.value), a.cls || "btn btn--ghost btn--sm")))
      );
      d.addEventListener("cancel", (e) => { e.preventDefault(); close(false); });
      document.body.append(d);
      d.showModal();
    });
  }
  const confirmBox = (title, message, okLabel = t("common.confirm"), danger = false) =>
    dialog(title, h("p", { text: message }), [
      { label: t("common.cancel"), value: false },
      { label: okLabel, value: true, cls: danger ? "btn btn--danger btn--sm" : "btn btn--primary btn--sm" },
    ]);

  // Shown after creating a user or resetting a password while email sending is off.
  function showLink(delivery, user, purpose) {
    if (delivery.emailed) {
      toast(t("users.emailed", { email: user.email }));
      return Promise.resolve();
    }
    const input = h("input", { type: "text", readonly: true, value: delivery.link, dir: "ltr", class: "linkbox", onfocus: (e) => e.target.select() });
    const body = h("div", {},
      h("p", { text: t(delivery.emailError ? "users.linkEmailFailed" : "users.linkManual", { name: user.name, days: delivery.days }) }),
      input,
      h("p", { class: "hint", text: t(purpose === "reset" ? "users.linkHintReset" : "users.linkHintSetup", { email: user.email }) }),
      btn(t("common.copy"), async () => {
        try { await navigator.clipboard.writeText(delivery.link); toast(t("common.copied")); } catch (_) { input.select(); }
      }, "btn btn--note btn--sm"));
    return dialog(t(purpose === "reset" ? "users.linkTitleReset" : "users.linkTitleSetup"), body, [{ label: t("common.done"), value: true, cls: "btn btn--primary btn--sm" }]);
  }

  // ---------- API ----------

  async function api(method, path, body, opts = {}) {
    const headers = { "X-XSim": "1" };
    let payload;
    if (body instanceof Blob) {
      payload = body;
      headers["Content-Type"] = body.type || "application/octet-stream";
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch("/api/app/" + path, { method, headers, body: payload, credentials: "same-origin" });
    } catch (_) {
      throw Object.assign(new Error("network"), { status: 0 });
    }
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 && data.error === "no_session" && !opts.quiet) {
      state.me = null;
      if (!location.hash.startsWith("#/setup/") && location.hash !== "#/login") {
        toast(t("errors.no_session"), "warn");
        go("#/login");
      }
    }
    if (!res.ok) throw Object.assign(new Error(data.error || "server_error"), { status: res.status, data });
    return data;
  }

  // ---------- Router ----------

  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
  const routes = [
    [/^#\/login$/, viewLogin, "public"],
    [/^#\/mfa$/, viewMfa, "mfa"],
    [/^#\/setup\/([\w-]+)$/, viewSetup, "public"],
    [/^#\/2fa$/, view2fa, "setup"],
    [/^#\/?$/, viewHome],
    [/^#\/new$/, viewNew],
    [/^#\/s\/([0-9a-f-]{36})\/edit$/, viewEdit],
    [/^#\/s\/([0-9a-f-]{36})\/people$/, viewPeople],
    [/^#\/s\/([0-9a-f-]{36})\/take$/, (id, view) => viewTake(id, false, view)],
    [/^#\/s\/([0-9a-f-]{36})\/preview$/, (id, view) => viewTake(id, true, view)],
    [/^#\/s\/([0-9a-f-]{36})\/results$/, viewResults],
    [/^#\/s\/([0-9a-f-]{36})\/results\/([0-9a-f-]{36})$/, viewIndividual],
    [/^#\/users$/, viewUsers],
    [/^#\/companies$/, viewCompanies],
    [/^#\/activity$/, viewActivity],
    [/^#\/account$/, viewAccount],
  ];

  // Refreshes who is signed in without re-rendering (callers navigate themselves).
  async function refreshMe() {
    try {
      const r = await api("GET", "me", undefined, { quiet: true });
      state.me = r.user;
      state.stage = r.stage;
    } catch (_) {
      state.me = null;
      state.stage = null;
    }
  }

  async function boot() {
    await refreshMe();
    render();
  }

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const hash = location.hash || "#/";
    updateChrome(hash);
    let match = null;
    for (const [re, fn, kind] of routes) {
      const m = hash.match(re);
      if (m) { match = { fn, kind: kind || "full", args: m.slice(1) }; break; }
    }
    if (!match) return go("#/");
    // Send people to the step their session is at.
    if (match.kind !== "public") {
      if (!state.me) return go("#/login");
      if (state.stage === "mfa" && match.kind !== "mfa") return go("#/mfa");
      if (state.stage === "setup" && match.kind !== "setup") return go("#/2fa");
      if (state.stage === "full" && (match.kind === "mfa" || match.kind === "setup")) return go("#/");
    } else if (match.fn === viewLogin && state.me && state.stage === "full") {
      return go("#/");
    }
    const view = h("div", { class: "view" });
    clear(app).append(h("p", { class: "loading", text: t("common.loading") }));
    try {
      await match.fn(...match.args, view);
      if (seq !== renderSeq) return;
      clear(app).append(view);
      const h1 = view.querySelector("h1");
      if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
      window.scrollTo(0, 0);
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e.status === 401) return;
      if (!e.status) console.error(e);
      clear(app).append(h("div", { class: "view" }, h("h1", { text: t("errors.title") }), h("p", { text: errText(e) }), h("p", {}, h("a", { href: "#/", text: t("nav.home") }))));
    }
  }

  function updateChrome(hash) {
    const lang = document.querySelector("[data-portal-lang]");
    if (lang) lang.href = OTHER_BASE + hash;
    const nav = clear(document.getElementById("portal-nav"));
    const me = state.me;
    if (!me || state.stage !== "full") return;
    const link = (href, label, active) => h("a", { href, class: active ? "is-active" : null, "aria-current": active ? "page" : null, text: label });
    nav.append(link("#/", t("nav.home"), hash === "#/" || hash.startsWith("#/s/") || hash === "#/new"));
    if (me.roles.admin) {
      nav.append(link("#/companies", t("nav.companies"), hash === "#/companies"));
      nav.append(link("#/users", t("nav.users"), hash === "#/users"));
      nav.append(link("#/activity", t("nav.activity"), hash === "#/activity"));
    }
    nav.append(link("#/account", t("nav.account"), hash === "#/account"));
    nav.append(h("span", { class: "portal-nav__who", text: me.name }));
    nav.append(btn(t("nav.signout"), signOut, "btn btn--ghost btn--sm"));
  }

  async function signOut() {
    try { await api("POST", "logout", {}); } catch (_) {}
    state.me = null;
    state.stage = null;
    go("#/login");
  }

  // ---------- Sign-in ----------

  let turnstilePromise;
  function loadTurnstile() {
    if (turnstilePromise) return turnstilePromise;
    turnstilePromise = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      sc.async = true;
      sc.onload = () => resolve(window.turnstile);
      sc.onerror = () => { turnstilePromise = null; reject(new Error("turnstile_unavailable")); };
      document.head.append(sc);
    });
    return turnstilePromise;
  }

  function authCard(view, title, intro, ...content) {
    view.classList.add("view--auth");
    view.append(h("div", { class: "auth-card" }, h("h1", { text: title }), intro ? h("p", { class: "lead", text: intro }) : null, ...content));
  }

  function errorLine() {
    return h("p", { class: "form-error", role: "alert", hidden: true });
  }
  const showError = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

  async function viewLogin(view) {
    const err = errorLine();
    const email = h("input", { type: "email", autocomplete: "username", required: true, dir: "ltr", maxlength: "200" });
    const pw = h("input", { type: "password", autocomplete: "current-password", required: true, maxlength: "200" });
    const ts = h("div", { class: "ts" });
    const submit = h("button", { type: "submit", class: "btn btn--primary" }, t("login.submit"));
    let widget = null;
    let token = "";
    const form = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showError(err, "");
      if (!email.value || !pw.value) return showError(err, t("login.missing"));
      if (!token) return showError(err, t("login.waitCheck"));
      submit.disabled = true;
      try {
        const r = await api("POST", "login", { email: email.value, password: pw.value, turnstile: token }, { quiet: true });
        await refreshMe();
        go(r.next === "setup" ? "#/2fa" : "#/mfa");
      } catch (ex) {
        showError(err, errText(ex));
        token = "";
        if (widget !== null && window.turnstile) window.turnstile.reset(widget);
      } finally {
        submit.disabled = false;
      }
    } },
      field(t("login.email"), email),
      field(t("login.password"), pw),
      ts, err, submit);
    authCard(view, t("login.title"), t("login.intro"), form, h("p", { class: "hint", text: t("login.help") }));
    loadTurnstile().then((turnstile) => {
      widget = turnstile.render(ts, {
        sitekey: CFG.turnstileSiteKey, action: "login", language: "auto",
        callback: (tok) => { token = tok; }, "expired-callback": () => { token = ""; },
      });
    }).catch(() => showError(err, t("errors.turnstile_unavailable")));
  }

  async function viewMfa(view) {
    const err = errorLine();
    let recovery = false;
    const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9 ]*", maxlength: "7", dir: "ltr", class: "code-input" });
    const lbl = h("label", { for: code.id = nid(), text: t("mfa.code") });
    const toggle = h("button", { type: "button", class: "linkbtn", onclick: () => {
      recovery = !recovery;
      lbl.textContent = t(recovery ? "mfa.recovery" : "mfa.code");
      toggle.textContent = t(recovery ? "mfa.useApp" : "mfa.useRecovery");
      code.value = "";
      code.inputMode = recovery ? "text" : "numeric";
      code.maxLength = recovery ? 11 : 7;
      code.autocomplete = recovery ? "off" : "one-time-code";
      code.focus();
    } }, t("mfa.useRecovery"));
    const submit = h("button", { type: "submit", class: "btn btn--primary" }, t("mfa.submit"));
    const form = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showError(err, "");
      submit.disabled = true;
      try {
        await api("POST", "login/mfa", recovery ? { recovery: code.value } : { code: code.value }, { quiet: true });
        await refreshMe();
        go("#/");
      } catch (ex) {
        showError(err, errText(ex));
        if (ex.status === 401 && ex.message === "no_session") setTimeout(() => go("#/login"), 1500);
      } finally {
        submit.disabled = false;
      }
    } }, h("div", { class: "field" }, lbl, code), err, submit, h("p", {}, toggle));
    authCard(view, t("mfa.title"), t("mfa.intro"), form, h("p", {}, btn(t("mfa.cancel"), signOut, "linkbtn")));
  }

  async function viewSetup(token, view) {
    let info;
    try {
      info = await api("POST", "setup/check", { token }, { quiet: true });
    } catch (e) {
      authCard(view, t("setup.invalidTitle"), t("setup.invalid"), h("p", {}, h("a", { href: "#/login", text: t("setup.toLogin") })));
      return;
    }
    const err = errorLine();
    const pw = h("input", { type: "password", autocomplete: "new-password", minlength: "10", maxlength: "200" });
    const pw2 = h("input", { type: "password", autocomplete: "new-password", maxlength: "200" });
    const submit = h("button", { type: "submit", class: "btn btn--primary" }, t("setup.submit"));
    const form = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showError(err, "");
      if (pw.value.length < 10) return showError(err, t("errors.password_short"));
      if (pw.value !== pw2.value) return showError(err, t("setup.mismatch"));
      submit.disabled = true;
      try {
        await api("POST", "setup/password", { token, password: pw.value }, { quiet: true });
        await refreshMe();
        // Replace the link in the address bar and history: it has been used.
        history.replaceState(null, "", BASE + "#/2fa");
        render();
      } catch (ex) {
        showError(err, errText(ex));
      } finally {
        submit.disabled = false;
      }
    } },
      h("input", { type: "email", autocomplete: "username", value: info.email, hidden: true, readonly: true }),
      field(t("setup.password"), pw, t("setup.passwordHint")),
      field(t("setup.password2"), pw2),
      err, submit);
    authCard(view, t(info.purpose === "reset" ? "setup.titleReset" : "setup.title", { name: info.name }),
      t(info.purpose === "reset" ? "setup.introReset" : "setup.intro", { email: info.email }), form);
  }

  function qrSvg(text) {
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const m = 4;
    const svg = s("svg", { viewBox: `0 0 ${n + m * 2} ${n + m * 2}`, class: "qr", role: "img", "aria-label": t("twofa.qrAlt"), "shape-rendering": "crispEdges" });
    svg.append(s("rect", { width: n + m * 2, height: n + m * 2, fill: "#fff" }));
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
    svg.append(s("path", { d, fill: "#0B1A36" }));
    return svg;
  }

  async function view2fa(view) {
    const r = await api("GET", "setup/totp");
    const err = errorLine();
    const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", dir: "ltr", class: "code-input" });
    const submit = h("button", { type: "submit", class: "btn btn--primary" }, t("twofa.submit"));
    const key = r.secret.replace(/(.{4})/g, "$1 ").trim();
    const form = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showError(err, "");
      submit.disabled = true;
      try {
        const out = await api("POST", "setup/totp", { code: code.value }, { quiet: true });
        await refreshMe();
        updateChrome(location.hash);
        showRecovery(clear(view), out.recovery, true);
      } catch (ex) {
        showError(err, errText(ex));
      } finally {
        submit.disabled = false;
      }
    } }, field(t("twofa.code"), code), err, submit);
    authCard(view, t("twofa.title"), t("twofa.intro"),
      h("ol", { class: "steps" },
        h("li", {}, h("p", { text: t("twofa.step1") })),
        h("li", {}, h("p", { text: t("twofa.step2") }), h("a", { href: r.uri, class: "qr-link", "aria-label": t("twofa.openApp") }, qrSvg(r.uri)),
          h("details", { class: "manual-key" }, h("summary", { text: t("twofa.manual") }), h("p", { class: "hint", text: t("twofa.manualHint") }), h("code", { dir: "ltr", class: "secret", text: key }))),
        h("li", {}, h("p", { text: t("twofa.step3") }), form)),
      h("p", {}, btn(t("mfa.cancel"), signOut, "linkbtn")));
  }

  function showRecovery(view, codes, firstTime) {
    const text = codes.join("\n");
    const ack = h("input", { type: "checkbox", id: nid() });
    const cont = h("button", { type: "button", class: "btn btn--primary", disabled: true, onclick: () => { history.replaceState(null, "", BASE + "#/"); render(); } }, t("recovery.continue"));
    ack.addEventListener("change", () => { cont.disabled = !ack.checked; });
    const download = () => {
      const blob = new Blob([`xSim portal recovery codes (${state.me ? state.me.email : ""})\n\n${text}\n`], { type: "text/plain" });
      const a = h("a", { href: URL.createObjectURL(blob), download: "xsim-recovery-codes.txt" });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    view.classList.add("view--auth");
    view.append(h("div", { class: "auth-card" },
      h("h1", { text: t("recovery.title") }),
      h("p", { class: "lead", text: t("recovery.intro") }),
      h("ul", { class: "codes", dir: "ltr" }, codes.map((c) => h("li", {}, h("code", { text: c })))),
      h("div", { class: "row" },
        btn(t("recovery.download"), download, "btn btn--ghost btn--sm"),
        btn(t("common.copy"), async () => { try { await navigator.clipboard.writeText(text); toast(t("common.copied")); } catch (_) {} }, "btn btn--ghost btn--sm")),
      firstTime ? h("div", { class: "check" }, ack, h("label", { for: ack.id, text: t("recovery.ack") })) : null,
      firstTime ? cont : btn(t("common.done"), () => go("#/account"), "btn btn--primary")));
  }

  // ---------- Home ----------

  function statusChip(st) {
    return h("span", { class: `chip chip--${st}`, text: t("status." + st) });
  }

  async function viewHome(view) {
    const { surveys } = await api("GET", "surveys");
    const me = state.me;
    view.append(h("h1", { text: t("home.title", { name: me.name.split(" ")[0] }) }));

    const mine = surveys.filter((x) => x.can.respond);
    if (mine.length || me.roles.respondent) {
      const list = h("div", { class: "cards" });
      for (const sv of mine) {
        const done = sv.mine && sv.mine.submitted_at;
        const started = sv.mine && sv.mine.started_at;
        const st = !sv.open ? "closed" : done ? "submitted" : started ? "inprogress" : "notstarted";
        list.append(h("article", { class: "card" },
          h("h3", { text: F(sv, "title") }),
          h("p", { class: "meta" }, statusChip(st), sv.closes_at ? h("span", { text: t("home.closes", { date: fmtDate(sv.closes_at) }) }) : null),
          h("p", {}, h("a", { class: sv.open && !done ? "btn btn--primary btn--sm" : "btn btn--ghost btn--sm", href: `#/s/${sv.id}/take`,
            text: t(!sv.open ? "home.viewAnswers" : done ? "home.review" : started ? "home.continue" : "home.start") }))));
      }
      if (!mine.length) list.append(h("p", { class: "empty", text: t("home.noneToAnswer") }));
      view.append(h("section", { class: "block" }, h("h2", { text: t("home.toAnswer") }), list));
    }

    const results = surveys.filter((x) => x.can.results === "aggregate");
    if (results.length || (me.roles.viewer && !me.roles.admin && !me.roles.editor)) {
      const list = h("div", { class: "cards" });
      for (const sv of results) {
        list.append(h("article", { class: "card" },
          h("h3", { text: F(sv, "title") }),
          h("p", { class: "meta" }, statusChip(sv.open ? "open" : sv.status), h("span", { text: t("home.responses", { n: sv.counts.submitted, total: sv.counts.assigned }) })),
          h("p", {}, h("a", { class: "btn btn--ghost btn--sm", href: `#/s/${sv.id}/results`, text: t("home.viewResults") }))));
      }
      if (!results.length) list.append(h("p", { class: "empty", text: t("home.noResults") }));
      view.append(h("section", { class: "block" }, h("h2", { text: t("home.companyResults", { company: me.company || "" }) }), h("p", { class: "hint", text: t("home.anonNote") }), list));
    }

    if (me.roles.admin || me.roles.editor) {
      const managed = surveys.filter((x) => x.can.edit);
      const head = h("div", { class: "block__head" }, h("h2", { text: t("home.manage") }), h("a", { class: "btn btn--primary btn--sm", href: "#/new", text: t("home.new") }));
      const sec = h("section", { class: "block" }, head);
      if (!managed.length) sec.append(h("p", { class: "empty", text: t("home.noneManaged") }));
      else {
        const tb = h("tbody");
        for (const sv of managed) {
          tb.append(h("tr", {},
            h("td", {}, h("a", { href: `#/s/${sv.id}/edit`, text: F(sv, "title") || t("common.untitled") })),
            h("td", { text: sv.company }),
            h("td", {}, statusChip(sv.status === "open" && !sv.open ? "closed" : sv.status)),
            h("td", { class: "num", text: `${sv.counts.submitted} / ${sv.counts.assigned}` }),
            h("td", { text: sv.creator || "" }),
            h("td", { class: "actions" },
              h("a", { href: `#/s/${sv.id}/edit`, text: t("home.edit") }),
              h("a", { href: `#/s/${sv.id}/people`, text: t("home.people") }),
              h("a", { href: `#/s/${sv.id}/results`, text: t("home.results") }))));
        }
        sec.append(h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["title", "company", "status", "responses", "creator", "actions"].map((k) => h("th", { scope: "col", text: t("home.col." + k) })))), tb)));
      }
      view.append(sec);
    }
  }

  // ---------- New survey ----------

  async function viewNew(view) {
    const [{ companies }, { templates }] = await Promise.all([api("GET", "companies"), api("GET", "templates")]);
    const err = errorLine();
    const comp = h("select", { required: true },
      h("option", { value: "", text: t("new.pickCompany") }),
      companies.filter((c) => !c.internal).map((c) => h("option", { value: c.id, text: c.name })));
    const obj = { title_en: "", title_he: "" };
    const tplRadios = [{ id: "", title: t("new.blank") }, ...templates.map((x) => ({ id: x.id, title: F(x, "title") }))].map((x, i) => {
      const id = nid();
      return h("div", { class: "check" }, h("input", { type: "radio", name: "tpl", id, value: x.id, checked: i === (templates.length ? 1 : 0) }), h("label", { for: id, text: x.title }));
    });
    const submit = h("button", { type: "submit", class: "btn btn--primary" }, t("new.create"));
    view.append(h("h1", { text: t("new.title") }),
      h("form", { class: "form form--wide", novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        showError(err, "");
        const template = view.querySelector('input[name="tpl"]:checked').value;
        if (!comp.value) return showError(err, t("new.needCompany"));
        if (!template && !obj.title_en && !obj.title_he) return showError(err, t("new.needTitle"));
        submit.disabled = true;
        try {
          const r = await api("POST", "surveys", { company_id: comp.value, template: template || undefined, ...obj });
          go(`#/s/${r.id}/edit`);
        } catch (ex) {
          showError(err, errText(ex));
          submit.disabled = false;
        }
      } },
        h("div", { class: "row row--fields new-co" },
          field(t("new.company"), comp, state.me.roles.admin ? null : (companies.filter((c) => !c.internal).length ? t("new.companyHintEditor") : t("new.noCompaniesEditor"))),
          state.me.roles.admin ? btn(t("companies.add"), async () => {
            const c = await companyDialog(null);
            if (!c) return;
            comp.append(h("option", { value: c.id, text: c.name }));
            comp.value = c.id;
          }) : null),
        biField(t("new.surveyTitle"), obj, "title_en", "title_he", { max: 200 }),
        h("p", { class: "hint", text: t("new.titleHint") }),
        h("fieldset", { class: "radios" }, h("legend", { text: t("new.startFrom") }), tplRadios),
        err, submit));
  }

  // ---------- Survey tabs ----------

  function surveyHeader(view, sv, active) {
    const tabs = [["edit", t("tabs.questions")], ["people", t("tabs.people")], ["results", t("tabs.results")], ["preview", t("tabs.preview")]];
    view.append(
      h("p", { class: "crumbs" }, h("a", { href: "#/", text: t("nav.home") }), " / ", h("span", { text: sv.company })),
      h("div", { class: "title-row" }, h("h1", { text: F(sv, "title") || t("common.untitled") }), statusChip(sv.status === "open" && !sv.open ? "closed" : sv.status)),
      sv.can.edit ? h("nav", { class: "tabs", "aria-label": t("tabs.label") }, tabs.map(([k, label]) =>
        h("a", { href: `#/s/${sv.id}/${k}`, class: k === active ? "is-active" : null, "aria-current": k === active ? "page" : null, text: label }))) : null
    );
  }

  // ---------- Builder ----------

  async function viewEdit(id, view) {
    const { survey: sv } = await api("GET", `surveys/${id}`);
    if (!sv.can.edit) return go(`#/s/${id}/results`);
    const me = state.me;
    const locked = !!sv.answered;
    surveyHeader(view, sv, "edit");
    if (locked) view.append(h("p", { class: "notice", text: t("edit.locked") }));

    // Survey settings
    const settings = { title_en: sv.title_en, title_he: sv.title_he, intro_en: sv.intro_en, intro_he: sv.intro_he };
    const closes = h("input", { type: "datetime-local", value: sv.closes_at ? toLocalInput(sv.closes_at) : "" });
    const saveSettings = h("button", { type: "button", class: "btn btn--primary btn--sm", disabled: true, onclick: async () => {
      try {
        await api("PATCH", `surveys/${id}`, { ...settings, closes_at: closes.value ? new Date(closes.value).toISOString() : null });
        saveSettings.disabled = true;
        toast(t("common.saved"));
      } catch (e) { toast(errText(e), "err"); }
    } }, t("common.save"));
    const dirty = () => { saveSettings.disabled = false; };
    closes.addEventListener("input", dirty);

    const statusActions = h("div", { class: "row" });
    const setStatus = async (st, msgKey) => {
      if (msgKey && !(await confirmBox(t("edit.status." + st), t(msgKey), t("edit.status." + st)))) return;
      try { await api("PATCH", `surveys/${id}`, { status: st }); toast(t("common.saved")); render(); } catch (e) { toast(errText(e), "err"); }
    };
    if (sv.status === "draft") statusActions.append(btn(t("edit.status.open"), () => setStatus("open", "edit.confirmOpen"), "btn btn--note btn--sm"));
    if (sv.status === "open") statusActions.append(btn(t("edit.status.closed"), () => setStatus("closed", "edit.confirmClose")));
    if (sv.status === "closed") statusActions.append(btn(t("edit.status.reopen"), () => setStatus("open", null)));
    if (sv.status !== "draft" && !locked) statusActions.append(btn(t("edit.status.draft"), () => setStatus("draft", null)));
    statusActions.append(btn(t("edit.duplicate"), async () => {
      try { const r = await api("POST", `surveys/${id}/duplicate`, {}); toast(t("edit.duplicated")); go(`#/s/${r.id}/edit`); } catch (e) { toast(errText(e), "err"); }
    }));
    if (sv.can.own && (me.roles.admin || !locked)) {
      statusActions.append(btn(t("edit.delete"), async () => {
        if (!(await confirmBox(t("edit.delete"), t(locked ? "edit.confirmDeleteAnswers" : "edit.confirmDelete"), t("edit.delete"), true))) return;
        try { await api("DELETE", `surveys/${id}`); toast(t("edit.deleted")); go("#/"); } catch (e) { toast(errText(e), "err"); }
      }, "btn btn--danger btn--sm"));
    }

    // Logo
    const logoBox = h("div", { class: "logo-edit" });
    const drawLogo = (has) => {
      clear(logoBox);
      const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "sr-only", id: nid(), onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 256 * 1024) return toast(t("errors.logo_too_large"), "err");
        try { await api("PUT", `surveys/${id}/logo`, f); toast(t("common.saved")); drawLogo(true); } catch (ex) { toast(errText(ex), "err"); }
      } });
      logoBox.append(
        h("div", { class: "brand-pair" }, h("img", { src: "/assets/img/logo/note-yellow-96.webp", alt: "xSim", width: "54", height: "48" }),
          has ? h("img", { src: `/api/app/surveys/${id}/logo?v=${Date.now()}`, alt: t("edit.logoAlt", { company: sv.company }), class: "cust-logo" }) : h("span", { class: "hint", text: t("edit.noLogo") })),
        h("div", { class: "row" },
          h("label", { for: file.id, class: "btn btn--ghost btn--sm", text: t(has ? "edit.replaceLogo" : "edit.addLogo") }), file,
          has ? btn(t("edit.removeLogo"), async () => { try { await api("DELETE", `surveys/${id}/logo`); drawLogo(false); } catch (e) { toast(errText(e), "err"); } }) : null),
        h("p", { class: "hint", text: t("edit.logoHint") }));
    };
    drawLogo(sv.has_logo);

    view.append(h("section", { class: "panel" },
      h("h2", { text: t("edit.settings") }),
      h("div", { class: "grid2" },
        h("div", {},
          biField(t("edit.surveyTitle"), settings, "title_en", "title_he", { max: 200, onInput: dirty }),
          biField(t("edit.intro"), settings, "intro_en", "intro_he", { multiline: true, max: 4000, onInput: dirty }),
          field(t("edit.closes"), closes, t("edit.closesHint")),
          saveSettings),
        h("div", {}, h("h3", { text: t("edit.branding") }), logoBox, h("h3", { text: t("edit.statusTitle") }), h("p", { class: "hint", text: t("edit.statusHint." + sv.status) }), statusActions))));

    // Sections and questions
    const sectionsEl = h("div", { class: "sections" });
    sv.sections.forEach((sec, i) => sectionsEl.append(sectionEditor(sv, sec, i, locked)));
    view.append(h("h2", { class: "sections-title", text: t("edit.content") }), sectionsEl);
    if (!locked) {
      view.append(h("p", {}, btn(t("edit.addSection"), async () => {
        try { await api("POST", `surveys/${id}/sections`, { title_en: t("edit.newSection") }); render(); } catch (e) { toast(errText(e), "err"); }
      }, "btn btn--ghost")));
    }
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const canDelete = (item) => state.me.roles.admin || item.created_by === state.me.id;

  function sectionEditor(sv, sec, index, locked) {
    const data = { title_en: sec.title_en, title_he: sec.title_he, intro_en: sec.intro_en, intro_he: sec.intro_he, capability: sec.capability || "" };
    const save = h("button", { type: "button", class: "btn btn--primary btn--sm", disabled: true, onclick: async () => {
      try { await api("PATCH", `sections/${sec.id}`, { ...data, capability: data.capability || null }); save.disabled = true; toast(t("common.saved")); } catch (e) { toast(errText(e), "err"); }
    } }, t("edit.saveSection"));
    const dirty = () => { save.disabled = false; };
    const capSel = h("select", { disabled: locked, onchange: (e) => { data.capability = e.target.value; dirty(); } },
      h("option", { value: "", text: t("edit.noCapability") }), CAPS.map((c) => h("option", { value: c, selected: c === data.capability, text: t("cap." + c) })));
    const allMine = sec.questions.every(canDelete) && canDelete(sec);
    const qList = h("div", { class: "questions" });
    sec.questions.forEach((q, qi) => qList.append(questionEditor(sv, sec, q, qi, locked)));

    const addType = h("select", {}, TYPES.map((x) => h("option", { value: x, text: t("types." + x) })));
    const head = h("div", { class: "sec__head" },
      h("h3", { text: `${index + 1}. ${F(sec, "title") || t("common.untitled")}` }),
      h("div", { class: "row" },
        btn("↑", () => moveItem(`sections/${sec.id}/move`, "up"), "btn btn--ghost btn--icon", { "aria-label": t("edit.moveUp") }),
        btn("↓", () => moveItem(`sections/${sec.id}/move`, "down"), "btn btn--ghost btn--icon", { "aria-label": t("edit.moveDown") }),
        !locked && allMine ? btn(t("edit.deleteSection"), async () => {
          if (!(await confirmBox(t("edit.deleteSection"), t("edit.confirmDeleteSection"), t("common.delete"), true))) return;
          try { await api("DELETE", `sections/${sec.id}`); render(); } catch (e) { toast(errText(e), "err"); }
        }, "btn btn--danger btn--sm") : null));
    return h("section", { class: "sec" }, head,
      h("details", { class: "sec__settings" }, h("summary", { text: t("edit.sectionSettings") }),
        biField(t("edit.sectionTitle"), data, "title_en", "title_he", { max: 200, onInput: dirty }),
        biField(t("edit.sectionIntro"), data, "intro_en", "intro_he", { multiline: true, max: 2000, onInput: dirty }),
        field(t("edit.capability"), capSel, t("edit.capabilityHint")),
        save),
      qList,
      !locked ? h("div", { class: "add-q" }, field(t("edit.questionType"), addType), btn(t("edit.addQuestion"), async () => {
        try { await api("POST", `sections/${sec.id}/questions`, { type: addType.value, text_en: "", text_he: "" }); render(); } catch (e) { toast(errText(e), "err"); }
      }, "btn btn--ghost btn--sm")) : null);
  }

  async function moveItem(path, dir) {
    try { await api("POST", path, { dir }); render(); } catch (e) { toast(errText(e), "err"); }
  }

  function questionEditor(sv, sec, q, qi, locked) {
    const data = { text_en: q.text_en, text_he: q.text_he, help_en: q.help_en, help_he: q.help_he, required: q.required, type: q.type, config: JSON.parse(JSON.stringify(q.config)) };
    const save = h("button", { type: "button", class: "btn btn--primary btn--sm", disabled: true }, t("edit.saveQuestion"));
    const status = h("span", { class: "hint" });
    const dirty = () => { save.disabled = false; status.textContent = t("edit.unsaved"); };
    const cfgBox = h("div", { class: "cfg" });
    const drawCfg = () => { clear(cfgBox).append(configEditor(data, dirty, locked)); };
    drawCfg();
    save.addEventListener("click", async () => {
      try {
        const r = await api("PATCH", `questions/${q.id}`, data);
        data.config = r.config;
        Object.assign(q, data);
        save.disabled = true;
        status.textContent = "";
        drawCfg();
        toast(t("common.saved"));
      } catch (e) { toast(errText(e), "err"); }
    });
    const typeSel = h("select", { disabled: locked, onchange: (e) => {
      data.type = e.target.value;
      data.config = defaultConfig(data.type);
      drawCfg();
      dirty();
    } }, TYPES.map((x) => h("option", { value: x, selected: x === q.type, text: t("types." + x) })));
    const req = h("input", { type: "checkbox", id: nid(), checked: !!q.required, onchange: (e) => { data.required = e.target.checked; dirty(); } });
    return h("article", { class: "q" },
      h("div", { class: "q__head" },
        h("span", { class: "q__num", text: `${qi + 1}` }),
        h("div", { class: "q__type" }, field(t("edit.questionType"), typeSel)),
        h("div", { class: "check" }, req, h("label", { for: req.id, text: t("edit.required") })),
        h("div", { class: "row q__tools" },
          btn("↑", () => moveItem(`questions/${q.id}/move`, "up"), "btn btn--ghost btn--icon", { "aria-label": t("edit.moveUp") }),
          btn("↓", () => moveItem(`questions/${q.id}/move`, "down"), "btn btn--ghost btn--icon", { "aria-label": t("edit.moveDown") }),
          !locked && canDelete(q) ? btn(t("common.delete"), async () => {
            if (!(await confirmBox(t("edit.deleteQuestion"), t("edit.confirmDeleteQuestion"), t("common.delete"), true))) return;
            try { await api("DELETE", `questions/${q.id}`); render(); } catch (e) { toast(errText(e), "err"); }
          }, "btn btn--danger btn--sm") : null)),
      biField(t("edit.questionText"), data, "text_en", "text_he", { multiline: true, max: 1000, onInput: dirty }),
      h("details", { class: "q__help", open: !!(q.help_en || q.help_he) }, h("summary", { text: t("edit.helpText") }),
        biField(t("edit.helpText"), data, "help_en", "help_he", { multiline: true, max: 1000, onInput: dirty })),
      cfgBox,
      h("div", { class: "row q__save" }, save, status));
  }

  function defaultConfig(type) {
    const o = (n) => ({ en: `${t("edit.option")} ${n}`, he: "" });
    switch (type) {
      case "single": case "multi": case "rank": return { options: [o(1), o(2)] };
      case "likert": return { points: 5, start: 1, labels: [], na: false };
      case "grid": return { rows: [{ en: `${t("edit.row")} 1`, he: "", capability: null }], points: 5, start: 1, labels: [], na: false };
      case "slider": return { start: 0, units: 10, left: { en: "", he: "" }, right: { en: "", he: "" }, na: false };
      case "text": return { maxLength: 300 };
      case "longtext": return { maxLength: 3000 };
      case "number": return { min: null, max: null, integer: false };
      default: return { na: false };
    }
  }

  // Type-specific settings. Structural inputs (counts, scale, ids) are disabled once answers exist.
  function configEditor(data, dirty, locked) {
    const c = data.config;
    const wrap = h("div", { class: "cfg__inner" });
    const numberIn = (label, key, lo, hi, hint, obj = c, allowEmpty = false) => {
      const inp = h("input", { type: "number", min: lo !== null ? String(lo) : null, max: hi !== null ? String(hi) : null, value: obj[key] ?? "", disabled: locked, class: "num-in",
        oninput: (e) => { obj[key] = e.target.value === "" && allowEmpty ? null : Number(e.target.value); dirty(); } });
      return field(label, inp, hint);
    };
    const checkIn = (label, key) => {
      const inp = h("input", { type: "checkbox", id: nid(), checked: !!c[key], disabled: locked, onchange: (e) => { c[key] = e.target.checked; dirty(); } });
      return h("div", { class: "check" }, inp, h("label", { for: inp.id, text: label }));
    };
    const itemList = (label, key, withCap) => {
      const box = h("div", { class: "items" });
      const draw = () => {
        clear(box);
        c[key].forEach((it, i) => {
          box.append(h("div", { class: "item" },
            h("span", { class: "item__n", text: String(i + 1) }),
            biField(`${label} ${i + 1}`, it, "en", "he", { max: 300, onInput: dirty }),
            withCap ? field(t("edit.capability"), h("select", { disabled: locked, onchange: (e) => { it.capability = e.target.value || null; dirty(); } },
              h("option", { value: "", text: t("edit.noCapability") }), CAPS.map((cp) => h("option", { value: cp, selected: cp === it.capability, text: t("cap." + cp) })))) : null,
            !locked && c[key].length > 1 ? btn(t("common.remove"), () => { c[key].splice(i, 1); dirty(); draw(); }, "btn btn--ghost btn--sm") : null));
        });
        if (!locked) box.append(btn(t(withCap ? "edit.addRow" : "edit.addOption"), () => { c[key].push({ en: "", he: "", capability: null }); dirty(); draw(); }, "btn btn--ghost btn--sm"));
      };
      draw();
      return box;
    };
    const scaleLabels = () => {
      const box = h("div", { class: "items" });
      const draw = () => {
        clear(box);
        const pts = Math.max(2, Math.min(11, Number(c.points) || 5));
        c.labels = Array.from({ length: pts }, (_, i) => (c.labels && c.labels[i]) || { en: "", he: "" });
        c.labels.forEach((lb, i) => box.append(biField(t("edit.pointLabel", { n: (Number(c.start) || 0) + i }), lb, "en", "he", { max: 80, onInput: dirty })));
      };
      draw();
      return { box, draw };
    };
    switch (data.type) {
      case "single":
        wrap.append(itemList(t("edit.option"), "options"));
        break;
      case "multi":
        wrap.append(itemList(t("edit.option"), "options"), numberIn(t("edit.maxSelect"), "max", 1, 40, t("edit.maxSelectHint"), c, true));
        break;
      case "rank":
        wrap.append(itemList(t("edit.option"), "options"), numberIn(t("edit.rankLimit"), "limit", 1, 20, t("edit.rankLimitHint"), c, true));
        break;
      case "likert":
      case "grid": {
        if (data.type === "grid") wrap.append(h("h4", { text: t("edit.rows") }), h("p", { class: "hint", text: t("edit.gridHint") }), itemList(t("edit.row"), "rows", true));
        const sl = scaleLabels();
        const pts = numberIn(t("edit.points"), "points", 2, 11, null);
        const st = h("select", { disabled: locked, onchange: (e) => { c.start = Number(e.target.value); dirty(); sl.draw(); } },
          h("option", { value: "1", selected: c.start === 1, text: "1" }), h("option", { value: "0", selected: c.start === 0, text: "0" }));
        pts.querySelector("input").addEventListener("change", () => sl.draw());
        wrap.append(h("div", { class: "row row--fields" }, pts, field(t("edit.startAt"), st)), checkIn(t("edit.allowNa"), "na"), h("h4", { text: t("edit.pointLabels") }), sl.box);
        break;
      }
      case "slider":
        wrap.append(
          h("div", { class: "row row--fields" }, numberIn(t("edit.sliderStart"), "start", -100, 100, null), numberIn(t("edit.units"), "units", 1, 100, t("edit.unitsHint"))),
          biField(t("edit.leftLabel"), c.left, "en", "he", { max: 80, onInput: dirty }),
          biField(t("edit.rightLabel"), c.right, "en", "he", { max: 80, onInput: dirty }),
          checkIn(t("edit.allowNa"), "na"));
        break;
      case "text":
      case "longtext":
        wrap.append(numberIn(t("edit.maxLength"), "maxLength", 1, data.type === "text" ? 500 : 5000, null));
        break;
      case "number":
        wrap.append(h("div", { class: "row row--fields" }, numberIn(t("edit.min"), "min", null, null, null, c, true), numberIn(t("edit.max"), "max", null, null, null, c, true)), checkIn(t("edit.integer"), "integer"));
        break;
      case "yesno":
        wrap.append(checkIn(t("edit.allowNa"), "na"));
        break;
    }
    return wrap;
  }

  // ---------- People ----------

  async function viewPeople(id, view) {
    const [{ survey: sv }, people] = await Promise.all([api("GET", `surveys/${id}`), api("GET", `surveys/${id}/people`)]);
    surveyHeader(view, sv, "people");
    const assignedIds = new Set(people.assigned.map((p) => p.id));

    // Respondents
    const tb = h("tbody");
    for (const p of people.assigned) {
      const ceo = h("input", { type: "radio", name: "ceo", id: nid(), checked: !!p.is_ceo, onchange: async () => {
        try { await api("PATCH", `surveys/${id}/assignments/${p.id}`, { is_ceo: true }); toast(t("common.saved")); render(); } catch (e) { toast(errText(e), "err"); }
      } });
      const st = p.submitted_at ? "submitted" : p.started_at ? "inprogress" : "notstarted";
      tb.append(h("tr", {},
        h("td", {}, h("strong", { text: p.name }), h("br"), h("span", { class: "hint", dir: "ltr", text: p.email })),
        h("td", {}, statusChip(st), p.status !== "active" ? h("span", { class: "hint", text: " " + t("people.notSetUp") }) : null),
        h("td", {}, h("div", { class: "check" }, ceo, h("label", { for: ceo.id, class: "sr-only", text: t("people.markCeo", { name: p.name }) }))),
        h("td", { class: "actions" }, btn(t("common.remove"), async () => {
          const msg = p.started_at ? t("people.confirmRemoveAnswers", { name: p.name }) : t("people.confirmRemove", { name: p.name });
          if (!(await confirmBox(t("people.remove"), msg, t("common.remove"), !!p.started_at))) return;
          try { await api("DELETE", `surveys/${id}/assignments/${p.id}`); render(); } catch (e) { toast(errText(e), "err"); }
        }))));
    }
    const clearCeo = people.assigned.some((p) => p.is_ceo) ? btn(t("people.clearCeo"), async () => {
      const c = people.assigned.find((p) => p.is_ceo);
      try { await api("PATCH", `surveys/${id}/assignments/${c.id}`, { is_ceo: false }); render(); } catch (e) { toast(errText(e), "err"); }
    }) : null;

    const avail = people.eligible.filter((p) => !assignedIds.has(p.id));
    const picks = avail.map((p) => {
      const cb = h("input", { type: "checkbox", id: nid(), value: p.id });
      return h("div", { class: "check" }, cb, h("label", { for: cb.id }, p.name, " ", h("span", { class: "hint", dir: "ltr", text: p.email })));
    });
    const addBtn = btn(t("people.add"), async () => {
      const ids = [...view.querySelectorAll(".pick input:checked")].map((x) => x.value);
      if (!ids.length) return toast(t("people.pickSomeone"), "warn");
      try { await api("POST", `surveys/${id}/assignments`, { user_ids: ids }); toast(t("common.saved")); render(); } catch (e) { toast(errText(e), "err"); }
    }, "btn btn--primary btn--sm");

    view.append(h("section", { class: "panel" },
      h("h2", { text: t("people.respondents") }),
      h("p", { class: "hint", text: t("people.respondentsHint", { company: sv.company }) }),
      people.assigned.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, [t("people.person"), t("people.progress"), t("people.ceo"), ""].map((x) => h("th", { scope: "col", text: x })))), tb)) : h("p", { class: "empty", text: t("people.none") }),
      clearCeo,
      h("p", { class: "hint", text: t("people.ceoHint") }),
      h("h3", { text: t("people.addTitle") }),
      avail.length ? h("div", { class: "pick" }, picks, addBtn) : h("p", { class: "hint", text: t(state.me.roles.admin ? "people.noneLeftAdmin" : "people.noneLeft", { company: sv.company }) })));

    // Collaborators
    const others = people.editors.filter((e) => e.id !== sv.created_by && !sv.editors.some((x) => x.id === e.id));
    const sel = h("select", {}, h("option", { value: "", text: t("people.pickEditor") }), others.map((e) => h("option", { value: e.id, text: `${e.name} (${e.email})` })));
    view.append(h("section", { class: "panel" },
      h("h2", { text: t("people.editors") }),
      h("p", { class: "hint", text: t("people.editorsHint") }),
      h("ul", { class: "plain" },
        h("li", {}, h("strong", { text: sv.creator ? sv.creator.name : "" }), " ", h("span", { class: "hint", text: t("people.creator") })),
        sv.editors.map((e) => h("li", {}, e.name, " ", h("span", { class: "hint", dir: "ltr", text: e.email }), " ",
          sv.can.own || e.id === state.me.id ? btn(t("common.remove"), async () => {
            try { await api("DELETE", `surveys/${id}/editors/${e.id}`); render(); } catch (ex) { toast(errText(ex), "err"); }
          }) : null))),
      others.length ? h("div", { class: "row" }, field(t("people.inviteEditor"), sel), btn(t("people.invite"), async () => {
        if (!sel.value) return;
        try { await api("POST", `surveys/${id}/editors`, { user_id: sel.value }); toast(t("common.saved")); render(); } catch (e) { toast(errText(e), "err"); }
      }, "btn btn--primary btn--sm")) : h("p", { class: "hint", text: t("people.noEditors") })));
  }

  // ---------- Answering ----------

  async function viewTake(id, preview, view) {
    const { survey: sv } = await api("GET", `surveys/${id}`);
    if (preview && !sv.can.edit) return go(`#/s/${id}/take`);
    if (!preview && !sv.can.respond) return go(sv.can.edit ? `#/s/${id}/preview` : "#/");
    if (preview) surveyHeader(view, sv, "preview");
    const answers = preview ? {} : { ...(sv.mine.answers || {}) };
    const readOnly = !preview && !sv.open;
    const pending = {};
    let timer = null;
    const saveState = h("p", { class: "save-state", "aria-live": "polite" });
    const flush = async () => {
      clearTimeout(timer);
      timer = null;
      if (preview || !Object.keys(pending).length) return true;
      const batch = { ...pending };
      for (const k of Object.keys(batch)) delete pending[k];
      saveState.textContent = t("take.saving");
      try {
        await api("PUT", `surveys/${id}/answers`, { answers: batch, lang: LANG });
        saveState.textContent = t("take.saved");
        return true;
      } catch (e) {
        Object.assign(pending, batch, pending);
        saveState.textContent = errText(e);
        return false;
      }
    };
    const set = (qid, value) => {
      answers[qid] = value;
      if (preview) return;
      pending[qid] = value === undefined ? null : value;
      saveState.textContent = t("take.unsaved");
      clearTimeout(timer);
      timer = setTimeout(flush, 900);
      updateProgress();
    };
    window.addEventListener("beforeunload", (e) => { if (timer) { flush(); e.preventDefault(); } }, { once: true });

    const allQ = sv.sections.flatMap((x) => x.questions);
    const progress = h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(allQ.length) }, h("span"));
    const progressText = h("span", { class: "hint" });
    const answered = (q) => {
      const v = answers[q.id];
      if (v === undefined || v === null || v === "") return false;
      if (q.type === "grid") return q.config.rows.every((r) => v[r.id] !== undefined);
      return !(Array.isArray(v) && !v.length);
    };
    function updateProgress() {
      const n = allQ.filter(answered).length;
      progress.firstChild.style.inlineSize = `${allQ.length ? Math.round((n / allQ.length) * 100) : 0}%`;
      progress.setAttribute("aria-valuenow", String(n));
      progressText.textContent = t("take.progress", { n, total: allQ.length });
    }

    view.append(h("header", { class: "take__head" },
      h("div", { class: "brand-pair" }, h("img", { src: "/assets/img/logo/note-yellow-96.webp", alt: "xSim", width: "54", height: "48" }),
        sv.has_logo ? h("img", { src: `/api/app/surveys/${id}/logo`, alt: sv.company, class: "cust-logo" }) : h("span", { class: "brand-pair__co", text: sv.company })),
      preview ? h("p", { class: "notice", text: t("take.previewNote") }) : null,
      !preview ? h("h1", { class: "take__title", text: F(sv, "title") }) : null,
      F(sv, "intro") ? h("div", { class: "take__intro prose" }, F(sv, "intro").split(/\n{2,}/).map((p) => h("p", { text: p }))) : null,
      readOnly ? h("p", { class: "notice", text: t("take.closed") }) : null,
      !preview && sv.mine.submitted_at && sv.open ? h("p", { class: "notice notice--ok", text: t("take.alreadySubmitted", { date: fmtDate(sv.mine.submitted_at) }) }) : null,
      sv.closes_at && sv.open ? h("p", { class: "hint", text: t("home.closes", { date: fmtDate(sv.closes_at) }) }) : null,
      h("div", { class: "progress-row" }, progress, progressText)));

    const form = h("form", { class: "take", novalidate: true, onsubmit: (e) => e.preventDefault() });
    let qn = 0;
    for (const sec of sv.sections) {
      const secEl = h("section", { class: "take__sec" }, h("h2", { text: F(sec, "title") }),
        F(sec, "intro") ? h("div", { class: "prose hint" }, F(sec, "intro").split(/\n+/).map((p) => h("p", { text: p }))) : null);
      for (const q of sec.questions) secEl.append(renderQuestion(q, ++qn, answers[q.id], (v) => set(q.id, v), readOnly));
      form.append(secEl);
    }
    const err = errorLine();
    const submit = h("button", { type: "button", class: "btn btn--note", disabled: readOnly || preview, onclick: async () => {
      showError(err, "");
      form.querySelectorAll(".qa.is-missing").forEach((x) => x.classList.remove("is-missing"));
      const missing = allQ.filter((q) => q.required && !answered(q));
      if (missing.length) {
        missing.forEach((q) => form.querySelector(`[data-q="${q.id}"]`).classList.add("is-missing"));
        showError(err, t("take.missing", { n: missing.length }));
        form.querySelector(`[data-q="${missing[0].id}"]`).scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      submit.disabled = true;
      if (!(await flush())) { submit.disabled = false; return; }
      try {
        await api("POST", `surveys/${id}/submit`, {});
        clear(view).append(h("div", { class: "auth-card" }, h("h1", { text: t("take.thanksTitle") }), h("p", { class: "lead", text: t("take.thanks") }),
          h("p", {}, h("a", { class: "btn btn--primary", href: "#/", text: t("nav.home") }))));
        window.scrollTo(0, 0);
      } catch (e) {
        if (e.data && e.data.questions) e.data.questions.forEach((q) => { const el = form.querySelector(`[data-q="${q}"]`); if (el) el.classList.add("is-missing"); });
        showError(err, errText(e));
        submit.disabled = false;
      }
    } }, t(!preview && sv.mine.submitted_at ? "take.resubmit" : "take.submit"));
    form.append(h("div", { class: "take__foot" }, err, submit, saveState, h("p", { class: "hint", text: t(preview ? "take.previewFoot" : "take.autosave") })));
    view.append(form);
    updateProgress();
  }

  function renderQuestion(q, n, value, onChange, readOnly) {
    const c = q.config;
    const name = "q" + q.id.replace(/-/g, "");
    const titleId = nid("qt");
    const wrap = h("div", { class: `qa qa--${q.type}`, "data-q": q.id, role: "group", "aria-labelledby": titleId });
    wrap.append(h("p", { class: "qa__title", id: titleId }, h("span", { class: "qa__n", text: `${n}.` }), " ", F(q, "text"),
      q.required ? h("span", { class: "req", "aria-label": t("take.required"), text: " *" }) : null));
    if (F(q, "help")) wrap.append(h("p", { class: "hint", text: F(q, "help") }));
    const radios = (items, current, cb, cls = "opts") => h("div", { class: cls }, items.map((it) => {
      const id = nid();
      return h("div", { class: "opt" }, h("input", { type: "radio", name, id, value: String(it.value), checked: current === it.value, disabled: readOnly, onchange: () => cb(it.value) }),
        h("label", { for: id }, it.label));
    }));
    // Each item's label is a getter so every use gets fresh elements (a DOM node can sit in one place only).
    const scaleItems = (start, points, labels, na) => {
      const items = Array.from({ length: points }, (_, i) => ({ value: start + i,
        get label() { return [h("span", { class: "pt", text: String(start + i) }), labels && B(labels[i]) ? h("span", { class: "pt__l", text: B(labels[i]) }) : null]; } }));
      if (na) items.push({ value: "na", get label() { return h("span", { class: "pt pt--na", text: t("take.na") }); } });
      return items;
    };
    switch (q.type) {
      case "single":
        wrap.append(radios(c.options.map((o) => ({ value: o.id, label: B(o) })), value, onChange));
        break;
      case "yesno":
        wrap.append(radios([{ value: "yes", label: t("take.yes") }, { value: "no", label: t("take.no") }, ...(c.na ? [{ value: "na", label: t("take.na") }] : [])], value, onChange, "opts opts--inline"));
        break;
      case "multi": {
        let cur = Array.isArray(value) ? [...value] : [];
        const boxes = [];
        const sync = () => boxes.forEach((b) => { b.disabled = readOnly || (!!c.max && cur.length >= c.max && !b.checked); });
        const list = h("div", { class: "opts" }, c.options.map((o) => {
          const id = nid();
          const cb = h("input", { type: "checkbox", id, value: o.id, checked: cur.includes(o.id), onchange: (e) => {
            cur = e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id);
            sync();
            onChange(cur.length ? cur : null);
          } });
          boxes.push(cb);
          return h("div", { class: "opt" }, cb, h("label", { for: id, text: B(o) }));
        }));
        if (c.max) wrap.append(h("p", { class: "hint", text: t("take.chooseUpTo", { n: c.max }) }));
        wrap.append(list);
        sync();
        break;
      }
      case "likert":
        wrap.append(radios(scaleItems(c.start, c.points, c.labels, c.na), value, onChange, `scale scale--${c.points}`));
        break;
      case "grid": {
        const cur = value && typeof value === "object" ? { ...value } : {};
        const cols = scaleItems(c.start, c.points, c.labels, c.na);
        const tbl = h("div", { class: "gridq", role: "presentation" });
        tbl.append(h("div", { class: "gridq__row gridq__row--head", "aria-hidden": "true" }, h("span"), cols.map((col) => h("span", { class: "gridq__h" }, col.label))));
        for (const row of c.rows) {
          const rn = name + row.id;
          const rowLabel = nid();
          tbl.append(h("div", { class: "gridq__row", role: "radiogroup", "aria-labelledby": rowLabel },
            h("span", { class: "gridq__label", id: rowLabel, text: B(row) }),
            cols.map((col) => {
              const id = nid();
              return h("span", { class: "gridq__cell" },
                h("input", { type: "radio", name: rn, id, checked: cur[row.id] === col.value, disabled: readOnly, onchange: () => { cur[row.id] = col.value; onChange({ ...cur }); } }),
                h("label", { for: id, class: "gridq__cl" }, col.label));
            })));
        }
        wrap.append(tbl);
        break;
      }
      case "slider": {
        const min = c.start, max = c.start + c.units;
        const isNa = value === "na";
        const has = Number.isInteger(value);
        const out = h("output", { class: "slider__val", text: has ? String(value) : t("take.notSet") });
        const range = h("input", { type: "range", min: String(min), max: String(max), step: "1", value: String(has ? value : Math.round((min + max) / 2)), disabled: readOnly || isNa,
          class: has ? "is-set" : "", "aria-labelledby": titleId,
          oninput: (e) => { const v = Number(e.target.value); out.textContent = String(v); range.classList.add("is-set"); onChange(v); } });
        const ticks = h("div", { class: "slider__ticks", "aria-hidden": "true" }, Array.from({ length: Math.min(c.units, 20) + 1 }, (_, i) => h("span", { text: String(Math.round(min + (i * c.units) / Math.min(c.units, 20))) })));
        wrap.append(h("div", { class: "slider" },
          h("div", { class: "slider__ends" }, h("span", { text: B(c.left) }), h("span", { text: B(c.right) })),
          range, ticks, h("p", { class: "slider__row" }, t("take.yourAnswer"), " ", out,
            !readOnly ? btn(t("take.clear"), () => { range.classList.remove("is-set"); out.textContent = t("take.notSet"); if (naBox) naBox.checked = false; range.disabled = false; onChange(null); }, "linkbtn") : null)));
        let naBox = null;
        if (c.na) {
          naBox = h("input", { type: "checkbox", id: nid(), checked: isNa, disabled: readOnly, onchange: (e) => {
            range.disabled = e.target.checked;
            out.textContent = e.target.checked ? t("take.na") : t("take.notSet");
            range.classList.remove("is-set");
            onChange(e.target.checked ? "na" : null);
          } });
          if (isNa) out.textContent = t("take.na");
          wrap.append(h("div", { class: "check" }, naBox, h("label", { for: naBox.id, text: t("take.naLong") })));
        }
        break;
      }
      case "rank": {
        let cur = Array.isArray(value) ? [...value] : [];
        const box = h("div", { class: "rank" });
        const label = (id) => B(c.options.find((o) => o.id === id));
        const draw = () => {
          clear(box);
          const limit = c.limit || c.options.length;
          box.append(h("p", { class: "hint", text: t(c.limit ? "take.rankLimit" : "take.rankAll", { n: limit }) }));
          const ol = h("ol", { class: "rank__list" }, cur.map((id, i) => h("li", {}, h("span", { class: "rank__label", text: label(id) }),
            !readOnly ? h("span", { class: "row" },
              btn("↑", () => { if (i) { [cur[i - 1], cur[i]] = [cur[i], cur[i - 1]]; onChange([...cur]); draw(); } }, "btn btn--ghost btn--icon", { "aria-label": t("take.moveUp", { item: label(id) }), disabled: i === 0 }),
              btn("↓", () => { if (i < cur.length - 1) { [cur[i + 1], cur[i]] = [cur[i], cur[i + 1]]; onChange([...cur]); draw(); } }, "btn btn--ghost btn--icon", { "aria-label": t("take.moveDown", { item: label(id) }), disabled: i === cur.length - 1 }),
              btn("×", () => { cur.splice(i, 1); onChange(cur.length ? [...cur] : null); draw(); }, "btn btn--ghost btn--icon", { "aria-label": t("take.removeItem", { item: label(id) }) })) : null)));
          box.append(ol);
          const rest = c.options.filter((o) => !cur.includes(o.id));
          if (!readOnly && rest.length && cur.length < limit) {
            box.append(h("p", { class: "hint", text: t("take.rankAdd") }), h("div", { class: "row rank__pool" }, rest.map((o) => btn(`+ ${B(o)}`, () => { cur.push(o.id); onChange([...cur]); draw(); }))));
          }
        };
        draw();
        wrap.append(box);
        break;
      }
      case "text":
      case "longtext": {
        const isLong = q.type === "longtext";
        const counter = h("span", { class: "hint counter" });
        const upd = (v) => { counter.textContent = t("take.chars", { n: v.length, max: c.maxLength }); };
        const inp = h(isLong ? "textarea" : "input", { type: isLong ? null : "text", rows: isLong ? "5" : null, maxlength: String(c.maxLength), value: value || "", disabled: readOnly, "aria-labelledby": titleId, dir: "auto",
          oninput: (e) => { upd(e.target.value); onChange(e.target.value || null); } });
        upd(value || "");
        wrap.append(inp, counter);
        break;
      }
      case "number": {
        const inp = h("input", { type: "number", inputmode: "decimal", class: "num-in", value: value ?? "", min: c.min ?? null, max: c.max ?? null, step: c.integer ? "1" : "any", disabled: readOnly, "aria-labelledby": titleId,
          oninput: (e) => { const v = e.target.value; onChange(v === "" ? null : Number(v)); } });
        wrap.append(inp, c.min !== null || c.max !== null ? h("p", { class: "hint", text: t("take.range", { min: c.min ?? "–", max: c.max ?? "–" }) }) : null);
        break;
      }
    }
    return wrap;
  }

  // ---------- Results ----------

  function bar(value, max, label) {
    const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    const b = h("span", { class: "bar", role: "img", "aria-label": label }, h("span", { class: "bar__fill" }));
    b.firstChild.style.inlineSize = `${pct}%`;
    return b;
  }

  async function viewResults(id, view) {
    const { survey: sv } = await api("GET", `surveys/${id}`);
    const full = sv.can.results === "full";
    const partial = full && sessionStorage.getItem("xsim_partial") === "1";
    const r = await api("GET", `surveys/${id}/results${partial ? "?partial=1" : ""}`);
    if (sv.can.edit) surveyHeader(view, sv, "results");
    else view.append(h("p", { class: "crumbs" }, h("a", { href: "#/", text: t("nav.home") })), h("h1", { text: F(sv, "title") }));

    if (r.hidden) {
      view.append(h("p", { class: "notice", text: t(r.reason === "open" ? "results.hiddenOpen" : "results.hidden", { n: r.min_group, submitted: r.counts.submitted }) }));
      return;
    }
    const c = r.counts;
    const summary = h("div", { class: "stats" },
      stat(t("results.submitted"), `${c.submitted}`),
      full ? stat(t("results.inProgress"), `${c.started}`) : null,
      full ? stat(t("results.invited"), `${c.assigned}`) : null);
    view.append(summary);
    if (!full) view.append(h("p", { class: "hint", text: t("results.anonNote", { n: r.min_group }) }));
    if (full) {
      const tog = h("input", { type: "checkbox", id: nid(), checked: partial, onchange: (e) => { try { sessionStorage.setItem("xsim_partial", e.target.checked ? "1" : "0"); } catch (_) {} render(); } });
      view.append(h("div", { class: "row" },
        h("div", { class: "check" }, tog, h("label", { for: tog.id, text: t("results.includePartial") })),
        h("a", { class: "btn btn--ghost btn--sm", href: `/api/app/surveys/${id}/export?lang=en`, download: "", text: t("results.exportEn") }),
        h("a", { class: "btn btn--ghost btn--sm", href: `/api/app/surveys/${id}/export?lang=he`, download: "", text: t("results.exportHe") })),
        h("p", { class: "hint", text: t("results.basis", { n: c.included }) }));
    }

    // Capability scores
    const caps = Object.entries(r.capabilities || {});
    if (caps.length) {
      caps.sort((a, b) => (b[1].gap ?? -1) - (a[1].gap ?? -1));
      const maxGap = Math.max(...caps.map(([, x]) => x.gap || 0), 1);
      const tb = h("tbody");
      caps.forEach(([k, x], i) => tb.append(h("tr", { class: i < 3 && x.gap !== null ? "is-top" : null },
        h("th", { scope: "row", text: t("cap." + k) }),
        h("td", { class: "num" }, h("span", { class: "barcell" }, bar(x.current || 0, x.scale_max || 5, `${num(x.current)}`), h("span", { text: num(x.current) }))),
        h("td", { class: "num", text: num(x.importance) }),
        h("td", { class: "num" }, h("span", { class: "barcell" }, bar(x.gap || 0, maxGap, `${num(x.gap)}`), h("strong", { text: num(x.gap) }))),
        h("td", { class: "num", dir: "ltr", text: x.n > 1 ? (x.low === null ? num(x.spread) : `${num(x.spread)} (${num(x.low)}–${num(x.high)})`) : "–" }))));
      view.append(h("section", { class: "panel" },
        h("h2", { text: t("results.capTitle") }),
        h("p", { class: "hint", text: t("results.capHint") }),
        h("div", { class: "table-wrap" }, h("table", { class: "table table--scores" },
          h("thead", {}, h("tr", {}, [t("results.capability"), t("results.current"), t("results.importance"), t("results.gap"), t("results.spread")].map((x) => h("th", { scope: "col", text: x })))), tb))));
    }

    // CEO versus team (xSim only)
    if (full && r.ceo) {
      const tb = h("tbody");
      for (const k of Object.keys(r.ceo.team)) {
        const a = r.ceo.ceo[k] || {}, b = r.ceo.team[k] || {};
        const d = a.current !== null && b.current !== null && a.current !== undefined ? a.current - b.current : null;
        tb.append(h("tr", { class: d !== null && Math.abs(d) >= 1 ? "is-top" : null },
          h("th", { scope: "row", text: t("cap." + k) }),
          h("td", { class: "num", text: num(a.current) }), h("td", { class: "num", text: num(b.current) }),
          h("td", { class: "num", dir: "ltr", text: d === null ? "–" : (d > 0 ? "+" : "") + num(d) }),
          h("td", { class: "num", text: num(a.importance) }), h("td", { class: "num", text: num(b.importance) })));
      }
      view.append(h("section", { class: "panel panel--private" },
        h("h2", { text: t("results.ceoTitle") }),
        h("p", { class: "hint", text: t("results.ceoHint") }),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["capability", "ceoCurrent", "teamCurrent", "diff", "ceoImportance", "teamImportance"].map((k) => h("th", { scope: "col", text: t("results." + k) })))), tb))));
    }

    // Per question
    const qmap = new Map(sv.sections.flatMap((x) => x.questions).map((q) => [q.id, q]));
    const qsec = h("section", { class: "panel" }, h("h2", { text: t("results.byQuestion") }), h("p", { class: "hint", text: t("results.expandHint") }));
    let n = 0;
    for (const sec of sv.sections) {
      const items = sec.questions.map((q) => r.questions.find((x) => x.id === q.id)).filter(Boolean);
      if (!items.length) { n += sec.questions.length; continue; }
      const det = h("details", { class: "res-group" }, h("summary", {}, h("span", { class: "res-sec", text: F(sec, "title") }), h("span", { class: "hint", text: " " + t("results.questionsCount", { n: items.length }) })));
      for (const q of sec.questions) {
        n++;
        const st = r.questions.find((x) => x.id === q.id);
        if (!st) continue;
        det.append(questionResult(qmap.get(q.id), st, n));
      }
      qsec.append(det);
    }
    view.append(qsec);

    if (full && r.people) {
      const tb = h("tbody");
      for (const p of r.people) {
        tb.append(h("tr", {},
          h("td", {}, p.name, p.is_ceo ? h("span", { class: "chip chip--ceo", text: t("people.ceo") }) : null),
          h("td", {}, statusChip(p.submitted_at ? "submitted" : p.started_at ? "inprogress" : "notstarted")),
          h("td", { text: p.submitted_at ? fmtDate(p.submitted_at) : "" }),
          h("td", { text: p.answer_lang ? t("lang." + p.answer_lang) : "" }),
          h("td", {}, p.started_at ? h("a", { href: `#/s/${id}/results/${p.id}`, text: t("results.viewAnswers") }) : null)));
      }
      view.append(h("section", { class: "panel panel--private" },
        h("h2", { text: t("results.individuals") }),
        h("p", { class: "hint", text: t("results.individualsHint") }),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, [t("people.person"), t("people.progress"), t("results.submittedAt"), t("results.language"), ""].map((x) => h("th", { scope: "col", text: x })))), tb))));
    }
  }

  function stat(label, value) {
    return h("div", { class: "stat" }, h("span", { class: "stat__v", text: value }), h("span", { class: "stat__l", text: label }));
  }

  function distribution(rows, total) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return h("div", { class: "dist" }, rows.map((r) => h("div", { class: "dist__row" },
      h("span", { class: "dist__label", text: r.label }),
      bar(r.count, max, `${r.count}`),
      h("span", { class: "dist__n", dir: "ltr", text: total ? `${r.count} (${Math.round((r.count / total) * 100)}%)` : String(r.count) }))));
  }

  function scaleRows(counts, start, labels, na) {
    const rows = counts.map((cnt, i) => ({ label: `${start + i}${labels && B(labels[i]) ? " " + B(labels[i]) : ""}`, count: cnt }));
    if (na !== undefined && na !== false) rows.push({ label: t("take.na"), count: na });
    return rows;
  }

  function questionResult(q, st, n) {
    const c = q.config;
    const box = h("article", { class: "qr-item" },
      h("p", { class: "qa__title" }, h("span", { class: "qa__n", text: `${n}.` }), " ", F(q, "text")),
      h("p", { class: "hint", text: t("results.answered", { n: st.answered }) }));
    const meanLine = (x) => (x.n ? h("p", { class: "meanline" }, t("results.mean"), " ", h("strong", { text: num(x.mean) }), x.n > 1 ? ` · ${t("results.sd")} ${num(x.sd)}` : "") : null);
    switch (q.type) {
      case "likert":
        box.append(meanLine(st), distribution(scaleRows(st.counts, c.start, c.labels, c.na ? st.na : undefined), st.answered));
        break;
      case "slider":
        box.append(meanLine(st), h("p", { class: "hint", text: `${c.start} ${B(c.left)} · ${c.start + c.units} ${B(c.right)}` }),
          distribution(scaleRows(st.counts, c.start, null, c.na ? st.na : undefined), st.answered));
        break;
      case "grid": {
        const tb = h("tbody");
        for (const row of c.rows) {
          const rs = st.rows.find((x) => x.id === row.id);
          tb.append(h("tr", {}, h("th", { scope: "row", text: B(row) }),
            h("td", { class: "num" }, h("span", { class: "barcell" }, bar(rs.mean || 0, c.start + c.points - 1, num(rs.mean)), h("strong", { text: num(rs.mean) }))),
            h("td", { class: "num", text: String(rs.n) }),
            h("td", { class: "dist-inline", dir: "ltr", text: rs.counts.map((x, i) => `${c.start + i}: ${x}`).join("  ") })));
        }
        box.append(h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, [t("results.row"), t("results.mean"), "n", t("results.distribution")].map((x) => h("th", { scope: "col", text: x })))), tb)));
        break;
      }
      case "single":
      case "multi":
        box.append(distribution(c.options.map((o) => ({ label: B(o), count: st.counts[o.id] || 0 })), st.answered));
        break;
      case "yesno":
        box.append(distribution([{ label: t("take.yes"), count: st.counts.yes || 0 }, { label: t("take.no"), count: st.counts.no || 0 },
          ...(c.na ? [{ label: t("take.na"), count: st.counts.na || 0 }] : [])], st.answered));
        break;
      case "rank": {
        const rows = c.options.map((o) => ({ o, s: st.scores[o.id] })).sort((a, b) => b.s.points - a.s.points);
        const max = Math.max(1, ...rows.map((x) => x.s.points));
        box.append(h("p", { class: "hint", text: t("results.rankHint") }),
          h("div", { class: "dist" }, rows.map(({ o, s: sc }) => h("div", { class: "dist__row" }, h("span", { class: "dist__label", text: B(o) }), bar(sc.points, max, String(sc.points)),
            h("span", { class: "dist__n", text: t("results.rankLine", { points: sc.points, first: sc.first }) })))));
        break;
      }
      case "number":
        box.append(st.n ? h("p", { class: "meanline", text: `${t("results.mean")} ${num(st.mean)} · ${t("results.min")} ${num(st.min)} · ${t("results.max")} ${num(st.max)}` }) : null);
        break;
      case "text":
      case "longtext":
        box.append(st.texts && st.texts.length
          ? h("ul", { class: "texts" }, st.texts.map((x) => h("li", { dir: "auto", text: x })))
          : h("p", { class: "hint", text: t("results.noText") }));
        break;
    }
    return box;
  }

  async function viewIndividual(id, uid, view) {
    const [{ survey: sv }, r] = await Promise.all([api("GET", `surveys/${id}`), api("GET", `surveys/${id}/responses/${uid}`)]);
    const p = r.person;
    view.append(h("p", { class: "crumbs" }, h("a", { href: `#/s/${id}/results`, text: F(sv, "title") }), " / ", h("span", { text: t("results.individual") })),
      h("h1", { text: p.name }),
      h("p", { class: "notice", text: t("results.individualNote") }),
      h("p", { class: "meta" }, statusChip(p.submitted_at ? "submitted" : "inprogress"), p.is_ceo ? h("span", { class: "chip chip--ceo", text: t("people.ceo") }) : null,
        p.submitted_at ? h("span", { text: fmtDate(p.submitted_at) }) : null, p.answer_lang ? h("span", { text: t("lang." + p.answer_lang) }) : null));
    let n = 0;
    for (const sec of sv.sections) {
      const secEl = h("section", { class: "take__sec" }, h("h2", { text: F(sec, "title") }));
      for (const q of sec.questions) secEl.append(renderQuestion(q, ++n, r.answers[q.id], () => {}, true));
      view.append(secEl);
    }
  }

  // ---------- Companies (admin) ----------

  // Create (company = null) or rename a company. Resolves to { id, name } or null if cancelled.
  function companyDialog(company) {
    return new Promise((resolve) => {
      const err = errorLine();
      const name = h("input", { type: "text", maxlength: "160", value: company ? company.name : "", autocomplete: "off" });
      const d = h("dialog", { class: "dlg", "aria-labelledby": "cd-title" });
      const close = (v) => { d.close(); d.remove(); resolve(v); };
      const save = h("button", { type: "submit", class: "btn btn--primary btn--sm" }, t(company ? "common.save" : "companies.create"));
      const form = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        showError(err, "");
        const v = name.value.trim();
        if (!v) return showError(err, t("companies.needName"));
        save.disabled = true;
        try {
          if (company) {
            await api("PATCH", `admin/companies/${company.id}`, { name: v });
            close({ id: company.id, name: v });
          } else {
            const r = await api("POST", "admin/companies", { name: v });
            toast(t("companies.created", { name: v }));
            close(r.company);
          }
        } catch (ex) {
          showError(err, errText(ex));
          save.disabled = false;
        }
      } }, field(t("companies.name"), name, company ? null : t("companies.nameHint")), err,
        h("div", { class: "dlg__actions" }, btn(t("common.cancel"), () => close(null)), save));
      d.append(h("h2", { id: "cd-title", class: "dlg__title", text: t(company ? "companies.renameTitle" : "companies.add") }), form);
      d.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
      document.body.append(d);
      d.showModal();
      name.focus();
    });
  }

  async function viewCompanies(view) {
    const { companies } = await api("GET", "admin/companies");
    const tb = h("tbody");
    for (const c of companies) {
      const own = !!c.internal;
      const empty = !c.users && !c.surveys;
      tb.append(h("tr", {},
        h("th", { scope: "row" }, c.name, own ? h("span", { class: "hint", text: " " + t("companies.ours") }) : null),
        h("td", { class: "num", text: String(c.users) }),
        h("td", { class: "num", text: String(c.respondents) }),
        h("td", { class: "num", text: String(c.viewers) }),
        h("td", { class: "num", text: String(c.surveys) }),
        h("td", { class: "actions" },
          btn(t("companies.addUser"), () => userForm(null, companies, c.name)),
          !own ? btn(t("companies.rename"), async () => { if (await companyDialog(c)) { toast(t("common.saved")); render(); } }) : null,
          !own && empty ? btn(t("common.delete"), async () => {
            if (!(await confirmBox(t("companies.deleteTitle"), t("companies.confirmDelete", { name: c.name }), t("common.delete"), true))) return;
            try { await api("DELETE", `admin/companies/${c.id}`); toast(t("companies.deleted")); render(); } catch (e) { toast(errText(e), "err"); }
          }, "btn btn--danger btn--sm") : null)));
    }
    view.append(
      h("div", { class: "block__head" }, h("h1", { text: t("companies.title") }),
        btn(t("companies.add"), async () => { if (await companyDialog(null)) render(); }, "btn btn--primary btn--sm")),
      h("p", { class: "hint", text: t("companies.intro") }),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ["name", "users", "respondents", "viewers", "surveys", "actions"].map((k) => h("th", { scope: "col", class: ["users", "respondents", "viewers", "surveys"].includes(k) ? "num" : null, text: t("companies.col." + k) })))),
        tb)));
  }

  // ---------- Users (admin) ----------

  async function viewUsers(view) {
    const [{ users }, { companies }] = await Promise.all([api("GET", "admin/users"), api("GET", "companies")]);
    const q = h("input", { type: "search", placeholder: t("users.search"), "aria-label": t("users.search") });
    const compSel = h("select", { "aria-label": t("users.company") }, h("option", { value: "", text: t("users.allCompanies") }), companies.map((c) => h("option", { value: c.id, text: c.name })));
    const tb = h("tbody");
    const roleNames = (u) => ["admin", "editor", "viewer", "respondent"].filter((k) => u.roles[k]).map((k) => t("roles." + k)).join(", ");
    const draw = () => {
      clear(tb);
      const needle = q.value.trim().toLowerCase();
      for (const u of users) {
        if (compSel.value && u.company_id !== compSel.value) continue;
        if (needle && !`${u.name} ${u.email} ${u.company}`.toLowerCase().includes(needle)) continue;
        tb.append(h("tr", { class: u.status === "disabled" ? "is-muted" : null },
          h("td", {}, h("strong", { text: u.name }), h("br"), h("span", { class: "hint", dir: "ltr", text: u.email }), h("br"), h("span", { class: "hint uid", dir: "ltr", text: `UID ${u.id}` })),
          h("td", { text: u.company }),
          h("td", { text: roleNames(u) }),
          h("td", {}, statusChip(u.status), u.mfa ? h("span", { class: "hint", text: " " + t("users.mfaOn") }) : null),
          h("td", { text: u.last_login_at ? fmtDate(u.last_login_at) : "–" }),
          h("td", { class: "actions" },
            btn(t("common.edit"), () => userForm(u, companies)),
            u.status === "pending" ? btn(t("users.newLink"), async () => {
              try { const r = await api("POST", `admin/users/${u.id}/link`, {}); await showLink(r.delivery, u, "setup"); } catch (e) { toast(errText(e), "err"); }
            }) : null,
            u.status === "active" ? btn(t("users.reset"), async () => {
              if (!(await confirmBox(t("users.reset"), t("users.confirmReset", { name: u.name }), t("users.reset"), true))) return;
              try { const r = await api("POST", `admin/users/${u.id}/reset`, {}); await showLink(r.delivery, u, "reset"); render(); } catch (e) { toast(errText(e), "err"); }
            }) : null,
            u.status !== "disabled" ? btn(t("users.disable"), async () => {
              if (!(await confirmBox(t("users.disable"), t("users.confirmDisable", { name: u.name }), t("users.disable"), true))) return;
              try { await api("POST", `admin/users/${u.id}/disable`, {}); render(); } catch (e) { toast(errText(e), "err"); }
            }, "btn btn--danger btn--sm") : btn(t("users.enable"), async () => {
              try { await api("POST", `admin/users/${u.id}/enable`, {}); render(); } catch (e) { toast(errText(e), "err"); }
            }))));
      }
      if (!tb.children.length) tb.append(h("tr", {}, h("td", { colspan: "6", class: "empty", text: t("users.noMatch") })));
    };
    q.addEventListener("input", draw);
    compSel.addEventListener("change", draw);
    draw();
    view.append(
      h("div", { class: "block__head" }, h("h1", { text: t("users.title") }), btn(t("users.add"), () => userForm(null, companies), "btn btn--primary btn--sm")),
      h("p", { class: "hint", text: t("users.intro") }),
      h("div", { class: "row filters" }, q, compSel),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ["person", "company", "roles", "status", "lastLogin", "actions"].map((k) => h("th", { scope: "col", text: t("users.col." + k) })))), tb)));
  }

  function userForm(u, companies, presetCompany = "") {
    const isNew = !u;
    const d = u ? { ...u, roles: { ...u.roles } } : { name: "", email: "", phone: "", company: presetCompany, lang: LANG, roles: { respondent: true } };
    const err = errorLine();
    const listId = nid("dl");
    const inp = (key, type, attrs = {}) => h("input", { type, value: d[key] || "", oninput: (e) => { d[key] = e.target.value; }, ...attrs });
    const langSel = h("select", { onchange: (e) => { d.lang = e.target.value; } },
      h("option", { value: "en", selected: d.lang === "en", text: "English" }), h("option", { value: "he", selected: d.lang === "he", text: "עברית" }));
    const roleBoxes = ["respondent", "viewer", "editor", "admin"].map((k) => {
      const cb = h("input", { type: "checkbox", id: nid(), checked: !!d.roles[k], onchange: (e) => { d.roles[k] = e.target.checked; } });
      return h("div", { class: "check" }, cb, h("label", { for: cb.id }, h("strong", { text: t("roles." + k) }), " ", h("span", { class: "hint", text: t("roles." + k + "Hint") })));
    });
    const body = h("form", { class: "form", novalidate: true },
      field(t("users.name"), inp("name", "text", { maxlength: "120", autocomplete: "off" })),
      field(t("users.email"), inp("email", "email", { maxlength: "200", dir: "ltr", autocomplete: "off" })),
      field(t("users.phone"), inp("phone", "tel", { maxlength: "40", dir: "ltr", autocomplete: "off" })),
      field(t("users.company"), inp("company", "text", { list: listId, maxlength: "160", autocomplete: "off" }), t("users.companyHint")),
      h("p", { class: "hint", text: t("users.staffHint") }),
      h("datalist", { id: listId }, companies.map((c) => h("option", { value: c.name }))),
      field(t("users.lang"), langSel, t("users.langHint")),
      h("fieldset", { class: "radios" }, h("legend", { text: t("users.roles") }), roleBoxes),
      err);
    const d2 = h("dialog", { class: "dlg dlg--wide", "aria-labelledby": "uf-title" });
    const close = () => { d2.close(); d2.remove(); };
    const save = h("button", { type: "button", class: "btn btn--primary btn--sm", onclick: async () => {
      showError(err, "");
      save.disabled = true;
      try {
        const payload = { name: d.name, email: d.email, phone: d.phone, company: d.company, lang: d.lang, roles: d.roles };
        if (isNew) {
          const r = await api("POST", "admin/users", payload);
          close();
          await showLink(r.delivery, r.user, "setup");
        } else {
          await api("PATCH", `admin/users/${u.id}`, payload);
          close();
          toast(t("common.saved"));
        }
        render();
      } catch (e) {
        const fields = e.data && e.data.fields ? e.data.fields.map((f) => t("users.field." + f)).join(", ") : "";
        showError(err, fields ? `${errText(e)} ${fields}` : errText(e));
        save.disabled = false;
      }
    } }, t(isNew ? "users.create" : "common.save"));
    d2.append(h("h2", { id: "uf-title", class: "dlg__title", text: t(isNew ? "users.add" : "users.editTitle") }),
      isNew ? h("p", { class: "hint", text: t("users.createHint") }) : h("p", { class: "hint uid", dir: "ltr", text: `UID ${u.id}` }),
      h("div", { class: "dlg__body" }, body),
      h("div", { class: "dlg__actions" }, btn(t("common.cancel"), close), save));
    d2.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    document.body.append(d2);
    d2.showModal();
  }

  function activitySubject(detail) {
    try { const d = JSON.parse(detail || "{}"); return d.to || d.name || d.title || ""; } catch (_) { return ""; }
  }

  async function viewActivity(view) {
    const { entries } = await api("GET", "audit");
    const tb = h("tbody", {}, entries.map((e) => h("tr", {},
      h("td", { text: fmtDate(e.at) }),
      h("td", { text: e.actor_name || "–" }),
      h("td", { text: t("audit." + e.action) === "audit." + e.action ? e.action : t("audit." + e.action) }),
      h("td", { text: e.target_name || activitySubject(e.detail) }))));
    view.append(h("h1", { text: t("activity.title") }), h("p", { class: "hint", text: t("activity.intro") }),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ["when", "who", "what", "subject"].map((k) => h("th", { scope: "col", text: t("activity.col." + k) })))), tb)));
  }

  // ---------- Account ----------

  async function viewAccount(view) {
    const me = state.me;
    const roles = ["admin", "editor", "viewer", "respondent"].filter((k) => me.roles[k]).map((k) => t("roles." + k)).join(", ");
    const err = errorLine();
    const cur = h("input", { type: "password", autocomplete: "current-password" });
    const pw = h("input", { type: "password", autocomplete: "new-password", minlength: "10" });
    const pw2 = h("input", { type: "password", autocomplete: "new-password" });
    const pwForm = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showError(err, "");
      if (pw.value !== pw2.value) return showError(err, t("setup.mismatch"));
      try {
        await api("POST", "account/password", { current: cur.value, password: pw.value });
        cur.value = pw.value = pw2.value = "";
        toast(t("account.pwChanged"));
      } catch (ex) { showError(err, errText(ex)); }
    } }, h("input", { type: "email", autocomplete: "username", value: me.email, hidden: true, readonly: true }),
      field(t("account.current"), cur), field(t("setup.password"), pw, t("setup.passwordHint")), field(t("setup.password2"), pw2), err,
      h("button", { type: "submit", class: "btn btn--primary btn--sm" }, t("account.changePw")));

    const err2 = errorLine();
    const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", dir: "ltr", class: "code-input" });
    const rcForm = h("form", { class: "form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showError(err2, "");
      try {
        const r = await api("POST", "account/recovery", { code: code.value });
        showRecovery(clear(view), r.recovery, false);
      } catch (ex) { showError(err2, errText(ex)); }
    } }, field(t("mfa.code"), code), err2, h("button", { type: "submit", class: "btn btn--ghost btn--sm" }, t("account.newCodes")));

    const langSel = h("select", { onchange: async (e) => {
      try { await api("POST", "account/lang", { lang: e.target.value }); toast(t("common.saved")); } catch (ex) { toast(errText(ex), "err"); }
    } }, h("option", { value: "en", selected: me.lang === "en", text: "English" }), h("option", { value: "he", selected: me.lang === "he", text: "עברית" }));

    view.append(h("h1", { text: t("account.title") }),
      h("section", { class: "panel" }, h("dl", { class: "facts" },
        h("dt", { text: t("users.name") }), h("dd", { text: me.name }),
        h("dt", { text: t("users.email") }), h("dd", { dir: "ltr", text: me.email }),
        h("dt", { text: t("users.company") }), h("dd", { text: me.company || "" }),
        h("dt", { text: t("users.roles") }), h("dd", { text: roles }),
        h("dt", { text: "UID" }), h("dd", { dir: "ltr", class: "uid", text: me.id })),
        field(t("account.lang"), langSel, t("account.langHint"))),
      h("div", { class: "grid2" },
        h("section", { class: "panel" }, h("h2", { text: t("account.changePw") }), pwForm),
        h("section", { class: "panel" }, h("h2", { text: t("account.recoveryTitle") }), h("p", { class: "hint", text: t("account.recoveryHint") }), rcForm)));
  }

  window.addEventListener("hashchange", render);
  boot();
})();
