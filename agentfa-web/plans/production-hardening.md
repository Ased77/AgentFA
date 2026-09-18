# AgentFA — Production Hardening Plan

Goal: move the app from a browser-only MVP (wallet, ownership, payments and provider
key all in `localStorage`) to a system that can **safely take money and sell agents**,
with server-authoritative accounting and no client-side bypass.

Source of the problem list: the audit in this session. Everything below is scoped to
`agentfa-web/` plus a new `server/` package (does not exist yet).

---

## 0. Current state (what we are replacing)

| Concern | Today | Where |
|---|---|---|
| Provider key | `localStorage` (`agentfa-provider`), sent from browser | `src/lib/provider.ts:43`, `src/lib/provider-client.ts:155` |
| Wallet / balance | `localStorage` (`agentfa-wallet`) | `src/lib/mock-store.ts:53` |
| Agent ownership | `localStorage` (`agentfa-bought`) | `src/lib/mock-store.ts:54` |
| Admin panel | unauthenticated, same origin | `src/pages/Admin.tsx` |
| Personas | bundled inline in JS | `src/data/personas.generated.ts` via `scripts/generate-catalog.mjs:204` |
| Provider proxy | dev-only Vite middleware | `vite.config.ts:41` |
| Payments | simulated `topUp` / `ownAgent` | `src/lib/mock-store.ts:150`, `:205` |
| Tool calling | not supported | `src/lib/provider-client.ts` (text deltas only) |
| Persona size | truncated at 2400 chars | `scripts/generate-catalog.mjs:118` |
| Tests | none for wallet/provider/ownership | — |

**Design decision driving the plan:** introduce a real backend. The browser keeps only
presentation + a session token. All money, all ownership, all usage, and the provider
key live server-side. This is the single change that unblocks everything else.

---

## 1. Target architecture

```
Browser (React/Vite)                 Server (new: Node + Fastify)
────────────────────                 ─────────────────────────────
UI, routing, streaming render   ──▶  /api/auth/*        (login, session)
                                     /api/catalog/*     (public list, gated persona)
                                     /api/wallet/*      (balance, topup intent)
                                     /api/agents/buy    (purchase → entitlement)
                                     /api/chat/stream   (proxy + count + debit)
                                     /api/admin/*       (provider config, owner-only)
                                            │
                                            ├─▶ Postgres (users, wallets, entitlements, usage, txs)
                                            ├─▶ Redis (rate limit, stream counters)
                                            └─▶ Provider (OpenAI-compatible, key server-side)
```

Principles:
- **Server is the only source of truth** for balance, ownership, usage, provider config.
- **Provider key never reaches the browser.** Server injects `Authorization`.
- **Persona is fetched per-agent from the server only when the user owns it.**
- **Every debit is derived from a server-measured stream**, not client estimates.
- The client `mock-store.ts` is kept as an **offline/demo fallback only** and is not used
  once a session exists.

---

## 2. Workstreams

### WS1 — Backend skeleton (foundation)

**New package:** `server/` (workspace) — Node 20, Fastify, TypeScript, Prisma + Postgres, ioredis.

Deliverables:
- `server/package.json`, `server/tsconfig.json`
- `server/prisma/schema.prisma` with tables:
  - `User(id, email, passwordHash, role, createdAt)`
  - `Wallet(userId, plan, tokenBalance, timeBalanceSeconds, monthlyTokenLimit, monthlyTimeLimitSeconds, periodStart)`
  - `Entitlement(userId, agentId, pricePaid, purchasedAt)` — unique `(userId, agentId)`
  - `Transaction(id, userId, type, amount, currency, provider, providerRef, status, createdAt)`
  - `UsageEvent(id, userId, agentId, tokens, seconds, estimated, providerModel, createdAt)`
  - `ProviderConfig(id, label, baseUrl, apiKeyCipher, model, meter, tomanPer1kTokens, tomanPerMinute, agentScope, enabled)` — single active row
  - `Session(id, userId, tokenHash, expiresAt)`
- `server/src/app.ts` (Fastify instance, CORS, rate-limit plugin, auth hook)
- `server/src/db.ts`, `server/src/redis.ts`, `server/src/env.ts` (zod-validated env)
- `server/.env.example`
- `docker-compose.yml` at repo root: postgres + redis for local dev
- Root `package.json` workspaces if not already present, or a documented two-terminal workflow in `AGENTS.md`.

Acceptance: `pnpm --filter server dev` boots, `/api/health` returns 200, migrations run.

---

### WS2 — Auth + roles (unblocks Admin gating)

- `server/src/routes/auth.ts`: `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`.
- Passwords: `argon2`. Sessions: opaque token, hashed at rest, `httpOnly` `Secure` cookie.
- `role: "user" | "admin"`.
- Server middleware `requireAuth` and `requireAdmin`.
- Client: new `src/lib/session.tsx` (session context, `useSession()`), `src/pages/Login.tsx`.
- `src/routes.tsx`: guard `/admin` behind `session.role === "admin"`; guard `/chat/:id` behind auth.

Acceptance: unauthenticated `/api/admin/*` → 401/403; non-admin `/admin` redirects to login.

---

### WS3 — Provider config server-side (fixes key leak + dev-only proxy)

- Move `ProviderProfile` validation (`src/lib/provider.ts:154` `profileProblems`) into a
  shared `server/src/provider/validate.ts` so web and server agree.
- `server/src/routes/admin-provider.ts`: `GET/PUT/DELETE /api/admin/provider`, admin only.
- Encrypt `apiKey` at rest: AES-256-GCM with `PROVIDER_KEY_SECRET` env; store ciphertext in
  `ProviderConfig.apiKeyCipher`. Never return the plaintext to the client — return `maskKey()`
  output only (reuse `src/lib/provider.ts:141`).
- `POST /api/admin/provider/test` runs the existing probe logic **server-side**.
- Delete `vite.config.ts:41` `/provider-proxy` block and `ProviderProfile.useDevProxy`
  (`src/lib/provider.ts:39`, `providerEndpoint` at `:148`), or keep behind `import.meta.env.DEV`.

Acceptance: network tab shows no provider key; `/provider-proxy` gone from prod build.

---

### WS4 — Server-side chat proxy + usage accounting (fixes metering)

- `server/src/routes/chat.ts`: `POST /api/chat/stream` (SSE).
  - Body: `{ agentId, message, history }` (max `HISTORY_LIMIT` turns, reuse
    `src/lib/provider-client.ts:73`).
  - Steps: `requireAuth` → load `Entitlement(userId, agentId)` (403 `not_owned`) →
    `providerCoversAgent` check → `canSend` check server-side → fetch provider with server key →
    stream deltas to client while accumulating `text` → on end, read `usage.total_tokens`
    (fallback to a **better** estimator, see WS8) → write `UsageEvent` → debit `Wallet`
    in the same transaction → return final `StreamOutcome` in a trailing SSE event.
- Port and adapt `streamChat` (`src/lib/provider-client.ts:119`) into
  `server/src/provider/stream.ts`. Keep the idle-timeout logic (`IDLE_TIMEOUT_MS`, `:76`) and
  the `overBudget` truncation (`:143`) but compute budget from the **server** wallet.
- Server rate limit: reuse Redis sliding window for 20/min, 100/hour, 500/day.
- Client `provider-client.ts` becomes a thin `fetch("/api/chat/stream")` SSE reader; delete
  the direct `Authorization` header and `providerEndpoint` usage.

Acceptance: killing client JS mid-stream still debits the correct server-measured amount;
calling `/api/chat/stream` for an unowned agent → 403.

---

### WS5 — Wallet, entitlements, purchases (fixes bypass + fake payments)

- `server/src/routes/wallet.ts`: `GET /api/wallet`, `POST /api/wallet/topup` (creates a
  `pending` Transaction + returns payment gateway redirect URL).
- `server/src/routes/agents.ts`: `POST /api/agents/:id/buy` (server re-reads price from the
  catalog, **never trusts client price**) → `pending` Transaction → on gateway callback marks
  `success` and inserts `Entitlement`.
- Payment gateway: pick one (Zarinpal / IDPay for Iran, or Stripe for intl) — needs a decision
  from the user. Put it in `server/src/payments/<gateway>.ts` behind a `PaymentProvider`
  interface so it is swappable.
- Webhook `server/src/routes/payments-webhook.ts`: verify signature, idempotent by `providerRef`.
- Client: `mock-store.ts` becomes `demo-store.ts` used **only when no session**; the real
  store is `src/lib/account.ts` talking to `/api/*`.

Acceptance: editing `localStorage` cannot grant an agent or a balance; replaying a webhook does
not double-credit.

---

### WS6 — Gate persona content (fixes pre-purchase leak)

- `generate-catalog.mjs`: split output into two files:
  - `catalog.generated.ts` — public metadata only (no `personas`).
  - Persona bodies move into `server/content/personas/<id>.md` (copied from the repo corpus at
    build time by a new `scripts/export-personas.mjs`).
- `GET /api/agents/:id/persona` — requires `Entitlement`, returns the full (untruncated) body.
- Chat route loads persona server-side; client never receives it for unowned agents.
- Raise or remove `PERSONA_CAP` (`generate-catalog.mjs:118`) for the server copy; the public
  `description`/`features` stay short.

Acceptance: a logged-in user without the entitlement gets 403 from the persona endpoint and
finds no persona text in the JS bundle (`grep` the `dist/` output).

---

### WS7 — Tool calling / function support (unblocks tool-using agents)

- `server/src/provider/stream.ts`: support OpenAI `tools` + `tool_calls` deltas.
- New `server/src/tools/registry.ts` defining the tool set exposed to agents
  (start with a safe read-only set; anything mutating is out of scope for v1).
- Multi-turn tool loop (max N iterations) with server-side time/token budget still enforced.
- Client renders tool-call events distinctly (a `tool` message kind in Chat UI).
- Note: the markdown corpus (README agent list) describes many agents that imply tools; v1
  should mark which agents are tool-enabled in the catalog.

Acceptance: one tool-using agent completes a 2-step tool loop end-to-end with correct billing.

---

### WS8 — Billing accuracy

- Replace `estimateTokens = length/2` (`src/lib/provider-client.ts:69`) with a real tokenizer
  (`tiktoken`-style or provider tokenizer) server-side; Persian-safe.
- Prefer provider `usage.total_tokens`; record `estimated: true` on `UsageEvent` when fallback.
- Time meter measured from server `started`/`ended` timestamps only.
- Define partial-stream policy: charge for received tokens, **no** refund for truncation
  (document this in `SECURITY.md` or a new `BILLING.md`).
- Add a reconciliation job (`server/src/jobs/reconcile.ts`) that re-pulls provider usage where
  the provider offers a usage/billing API.

Acceptance: a scripted call with known token count is billed within ±1%.

---

### WS9 — Catalog data honesty

- `generate-catalog.mjs:139-141`: remove hash-derived `rating` and `sales`, or source them
  from real data. Add a `real: boolean` flag until real data exists.
- Keep `price` server-authoritative (WS5 already re-reads it).

---

### WS10 — Testing + observability

- Server tests (Vitest): auth, entitlement gate, wallet debit atomicity, webhook idempotency,
  usage accounting, budget truncation.
- Client tests: session guard, ownership-driven UI.
- Structured logging (pino) for every chat call: `userId, agentId, tokens, seconds, providerStatus`.
- Metrics endpoint `/api/metrics` (Prometheus) for spend per user, error rates.
- Add `server` test/lint commands to root `AGENTS.md`.

---

### WS11 — Licensing / attribution

- The corpus derives from `msitarzewski/agency-agents` (MIT). Add a `NOTICE` /
  `THIRD_PARTY_LICENSES.md` at repo root preserving the MIT attribution, and state in the
  marketing copy what value-add AgentFA provides.
- Do this before any paid launch.

---

## 3. Sequenced milestones

| # | Milestone | Workstreams | Exit criterion |
|---|---|---|---|
| M1 | Server boots with Postgres+Redis | WS1 | `/api/health` green, migrations applied |
| M2 | Auth + admin gating | WS2, WS3 | provider key server-only, `/admin` guarded |
| M3 | Server chat + accounting | WS4, WS8 | correct debit, 403 on unowned agent |
| M4 | Real purchases + wallet | WS5, WS9 | webhook idempotent, price server-side |
| M5 | Persona gating | WS6 | no persona in bundle, 403 gate works |
| M6 | Tools | WS7 | 2-step tool loop billed correctly |
| M7 | Hardening | WS10, WS11 | tests pass, attribution present |

M1–M4 are the **minimum viable paid product**. M5 closes the content leak; M6–M7 are
quality/legal.

---

## 4. New files to create (summary)

**Server package**
- `server/package.json`, `server/tsconfig.json`, `server/.env.example`
- `server/prisma/schema.prisma`, `server/prisma/migrations/*`
- `server/src/app.ts`, `env.ts`, `db.ts`, `redis.ts`
- `server/src/routes/auth.ts`, `wallet.ts`, `agents.ts`, `chat.ts`, `admin-provider.ts`, `payments-webhook.ts`
- `server/src/provider/{validate.ts,stream.ts,crypto.ts}`
- `server/src/payments/{types.ts,zarinpal.ts|stripe.ts}`
- `server/src/tools/registry.ts`
- `server/src/jobs/reconcile.ts`
- `server/test/*.test.ts`

**Repo / client**
- `docker-compose.yml`
- `THIRD_PARTY_LICENSES.md` / `NOTICE`
- `agentfa-web/scripts/export-personas.mjs`
- `agentfa-web/src/lib/session.tsx`, `src/lib/account.ts`, `src/pages/Login.tsx`
- `agentfa-web/BILLING.md` (partial-stream policy)

---

## 5. Open decisions (need user input before M4)

1. **Payment gateway** — Zarinpal/IDPay (Iran, Toman) vs Stripe (intl)?
2. **Pricing model** — keep per-agent one-time purchase + token/time top-ups, or move to a
   subscription-only plan?
3. **Hosting** — self-hosted Postgres/Redis vs managed (Supabase/Neon + Upstash)?
4. **Tool scope for v1** — read-only tools only, or include file/network tools?

These do not block M1–M3.