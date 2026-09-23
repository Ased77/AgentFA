# AgentFA API (`server/`)

[![CI/CD](https://github.com/Ased77/AgentFA/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/Ased77/AgentFA/actions/workflows/ci-cd.yml)
[![CodeQL](https://github.com/Ased77/AgentFA/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/Ased77/AgentFA/actions/workflows/codeql.yml)

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
npm run seed                    # optional: promotes SEED_ADMIN_PHONE to admin

# 5. Run
npm run dev                     # tsx watch --env-file=.env src/index.ts
curl http://localhost:8787/api/health
```

`GET /api/health` reports `{ db: "ok", redis: "ok" | "skipped" }`. Redis is
optional: when `REDIS_URL` is unset the rate limiter uses Postgres counters.

Logging in locally needs no SMS account: with `SMS_PROVIDER=none` the code is
printed in the server log and shown on the login page, so any Iranian mobile
number signs you in. Promote it with `SEED_ADMIN_PHONE=<number> npm run seed` if
you need `/admin`.

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
| `SMS_PROVIDER` | production | `none` (development) \| `kavenegar`. With `none` in production, login answers 503 rather than pretending to send. |
| `KAVENEGAR_API_KEY`, `KAVENEGAR_SENDER`, `KAVENEGAR_TEMPLATE`, `KAVENEGAR_BASE_URL` | for kavenegar | API key, sender number, registered verification template, host override (tests). |
| `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_SECONDS` | no | Code lifetime (120s), wrong guesses per code (5), minimum gap between codes (30s). |
| `OTP_SECRET` | no | Pepper for hashed codes; falls back to `PROVIDER_KEY_SECRET`. |
| `SEED_ADMIN_PHONE` | no | Mobile number `npm run seed` promotes to admin (default `09120000000`). |

Variables that are defined but empty are treated as unset (`""` → default), so
Vercel placeholders never break validation.

## Authentication

Login is a **mobile number and an SMS code**. There is no password to forget,
reset or leak, and no separate signup: `POST /api/auth/otp/verify` creates the
account when the number is new, so a first-time visitor and a returning user walk
the identical path (`/login` and `/signup` render the same page).

```
POST /api/auth/otp/start   { phone }        → { phone, expiresInSeconds, resendInSeconds }
POST /api/auth/otp/verify  { phone, code }  → { user, isNewUser } + session cookie
POST /api/auth/logout, GET /api/auth/me
```

Numbers are normalized to E.164 (`+989121234567`) by `src/lib/phone.ts`, which
also reads Persian and Arabic-Indic digits, so `۰۹۱۲ ۱۲۳ ۴۵۶۷`, `0912-123-4567`
and `+98 912 123 4567` are one account rather than three. Landlines and short
numbers are rejected before any SMS is sent.

What is stored and checked:

- **Hashed codes.** `LoginCode.codeHash` is HMAC-SHA256 over `phone:code`, keyed
  by `OTP_SECRET` (falling back to `PROVIDER_KEY_SECRET`) and bound to the
  number, so a leaked row cannot be replayed elsewhere and six digits are never
  stored recoverably.
- **One live code per number.** Requesting a new one retires the previous, and a
  verified code is marked consumed before the session exists — replaying it is a
  `code_expired` rejection, not a second login.
- **Bounded guessing.** Five wrong attempts burn the code, comparison is
  constant-time, and both endpoints are rate limited per number *and* per IP
  (Postgres fixed-window counters, so it works on serverless). Asking again
  inside `OTP_RESEND_SECONDS`, or more than six times an hour, is a 429.
- **No account enumeration.** `otp/start` reveals nothing: a number that has
  never been seen gets a code like any other, and nothing is created until that
  code is verified.
- **A failed send is not a pending login.** If the provider rejects the message,
  the code row is deleted and the request fails with 502 `sms_failed`.

Sessions are unchanged: an opaque token in an httpOnly cookie, stored hashed in
`Session`, resolved per request by `src/lib/session.ts`. Sessions issued before
phone login existed (they identified a user by email) are dropped on first use,
since those rows have no number left to authenticate with.

### SMS providers

`src/sms/types.ts` is the contract (`send`), `kavenegar.ts` implements it and
`index.ts` selects one from `SMS_PROVIDER` — the same shape as the payment
gateways, so another provider is one file plus a registry entry. Kavenegar is
called in whichever of its two modes is configured: `verify/lookup.json` with a
registered template (preferred: the provider owns the wording, only the code is
substituted) or `sms/send.json` with plain text.

In development with `SMS_PROVIDER=none` the code is written to the server log
**and** returned as `devCode`, so the flow is usable without SMS credit. Neither
happens in production: that path requires a real provider, and login answers 503
`sms_not_configured` without one.

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

## CI/CD (GitHub Actions)

`.github/workflows/ci-cd.yml` is the only workflow that touches the product;
the other files in that directory lint the upstream content repo (agent
markdown, `install.sh`, divisions).

| Job | Runs | Checks |
| --- | --- | --- |
| `api` | every push and PR | `npm install` → `typecheck` → `vitest` → `tsc`, on Node 20 **and** 22 |
| `web` | every push and PR | `bun install --frozen-lockfile` → format check → `tsc --noEmit` → `vite build`, on Node 20 and 22 |
| `e2e` | every push and PR | real Postgres 17 service, `migrate deploy` → schema-drift check → content export + seed → `build` → `smoke` (65 assertions through the actual `api/index.ts` entry) |
| `deploy` | pushes to `main`, after all three pass | `vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod` |

Two safeguards worth knowing:

- **Schema drift.** `prisma migrate diff --from-migrations … --exit-code` fails
the pipeline if `schema.prisma` has changes that no committed migration
contains. A forgotten migration cannot reach production.
- **Deploy serialisation.** `deploy` uses its own `concurrency: deploy-production`
group with `cancel-in-progress: false`, so two merges cannot interleave, and a
half-finished deploy is never cancelled. The whole pipeline cancels *stale*
feature-branch runs (`concurrency` at workflow level), but never a run on main.

### Required secrets

Configure these in **Settings → Secrets and variables → Actions** (and, for
`deploy`, ideally on a `production` environment so they cannot be read by a
branch build):

| Secret | Where to get it |
| --- | --- |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens. The CLI reads it from the environment, so it never appears in a command line or a log. |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` |

CI itself needs **no secrets**: the e2e job creates its own throwaway Postgres
and a dummy `PROVIDER_KEY_SECRET` that encrypts nothing outside the job. The
application's real values (`DATABASE_URL`, `DIRECT_URL`,
`PROVIDER_KEY_SECRET`, `SMS_*`, `ZARINPAL_*`, `STRIPE_*`) stay in the Vercel
project, which `vercel pull` fetches into the build.

### Setup checklist

1. Push this branch and open a pull request — `api`, `web` and `e2e` run with no
   configuration at all. Add `[skip ci]` to a commit message to skip a run.
2. Create the three secrets above (repository or `production` environment).
3. Optional but recommended: **Settings → Environments → production** → add
   required reviewers so a deploy to production waits for a human.
4. Optional: enable **Security → Code scanning** so the CodeQL workflow's
   findings appear in the Security tab (it uploads SARIF automatically).
5. Merge to `main`; the deploy job runs and the URL is attached to the run
   summary.

### Known gaps in this pipeline

- **No committed lockfile for `server/`.** `package.json` never allowed `npm ci`,
  so the API job uses `npm install` — reproducible in practice, not guaranteed.
  Committing `server/package-lock.json` (and removing it from `.gitignore`)
  fixes it and pairs well with Dependabot.
- **No linter.** There is no ESLint or oxlint anywhere in the repo, so
  `typecheck` is the blocking static gate. Adding oxlint (the same family as the
  existing `oxfmt`) is a deliberate follow-up rather than something this change
  smuggles in: a new linter on an unlinted codebase fails CI on day one.
- **`oxfmt` is not clean tree-wide** (22 of 23 web files differ), so the format
  step blocks on the files a change touches and only *reports* the rest. Run
  `cd agentfa-web && bun run format` once, then the whole-tree check can become
  a hard gate.
- **The web has no tests.** It is covered by typecheck, format and build only.

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
| `npm run seed` | Promotes `SEED_ADMIN_PHONE` to admin (creates the row if needed). |
| `npm run build` / `npm run build:vercel` | Plain `tsc` build / full Vercel build step. |
| `npm run smoke` | End-to-end smoke test (needs the containers and a seeded database). |

### Smoke test

`npm run smoke` boots the API through the real Vercel entry point
(`api/index.ts` → `server/dist`, so run `npm run build` first), points the LLM,
payment and SMS integrations at fake local servers, and then drives:
health → catalog → SMS login → wallet → purchase → settlement → persona gate →
streamed chat with a wallet debit → top-up through the gateway → verified
callback and replay protection → code replay, resend cooldown, attempt cap and
provider failure.

The SMS stub is a Kavenegar-shaped server, so the login checks exercise the real
adapter: the code is read out of the request the provider would have received.

It writes throwaway users, login codes and provider config to the configured
database and removes them again when it finishes, so run it against a local
database rather than production.

Without SMS credit the login flow is still testable by hand — leave
`SMS_PROVIDER=none`: the API logs the code and returns it as `devCode`, and the
login page shows it in a development notice.
