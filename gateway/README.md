# AI Gateway

A production-shaped LLM reseller. Customers call **your** FastAPI service, which
calls an **internal-only** LiteLLM proxy, which load-balances and falls back
across OpenAI, Anthropic, Google Gemini and a local Ollama.

Customers buy credit in USD at a markup. They never learn which model, provider,
token counts or real costs were involved — a response contains exactly two
fields:

```json
{ "reply": "…", "credit_remaining_percent": 87.4 }
```

---

## 1. Architecture

```
                         public                internal Docker network
customer ── HTTPS ──> api (FastAPI :8000) ──> litellm (:4000, no published port)
                            │                     ├── OpenAI   gpt-4o / gpt-4o-mini (2 keys)
                            │                     ├── Anthropic claude-3-5-sonnet (2 keys)
                            │                     ├── Gemini   gemini-1.5-pro / flash (2 keys)
                            │                     └── Ollama   llama3.1:70b / 8b (local)
                            ├── postgres (users, usage_logs, purchases + LiteLLM spend logs)
                            └── redis    (response cache + rate limits)
```

Only `api` publishes a port. `litellm`, `postgres` and `redis` are reachable
only from inside the compose network, so the LiteLLM master key and every
provider/model detail stay private.

### The security contract

| Layer | Guarantees |
| --- | --- |
| `app/schemas.py` | Customer-facing schemas have no model/provider/token/cost fields — the leak would have to be deliberate. |
| `app/main.py` | Error handlers collapse every upstream failure into `503 {"error": "Service temporarily unavailable"}` / `502`; `/docs`, `/redoc` and `/openapi.json` are disabled. |
| `app/llm_client.py` | Only the logical names `agent-pro` / `agent-basic` ever leave the process; LiteLLM's `X-Model-Used` / `X-Real-Cost` headers are read for billing and never forwarded. |
| `docker-compose.yml` | LiteLLM has no published port; `litellm` and `api` are the only services that hold secrets they need. |

Test `tests/test_chat.py::test_chat_returns_only_reply_and_percentage` fails the
build if a model name, token count or real cost ever appears in a customer
response.

---

## 2. Quick start

```bash
cd gateway
cp .env.example .env          # then fill in every CHANGE_ME value
docker compose up -d --build
docker compose ps             # wait until api + litellm are "healthy"
curl -s localhost:8000/health # {"status":"ok"}
```

Required in `.env`:

| Variable | What it is |
| --- | --- |
| `LITELLM_MASTER_KEY` | Shared secret between the API and the proxy. `python -c "import secrets; print('sk-gw-' + secrets.token_urlsafe(48))"` |
| `LITELLM_SALT_KEY` | Salt LiteLLM uses to encrypt secrets at rest. |
| `JWT_SECRET` | Signs customer tokens. |
| `OPENAI_API_KEY_1/2`, `ANTHROPIC_API_KEY_1/2`, `GEMINI_API_KEY_1/2` | Two keys per provider for rotation + load balancing. |
| `POSTGRES_PASSWORD` | Change it; it is also embedded in `DATABASE_URL` / `LITELLM_DATABASE_URL`. |
| `OLLAMA_API_BASE` | Default `http://host.docker.internal:11434`. Pull the models first: `ollama pull llama3.1:70b && ollama pull llama3.1:8b`. |

Compose refuses to start if `LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY` or
`JWT_SECRET` is missing (`:?set in .env`), so a half-configured deployment
cannot come up.

---

## 3. Customer API

`POST /register` (201) → 5.00 USD of signup credit, plan `pro`, returns a JWT.

```bash
TOKEN=$(curl -s localhost:8000/register -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"password123"}' | jq -r .access_token)

curl -s localhost:8000/chat -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Summarise HTTP/3 in one sentence."}]}'
# {"reply":"…","credit_remaining_percent":99.8}
```

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `POST /register` | Create an account | 409 on a duplicate email |
| `POST /login` | Exchange credentials for a JWT | 401 on bad credentials |
| `POST /chat` | Talk to the agent | rate limit → credit gate → LLM → charge → log |
| `GET /me/credit` | Balance, baseline and remaining % | never reveals spend in USD per model |
| `POST /buy-credit` | Buy credit | **stub**: no payment processor yet, records 1:1 |
| `GET /me/usage` | Paginated history | shows only `charged` + `created_at` |
| `GET /health` | Liveness for orchestration | public |

`/chat` returns `402 {"error":"Credit exhausted","action":"buy_credit","link":"/buy-credit"}`
when the balance reaches zero, and `429` when either limit is hit
(`RATE_LIMIT_PER_MIN`, `DAILY_MESSAGE_CAP`).

### Billing

```
charged         = real_cost × MARKUP          (MARKUP default 2.5)
minimum charge  = 0.000001 USD                (cache hits are not free)
```

Deduction is a single conditional `UPDATE users SET credit = credit - :charge
WHERE id = :id AND credit >= :charge RETURNING credit`, so concurrent `/chat`
requests can never drive a balance negative. The deduction and the `usage_logs`
row are written in **one transaction** (`app/credit.py::deduct` deliberately does
not commit), so a crash can never charge a customer without recording why. `credit_remaining_percent` is
computed against lifetime purchases (or the signup bonus before the first
purchase) and clamped to 0–100.

---

## 4. Resilience: how the gateway stays online

Model groups are chosen by `routing_strategy: latency-based-routing`, and each
remote provider has **two deployments (two keys)** with the same `model_name`,
so LiteLLM load-balances across them and retries prefer a key that has not been
tried yet.

```
agent-pro    →  gpt-4o          →  claude-3-5-sonnet  →  gemini-1.5-pro  →  llama3.1:70b (local)
agent-basic  →  gpt-4o-mini     →  gemini-1.5-flash   →  llama3.1:8b (local)
```

| Setting | Value | Effect |
| --- | --- | --- |
| `router_settings.num_retries` | 2 | retries inside a group (covers the second key) |
| `router_settings.allowed_fails` / `cooldown_time` | 5 / 60s | circuit breaker: a failing deployment is skipped for 60s |
| `router_settings.enable_pre_call_checks` | true | cooled-down deployments are filtered before the call |
| `router_settings.fallbacks` | see above | the chain is walked **in order**, ending at local Ollama |

### Timeout budget

The customer-facing deadline is **25s** (httpx `connect=3s`, `read=20s`, plus a
hard `anyio.fail_after(25)`). Per-attempt timeouts must fit inside it, otherwise
the API would abort before a fallback could be tried:

| Stage | Budget |
| --- | --- |
| one attempt, remote provider | 8s (`agent-pro`), 6s (`agent-basic`) |
| one group | 2 attempts → 16s / 12s |
| worst case | primary group (16s) + first fallback (8s) = **24s < 25s** |
| Ollama (last resort, local) | 20s / 15s, but bounded by the 25s deadline above |

Fast failures (401/429/connection refused) cost milliseconds, so the real chain
is usually traversed in well under a second.

---

## 5. Operations runbook

### 5.1 Invalidate one provider key

The point of two keys per provider is that one bad key is invisible to
customers. To prove it, break exactly one key and watch which model serves the
traffic.

```bash
cd gateway
# 1. break ONE OpenAI key (on Windows, edit .env and set the same value)
sed -i 's|^OPENAI_API_KEY_1=.*|OPENAI_API_KEY_1=sk-invalid-key|' .env

# 2. reload the proxy so it re-reads the environment
docker compose up -d --force-recreate litellm
docker compose logs -f litellm        # watch for auth errors + recovery
```

Send one request as a customer:

```bash
curl -s localhost:8000/chat -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"ping"}]}'
```

Two things are true at once, and both matter:

1. **The customer still gets a normal `200` reply** (possibly a few hundred ms
   slower). That is the resilience guarantee.
2. **The operator sees the model actually used** in the proxy log line, never in
   the HTTP response:

```bash
docker compose logs --tail 50 litellm | grep llm_request_success
# {"event":"llm_request_success","model_used":"gpt-4o","input_tokens":…,"cost_usd":…,"user_id":"…"}
```

With a single bad key, `model_used` stays `gpt-4o`: LiteLLM simply routed to the
second deployment. To confirm the key was the reason, look for the retry/cooldown
lines just before it:

```bash
docker compose logs --tail 100 litellm | grep -E "APIError|AuthenticationError|cooldown"
```

**Prefer a direct probe instead of an end-to-end request?** `scripts/probe_model.sh`
does exactly that, and it is the fastest way to watch the chain move:

```bash
sh scripts/probe_model.sh agent-pro 5
# agent-pro    -> model_used=gpt-4o                       real_cost=0.00012300
# agent-pro    -> model_used=claude-3-5-sonnet-20241022   real_cost=0.00189000
```

It runs `python3` **inside** the litellm container, because the proxy publishes
no port and the LiteLLM image contains no curl (see BerriAI/litellm#9295).

### 5.2 Verify the full fallback chain

Break the whole provider to force the chain to move.

```bash
# break BOTH agent-pro providers except the last one, in order:
sed -i 's|^OPENAI_API_KEY_1=.*|OPENAI_API_KEY_1=sk-invalid|' .env
sed -i 's|^OPENAI_API_KEY_2=.*|OPENAI_API_KEY_2=sk-invalid|' .env
docker compose up -d --force-recreate litellm
```

Then probe repeatably until the model changes:

```bash
sh scripts/probe_model.sh agent-pro 5
```

Expected progression, in this order:

| Keys broken | `x-model-used` | What it proves |
| --- | --- | --- |
| `OPENAI_API_KEY_1` | `gpt-4o` | key rotation / load balancing |
| both OpenAI keys | `claude-3-5-sonnet-20241022` | provider fallback hop 1 |
| + both Anthropic keys | `gemini-1.5-pro` | provider fallback hop 2 |
| + both Gemini keys | `llama3.1:70b` | local last line of defence |
| + Ollama stopped | `503` in ~25s | exhausted: the API fails *closed*, generically |

While both OpenAI keys are invalid, note that LiteLLM opens the circuit breaker
after `allowed_fails` (5) failures and skips those deployments for
`cooldown_time` (60s) — that is why the probe may still say `gpt-4o` on the first
couple of calls while the breaker is closing.

Customers always see the same response shape throughout; only the latency and
the operator-side log line change.

### 5.3 Restore

```bash
sed -i 's|^OPENAI_API_KEY_1=.*|OPENAI_API_KEY_1=sk-your-real-key|' .env
# repeat for OPENAI_API_KEY_2, then:
docker compose up -d --force-recreate litellm
docker compose logs --tail 20 litellm | grep llm_request_success   # gpt-4o again
```

Rotating a key for real is exactly the same procedure: update `.env`,
`docker compose up -d --force-recreate litellm`, confirm `gpt-4o` is back in one
request. No API redeploy is needed — keys live only in the proxy.

### 5.4 Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `/chat` returns `503` for everything | all providers down, or `LITELLM_MASTER_KEY` mismatch between `api` and `litellm` | `docker compose logs litellm \| tail -50` |
| `/chat` returns `502` | integration error (bad model name, malformed payload) | `docker compose logs api \| grep "litellm unexpected status"` |
| `model_used` is `unknown` | neither the `X-Model-Used` header nor `_hidden_params` was present | confirm `custom_callbacks.proxy_handler_instance` is in `litellm_settings.callbacks` |
| Ollama never answers | models not pulled / `OLLAMA_API_BASE` wrong | `docker compose exec -T litellm python3 -c "import os,urllib.request;print(urllib.request.urlopen(os.environ['OLLAMA_API_BASE']+'/api/tags', timeout=5).status)"` |
| `502` on every call mentioning "no healthy deployment" | the requested logical name is missing from `model_list` | `pytest tests/test_litellm_config.py` |
| Credit never decreases | `X-Real-Cost` missing (see above) — every request then bills the 0.000001 minimum | `docker compose logs litellm \| grep llm_request_success` |
| `401` on every customer call | `JWT_SECRET` changed between restarts | re-login |
| Postgres storage grows | LiteLLM spend logs | `LiteLLM_SpendLogs` is retained by design; prune on your own schedule |

---

## 6. Tests

The suite is self-contained: SQLite via aiosqlite, the LiteLLM call stubbed at
the module boundary, no Redis and no containers required.

```bash
cd gateway
pip install -r requirements-dev.txt
pytest -q
```

| File | Covers |
| --- | --- |
| `tests/test_auth.py` | register/login, duplicate emails, expired/garbage/unknown-user tokens, bcrypt round-trip |
| `tests/test_credit.py` | markup, minimum charge, clamped percentage, atomic deduction refusing to overdraw, purchases |
| `tests/test_chat.py` | the whole pipeline end to end + the "no internals in the response" contract, 402/429/502/503 mapping, usage scoping, buy-credit |
| `tests/test_llm_client.py` | logical model names, `user` propagation, `X-Model-Used`/`X-Real-Cost` parsing, timeout/5xx → `503`, 4xx → `502`, malformed body |
| `tests/test_migrations.py` | the Alembic revision produces exactly the schema in `app/models.py`, is reversible, and compiles for Postgres without a database |
| `tests/test_litellm_config.py` | `agent-pro`/`agent-basic` exist, every fallback target is defined, chains match the documented order, timeouts fit the 25s deadline, callback is an instance, no literal secrets |
| `tests/test_custom_callbacks.py` | header injection + structured telemetry (skipped unless `litellm` is installed — it is a dev-only dependency) |

`GATEWAY_ALLOW_MISSING_SECRETS=1` (set by `tests/conftest.py`) lets `Settings`
load with placeholder secrets. Never set it in production.

---

## 7. Layout

```
gateway/
├── app/
│   ├── main.py            FastAPI app: routes, error handlers, lifespan
│   ├── auth.py            bcrypt + JWT, `CurrentUser` dependency
│   ├── llm_client.py      the only caller of LiteLLM; timeouts + sanitizing
│   ├── credit.py          Decimal money: markup, atomic deduction, purchases
│   ├── rate_limit.py      Redis fixed-window per-minute limit + daily cap
│   ├── models.py          SQLAlchemy: users, usage_logs, purchases
│   ├── schemas.py         customer-facing request/response models
│   ├── config.py          pydantic-settings, fail-fast on missing secrets
│   └── db.py              async engine/session lifecycle
├── litellm/
│   ├── config.yaml        model groups, routing, fallbacks, cache, logging
│   └── custom_callbacks.py X-Model-Used / X-Real-Cost headers + telemetry
├── migrations/            Alembic (0001_initial = users/usage_logs/purchases)
├── docker/initdb/         creates the litellm + gateway databases
├── scripts/probe_model.sh ask the proxy which model served a request
├── tests/                 pytest suite (SQLite, no services needed)
├── docker-compose.yml     postgres, redis, litellm (internal), api (public)
├── Dockerfile             migrations run on boot, then uvicorn (2 workers)
└── requirements*.txt      runtime vs dev/test dependencies
```

---

## 8. Known deviations & limitations

* **No connect/read timeout split in LiteLLM YAML.** LiteLLM only accepts a
  scalar `timeout` (+ `stream_timeout`) per deployment, so the connect=3s /
  read=20s split and the hard 25s deadline live in `app/llm_client.py`.
* **Retry budget is bounded by design.** Router retries and per-attempt
  timeouts are tuned to fit the 25s deadline (section 4); raising a per-attempt
  timeout above ~8s silently reintroduces the "no time left for a fallback" bug.
* **`POST /buy-credit` is a stub.** No payment processor: it records a purchase
  and credits 1:1. Wire a provider (Stripe et al.) before charging real money.
* **Rate limiting fails open.** If Redis is unavailable the limiter logs a
  warning and lets traffic through — availability over strictness.
* **No streaming endpoint.** Customers receive complete replies; the design
  would still hide model identity if streaming were added.
* **Exhausted capacity fails closed with a generic 503.** The customer is never
  told why, which is intentional: provider identity is not theirs to see.
* **Dependencies are pinned deliberately.** `bcrypt` must stay below 5.0
  (`passlib==1.7.4` cannot hash with it — it raises `ValueError: password cannot
  be longer than 72 bytes` on *every* password), and `litellm` must not be
  installed into the API's environment: litellm ≥ 1.104 requires
  `pydantic-settings>=2.14.1`, which contradicts the API's pin. LiteLLM runs in
  its own container and ships its own copy of the callback.
* **No payment processor.** `/buy-credit` credits the account without taking
  money; add real payment verification before opening the gateway to the public.
* **One Postgres instance, two databases** (`litellm` for spend logs, `gateway`
  for app data) created by `docker/initdb/01-create-databases.sh` on first boot.
