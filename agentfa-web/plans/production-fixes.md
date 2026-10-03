# Production fixes

An audit of the deployed product (not the repository) produced this plan. It is
kept as a record of what was wrong and what changed, because several of these
failures were invisible from inside the codebase — the build was green, the tests
passed, and the site was broken.

## What was actually wrong

| # | Problem | Evidence |
| --- | --- | --- |
| 1 | **Every nested `/api/**` path 404'd at the Vercel edge.** `api/[...path].ts` was assumed to be a catch-all; in a plain (non-Next) project a bracketed route matches a single segment. | `/api/foo` → 500 (function), `/api/auth/me` → edge `NOT_FOUND`. 21 of the 27 calls in `src/lib/account.ts` are multi-segment: login, purchases, wallet, chat, refunds, admin. |
| 2 | **No database configured.** The Vercel project had zero environment variables, so the function died in `env.js` before routing anything. | `vercel env ls` → none; the function log named `DATABASE_URL: Required`. |
| 3 | **The public site was hidden from crawlers.** `noindex, nofollow` and `Disallow: /`, both generated from a template default in `site.config.json`, with no favicon, no `og:image`, no sitemap and no canonical. | Served HTML and `robots.txt`; `og:image` absent. |
| 4 | **Every unknown URL returned the app shell with a 200.** | `/no-such-page` → 200; also `/favicon.ico`, `/sitemap.xml`. |
| 5 | **A failed login said "try again".** The generic bucket covered a 404 that can never succeed. | Submitting the login form against the broken API. |
| 6 | **Error text froze in the language it failed in.** Eight sites stored rendered text in state. | FA → EN switch left the Persian error on screen. |
| 7 | **The English product showed Persian agent content.** The generator's fallbacks were Persian. | 246/264 agents showed `برای شروع یک درخواست بنویس` under an "Start here"; 264/264 chat greetings mixed Persian and English. |
| 8 | **The pre-paint bootstrap and the skip link were inline English.** | "Skip to content" on every Persian page. |
| 9 | **Hashed assets were revalidated on every navigation** (`max-age=0, must-revalidate`), and no CSP, `X-Frame-Options` or `nosniff` was set. | Response headers. |
| 10 | **Nothing watched the deployment.** The site was broken for ten days across ten consecutive failed builds; the only workflows linted the upstream markdown corpus. | Deployment history; no monitoring in the repo. |

## What changed

| Phase | Change | Commit |
| --- | --- | --- |
| Routing | The catch-all file is gone; `/api/(.*)` reaches the one function through a rewrite, and the handler restores the original URL while stripping the rewrite's capture parameter. Confirmed from deployment logs, not inferred: the function receives `/api/wallet/transactions?days=7`. | `73eb1da`, `13a1c19` |
| Observability | `scripts/check-deploy.mjs` verifies a *running* deployment (shell, nested routing, health, sitemap, caching, headers, real 404s), and a scheduled workflow runs it every 30 minutes. A function that routes but crashes is reported as configuration, not as a routing failure. | `73eb1da` |
| Discovery | `robots.txt` allows crawling and points at a generated sitemap of the 264 agent pages; favicon, social card and touch icon added; per-route titles already existed; unknown paths now answer `public/404.html` with a real 404 because the SPA rewrite is an allow-list. | `13a1c19` |
| Hardening | Immutable caching for `/assets/**`, CSP + `nosniff` + `frame-ancestors`, and the bootstrap moved to `public/boot.js` so `script-src` needs no `unsafe-inline`. | `13a1c19` |
| Content and i18n | English starter prompts derived from each agent's own capability, English greetings, error/notice state storing keys instead of rendered text, a distinct "service unavailable" message for 5xx/404, and the user's language now drives the skip link. | `277a2f6` |
| Weight | The 264-agent catalog moved behind a dynamic import (`src/data/useCatalog.ts`); the landing page uses a generated 12-agent featured list. Entry chunk 640 kB → 351 kB (176 kB → 110 kB gzip). | `3f645a7`, `b83ccd7` |

## Deliberately not done

- **`fa-agents.ts` stays in the preloaded chunk** (~75 kB gzip of it). Splitting it
  would make a Persian reader — the primary audience — see English agent names
  until the chunk arrives. That is the next lever if the weight matters more than
  that flash.
- **`maxDuration` stays 60 s.** It is the ceiling on Vercel's Hobby plan; raising
  it is a plan decision, not a code one. Long chat answers on Hobby are cut at 60 s.
- **`bun.lock` is `lockfileVersion: 2`** while Vercel builds with bun 1.3.14, so
  the lockfile is discarded and dependencies are re-resolved on every deploy.
  Regenerating it with the matching version is the fix; it was left out of a
  change set that already touched the deploy pipeline.
- **Analytics and error tracking.** The uptime check was chosen over both; a
  client-side crash still produces no signal beyond a Sentry-less console.

## Verification

- `server`: `bun run typecheck`, `bun run test` — 58 tests. (`bun test` is the
  wrong runner here and reports failures that do not exist; the project uses vitest.)
- `agentfa-web`: `bun run check` (i18n, catalog, routes, types) and `bun run build`.
- `scripts/check-deploy.mjs` against production: **10/12**, with the two failures
  being the missing database (Phase 0 above) and nothing else. The scheduled
  workflow runs the same script every 30 minutes and is red for that same reason,
  so it turns green by itself once the variables exist.
- Browser pass, FA and EN, desktop and 390 px: marketplace renders 264 agents and
  Design filters to 10, detail pages resolve, an unknown slug renders the app's
  404, no CSP violations, no raw i18n keys, no `NaN`, no horizontal overflow.
- The language-freeze fix was verified by reproducing the original bug: submitting
  the login form in Persian showed *«سرویس ورود الان در دسترس نیست…»*, and
  switching to English re-rendered the same failure as *“Sign-in is unavailable
  right now…”* — which is precisely what the old code could not do, because it had
  stored the rendered string.
- The catalog split was verified against the running site: `agents-*.js` loads as
  its own chunk and all 264 cards render, which is the regression the first split
  introduced (a memo that did not list `agents` as a dependency) and this fixes.

## Still required from a human

Create a Postgres and set, on the Vercel project: `DATABASE_URL` (pooled),
`DIRECT_URL` (direct), `PROVIDER_KEY_SECRET` (`openssl rand -hex 32`), and — for
the product to be usable — `SMS_PROVIDER=kavenegar` with its key/sender/template,
`PUBLIC_API_URL`, `PUBLIC_WEB_URL` and a payment provider. The first deploy after
that applies the migrations and seeds the catalog automatically.
