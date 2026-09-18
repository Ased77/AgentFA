import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : /^(1|true|yes)$/i.test(v)));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:8443")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  PROVIDER_KEY_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "PROVIDER_KEY_SECRET must be 64 hex chars (32 bytes)"),
  SESSION_COOKIE: z.string().default("agentfa_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PAYMENT_PROVIDER: z.enum(["none", "zarinpal", "stripe"]).default("none"),
  ZARINPAL_MERCHANT_ID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  COOKIE_SECURE: bool(false),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();

export const isProd = env.NODE_ENV === "production";