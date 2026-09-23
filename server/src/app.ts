import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { env, isProd, providerKeySecret } from "./env.js";
import { registerAuthGuard } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { adminProviderRoutes } from "./routes/admin-provider.js";
import { walletRoutes } from "./routes/wallet.js";
import { agentsRoutes } from "./routes/agents.js";
import { chatRoutes } from "./routes/chat.js";
import { paymentRoutes } from "./routes/payments.js";

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
    } catch (err) {
      done(err as Error);
    }
  });

  registerAuthGuard(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(catalogRoutes, { prefix: "/api" });
  await app.register(adminProviderRoutes, { prefix: "/api/admin" });
  await app.register(walletRoutes, { prefix: "/api/wallet" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(chatRoutes, { prefix: "/api/chat" });
  await app.register(paymentRoutes, { prefix: "/api/payments" });

  return app;
}