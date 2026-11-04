# Deploying xsim.dev

Everything below runs on the Cloudflare **free** plan. The only recurring cost is the domain renewal.

## Why Cloudflare (and not Vercel)

| | Cloudflare Workers (chosen) | Vercel Hobby |
|---|---|---|
| Commercial use on free plan | Allowed | Not allowed: "the Hobby plan restricts users to non-commercial, personal use only" |
| Domain | xsim.dev is already registered and on DNS there | Needs DNS pointed elsewhere |
| Turnstile | Native, same dashboard | Works, but separate vendor |
| Static page requests | Free and unlimited | Metered |
| Lead storage | D1 database, free tier: 5 GB, 5M rows read and 100K rows written per day | Needs a third-party database |
| Lead notification email | Free when sent to a verified address | Needs a third-party email service |

Sources: [Vercel Hobby plan](https://vercel.com/docs/plans/hobby), [Workers static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## How the site is put together

- **Pages** are plain HTML/CSS built by `npm run build` into `public/`. They are served as static assets and never run code. The client portal at `/app/` is a static shell too; its data comes from the Worker under `/api/app/` (see "Client portal" below).
- **The Worker** handles `/api/*` only. `POST /api/lead` handles the briefing form: origin check, honeypot, field validation, Turnstile verification (token, hostname and action), save to D1, email notification.
- No cookies, no trackers, no third-party scripts other than Turnstile. Strict security headers are set in `site/static/_headers`.

## One-time setup (about 30 minutes)

You need: your Cloudflare login, and **Node.js LTS** installed on your PC (https://nodejs.org). Open a terminal (PowerShell) in the `xsim-website` folder.

### 1. Install and sign in

```powershell
npm install
npx wrangler login
```

A browser window opens to authorize Wrangler (Cloudflare's command-line tool) on your account.

### 2. Create the lead database

```powershell
npx wrangler d1 create xsim-leads
```

Copy only the `database_id` it prints into `wrangler.jsonc` (replace `REPLACE_WITH_DATABASE_ID`). Ignore the rest of the snippet Wrangler suggests: keep `"binding": "DB"` as it is, because the site's code looks for the database under that name. Then create the table:

```powershell
npm run db:migrate
```

### 3. Turn on Email Routing (for notifications and hello@xsim.dev)

In the Cloudflare dashboard: **xsim.dev → Email → Email Routing**.

1. Enable Email Routing and accept the DNS records it adds.
2. Under **Destination addresses**, add `larry@shertz.com` and click the verification link Cloudflare emails you. Notifications only work after this.
3. Under **Routing rules**, create `hello@xsim.dev` and forward it to `larry@shertz.com` (this is the public contact address on the site).

To notify another address, verify it here first, then add it to both `NOTIFY_TO` and `send_email.allowed_destination_addresses` in `wrangler.jsonc`.

### 4. Create the Turnstile widget

Dashboard: **Turnstile → Add widget**.

- Name: `xsim.dev`
- Hostnames: `xsim.dev` and `www.xsim.dev`
- Widget mode: **Managed**

Copy the **Site key** into `src/content/site.json` (`turnstileSiteKey`). The site key is public by design. Keep the **Secret key** for step 6.

### 5. First deploy

```powershell
npm run deploy
```

This builds the site and deploys it. Because `wrangler.jsonc` lists `xsim.dev` and `www.xsim.dev` as custom domains, Cloudflare creates the DNS records and certificates automatically.

### 6. Add the Turnstile secret

```powershell
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Paste the secret key when prompted. It is stored encrypted at Cloudflare and never appears in the code.

### 7. Recommended dashboard settings for xsim.dev

Log in at https://dash.cloudflare.com, open your account and click **xsim.dev** in the domain list. These settings are per domain.

**Send www to the main address.** Go to **Rules → Overview → Create rule → Redirect Rule**. Name it "www to root", choose **Wildcard pattern**, and set:
- Request URL: `https://www.*`
- Target URL: `https://${1}`
- Status code: `301`
- Preserve query string: on

Then **Deploy**. Test it by opening https://www.xsim.dev; you should end up at https://xsim.dev.

**Always Use HTTPS.** Go to **SSL/TLS → Edge Certificates** and turn on **Always Use HTTPS**. (It is hidden if the SSL/TLS encryption mode on the Overview page is set to Off.)

**Bot Fight Mode: leave it off for now.** It cannot be bypassed for specific paths and Cloudflare notes it may challenge API traffic, which could block the briefing form's submission. The form is already protected by Turnstile. Revisit only if you see abuse.

Sources: [Single Redirects in the dashboard](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/create-dashboard/), [www to root example](https://developers.cloudflare.com/rules/url-forwarding/examples/redirect-www-to-root/), [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/), [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/).

### 8. Test it live

Open https://xsim.dev, submit the form with your own details, and confirm the email arrives. Then check the database:

```powershell
npm run leads
```

## Publishing workflow: GitHub → Cloudflare (the standard way)

The code lives in a **private** GitHub repository. Cloudflare's Workers Builds watches the `main` branch: every push builds the site and deploys it to xsim.dev. You no longer run `npm run deploy` by hand. Free plan: 3,000 build minutes a month, one build at a time, 20-minute limit per build; this site builds in about a minute. ([Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/))

**Secrets never go to GitHub.** The Turnstile secret is stored in Cloudflare (Workers & Pages → xsim-website → Settings → Variables and Secrets) and survives every deploy. `.gitignore` blocks `.dev.vars`, `.env` files, keys and certificates, `.wrangler/`, `node_modules/` and `public/`. What *is* in the repo and is fine to be there: the Turnstile **site** key (public by design, it ships in every page), the D1 database ID (useless without your Cloudflare login) and your notification address.

### One-time: create the repository and push

1. On github.com: **New repository** → name `xSim` → **Private** → do *not* add a README, .gitignore or license (the folder already has them) → **Create repository**.
2. In Command Prompt, in the `xsim-website` folder :

   ```
   git status
   git remote add origin https://github.com/lshertz/xSim.git
   git push -u origin main
   ```

   `git status` should say "nothing to commit". Before the first push, `git ls-files` lists exactly what will be uploaded; `.dev.vars` must not appear.

### One-time: connect the repository to Cloudflare

1. Dashboard: **Workers & Pages → xsim-website → Settings → Builds → Connect**.
2. Authorize the Cloudflare GitHub app for the `xSim` repository only (not all repositories).
3. Settings:
   - Git branch: `main`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy` (the default)
   - Root directory: leave empty
4. Save. The Worker name in the dashboard (`xsim-website`) already matches `wrangler.jsonc`, which Workers Builds requires.
5. Test: make a tiny wording change, then commit and push (below). Watch the build under **Deployments**, then check xsim.dev.

### Everyday changes

```
git pull
(edit files)
git add -A
git commit -m "Short description of the change"
git push
```

The push deploys. If a build fails, the live site stays on the previous version; the build log in the dashboard says why.

- **Wording**: `src/content/en.json` and `src/content/he.json`.
- **Design**: `site/static/assets/css/site.css`.
- **Preview locally before pushing**: copy `.dev.vars.example` to `.dev.vars`, run `npm run db:migrate:local` once, then `npm run dev` and open http://127.0.0.1:8787. The preview is built with Cloudflare's Turnstile test site key, which pairs with the test secret in `.dev.vars`; the widget shows a "testing only" label locally, which is expected.
- **Social preview images**: `node tools/make-images.cjs` (needs `npx playwright install chromium` once).
- **Database schema changes** are not applied by the build. After pushing a new file in `migrations/`, run `npm run db:migrate` once.
- **Emergency deploy without GitHub**: `npm run deploy` still works, but push the same change afterwards so GitHub and the live site don't drift apart.

## Client portal

### First deployment of the portal

1. Push the code (the build deploys it).
2. Create the portal tables once: `npm run db:migrate` (applies 0002 and 0003; run it again whenever a new file appears in `migrations/`). The build does not apply migrations. Until this runs, the portal answers with an error and the rest of the site is unaffected.
3. Create the two admin accounts, one at a time:

   ```
   npm run portal:admin -- admin@example.com "Full Name" "+972 ..."
   ```

   Each run prints a setup link (single use, valid 7 days). Open it, choose a password, scan the QR code with an authenticator app, enter the code and save the recovery codes. Add `he` as a fourth argument for a Hebrew setup page. Running the command again for the same email issues a fresh link, which also works as an emergency reset if an admin loses both the authenticator and the recovery codes.
4. Sign in at https://xsim.dev/app/, add each customer company under Companies, then its people under Users.

Local preview: `npm run db:migrate:local` (again after new migrations; if sign-in says the portal database needs an update, this is the step that was missed), then `npm run portal:admin:local -- you@example.com "Name" "+972 ..."` and open the printed http://127.0.0.1:8787 link while `npm run dev` is running. `npm run dev` passes `PORTAL_ORIGIN=http://127.0.0.1:8787` to the Worker so that links point at the preview and the session cookie works over plain http. Never set `PORTAL_ORIGIN` in production.

### Portal email

Today `MAIL_MODE` is `"manual"`: setup and reset links are shown to the admin, who sends them personally. Cloudflare can only send to arbitrary recipients on the Workers Paid plan ("Sending to arbitrary recipients requires the Workers Paid plan"; free plans send only to verified destination addresses). Workers Paid has a $5 per month minimum per account and includes 3,000 outbound emails a month, then $0.35 per 1,000. Cloudflare Email Sending is in beta. ([Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/))

**Option 1: Workers Paid with Cloudflare Email Service (no new code).**

1. In the Cloudflare dashboard, upgrade the account to the Workers Paid plan (from the Workers & Pages section).
2. In the dashboard's Email section, check that xsim.dev is onboarded for Email Sending (the sender address must belong to an onboarded Email Service domain; the lead form already sends from leads@xsim.dev).
3. In `wrangler.jsonc`, add a second entry to `send_email` (the commented line is already there), limited to the portal sender:

   ```jsonc
   { "name": "MAILER", "allowed_sender_addresses": ["portal@xsim.dev"] }
   ```

   and set `"MAIL_MODE": "cloudflare"` in `vars`.
4. Push. Test by creating a user with an address that is not a verified destination and confirm the email arrives. If sending fails, the admin still sees the link, so nothing is lost.

The emails are plain text in the user's language (`src/portal/mail.js`) with replies going to hello@xsim.dev.

**Option 2: another transactional email provider (small code change).** Choose a provider, verify xsim.dev with the DNS records it gives you (added in Cloudflare DNS), and store its API key as a Cloudflare secret, for example `npx wrangler secret put MAIL_API_KEY`. Then add a third mode to `deliverLink` in `src/portal/mail.js` that calls the provider's HTTPS API with `fetch` using that key, and set `MAIL_MODE` to the new mode. Everything else (link creation, fallback to showing the link) stays the same. Compare providers on price, Israeli/EU data handling and whether their free tier allows commercial use before choosing.

### Portal operations

- Activity (admins) lists the latest 200 account and survey events.
- `npx wrangler d1 execute xsim-leads --remote --command "SELECT email, status, last_login_at FROM users"` lists accounts from the command line.
- Survey answers stay in D1 until a survey or respondent is deleted. Retention for portal data is not yet defined (see PROJECT_CONTEXT.md, open items).

### Portal security

What the code does: passwords hashed with PBKDF2; a second factor (authenticator app) for everyone; Turnstile on sign-in; lockouts that grow for wrong codes; server-side sessions in HttpOnly, Secure, SameSite=Strict cookies that end after two hours idle; a custom header and Origin check against cross-site requests; single-use, expiring setup links carried in the URL fragment (never sent to the server or in referrers); strict Content-Security-Policy; customer logos checked by content and served as images only; CSV cells guarded against spreadsheet formulas; Admin and Editor roles confined to the xSim company; Viewer results only after closing and with at least 3 submissions; xSim (Admins and the survey's Editors) see results at any time, including answers not yet submitted.

What the code cannot protect, and the steps that do:

1. **The Cloudflare account is the master key.** Anyone who can sign in to it can read the database, change secrets and deploy code. Turn on two-factor authentication for the Cloudflare login, keep the number of people with access to the account minimal, and use scoped API tokens rather than the Global API Key for any tooling.
2. **The GitHub repository is a deploy key.** Every push to `main` goes live, so anyone who can push can change the portal. Turn on two-factor authentication on GitHub, keep collaborators to the founders, and keep the Cloudflare GitHub app limited to the `xSim` repository.
3. **Setup and reset links are bearer credentials** while email is manual. Whoever holds an unused link can set the password and 2FA for that account. Send each link only to its owner, through a channel you trust, and reissue it (New setup link) if in doubt; the old one stops working at once. Admin accounts deserve extra care, since a stolen admin link opens everything.
4. **Rate limit the sign-in endpoint.** The Free plan includes one rate limiting rule (counting by IP over 10 seconds). In the dashboard, open the WAF settings for xsim.dev and add a rate limiting rule: match URI path equals `/api/app/login`, for example more than 5 requests in 10 seconds per IP, action Block. Turnstile already makes each attempt cost a solved challenge; this caps bursts. ([rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/))
5. **Turn off the workers.dev address if you do not use it.** `wrangler.jsonc` has `"workers_dev": true`, which also serves the Worker on a `*.workers.dev` hostname. Sign-in and every change are already refused there (the Origin check), but setting it to `false` removes that second public address.
6. **Recovery codes and authenticator secrets are stored in D1.** Recovery codes are hashed; authenticator secrets cannot be (the server must compute codes from them). Someone with read access to the database would also need each user's password to sign in, but this is a reason to treat database exports and backups as confidential.

Known limits, accepted for now: sign-in reveals that an account exists only when it is locked (a 429 response); a lockout can be triggered deliberately by someone who knows an email address and solves Turnstile, which delays that user by 15 minutes; Viewers who are also respondents know their own answers, so with very small teams the aggregate says more about the others. Raise `MIN_GROUP` in `src/portal/results.js` for stricter anonymity.

## Optional: traffic statistics

Cloudflare Web Analytics is free and cookieless. If you turn it on, the Content-Security-Policy in `site/static/_headers` must also allow `https://static.cloudflareinsights.com` (script) and `https://cloudflareinsights.com` (connect).
