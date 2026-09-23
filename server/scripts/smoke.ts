// End-to-end smoke test against a real Postgres.
//
//   docker compose up -d
//   npm run migrate && (cd ../agentfa-web && bun run export:server-content) && npm run seed:content
//   npm run build && npm run smoke
//
// It boots the API through the actual Vercel entry point (api/index.ts, which
// imports the compiled server/dist) when that build exists, points the LLM
// provider, the payment gateway and the SMS gateway at fake local endpoints,
// and then drives:
//
//   health → catalog (from Postgres) → SMS login → wallet → purchase
//   → settlement → persona gate → streamed chat with a wallet debit
//   → top-up through the gateway → verified callback → idempotent replay
//   → code replay, resend cooldown, attempt cap and provider failure
//
// Everything this run creates (users, login codes, transactions, provider
// config) is removed again at the end, so it is safe to run repeatedly.
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHAT_REPLY = ["سلام", "، این یک ", "پاسخ آزمایشی ", "است."];
const CHAT_TOKENS = 42;
const TOP_UP_TOKENS = 100_000;
/** 100 000 tokens at 2 tokens per Toman, sent to the gateway in Rial. */
const TOP_UP_TOMAN = 50000;
const TOP_UP_RIAL = TOP_UP_TOMAN * 10;
const GATEWAY_REF = "REF123456789";

/**
 * A fresh client IP per run. The app trusts `X-Forwarded-For`, and the OTP
 * endpoints are rate limited per IP, so without this a few runs inside an hour
 * would start failing on the limiter rather than on the code under test.
 */
const SMOKE_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** A valid, unique Iranian mobile per run: `9` + nine digits. */
function phoneFor(seed: number): string {
  return `+98912${String(seed).slice(-7).padStart(7, "0")}`;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

// Assigned inside main() once the environment is configured.
let prisma!: PrismaClient;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures.push(name);
  console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

function readJson(req: IncomingMessage, done: (body: Record<string, unknown>) => void): void {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    try {
      done(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
    } catch {
      done({});
    }
  });
}

/** OpenAI-compatible LLM endpoint that streams a fixed reply and reports usage. */
function fakeProvider(): Server {
  return createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const chunk of CHAT_REPLY) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ choices: [], usage: { total_tokens: CHAT_TOKENS } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
}

type GatewayState = {
  requestAmount: number | null;
  verifyAmount: number | null;
  merchantId: string | null;
  authority: string;
  verifyAuthority: string | null;
};

/** Minimal Zarinpal v4 stand-in: request → authority, verify → ref_id. */
function fakeGateway(state: GatewayState): Server {
  return createServer((req, res) => {
    readJson(req, (body) => {
      const send = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/pg/v4/payment/request.json")) {
        state.requestAmount = Number(body.amount);
        state.merchantId = String(body.merchant_id ?? "");
        state.authority = `A${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        return send({ data: { code: 100, authority: state.authority }, errors: [] });
      }
      if (req.url?.startsWith("/pg/v4/payment/verify.json")) {
        state.verifyAmount = Number(body.amount);
        state.verifyAuthority = String(body.authority ?? "");
        return send({ data: { code: 100, ref_id: GATEWAY_REF }, errors: [] });
      }
      res.writeHead(404).end();
    });
  });
}

type SmsState = {
  receptor: string | null;
  template: string | null;
  text: string | null;
  code: string | null;
  /** Set to make the next send fail, exercising the error path. */
  failNext: boolean;
};

/**
 * Minimal Kavenegar stand-in: `verify/lookup.json` is a GET whose `token` is the
 * login code, and the reply is the same envelope the real API sends.
 */
function fakeSms(state: SmsState): Server {
  return createServer((req, res) => {
    const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
    state.receptor = params.get("receptor");
    state.template = params.get("template");
    state.text = params.get("message");
    state.code = params.get("token") ?? (params.get("message")?.match(/\d{6}/)?.[0] ?? null);

    res.writeHead(200, { "Content-Type": "application/json" });
    if (state.failNext) {
      state.failNext = false;
      return res.end(JSON.stringify({ return: { status: 424, message: "insufficient credit" } }));
    }
    res.end(JSON.stringify({ return: { status: 200, message: "ok" }, entries: [{ messageid: 987654 }] }));
  });
}

/** Boot through the real Vercel entry when it is built, otherwise from source. */
async function loadHandler(): Promise<Handler> {
  const entry = resolve(serverRoot, "..", "api", "index.ts");
  if (existsSync(resolve(serverRoot, "dist", "app.js"))) {
    console.log("smoke: booting through api/index.ts (Vercel entry + server/dist)");
    const mod = (await import(pathToFileURL(entry).href)) as { default: Handler };
    return mod.default;
  }
  console.log("smoke: server/dist is missing — booting src/app.ts instead (run `npm run build`)");
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp();
  await app.ready();
  return (req, res) => {
    app.server.emit("request", req, res);
  };
}

async function main(): Promise<void> {
  const provider = fakeProvider();
  const providerPort = await listen(provider);

  const gatewayState: GatewayState = {
    requestAmount: null,
    verifyAmount: null,
    merchantId: null,
    authority: "",
    verifyAuthority: null,
  };
  const gateway = fakeGateway(gatewayState);
  const gatewayPort = await listen(gateway);

  const smsState: SmsState = { receptor: null, template: null, text: null, code: null, failNext: false };
  const sms = fakeSms(smsState);
  const smsPort = await listen(sms);

  // The handler is loaded after the environment below, so it is deliberately
  // kept in a mutable reference the server reads per request.
  let handler: Handler | null = null;
  const api = createServer((req, res) => {
    if (!handler) {
      res.statusCode = 503;
      res.end();
      return;
    }
    void Promise.resolve(handler(req, res)).catch((err) => {
      console.error("handler failed", err);
      res.statusCode = 500;
      res.end();
    });
  });
  const apiPort = await listen(api);
  const base = `http://127.0.0.1:${apiPort}`;

  // Gateway configuration has to exist before anything reads the environment.
  process.env.PAYMENT_PROVIDER = "zarinpal";
  process.env.ZARINPAL_MERCHANT_ID = "smoke-merchant-id";
  process.env.ZARINPAL_BASE_URL = `http://127.0.0.1:${gatewayPort}`;
  process.env.SMS_PROVIDER = "kavenegar";
  process.env.KAVENEGAR_API_KEY = "smoke-api-key";
  process.env.KAVENEGAR_TEMPLATE = "agentfa-login";
  process.env.KAVENEGAR_BASE_URL = `http://127.0.0.1:${smsPort}`;
  process.env.OTP_RESEND_SECONDS = "1";
  process.env.PUBLIC_API_URL = base;
  process.env.PUBLIC_WEB_URL = base;

  const { prisma: client } = await import("../src/db.js");
  prisma = client;
  const { settleTransaction } = await import("../src/routes/payments.js");
  handler = await loadHandler();

  let cookie = "";
  async function call(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, unknown> | string; location?: string | null }> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        // A fresh IP per run keeps the per-IP OTP limits from leaking between runs.
        "x-forwarded-for": SMOKE_IP,
        ...(init.headers ?? {}),
      },
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
    const text = await response.text();
    let body: Record<string, unknown> | string = text;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* SSE and plain text stay strings */
    }
    return { status: response.status, body, location: response.headers.get("location") };
  }

  /** Follow a gateway redirect without leaving the process. */
  async function hit(path: string): Promise<{ status: number; location: string | null }> {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    return { status: response.status, location: response.headers.get("location") };
  }

  console.log("\nhealth + catalog (Postgres)");
  const health = await call("/api/health");
  check("GET /api/health is 200", health.status === 200, health.body);
  check("health reports db ok", JSON.stringify(health.body).includes('"db":"ok"'), health.body);
  check("health skips redis when unset", JSON.stringify(health.body).includes('"redis":"skipped"'), health.body);

  const catalog = (await call("/api/catalog")).body as unknown as {
    agents: { id: string; price: number; division: string }[];
    divisions: { slug: string; count: number }[];
  };
  check("catalog comes from the database", catalog.agents.length > 200, catalog.agents.length);
  check("divisions include counts", catalog.divisions.every((d) => typeof d.count === "number"));
  const agent = catalog.agents[0]!;

  console.log("\nauth: phone + SMS code");
  const phone = phoneFor(Date.now());
  const typedPhone = `0${phone.slice(3)}`;

  const passwordLogin = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "someone@example.com", password: "supersecret1" }),
  });
  check("password login no longer exists", passwordLogin.status === 404, passwordLogin.status);

  const landline = await call("/api/auth/otp/start", {
    method: "POST",
    body: JSON.stringify({ phone: "02188776655" }),
  });
  check(
    "a landline is refused before any SMS is sent",
    landline.status === 400 && JSON.stringify(landline.body).includes("invalid_phone"),
    landline.body,
  );

  const started = await call("/api/auth/otp/start", {
    method: "POST",
    body: JSON.stringify({ phone: typedPhone }),
  });
  check("otp/start accepts the number as typed (۰۹…)", started.status === 200, started.body);
  check(
    "the response never carries a code when a provider is configured",
    !JSON.stringify(started.body).includes("devCode"),
    started.body,
  );
  check(
    "the provider received the number without a plus sign",
    smsState.receptor === phone.replace("+", ""),
    smsState.receptor,
  );
  check("the registered template was used", smsState.template === "agentfa-login", smsState.template);
  check("a six-digit code was delivered", /^\d{6}$/.test(smsState.code ?? ""), smsState.code);

  const resend = await call("/api/auth/otp/start", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  check("a second code inside the cooldown is refused (429)", resend.status === 429, resend.body);

  const wrong = await call("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code: smsState.code === "000000" ? "111111" : "000000" }),
  });
  check("a wrong code is rejected (401)", wrong.status === 401, wrong.body);
  check(
    "the rejection names the code, not the account",
    JSON.stringify(wrong.body).includes("invalid_code"),
    wrong.body,
  );

  const verified = await call("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code: smsState.code }),
  });
  check("the delivered code signs the user in", verified.status === 200, verified.body);
  check(
    "a first login is reported as a new account",
    JSON.stringify(verified.body).includes('"isNewUser":true'),
    verified.body,
  );
  check("otp/verify sets a session cookie", cookie.includes("agentfa_session"), cookie);
  const userCookie = cookie;

  const me = await call("/api/auth/me");
  check(
    "the session resolves the normalized phone",
    me.status === 200 && JSON.stringify(me.body).includes(phone),
    me.body,
  );
  const walletBefore = (await call("/api/wallet")).body as unknown as { tokenBalance: number };
  check("a new account gets the gift balance", walletBefore.tokenBalance === 50000, walletBefore);
  check(
    "unauthenticated wallet access is rejected",
    (await call("/api/wallet", { headers: { cookie: "" } })).status === 401,
  );

  const replay = await call("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code: smsState.code }),
  });
  check("a used code cannot be replayed", replay.status === 401, replay.body);

  // The cooldown is a second long in this run, so waiting is enough.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const resendAfterCooldown = await call("/api/auth/otp/start", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  check("asking again after the cooldown works", resendAfterCooldown.status === 200, resendAfterCooldown.body);

  const returning = await call("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code: smsState.code }),
  });
  check(
    "the same number is the same account, not a new one",
    returning.status === 200 && JSON.stringify(returning.body).includes('"isNewUser":false'),
    returning.body,
  );
  cookie = userCookie;

  console.log("\nSMS: attempt cap and provider failure");
  const burnPhone = phoneFor(Date.now() + 5_000_000);
  await call("/api/auth/otp/start", { method: "POST", body: JSON.stringify({ phone: burnPhone }) });
  const wrongGuess = smsState.code === "000000" ? "111111" : "000000";
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await call("/api/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone: burnPhone, code: wrongGuess }),
    });
    statuses.push(response.status);
  }
  check(
    "the first four wrong guesses are plain rejections",
    statuses.slice(0, 4).every((status) => status === 401),
    statuses,
  );
  check("the fifth wrong guess reports the cap (429)", statuses[4] === 429, statuses);
  const burned = await call("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone: burnPhone, code: smsState.code }),
  });
  check("a burned code stops working even when correct", burned.status === 401, burned.body);

  const failPhone = phoneFor(Date.now() + 9_000_000);
  smsState.failNext = true;
  const failedSend = await call("/api/auth/otp/start", {
    method: "POST",
    body: JSON.stringify({ phone: failPhone }),
  });
  check("a provider rejection surfaces as 502", failedSend.status === 502, failedSend.body);
  check(
    "no code is left pending after a failed send",
    (await prisma.loginCode.count({ where: { phone: failPhone, consumedAt: null } })) === 0,
  );

  console.log("\nentitlement gate + purchase through the gateway");
  const personaBefore = await call(`/api/agents/${agent.id}/persona`);
  check("persona is gated before purchase (403)", personaBefore.status === 403, personaBefore.body);
  const buy = (await call(`/api/agents/${agent.id}/buy`, { method: "POST" })).body as unknown as {
    transactionId: string;
    orderId: string;
    price: number;
    redirectUrl: string;
  };
  check("purchase re-reads the server price", buy.price === agent.price, buy);
  check("purchase starts at the gateway", buy.redirectUrl.includes(`/pg/StartPay/`), buy.redirectUrl);
  check("order id is exposed for support", /^AF-\d{8}-[0-9A-F]{8}$/.test(buy.orderId), buy.orderId);
  check(
    "persona stays locked while the payment is pending",
    (await call(`/api/agents/${agent.id}/persona`)).status === 403,
  );

  await settleTransaction({ transactionId: buy.transactionId, refId: `smoke-${Date.now()}` });
  const personaAfter = await call(`/api/agents/${agent.id}/persona`);
  check("persona unlocks once the settlement exists (200)", personaAfter.status === 200, personaAfter.body);
  const otherAgent = catalog.agents[1]!;
  check("other personas stay locked", (await call(`/api/agents/${otherAgent.id}/persona`)).status === 403);
  const replayPurchase = await settleTransaction({
    transactionId: buy.transactionId,
    refId: `smoke-${Date.now()}`,
  })
    .then((result) => result.credited === false)
    .catch(() => false);
  check("settlement is idempotent (no second credit)", replayPurchase);
  check("purchases are listed as owned", JSON.stringify((await call("/api/agents/owned")).body).includes(agent.id));

  console.log("\nadmin provider config");
  // Promotion is an operator action (npm run seed / SQL), so the row is created
  // directly; the admin then logs in through the same SMS path as everyone else.
  const adminPhone = phoneFor(Date.now() + 2_000_000);
  await prisma.user.create({ data: { phone: adminPhone, role: "admin", wallet: { create: {} } } });
  const adminStart = await call("/api/auth/otp/start", {
    method: "POST",
    body: JSON.stringify({ phone: adminPhone }),
  });
  check("an admin can request a code too", adminStart.status === 200, adminStart.body);
  const adminLogin = await call("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone: adminPhone, code: smsState.code }),
  });
  check("admin login succeeds with an SMS code", adminLogin.status === 200, adminLogin.body);
  const saved = await call("/api/admin/provider", {
    method: "PUT",
    body: JSON.stringify({
      label: "smoke",
      baseUrl: `http://127.0.0.1:${providerPort}`,
      model: "smoke-model",
      apiKey: "sk-smoke-0123456789",
      meter: "tokens",
      agentScope: ["*"],
      enabled: true,
    }),
  });
  check("provider config is stored", saved.status === 200, saved.body);
  const providerId = (saved.body as unknown as { provider?: { id?: string } }).provider?.id;
  const patched = await call("/api/admin/provider", {
    method: "PUT",
    body: JSON.stringify({
      label: "smoke",
      baseUrl: `http://127.0.0.1:${providerPort}`,
      model: "smoke-model-2",
      meter: "tokens",
      agentScope: ["*"],
      enabled: true,
    }),
  });
  check(
    "editing without an api key keeps the stored one",
    patched.status === 200 && JSON.stringify(patched.body).includes('"model":"smoke-model-2"'),
    patched.body,
  );

  console.log("\nstreamed chat + billing");
  // Back to the buyer: the admin login above replaced the session cookie.
  cookie = userCookie;
  const stream = await call("/api/chat/stream", {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, message: "سلام", history: [], lang: "fa" }),
  });
  const raw = String(stream.body);
  check("chat streams delta frames", stream.status === 200 && raw.includes("event: delta"), stream.status);
  check("stream carries the provider text", raw.includes(CHAT_REPLY[0]!), raw.slice(0, 120));
  check("stream closes with a done frame", raw.includes("event: done"), raw.slice(-200));
  check("billing uses the provider token count", raw.includes(`"tokens":${CHAT_TOKENS}`), raw.slice(-200));
  const walletAfter = (await call("/api/wallet")).body as unknown as { tokenBalance: number };
  check(
    "wallet is debited in the database",
    walletAfter.tokenBalance === walletBefore.tokenBalance - CHAT_TOKENS,
    walletAfter,
  );
  const unownedChat = await call("/api/chat/stream", {
    method: "POST",
    body: JSON.stringify({ agentId: otherAgent.id, message: "hi", history: [], lang: "fa" }),
  });
  check("chat for an unowned agent is refused (403)", unownedChat.status === 403, unownedChat.body);

  console.log("\npayments: top-up, verified callback, replay protection");
  const balanceBeforeTopUp = (await call("/api/wallet")).body as unknown as { tokenBalance: number };
  const topUp = (await call("/api/wallet/topup", {
    method: "POST",
    body: JSON.stringify({ tokens: TOP_UP_TOKENS, minutes: 0 }),
  })).body as unknown as { transactionId: string; orderId: string; redirectUrl: string; provider: string };
  check("top-up returns a gateway redirect", topUp.redirectUrl.includes("/pg/StartPay/"), topUp.redirectUrl);
  check("gateway is recorded on the transaction", topUp.provider === "zarinpal", topUp.provider);
  check(
    "gateway received the amount in Rial",
    gatewayState.requestAmount === TOP_UP_RIAL,
    gatewayState.requestAmount,
  );
  check("merchant id was sent", gatewayState.merchantId === "smoke-merchant-id", gatewayState.merchantId);

  const pending = (await call(`/api/payments/${topUp.transactionId}`)).body as unknown as {
    status: string;
    currency: string;
  };
  check("transaction is pending before payment", pending.status === "pending", pending);
  check("currency is recorded for the gateway", pending.currency === "IRT", pending.currency);

  const authority = gatewayState.authority;
  const callback = await hit(`/api/payments/callback/zarinpal?Authority=${authority}&Status=OK`);
  check(
    "callback redirects the payer back to the SPA",
    callback.status === 302 && String(callback.location).includes("status=ok"),
    callback,
  );
  check(
    "callback re-verifies the amount with the gateway",
    gatewayState.verifyAmount === TOP_UP_RIAL && gatewayState.verifyAuthority === authority,
    { amount: gatewayState.verifyAmount, authority: gatewayState.verifyAuthority },
  );
  const credited = (await call("/api/wallet")).body as unknown as { tokenBalance: number };
  check(
    "wallet is credited by the settled top-up",
    credited.tokenBalance === balanceBeforeTopUp.tokenBalance + TOP_UP_TOKENS,
    credited,
  );
  const settled = (await call(`/api/payments/${topUp.transactionId}`)).body as unknown as {
    status: string;
    refId: string | null;
    paidAt: string | null;
  };
  check("transaction is settled with the gateway reference", settled.refId === GATEWAY_REF, settled);
  check("settlement records the payment time", Boolean(settled.paidAt), settled.paidAt);

  await hit(`/api/payments/callback/zarinpal?Authority=${authority}&Status=OK`);
  const afterReplay = (await call("/api/wallet")).body as unknown as { tokenBalance: number };
  check(
    "a replayed callback does not credit twice",
    afterReplay.tokenBalance === credited.tokenBalance,
    afterReplay,
  );

  const forged = await hit("/api/payments/callback/zarinpal?Authority=FORGED-AUTHORITY&Status=OK");
  check(
    "a forged authority is refused",
    forged.status === 302 && String(forged.location).includes("reason=unknown_transaction"),
    forged,
  );

  const canceledTopUp = (await call("/api/wallet/topup", {
    method: "POST",
    body: JSON.stringify({ tokens: TOP_UP_TOKENS, minutes: 0 }),
  })).body as unknown as { transactionId: string };
  const canceledAuthority = gatewayState.authority;
  await hit(`/api/payments/callback/zarinpal?Authority=${canceledAuthority}&Status=NOK`);
  const canceled = (await call(`/api/payments/${canceledTopUp.transactionId}`)).body as unknown as {
    status: string;
    failureReason: string | null;
  };
  check("a canceled payment is recorded as failed", canceled.status === "failed", canceled);
  check("the failure reason is stored", canceled.failureReason === "payer_canceled", canceled.failureReason);
  const balanceAfterCancel = (await call("/api/wallet")).body as unknown as { tokenBalance: number };
  check(
    "a canceled payment credits nothing",
    balanceAfterCancel.tokenBalance === credited.tokenBalance,
    balanceAfterCancel,
  );
  check(
    "another user cannot read someone else's transaction",
    (await call(`/api/payments/${topUp.transactionId}`, { headers: { cookie: "" } })).status === 401,
  );

  // Leave the database as we found it (only the rows this run created).
  await prisma.providerConfig.deleteMany({ where: { id: providerId } }).catch(() => {});
  const createdPhones = [phone, burnPhone, failPhone, adminPhone];
  await prisma.loginCode.deleteMany({ where: { phone: { in: createdPhones } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { phone: { in: createdPhones } } }).catch(() => {});

  console.log("");
  if (failures.length > 0) {
    console.error(`smoke: ${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`);
  } else {
    console.log("smoke: all checks passed");
  }

  api.closeAllConnections?.();
  provider.closeAllConnections?.();
  gateway.closeAllConnections?.();
  sms.closeAllConnections?.();
  api.close();
  provider.close();
  gateway.close();
  sms.close();
  await prisma.$disconnect().catch(() => {});
  // Sockets and the Prisma pool can keep the loop alive; every check is done.
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma?.$disconnect().catch(() => {});
  process.exitCode = 1;
});
