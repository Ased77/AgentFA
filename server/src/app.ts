import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env, isProd } from "./env.js";
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
    logger: isProd ? { level: "info" } : { level: "debug" },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.PROVIDER_KEY_SECRET,
    hook: "onRequest",
  });

  await app.register(rateLimit, {
    global: false,
    max: 200,
    timeWindow: "1 minute",
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