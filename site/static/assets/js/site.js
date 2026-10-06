// xsim.dev: navigation and briefing form (progressive enhancement; the form also works as a plain POST).
(function () {
  "use strict";

  // Sticky header border
  var bar = document.querySelector("[data-topbar]");
  if (bar) {
    var onScroll = function () { bar.classList.toggle("is-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Mobile menu
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    var label = toggle.querySelector(".sr-only");
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      nav.classList.toggle("is-open", open);
      if (label) label.textContent = open ? label.dataset.labelClose : label.dataset.labelOpen;
    };
    toggle.addEventListener("click", function () { setOpen(toggle.getAttribute("aria-expanded") !== "true"); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
  }

  // Briefing form
  var form = document.querySelector("[data-lead-form]");
  if (!form) return;
  var status = form.querySelector("[data-status]");
  var button = form.querySelector('button[type="submit"]');
  var buttonText = button ? button.textContent : "";
  var emailRe = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

  function setStatus(msg, kind) {
    status.textContent = msg || "";
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-ok", kind === "ok");
  }
  function mark(name, bad) {
    var el = form.elements[name];
    if (!el) return;
    var field = el.closest(".field");
    if (field) field.classList.toggle("is-invalid", !!bad);
    el.setAttribute("aria-invalid", bad ? "true" : "false");
  }
  function validate() {
    var bad = [];
    ["name", "email", "company", "role"].forEach(function (n) {
      var v = (form.elements[n].value || "").trim();
      var b = !v || (n === "email" && !emailRe.test(v));
      mark(n, b);
      if (b) bad.push(n);
    });
    var c = form.elements.consent;
    mark("consent", !c.checked);
    if (!c.checked) bad.push("consent");
    return bad;
  }
  function resetTurnstile() {
    try { if (window.turnstile) window.turnstile.reset(form.querySelector(".cf-turnstile")); } catch (_) {}
  }

  form.addEventListener("input", function (e) {
    var f = e.target.closest(".field");
    if (f && f.classList.contains("is-invalid")) { f.classList.remove("is-invalid"); e.target.setAttribute("aria-invalid", "false"); }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var bad = validate();
    if (bad.length) {
      var msg = bad.indexOf("name") > -1 || bad.indexOf("company") > -1 || bad.indexOf("role") > -1
        ? form.dataset.msgRequired
        : bad.indexOf("email") > -1 ? form.dataset.msgEmail : form.dataset.msgConsent;
      setStatus(msg, "error");
      var first = form.elements[bad[0]];
      if (first) first.focus();
      return;
    }
    var fd = new FormData(form);
    if (!fd.get("cf-turnstile-response")) {
      setStatus(form.dataset.msgVerification, "error");
      return;
    }
    button.disabled = true;
    button.textContent = form.dataset.msgSending;
    setStatus("", null);

    fetch(form.action, { method: "POST", body: new URLSearchParams(fd), headers: { Accept: "application/json" } })
      .then(function (res) { return res.json().catch(function () { return { ok: false, error: "server_error" }; }); })
      .then(function (out) {
        if (out && out.ok) {
          form.classList.add("is-done");
          setStatus(form.dataset.msgSuccess, "ok");
          status.setAttribute("tabindex", "-1");
          status.focus();
          return;
        }
        if (out && out.error === "invalid" && out.fields) {
          out.fields.forEach(function (n) { mark(n, true); });
          setStatus(out.fields.indexOf("email") > -1 ? form.dataset.msgEmail : form.dataset.msgRequired, "error");
        } else if (out && out.error === "verification_failed") {
          setStatus(form.dataset.msgVerification, "error");
        } else {
          setStatus(form.dataset.msgServer, "error");
        }
        resetTurnstile();
      })
      .catch(function () {
        setStatus(form.dataset.msgServer, "error");
        resetTurnstile();
      })
      .then(function () {
        button.disabled = false;
        button.textContent = buttonText;
      });
  });
})();
