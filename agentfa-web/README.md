# AgentFA web (`agentfa-web/`)

The storefront: landing, marketplace, agent detail, chat, pricing, account and
admin. React 19 + Vite + Tailwind CSS v4 + React Router, built as a static SPA
that talks to the API in [`../server`](../server).

## Running it

The SPA owns almost no data — agents, prices, the wallet, entitlements and chat
all come from the API — so it needs the API running, and the API needs Postgres.

```bash
# 1. Postgres (+ optional Redis) — from the repository root
docker compose up -d

# 2. The API on :8787 (schema, catalog content, then the server)
cd server && npm install && npm run migrate && npm run seed:content && npm run dev
#   → http://localhost:8787/api/health

# 3. The SPA on :8443
cd agentfa-web && bun install && bun run dev
#   → http://localhost:8443
```

`vite.config.ts` proxies `/api` to `http://localhost:8787` in development, so
there is no CORS or cross-domain cookie setup to do locally — it mirrors the
single-origin deployment.

> **The API is not optional, and its absence is quiet.** Without it the app still
> boots and still looks like itself: the marketplace renders an empty catalog,
> login appears to do nothing and chat shows an error. Every `/api/*` request
> fails. If the app looks logged out and static, check that the API is up before
> looking anywhere else.

See [`../server/README.md`](../server/README.md) for the API's own setup,
environment variables, SMS login in development and the deploy pipeline.

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8443` | Dev and preview server port. |
| `DEV_SERVER_HOST` | `0.0.0.0` | Interface the dev server binds. |
| `API_PROXY_TARGET` | `http://localhost:8787` | Where `/api` is proxied in development. |
| `PROVIDER_PROXY_TARGET` | `https://api.openai.com` | Dev-only escape hatch for OpenAI-compatible providers that send no CORS headers; never relied on in production. |
| `SITE_BASE_URL` | `/` | Set when the app is not served from the domain root. |

### Windows

`run-web.bat` is a double-clickable launcher: it finds Bun (PATH, `~/.bun/bin`,
winget, `Program Files`), installs dependencies on the first run and serves on
:8443.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server with HMR on :8443. |
| `bun run build` | `check` (all four gates below) then a production build into `dist/`, then `dist/sitemap.xml`. |
| `bun run preview` | Serve the built `dist/`. |
| `bun run check` | Every gate below. The first step of `build`, so a gate failing fails the deployment. |
| `bun run check:i18n` | Dictionaries hold the same keys, every `t("…")` resolves to one, and no component stores rendered text in state. |
| `bun run check:catalog` | No field the English UI renders contains Persian text — the generated catalog is English, and `fa-agents.ts` is the Persian copy. |
| `bun run check:routes` | Every client route has a rewrite in the root `vercel.json`, so a route cannot work in `vite dev` and 404 in production. |
| `bun run typecheck` | `tsc --noEmit`. Vite does not typecheck, so this is the only type gate. |
| `bun run catalog` | Regenerates `src/data/catalog.generated.ts` and the small `featured.generated.ts` the landing page uses. |
| `bun run export:server-content` | Catalog plus `server/content/seed.json`, which the API seeds from. |
| `bun run format` | oxfmt. **Not** repo-wide: the tree is not oxfmt-formatted, so a full run rewrites unrelated lines — format only the files you touched. |

## Localization

Persian is the default locale and the product is RTL-first: `index.html` sets
`dir` before first paint from `localStorage.agentfa-lang`, the language toggle
flips it, and direction-dependent UI (arrows, `inset-inline-*`) follows the
direction rather than the locale.

- **Both dictionaries live in `src/lib/i18n.tsx`** (`fa` and `en`). Every key must
  exist in both — a key present in one renders as its raw name in the other, which
  is how `payment.pending` once leaked into the English UI — which is what
  `bun run check:i18n` prevents.
- **Translate through `t()`.** Numbers and amounts go through the helpers on the
  same hook (`n()` for digits, `toman()` for currency) so Persian digits and the
  currency suffix are not hand-rolled per page.
- **Server errors are localized by code.** `ApiError` carries a stable code; pages
  map it to a `t("...")` key and fall back to a generic message, so a new server
  error never surfaces as a raw identifier.
- **Store the key, not the message.** `setError(t("…"))` freezes the text in
  whichever language was showing when it failed, so an error raised in Persian
  stayed Persian after switching to English. `check:i18n` rejects the pattern.
- **The catalog is English; `fa-agents.ts` is the Persian copy.** The generator's
  fallbacks used to be Persian, which put a Persian starter prompt and a
  half-Persian chat greeting in front of English readers on 246 of 264 agents.
  `check:catalog` now fails if Persian appears in any field the English UI shows.

## Deploying

The SPA and the API ship as one Vercel project (root `vercel.json`). Four things
there are load-bearing and easy to undo by accident:

- **`/api/**` reaches `api/index.ts` through a rewrite.** Do *not* add
  `api/[...path].ts`: in a plain (non-Next) Vercel project a bracketed catch-all
  matches a **single** path segment, so `/api/auth` reached the function while
  `/api/auth/me` was answered by the edge with `NOT_FOUND`. That is how two thirds
  of the API — login, purchases, wallet, chat, refunds, admin — was unreachable in
  production while `/api/health` looked fine. The rewrite appends its capture to
  the query string, so the handler strips it; both behaviours are asserted by
  `scripts/check-deploy.mjs`.
- **Unknown paths must keep returning a real 404.** The SPA rewrite lists client
  routes explicitly and `public/404.html` answers everything else. A blanket
  catch-all meant every typo returned the app shell with a 200, which hides broken
  links from crawlers and from monitoring. `check:routes` keeps the list honest.
- **`public/boot.js` must stay an external script.** It is what applies the saved
  language before first paint; inlining it would force `script-src 'unsafe-inline'`
  into the deployment's CSP. `style-src` does keep `'unsafe-inline'`, because the
  UI sets inline `style` attributes (agent accent colours, chip rows).
- **Assets here are not Git LFS objects.** The blanket `.gitattributes` in this
directory otherwise routes every binary extension through LFS, and GitHub refuses
  to accept *new* LFS objects in a public fork — which this repository is — so the
  push fails outright.

`node scripts/check-deploy.mjs [url]` verifies a **running** deployment from the
outside (shell, nested `/api` routing, health, sitemap, caching, headers, real
404s); `node scripts/make-social-assets.mjs` regenerates `og.png` through a local
browser when the social card needs to change.

## Layout

| Path | What it is |
| --- | --- |
| `src/routes.tsx` | Router, the app shell (nav/footer), and the landing, marketplace, agent detail and dashboard views. |
| `src/pages/` | Lazy-loaded pages: `Chat`, `Pricing`, `Account`, `Admin`, `Login`, `PaymentReturn`, `Legal`, `NotFound`. |
| `src/lib/i18n.tsx` | Both dictionaries, the `t()`/`n()`/`toman()` helpers, direction handling. |
| `src/lib/account.ts` | The typed API client — the only place that calls `fetch`. |
| `src/lib/session.tsx` | Who is signed in, and the login/logout transitions. |
| `src/lib/pricing.ts` | Prices fetched from `GET /api/pricing`, with a labeled fallback when the API is unreachable. |
| `src/lib/useEntitlements.tsx` | Which agents the user owns — fetched **once** per session and shared, rather than per card. |
| `src/components/` | Shared primitives: `ForwardArrow`, `Modal`, `ErrorBoundary`. |
| `src/data/` | Generated catalog, English source copy and the Persian translations of it. Regenerate, do not hand-edit. |
| `src/data/useCatalog.ts` | Loads the 264-agent catalog on demand; only the marketplace, detail and dashboard routes need all of it. |
| `public/` | Files copied to the deployment root: `boot.js`, `404.html`, `favicon.svg`, the social card and the touch icon. |
