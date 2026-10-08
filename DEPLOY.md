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

- **Pages** are plain HTML/CSS built by `npm run build` into `public/`. They are served as static assets and never run code.
- **One Worker route**, `POST /api/lead`, handles the briefing form: origin check, honeypot, field validation, Turnstile verification (token, hostname and action), save to D1, email notification.
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

## Optional: traffic statistics

Cloudflare Web Analytics is free and cookieless. If you turn it on, the Content-Security-Policy in `site/static/_headers` must also allow `https://static.cloudflareinsights.com` (script) and `https://cloudflareinsights.com` (connect).
