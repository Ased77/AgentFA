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
| `bun run build` | `check` (i18n parity + types) then a production build into `dist/`. |
| `bun run preview` | Serve the built `dist/`. |
| `bun run check` | Both guards below. |
| `bun run check:i18n` | Fails if the `fa` and `en` dictionaries have different keys. |
| `bun run typecheck` | `tsc --noEmit`. Vite does not typecheck, so this is the only type gate. |
| `bun run catalog` | Regenerates `src/data/catalog.generated.ts` from the agent corpus. |
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
