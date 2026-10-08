# xSim website: project context

Read this first before any work on the xsim.dev site, and keep it as the project knowledge for that work.

## What this is

B2B marketing and lead-generation site for **xSim**, simulation-based executive development (the venture previously called EDGE / EDGE Team Dynamics). Market: Israel-based companies and Israeli-led leadership teams. Founders: Jeremy Stein (simulation architect, lead facilitator) and Larry (GTM, commercial). Founders are deliberately **not named** on the site yet.

**Goal of the site:** give senior buyers (CEO, CHRO/VP HR, Chief of Staff) high-quality, high-level information, then convert them into a **briefing request**: a sales meeting where the client pitch deck is presented. The site is not the pitch itself.

## Status

**Live at https://xsim.dev since Oct 8 2026** (Cloudflare account lshertz@gmail.com). **Workflow: private GitHub repo `lshertz/xSim` (https://github.com/lshertz/xSim), branch `main`; Cloudflare Workers Builds deploys every push** (build `npm run build`, deploy `npx wrangler deploy`). Do not deploy with `npm run deploy` except in an emergency, and push afterwards. Secrets live only in Cloudflare; `.gitignore` blocks `.dev.vars`, `.env*`, keys and `.wrangler/`. The briefing form is confirmed working end to end with Turnstile. Deploy lessons: keep the D1 binding named `DB` (ignore the binding name Wrangler suggests); if `wrangler login` times out on Windows, retry or use an API token; the Turnstile secret can also be set in the dashboard under Workers & Pages → xsim-website → Settings → Variables and Secrets. Bot Fight Mode is deliberately off (it can challenge the form's API call and cannot be bypassed per path).

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
7. Possible later additions: booking link (e.g. Cal.com) on the thank-you page, case studies after the alpha pilots, the Executive Team Pulse as an online form (would also use Turnstile).

## File map

```
src/content/site.json   domain, contact email, Turnstile site key
src/content/en.json     all English copy
src/content/he.json     all Hebrew copy
src/templates.mjs       page HTML
src/worker.js           POST /api/lead (Turnstile, D1, email)
site/static/            CSS, JS, fonts, images, _headers, robots.txt
migrations/             D1 schema
build.mjs               builds ./public
wrangler.jsonc          Cloudflare config (routes, D1, email, vars)
DEPLOY.md               setup, GitHub → Cloudflare workflow
```

Source material lives in the ExecutiveTraining folder: `SharedGDriveMirror/Simulations/xSim Curiculum Overview.docx`, `SharedGDriveMirror/JDS Misc/xSim Survey Discussion and Business Offering.docx`, `SharedGDriveMirror/Sales/EDGE_Client_Pitch_Deck_Draft4.pptx`, and the facilitator kits.
