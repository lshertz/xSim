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

Copy the `database_id` it prints into `wrangler.jsonc` (replace `REPLACE_WITH_DATABASE_ID`), then create the table:

```powershell
npm run db:migrate
```

### 3. Turn on Email Routing (for notifications and hello@xsim.dev)

In the Cloudflare dashboard: **xsim.dev → Email → Email Routing**.

1. Enable Email Routing and accept the DNS records it adds.
2. Under **Destination addresses**, add `larry@shertz.com` and click the verification link Cloudflare emails you. Notifications only work after this.
3. Under **Routing rules**, create `hello@xsim.dev` and forward it to `larry@shertz.com` (this is the public contact address on the site).

To notify someone else as well (for example Jeremy), verify their address here first, then ask Claude to add them as a second recipient in `wrangler.jsonc`.

### 4. Create the Turnstile widget

Dashboard: **Turnstile → Add widget**.

- Name: `xsim.dev`
- Hostnames: `xsim.dev` and `www.xsim.dev`
- Widget mode: **Managed**

Copy the **Site key** into `src/content/site.json` (`turnstileSiteKey`). The site key is public by design. Keep the **Secret key** for step 6.

### 5. Deploy

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

- **Rules → Redirect Rules**: use the "Redirect from WWW to root" template so everyone lands on `https://xsim.dev`.
- **SSL/TLS → Edge Certificates**: Always Use HTTPS on.
- **Security → Bots**: Bot Fight Mode on (free).

### 8. Test it live

Open https://xsim.dev, submit the form with your own details, and confirm the email arrives. Then check the database:

```powershell
npm run leads
```

## Everyday changes

- **Wording**: edit `src/content/en.json` or `src/content/he.json`, then `npm run deploy`.
- **Design**: `site/static/assets/css/site.css`.
- **Preview locally**: copy `.dev.vars.example` to `.dev.vars`, run `npm run db:migrate:local` once, then `npm run dev` and open http://127.0.0.1:8787. Turnstile test keys are used locally and always pass.
- **Social preview images**: `node tools/make-images.cjs` (needs `npx playwright install chromium` once).

## Optional: deploy automatically from GitHub

Put this folder in a **private** GitHub repository, then in the dashboard open **Workers & Pages → xsim-website → Settings → Builds** and connect the repository. Set the build command to `npm run build` and the deploy command to `npx wrangler deploy`. After that, every push to `main` deploys. This is the better setup once more than one person (or more than one Claude chat) is editing the site, because every change is versioned.

## Optional: traffic statistics

Cloudflare Web Analytics is free and cookieless. If you turn it on, the Content-Security-Policy in `site/static/_headers` must also allow `https://static.cloudflareinsights.com` (script) and `https://cloudflareinsights.com` (connect).
