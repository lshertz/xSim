# xSim website: project context

Read this first before any work on the xsim.dev site, and keep it as the project knowledge for that work.

## What this is

B2B marketing and lead-generation site for **xSim**, simulation-based executive development (the venture previously called EDGE / EDGE Team Dynamics). Market: Israel-based companies and Israeli-led leadership teams. Founders: Jeremy Stein and Larry Shertz. Founders are deliberately **not named** on the site yet.

**Goal of the site:** give senior buyers (CEO, CHRO/VP HR, Chief of Staff) high-quality, high-level information, then convert them into a **briefing request**: a sales meeting where the client pitch deck is presented. The site is not the pitch itself.

## Status

**Live at https://xsim.dev since Oct 8 2026** (Cloudflare account lshertz@gmail.com). **Workflow: private GitHub repo `lshertz/xSim` (https://github.com/lshertz/xSim), branch `main`; Cloudflare Workers Builds deploys every push** (build `npm run build`, deploy `npx wrangler deploy`). Do not deploy with `npm run deploy` except in an emergency, and push afterwards. Secrets live only in Cloudflare; `.gitignore` blocks `.dev.vars`, `.env*`, keys and `.wrangler/`. The briefing form is confirmed working end to end with Turnstile. Deploy lessons: keep the D1 binding named `DB` (ignore the binding name Wrangler suggests); if `wrangler login` times out on Windows, retry or use an API token; the Turnstile secret can also be set in the dashboard under Workers & Pages → xsim-website → Settings → Variables and Secrets. Bot Fight Mode is deliberately off (it can challenge the form's API call and cannot be bypassed per path).

## Client portal (/app/ and /he/app/)

A gated section for running the assessment survey with each customer. Everything lives in the same Worker and D1 database as the site (migration `0002_portal.sql`); pages are a static shell, `site/static/assets/js/portal.js` renders every view, and `src/portal/` is the API under `/api/app/`. Not linked from the public site, `noindex`, and disallowed in robots.txt.

**Sign-in.** Email and password (PBKDF2-SHA256, 100,000 iterations), Turnstile on the sign-in form, then a code from an authenticator app (TOTP, RFC 6238). Eight single-use recovery codes are shown once at setup. Eight failed passwords lock the account for 15 minutes. Five wrong authenticator or recovery codes pause sign-in for 15 minutes and end every session of that user; each further pause doubles (30, 60 minutes and so on, up to 24 hours) until a successful sign-in. Counters are updated atomically, and a code can be used only once. Sessions are server-side (cookie `__Host-xsim_session`, HttpOnly, Secure, SameSite=Strict), end after two hours idle or 12 hours in total, and every state-changing request needs the `X-XSim` header and an allowed Origin. Each user has a UID (random UUID) tied to one email address.

**Roles** (they combine; a CEO can be a Respondent and a Viewer):
- *Admin*: everything. Manages companies on the Companies page (add, rename; delete only while a company has no users and no surveys; the xSim company is protected) and can also add a company from the New survey form. Creates users (name, email, phone and company required; typing a new company name in the user form also creates it), edits, disables and enables them, resets passwords. A reset removes the password, 2FA and recovery codes, signs the person out everywhere and issues a new link; they set a password and 2FA again. There must always be one active admin.
- *Editor*: creates surveys for an existing customer company (Editors cannot add companies), adds the customer logo, builds sections and questions, assigns that company's Respondents, marks the CEO, invites other Editors to collaborate, opens and closes the survey, sees full results. Collaborators can edit everything but each Editor can delete only the questions (and sections) they created; only the creator or an Admin can delete a survey, and once it has answers only an Admin can.
- *Respondent*: answers the surveys they are assigned to, in English or Hebrew; answers autosave and stay editable until the survey closes.
- *Viewer*: company-wide anonymized results for their own company: capability scores and per-question distributions only, hidden until at least 3 people have submitted, no free-text answers, no CEO comparison, no individual answers.

**Tenant separation.** The xSim company is marked internal (migration 0003). Admin and Editor roles can be given only to its members; the server refuses them for customer users, and a session ignores those flags for anyone outside the internal company even if the database says otherwise. Respondents can open only their own company's surveys, and moving someone to another company drops their unstarted assignments elsewhere. Viewers see only their own company's results, only after the survey has closed (so totals cannot be watched changing as each person submits), and only with 3 or more submissions. They do see each capability's lowest and highest individual average, which are not linked to names. A password set from a link must be followed by 2FA setup within 24 hours, or a new link is needed.

**Confidentiality rules (decided Nov 2026).** Individual answers are visible to Admins and to the survey's Editors only. The CEO versus team comparison is xSim only. Viewers never see free text; xSim summarizes it in the CEO report. Customer users never see the Users or Activity pages.

**Surveys.** Bilingual per question (English and Hebrew text side by side; respondents see their portal language and fall back to the other). Question types: rating scale (2 to 11 points, optional point labels, optional N/A), single choice, multiple choice (optional maximum), slider (editor sets the lowest value, number of units and end labels), rating grid, ranking (optional top N), yes/no, short text, long text, number. Status: draft (xSim only), open, closed (reopenable); optional closing date. Once any answer exists the structure locks (no adding, removing or restructuring; wording can still be fixed); duplicate the survey for bigger changes. The Executive Team Pulse is a built-in template (`src/portal/templates/pulse.json`): English from the Pulse document with em dashes removed, Hebrew drafted and awaiting native review.

**Scoring** follows the Pulse facilitator notes: sections tagged with a capability feed its current state (mean of scale items, N/A excluded); rating-grid rows tagged with a capability feed its importance; priority gap = importance × (scale maximum − current state); spread = standard deviation of each person's own capability mean; CEO versus team when a respondent is marked CEO. Results count submitted responses (xSim can include in-progress ones) and export to CSV in English or Hebrew.

**Email is off (MAIL_MODE "manual").** Setup and reset links are shown to the admin once, to copy and send personally. Setup links last 7 days, reset links 3 days, and each works once. Sending to customer addresses needs the Workers Paid plan; DEPLOY.md, "Portal email", has both upgrade paths.

**Security review (Nov 2026)** and the account-level hardening checklist are in DEPLOY.md, "Portal security".

**First admins** are created from the command line: `npm run portal:admin -- email "Full Name" "phone"` prints a setup link (live database). After that, admins add everyone else in the portal.

## Lead handling

- Each briefing request is saved in the D1 database `xsim-leads` (`npm run leads` lists the latest) and emailed separately to every address in `NOTIFY_TO` in `wrangler.jsonc` (currently larry@shertz.com and jdstein7@gmail.com). Every recipient must be a verified Email Routing destination and also listed in `send_email.allowed_destination_addresses`.
- Clicking Reply on a notification goes to hello@xsim.dev (`REPLY_TO` in `wrangler.jsonc`), not to the lead. The lead's address is in the body.
- hello@xsim.dev is an Email Routing forward to larry@shertz.com.
- The Turnstile secret is a Cloudflare **Secret** set with `npx wrangler secret put TURNSTILE_SECRET_KEY` (in Command Prompt, paste with a right-click). A dashboard **Text** variable gets wiped by the next deploy; that caused the Oct 8 outage.

## Local preview

`npm run dev` builds with Cloudflare's Turnstile **test** site key and uses the test secret in `.dev.vars` (copy of `.dev.vars.example`, gitignored). The test secret only accepts tokens from the test site key, so never use the real site key locally. Local submissions go to a local copy of the database and the notification email is simulated. `npm run build` (used by Cloudflare on every push) always uses the real site key from `src/content/site.json`.

## Decisions made (Oct 2026)

- Hosting: Cloudflare Workers with static assets, D1 for leads, Email Routing for notifications, Turnstile on every form. All free tier. Vercel rejected: Hobby plan is non-commercial only.
- No framework, no build dependencies: `build.mjs` renders `src/templates.mjs` with copy from `src/content/en.json` and `src/content/he.json`.
- Bilingual from launch: English at `/`, Hebrew (RTL) at `/he/`. Hebrew uses plural address (אתם).
- No pricing on the site. Pricing is discussed in the sales meeting.
- Engagement model on the site: **Calibrate → Simulate → Integrate**. The CEO discovery interview (60 to 90 min) and the Executive Team Pulse (confidential survey) are **required** parts of Calibrate once a client is engaged. The Simulation Summit is half-day or full-day.
- Six capabilities (from the xSim Curriculum Overview): Information, Decision, Adapt, Align, Lead, Customer, with **Execute** as the thread through all six.
- Lead form fields: name, work email, company, role, team size, preferred meeting language, phone, message, consent. Honeypot + Turnstile + server-side validation.

## Visual identity

- **Logo:** hand-written "xSim" in navy on a yellow sticky note (base logo), with blue, green, orange and pink variants. Masters: `SharedGDriveMirror/Graphics/logo/` in the ExecutiveTraining folder. Web sizes (WebP, trimmed) in `site/static/assets/img/logo/`. Aspect ratio of the trimmed yellow note: 1290 x 1155.
- **Where it is used:** header and footer (yellow), favicon and apple-touch icon (yellow), social preview images (yellow on navy), utility pages use the variants (thank-you green, error orange, 404 pink).
- **Palette:** ink `#0B1A36` (matches the logo's navy; also used for labels, bullets, numbers and links on light backgrounds), paper `#F5F2EB`, paper-2 `#ECE7DC`, slate `#4F5A6A`, and the note colors yellow `#FCE742`, blue `#9AD5FC`, green `#C3ED86`, orange `#FCA75A`, pink `#FC99C4` for accents (eyebrow dashes, phase tabs, simulation chips, the Execute tag, the brush underline under the hero title; yellow replaces any accent text on navy sections). No extra accent color beyond navy and the logo's note colors. Primary buttons are navy with white text; the form's submit button is note yellow with navy text.
- **Type:** IBM Plex Sans + IBM Plex Sans Hebrew (self-hosted, SIL OFL), IBM Plex Mono for small labels.
- Hero visual is the six-capability diagram (navy, yellow EXECUTE label). A sticky-note collage in the hero does not fit the corporate B2B tone; keep the notes to the logo and small accents.

## House style rules (carry over from the pitch deck work)

- **No em dashes** anywhere in prepared content. `npm run build` warns if one appears in the content files.
- Prose over bullets; no salesy language; strict accuracy, no unverified statistics or invented claims.
- Never use "observe" for what happens to participants (reads as surveillance). Use "surfaces", "illuminate".
- Never use "mort"-rooted words. "Stress test", not "pre-mortem".
- Positive framing, not pain-point framing, for a senior audience.
- Do not claim that Israeli companies undervalue customers.
- Calibration starts once the client gives the go-ahead.
- Operator credibility figure: **"50+ years combined"** (as in Draft4 of the client deck, Sept 29 2026; earlier drafts said 75+).

## Open items

1. Native review of all Hebrew copy (`src/content/he.json`).
2. Confirm the Integrate deliverables shown on the site: CEO report and 90-day check-ins.
3. Confirm it is fine to name four simulations publicly (The $100M Decision, Customer Rescue, Blind Builder, The Perfect Meeting).
4. Privacy policy is a draft: the 24-month retention period is a placeholder and the whole page needs legal review against the Israeli Privacy Protection Law.
5. Lead notifications go to larry@shertz.com and jdstein7@gmail.com (both must be verified Email Routing destinations). Still open: who answers hello@xsim.dev.
6. Logo now in use (Oct 2026); confirm the accent palette built around it.
7. Possible later additions: booking link (e.g. Cal.com) on the thank-you page, case studies after the alpha pilots.
8. Portal: native review of the Hebrew interface strings (`src/content/portal/he.json`) and of the Hebrew Pulse template text.
9. Portal: decide when to switch on email (Workers Paid plan, or another provider); see DEPLOY.md, "Portal email".
10. Portal: the privacy policy does not yet cover portal accounts and survey answers (what is stored, who sees it, retention). Needs adding before the first customer uses it.

## File map

```
src/content/site.json   domain, contact email, Turnstile site key
src/content/en.json     all English copy
src/content/he.json     all Hebrew copy
src/templates.mjs       page HTML
src/worker.js           POST /api/lead (Turnstile, D1, email); routes /api/app/* to the portal
src/turnstile.js        Turnstile verification shared by the form and the portal sign-in
src/portal/             portal API: index.js (router, CSRF), auth.js (sign-in, 2FA, sessions),
                        admin.js (users), surveys.js (builder, answers), results.js (scores, CSV),
                        schema.js (question types), mail.js (link delivery), crypto.js, templates/pulse.json
src/content/portal/     portal strings, en.json and he.json
site/static/assets/js/portal.js, assets/css/portal.css, assets/js/vendor/qrcode.js (MIT, for the 2FA QR code)
tools/portal-admin.mjs  creates the first admins (npm run portal:admin)
site/static/            CSS, JS, fonts, images, _headers, robots.txt
migrations/             D1 schema (0001 leads, 0002 portal, 0003 portal hardening)
build.mjs               builds ./public
wrangler.jsonc          Cloudflare config (routes, D1, email, vars)
DEPLOY.md               setup, GitHub → Cloudflare workflow
```

Source material lives in the ExecutiveTraining folder: `SharedGDriveMirror/Simulations/xSim Curiculum Overview.docx`, `SharedGDriveMirror/JDS Misc/xSim Survey Discussion and Business Offering.docx`, `SharedGDriveMirror/Sales/EDGE_Client_Pitch_Deck_Draft4.pptx`, and the facilitator kits.
