# AgentFA API (`server/`)

Fastify + Prisma API for the AgentFA storefront. **Postgres is the only
datastore** — users, wallets, entitlements, usage, the provider config, the
catalog and the persona bodies all live in one database. There is no SQLite
build, no file-backed store and nothing read from disk at request time, which is
what makes the same code run locally *and* inside a serverless function.

```
Browser (agentfa-web)                 API (this package)
─────────────────────                 ───────────────────
/api/*  ────────────────────────▶     Fastify routes (/api/auth, /api/catalog,
(first-party cookie)                  /api/wallet, /api/agents, /api/chat,
                                      /api/payments, /api/admin)
                                            │
                                            ├─▶ Postgres (Prisma + pg adapter)
                                            └─▶ Provider (server-side key)
```

## Local development

```bash
# 1. Postgres (+ optional Redis) — from the repository root
docker compose up -d

# 2. Configure
cp .env.example .env            # a working local DATABASE_URL is already there

# 3. Dependencies
npm install                     # runs `prisma generate` via postinstall

# 4. Schema + catalog content
npm run migrate                 # prisma migrate dev (creates/applies migrations)
cd ../agentfa-web && bun run export:server-content && cd ../server
npm run seed:content            # upserts agents, divisions and personas
npm run seed                    # optional: creates an admin user

# 5. Run
npm run dev                     # tsx watch --env-file=.env src/index.ts
curl http://localhost:8787/api/health
```

`GET /api/health` reports `{ db: "ok", redis: "ok" | "skipped" }`. Redis is
optional: when `REDIS_URL` is unset the rate limiter uses Postgres counters.

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Pooled connection string at runtime. Vercel Postgres / Prisma Postgres inject this for you. |
| `DIRECT_URL` | production | Non-pooled connection string used **only** by `prisma migrate deploy`. Leave empty locally. |
| `DB_POOL_MAX` | no | Connections per warm instance (default `4`). Keep small on serverless. |
| `REDIS_URL` | no | Enables the Redis sliding-window limiter; otherwise Postgres. |
| `PROVIDER_KEY_SECRET` | yes | 64 hex chars. Encrypts the provider API key at rest (AES-256-GCM). |
| `SESSION_COOKIE`, `SESSION_TTL_DAYS` | no | Session cookie name (default `agentfa_session`) and lifetime (30 days). |
| `CORS_ORIGINS` | no | Comma-separated origins. Empty means same-origin only, which is what the Vercel deployment needs. |
| `COOKIE_SECURE` | no | Force the `Secure` cookie flag outside production. |
| `PAYMENT_PROVIDER`, `ZARINPAL_MERCHANT_ID`, `STRIPE_*` | no | Gateway config; `none` until a gateway is wired. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | no | Credentials used by `npm run seed`. |

Variables that are defined but empty are treated as unset (`""` → default), so
Vercel placeholders never break validation.

## Deploying to Vercel

The SPA and this API ship as **one Vercel project** (root `vercel.json`): the
static build goes to `agentfa-web/dist`, and `/api/*` is served by the single
function in `api/index.ts`, which delegates to this Fastify app. Same origin
means first-party cookies and no CORS.

Build pipeline (`bun run build:vercel` in `vercel.json`'s `buildCommand`):

1. `agentfa-web` exports the catalog seed to `server/content/seed.json`.
2. `prisma generate` — never ships a client generated from an older schema.
3. `prisma migrate deploy` — **production builds only**, through `DIRECT_URL`.
4. `seed:content` — idempotent catalog upsert, skipped when no database is set.
5. `tsc` — compiles the API that `api/index.ts` imports.
6. `agentfa-web` builds the SPA.

Checklist:

- Add `DATABASE_URL` (pooled), `DIRECT_URL` (non-pooled) and
  `PROVIDER_KEY_SECRET` to the project's environment variables.
- Point **preview** deployments at a separate database, or leave `DATABASE_URL`
  empty for them, so a schema change on a branch cannot touch production.
- `maxDuration` for `api/index.ts` is 60s in `vercel.json` (the ceiling on
  Hobby). Raise it for longer chat streams on Pro/Enterprise; the chat SSE route
  truncates a stream that outruns the token/time budget either way.
- After the first deploy, verify `GET /api/health` returns `db: "ok"`, that
  `/api/*` is not rewritten to the SPA shell, and that
  `/api/chat/stream` emits `event: delta` frames as they arrive.

### Why there is no Prisma engine binary

The schema uses `engineType = "client"` with `@prisma/adapter-pg`, so the query
engine is the `pg` driver and not a platform-specific Rust binary. That removes
the usual Vercel failure (`Could not locate the Query Engine for runtime
"rhel-openssl-3.0.x"`) and with it the need for `binaryTargets` or bundler
workarounds. The pool is small and registered with `attachDatabasePool` so idle
connections are released before the function is suspended.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch mode with `.env` loaded. |
| `npm run typecheck` | Type checks `src/` **and** `test/`. |
| `npm test` | Vitest (unit tests, no database required). |
| `npm run migrate` / `npm run deploy` | `prisma migrate dev` / `prisma migrate deploy`. |
| `npm run seed:content` | Upserts the catalog from `content/seed.json`. |
| `npm run seed` | Creates the admin user. |
| `npm run build` / `npm run build:vercel` | Plain `tsc` build / full Vercel build step. |
| `npm run smoke` | End-to-end smoke test (needs the containers and a seeded database). |

### Smoke test

`npm run smoke` boots the API through the real Vercel entry point
(`api/index.ts` → `server/dist`, so run `npm run build` first), points the
provider config at a fake OpenAI-compatible SSE endpoint and then drives:
health → catalog → register → wallet → purchase → settlement → persona gate →
streamed chat with a wallet debit.

It writes a throwaway user and provider config to the configured database and
removes them again when it finishes, so run it against a local database rather
than production.
