import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { env, isProd, providerKeySecret } from "./env.js";
import { registerAuthGuard } from "./plugins/auth.js";
import { badRequest } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { pricingRoutes } from "./routes/pricing.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";
import { adminProviderRoutes } from "./routes/admin-provider.js";
import { walletRoutes } from "./routes/wallet.js";
import { agentsRoutes } from "./routes/agents.js";
import { chatRoutes } from "./routes/chat.js";
import { paymentRoutes } from "./routes/payments.js";
import { clientErrorRoutes } from "./routes/client-errors.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProd() ? { level: "info" } : { level: "debug" },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // A same-origin deployment (SPA and API in one Vercel project) needs no CORS
  // at all. Only register it when explicit origins are configured.
  if (env.CORS_ORIGINS.length > 0) {
    await app.register(cors, {
      origin: env.CORS_ORIGINS,
      credentials: true,
    });
  }

  await app.register(cookie, {
    secret: providerKeySecret(),
    hook: "onRequest",
  });

  // Endpoints that take no input (purchase, logout) are still called with
  // `Content-Type: application/json` and no body. Fastify's default JSON
  // parser rejects that combination, so treat an empty body as `{}`.
  // The raw bytes are kept as well: payment webhooks are signed over them, and
  // re-serialising the parsed object would invalidate every signature.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const text = typeof body === "string" ? body : "";
    req.rawBody = text;
    const trimmed = text.trim();
    if (!trimmed) return done(null, {});
    try {
      done(null, JSON.parse(trimmed));
    } catch {
      // A body that is not JSON is the caller's mistake, not ours. Handing
      // Fastify the bare `SyntaxError` made it answer 500, which misreports a
      // bad request as a server failure — and a 5xx is what the client-side
      // error reporter forwards, so it would have shown up as a crash that
      // never happened.
      done(badRequest("invalid_json"));
    }
  });

  registerAuthGuard(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(catalogRoutes, { prefix: "/api" });
  await app.register(pricingRoutes, { prefix: "/api" });
  await app.register(accountRoutes, { prefix: "/api/account" });
  await app.register(adminProviderRoutes, { prefix: "/api/admin" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(walletRoutes, { prefix: "/api/wallet" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(chatRoutes, { prefix: "/api/chat" });
  await app.register(paymentRoutes, { prefix: "/api/payments" });
  // Registered without a prefix: it owns both `/api/client-errors` (public) and
  // `/api/admin/client-errors` (admin), and those two do not share a prefix.
  await app.register(clientErrorRoutes);

  return app;
}