// End-to-end smoke test against a real Postgres.
//
//   docker compose up -d
//   npm run migrate && (cd ../agentfa-web && bun run export:server-content) && npm run seed:content
//   npm run build && npm run smoke
//
// It boots the API through the actual Vercel entry point (api/index.ts, which
// imports the compiled server/dist) when that build exists, points the provider
// config at a fake OpenAI-compatible SSE endpoint, and then drives: health →
// catalog (from Postgres) → register → wallet → buy → settle (entitlement) →
// persona gate → streamed chat with a wallet debit.
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/lib/password.js";
import { settleTransaction } from "../src/routes/payments.js";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHAT_REPLY = ["سلام", "، این یک ", "پاسخ آزمایشی ", "است."];
const CHAT_TOKENS = 42;

type Json = Record<string, unknown>;
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

/** OpenAI-compatible endpoint that streams a fixed reply and reports usage. */
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

async function loadHandler(): Promise<(req: IncomingMessage, res: unknown) => Promise<void>> {
  const entry = resolve(serverRoot, "..", "api", "index.ts");
  if (existsSync(resolve(serverRoot, "dist", "app.js"))) {
    console.log("smoke: booting through api/index.ts (Vercel entry + server/dist)");
    const mod = (await import(pathToFileURL(entry).href)) as {
      default: (req: IncomingMessage, res: unknown) => Promise<void>;
    };
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

  const handler = await loadHandler();
  const api = createServer((req, res) => {
    void handler(req, res as never).catch((err) => {
      console.error("handler failed", err);
      res.statusCode = 500;
      res.end();
    });
  });
  const apiPort = await listen(api);
  const base = `http://127.0.0.1:${apiPort}`;

  let cookie = "";
  async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Json | string }> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
    const text = await response.text();
    let body: Json | string = text;
    try {
      body = JSON.parse(text) as Json;
    } catch {
      /* SSE and plain text stay as strings */
    }
    return { status: response.status, body };
  }

  console.log("\nhealth + catalog (Postgres)");
  const health = await call("/api/health");
  check("GET /api/health is 200", health.status === 200, health.body);
  check("health reports db ok", JSON.stringify(health.body).includes('"db":"ok"'), health.body);
  check("health skips redis when unset", JSON.stringify(health.body).includes('"redis":"skipped"'), health.body);

  const catalog = (await call("/api/catalog")).body as {
    agents: { id: string; price: number; division: string }[];
    divisions: { slug: string; count: number }[];
  };
  check("catalog comes from the database", catalog.agents.length > 200, catalog.agents.length);
  check("divisions include counts", catalog.divisions.every((d) => typeof d.count === "number"));
  const agent = catalog.agents[0]!;

  console.log("\nauth + wallet");
  const email = `smoke-${Date.now()}@agentfa.test`;
  const registered = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: "supersecret1" }),
  });
  check("register returns 201", registered.status === 201, registered.body);
  check("register sets a session cookie", cookie.includes("agentfa_session"), cookie);
  const userCookie = cookie;
  const me = await call("/api/auth/me");
  check("session resolves the new user", me.status === 200, me.body);
  const walletBefore = (await call("/api/wallet")).body as { tokenBalance: number };
  check("new wallet holds the gift balance", walletBefore.tokenBalance === 50000, walletBefore);
  check(
    "unauthenticated wallet access is rejected",
    (await call("/api/wallet", { headers: { cookie: "" } })).status === 401,
  );

  console.log("\nentitlement gate + purchase");
  const personaBefore = await call(`/api/agents/${agent.id}/persona`);
  check("persona is gated before purchase (403)", personaBefore.status === 403, personaBefore.body);
  const buy = (await call(`/api/agents/${agent.id}/buy`, { method: "POST" })).body as {
    transactionId: string;
    price: number;
  };
  check("purchase re-reads the server price", buy.price === agent.price, buy);
  await settleTransaction(buy.transactionId, `smoke-${Date.now()}`);
  const personaAfter = await call(`/api/agents/${agent.id}/persona`);
  check("persona unlocks once the settlement exists (200)", personaAfter.status === 200, personaAfter.body);
  const grandchild = catalog.agents[1]!;
  check(
    "other personas stay locked",
    (await call(`/api/agents/${grandchild.id}/persona`)).status === 403,
  );
  check(
    "settlement is idempotent",
    await settleTransaction(buy.transactionId, `smoke-${Date.now()}`).then(
      () => true,
      () => false,
    ),
  );
  check("purchases are listed as owned", JSON.stringify((await call("/api/agents/owned")).body).includes(agent.id));

  console.log("\nadmin provider config");
  const adminEmail = `smoke-admin-${Date.now()}@agentfa.test`;
  await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash: await hashPassword("supersecret1"),
      role: "admin",
      wallet: { create: {} },
    },
  });
  const adminLogin = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, password: "supersecret1" }),
  });
  check("admin login succeeds", adminLogin.status === 200, adminLogin.body);
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
  const providerId = (saved.body as { provider?: { id?: string } }).provider?.id;
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
  const walletAfter = (await call("/api/wallet")).body as { tokenBalance: number };
  check(
    "wallet is debited in the database",
    walletAfter.tokenBalance === walletBefore.tokenBalance - CHAT_TOKENS,
    walletAfter,
  );
  const otherUser = await call(`/api/chat/stream`, {
    method: "POST",
    body: JSON.stringify({ agentId: grandchild.id, message: "hi", history: [], lang: "fa" }),
  });
  check("chat for an unowned agent is refused (403)", otherUser.status === 403, otherUser.body);

  // Leave the database as we found it (the rows this run created only).
  await prisma.providerConfig.deleteMany({ where: { id: providerId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { in: [email, adminEmail] } } }).catch(() => {});

  console.log("");
  if (failures.length > 0) {
    console.error(`smoke: ${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`);
  } else {
    console.log("smoke: all checks passed");
  }

  api.closeAllConnections?.();
  provider.closeAllConnections?.();
  api.close();
  provider.close();
  await prisma.$disconnect().catch(() => {});
  // Sockets and the Prisma pool can keep the loop alive; every check is done.
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
