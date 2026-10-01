# Billing

How money works in AgentFA, and the invariants that keep it honest.

The domain is deliberately small: **a price list, one wallet per user, and one
transaction per movement of money.** There are no subscriptions-as-schema, no
invoices and no recurring charges — a plan is an allowance the user buys a period
of, and everything else is a top-up or an agent purchase.

## One source of truth for prices

`src/payments/pricing.ts` is the only place an amount is defined:

| Rate | Value |
| --- | --- |
| Tokens | 2 tokens per Toman (0.5 Toman each) |
| Time | 500 Toman per minute |

Everything sellable is *derived* from those two rates, so an advertised price and
a charged price cannot drift apart:

| Token bundle | Price | Time pass | Price |
| --- | --- | --- | --- |
| 100,000 tokens | 50,000 | 60 minutes | 30,000 |
| 300,000 tokens | 150,000 | 300 minutes | 150,000 |
| 1,000,000 tokens | 500,000 | 1,200 minutes | 600,000 |

| Plan | Allowance / period | Price / month |
| --- | --- | --- |
| `free` | 50,000 tokens + 60 minutes | 0 |
| `basic` | 500,000 tokens + 600 minutes | 290,000 |
| `pro` | 2,000,000 tokens + 2,400 minutes | 990,000 |

Yearly billing is **20% off, twelve months charged up front** — `basic` 2,784,000
and `pro` 9,504,000. `planPrice()` computes that on the server, and
`GET /api/pricing` hands the SPA the same list (plus `monthlyEquivalent` for the
"…/mo, billed yearly" sub-label), which `usePricing()` serves to the pricing page.
The yearly toggle therefore changes what is *charged*, not just what is shown.

**To change a price, edit `pricing.ts` and nothing else.** The UI reads the list at
runtime and every charge is recomputed from it. `test/pricing.test.ts` pins the
relationship — e.g. that a bundle's advertised price equals what a top-up for that
bundle costs — so a rate change that breaks the rule fails the suite rather than
silently shipping two prices.

### What must never happen again

The original pricing page carried its own hardcoded copy of this table and called
the *top-up* endpoint with the *plan's* numbers, which is how "Free" came to cost
55,000 Toman and the yearly discount turned out to be decorative. Hence the rule:

- **The client sends what it wants, never what it costs.** `topUp` sends tokens
  and minutes; `plan` sends a plan key and a billing period. Amounts are always
  computed server-side.
- **Never trust a client-supplied discount, amount or currency.**

## The wallet

One `Wallet` row per user: a plan, two balances (`tokenBalance`,
`timeBalanceSeconds`), the current plan's limits, and the usage counters for the
running period.

Two rules define spending:

1. **A balance is a balance.** The plan allowance is a monthly *refill*, not a
   second ceiling — `remaining()` returns the balance, and that is the only cap.
   (Previously spendable usage was capped at `allowance − usage`, which made
   tokens a user had *bought* unspendable the moment the free allowance ran out.)
2. **The period rolls.** `PERIOD_MS` is 30 days. `ensurePeriod()` rolls lazily on
   the wallet read and on every debit: usage counters reset to zero and each
   balance becomes `max(balance, allowance)` — the allowance is restored, and
   anything bought on top survives. Rolling on read rather than on a schedule is
   what keeps the serverless deployment working with no cron configured.

Switching plans: `free` applies directly (it costs nothing) and restarts the
period; a paid plan goes through checkout like anything else, and the wallet only
changes once the transaction settles.

## Transactions

Every movement is one `Transaction` row typed `topup`, `plan`, `purchase` or
`refund`, with a human-readable `orderId` (`AF-20260923-9F3C21A4`).

```
start      amount computed from pricing.ts → pending row → gateway redirect
redirect   the browser leaves for the gateway (authority / client_secret stored
           as providerToken; the client only ever gets the URL and order id)
callback   /api/payments/callback/:provider → resolve by handle → verify with the
           gateway itself (Zarinpal: re-submit authority *and amount*;
           Stripe: HMAC over the raw body)
settle     settleTransaction re-checks amount and handle, then marks success with
           the gateway refId — and only then credits the wallet or grants the
           entitlement
return     the payer lands on /payment-required?transaction=…&status=ok|failed,
           which polls GET /api/payments/:id until the row is settled
```

Guarantees:

- **A `Status=OK` query parameter is never trusted on its own.** Only the gateway's
  own verification settles a payment.
- **Idempotent.** A replayed callback returns `credited: false` instead of
  crediting twice, so a retried webhook or a refreshed browser is harmless; a
  `refId` is unique across transactions and a handle that already settled another
  order is refused (`payment_ref_reused`).
- **Nothing is left dangling.** A canceled or failed payment is stored as `failed`
  with a reason (`payer_canceled`, `amount_mismatch`, `gateway_unreachable`, …),
  and a request that throws marks the transaction failed rather than orphaning it.
- **Content stays gated until settlement**, so a pending payment never leaks a
  persona.
- **One currency, converted at the edge.** The catalogue is in Toman (IRT);
  Zarinpal is charged in Rial (×10) inside the adapter, never in the price list.

Gateways are adapters behind `payments/types.ts` (`start`,
`referenceFromCallback`, `verify`, optional `refund`), selected by
`PAYMENT_PROVIDER`. With `none` — the default — no gateway is configured:
checkouts answer `503 gateway_not_configured`, which the SPA renders as a
localized message rather than a raw code. Only the free plan works without one.

## Refunds

Agent purchases carry a **7-day money-back window**, measured from
`Entitlement.purchasedAt` (`lib/refund-window.ts`).

A refund is a request plus a decision, because money can only move once a person
or a gateway settles it:

1. `POST /api/agents/:agentId/refund` records a `pending` refund transaction for
   the amount actually paid. It revokes nothing — asking for a refund does not
   lock the buyer out of something they may end up keeping. One open request per
   agent (`refund_exists` survives double-submits).
2. An admin sees the queue at `GET /api/admin/refunds` and settles it with
   `POST /api/admin/refunds/:id/approve` or `/reject`.
3. Approval calls the gateway's `refund()` when the adapter supports it, then
   revokes the entitlement and settles the row in one database transaction —
   idempotently, so approving twice refunds once. A gateway that refuses is
   reported as `gateway_refund_failed:<reason>` and nothing is revoked, so the
   request stays pending for a retry instead of the failure being swallowed.

Because the purchase row itself is untouched, a user who re-buys a refunded agent
keeps a clean history: `revokedAt` is cleared and a fresh payment is recorded.

## Related

- [`../server/README.md`](README.md) — running the API, environment, testing
  payments against the local stub PSP, deployment.
- [`../agentfa-web/README.md`](../agentfa-web/README.md) — the SPA side.
- [`../agentfa-web/NOTICE.md`](../agentfa-web/NOTICE.md) — third-party notices.
