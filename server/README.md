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
| `PAYMENT_PROVIDER` | no | `none` (default) \| `zarinpal` \| `stripe`. Selects the adapter. |
| `PUBLIC_API_URL`, `PUBLIC_WEB_URL` | production | Origins the gateway calls back to and returns the payer to. Must be internet-reachable. |
| `ZARINPAL_MERCHANT_ID`, `ZARINPAL_SANDBOX`, `ZARINPAL_BASE_URL` | for zarinpal | Merchant id; sandbox host; override host (point at a stub in tests). |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `STRIPE_BASE_URL` | for stripe | API key, webhook signing secret, currency, API host. |
| `PAYMENT_TERMINAL_ID` | no | Second merchant credential for PSPs that need one; unused by Zarinpal v4. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | no | Credentials used by `npm run seed`. |

Variables that are defined but empty are treated as unset (`""` → default), so
Vercel placeholders never break validation.

## Payments

One interface, two adapters. `src/payments/types.ts` is the whole contract
(`start`, `referenceFromCallback`, `verify`); `zarinpal.ts` and `stripe.ts`
implement it, and `index.ts` picks one from `PAYMENT_PROVIDER`. Routes, the
database and the SPA never import an adapter, so switching gateway is an env
change and adding a third PSP is one new file plus a line in the registry.

The flow, for a top-up or an agent purchase alike:

1. **Start.** The route computes the amount from server-side data (the agent's
   price in `Agent.price`, or the top-up price list) — never from the request —
   creates a `pending` transaction with a human-readable `orderId`
   (`AF-20260923-9F3C21A4`), and asks the gateway for a redirect. The gateway's
   handle (`authority` / `client_secret`) is stored as `providerToken`; the
   browser only ever receives the redirect URL and the order id.
2. **Redirect.** The SPA sends the browser (or, for a subscription-style
   checkout, the app) to the gateway.
3. **Callback.** `GET /api/payments/callback/:provider` (Zarinpal) or
   `POST .../stripe` (webhook) resolves the pending transaction from the gateway
   handle, then **verifies with the gateway itself** — Zarinpal by re-submitting
   the authority *and amount* to `verify.json`, Stripe by checking the
   `Stripe-Signature` HMAC over the raw body. A `Status=OK` query parameter on
   its own is never trusted.
4. **Settle.** `settleTransaction` re-reads the transaction, re-checks the
   amount and handle, and marks it `success` with the gateway `refId` in one
   database transaction.
5. **Return.** The payer's browser is redirected to
   `/payment-required?transaction=…&status=ok|failed&reason=…`; the SPA polls the
   transaction and unlocks the agent or wallet balance once it is settled.

Idempotency and safety:

- Replaying a callback returns `credited: false` instead of crediting twice, so
  a retried webhook or a refreshed browser is harmless.
- `refId` is unique across transactions and a handle that already settled
  another order is refused (`payment_ref_reused`) — two orders cannot share one
  payment.
- A canceled or failed payment is stored as `failed` with a reason
  (`payer_canceled`, `amount_mismatch`, `gateway_unreachable`, …) rather than
  leaving a row that can never settle; a gateway request that throws marks the
  transaction failed instead of orphaning it.
- Personas stay gated until the transaction is settled, so a pending payment
  never leaks content.

`transactions` holds `id`, `order_id`, `amount`, `currency`, `provider`,
`provider_token`, `ref_id`, `status`, `failure_reason`, `created_at`,
`paid_at` and `updated_at` (`server/prisma/schema.prisma`); the gateway id
recorded at checkout means a transaction stays auditable after a provider swap.

## Testing payments

No real PSP is needed for any of this — the adapters talk to a configurable base
URL and the callback routes are ordinary HTTP.

**Unit (`npm test`)** — signature verification, amount/price math and gateway
selection, with no database:

- `test/payments.test.ts` covers the Stripe webhook HMAC (valid, tampered,
  replayed timestamp), Zarinpal `code: 100/101` acceptance, `-33
  amount_mismatch` and `-54 invalid_authority` rejection, Toman→Rial conversion,
  and order-id format/uniqueness.

**End-to-end (`npm run smoke`)** — boots the real Vercel entry and drives a
complete top-up against a **local stub PSP** (an HTTP server that implements
`request.json` / `verify.json`), asserting:

1. `POST /api/wallet/topup` returns a redirect and records the transaction as
   `pending` with the gateway and currency attached.
2. The stub received the amount in **Rial** and the merchant id.
3. Calling the callback with `Status=OK` credits the wallet and stores the
   `refId` and `paid_at`.
4. The same callback a second time credits nothing (replay protection).
5. A forged authority is refused, a `Status=NOK` callback is stored as `failed`
   with `payer_canceled`, and one user cannot read another's transaction.

```bash
docker compose up -d          # Postgres (+ Redis) from the repo root
cd server
npm run migrate && npm run seed:content && npm run build
npm run smoke                 # 45 checks
```

The smoke test writes a throwaway user and provider config to the configured
database and deletes them afterwards, so run it locally, not against
production.

**Manual sandbox check** (Zarinpal, no money moves):

```bash
PAYMENT_PROVIDER=zarinpal ZARINPAL_MERCHANT_ID=<your id> ZARINPAL_SANDBOX=true \
  PUBLIC_API_URL=https://<your-tunnel> PUBLIC_WEB_URL=https://<your-tunnel> npm run dev
```

Then `POST /api/wallet/topup`, open the returned `redirectUrl`, pay in the
sandbox, and watch the callback land in the server log. `PUBLIC_API_URL` must be
publicly reachable — the gateway has to be able to call it back, which is why
localhost only ever works with the stub.

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
