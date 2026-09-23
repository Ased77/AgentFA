import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : /^(1|true|yes)$/i.test(v)));

/** Vercel (and shells) can define a variable as an empty string; treat that as
    "not set" so the default — or the error — applies. */
const blank = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), inner);

const schema = z.object({
  NODE_ENV: blank(z.enum(["development", "test", "production"]).default("development")),
  // 0 is allowed: Node then picks a free port (used by tooling and tests).
  PORT: blank(z.coerce.number().int().min(0).max(65_535).default(8787)),
  HOST: blank(z.string().default("0.0.0.0")),
  /** Pooled connection string used by the app at runtime. */
  DATABASE_URL: blank(z.string().min(1, "DATABASE_URL is required")),
  /** Direct (non-pooled) connection string, used only by `prisma migrate`. */
  DIRECT_URL: blank(z.string().optional()),
  /** Connections held per warm instance. Serverless platforms need this small. */
  DB_POOL_MAX: blank(z.coerce.number().int().positive().default(4)),
  /** Optional. Rate limiting falls back to Postgres when this is unset. */
  REDIS_URL: blank(z.string().optional()),
  /** Comma-separated origins. Empty (the default) means same-origin only. */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  PROVIDER_KEY_SECRET: blank(
    z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "PROVIDER_KEY_SECRET must be 64 hex chars (32 bytes)")
      .optional(),
  ),
  SESSION_COOKIE: blank(z.string().default("agentfa_session")),
  SESSION_TTL_DAYS: blank(z.coerce.number().int().positive().default(30)),
  PAYMENT_PROVIDER: blank(z.enum(["none", "zarinpal", "stripe"]).default("none")),
  /** Terminal id, for PSPs that issue one next to the merchant id. */
  PAYMENT_TERMINAL_ID: blank(z.string().optional()),
  /** Public URL of this API: gateway callbacks must reach it from outside. */
  PUBLIC_API_URL: blank(z.string().default("http://localhost:8787")),
  /** Public URL of the SPA: where the payer lands after paying. */
  PUBLIC_WEB_URL: blank(z.string().default("http://localhost:8443")),
  ZARINPAL_MERCHANT_ID: blank(z.string().optional()),
  ZARINPAL_SANDBOX: bool(false),
  /** Host override (tests, staging). Defaults to the Zarinpal host. */
  ZARINPAL_BASE_URL: blank(z.string().optional()),
  STRIPE_SECRET_KEY: blank(z.string().optional()),
  STRIPE_WEBHOOK_SECRET: blank(z.string().optional()),
  STRIPE_CURRENCY: blank(z.string().default("usd")),
  STRIPE_BASE_URL: blank(z.string().default("https://api.stripe.com")),
  /** SMS gateway for login codes. `none` logs the code instead of sending it. */
  SMS_PROVIDER: blank(z.enum(["none", "kavenegar"]).default("none")),
  KAVENEGAR_API_KEY: blank(z.string().optional()),
  KAVENEGAR_SENDER: blank(z.string().optional()),
  /** Verification template name; without it a plain SMS is sent instead. */
  KAVENEGAR_TEMPLATE: blank(z.string().optional()),
  /** Host override (tests, staging). Defaults to the Kavenegar API host. */
  KAVENEGAR_BASE_URL: blank(z.string().optional()),
  /** How long an SMS login code stays valid. */
  OTP_TTL_SECONDS: blank(z.coerce.number().int().positive().default(120)),
  /** Wrong guesses allowed for one code before it is burned. */
  OTP_MAX_ATTEMPTS: blank(z.coerce.number().int().positive().default(5)),
  /** Minimum seconds between two codes for the same number. */
  OTP_RESEND_SECONDS: blank(z.coerce.number().int().positive().default(30)),
  /** Pepper for hashed codes. Falls back to PROVIDER_KEY_SECRET when unset. */
  OTP_SECRET: blank(z.string().min(16).optional()),
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

let cached: Env | undefined;

/**
 * Validated lazily: importing a module must not throw just because a variable
 * is missing (tooling, tests), and when one is missing the error names it.
 */
export function currentEnv(): Env {
  return (cached ??= load());
}

/**
 * The provider-key encryption secret. Required wherever provider keys or
 * session cookies are handled, but not by database-only tooling (migrations,
 * content seed, Vercel build), which is why the schema keeps it optional.
 */
export function providerKeySecret(): string {
  const value = currentEnv().PROVIDER_KEY_SECRET;
  if (!value) {
    throw new Error("PROVIDER_KEY_SECRET is required (64 hex chars, 32 bytes)");
  }
  return value;
}

/**
 * Pepper for hashed login codes. Login is the one flow an attacker can reach
 * without an account, so the code hashes are keyed with a server secret rather
 * than stored as a plain digest of six digits (which is trivially reversible).
 */
export function otpSecret(): string {
  const value = currentEnv().OTP_SECRET ?? currentEnv().PROVIDER_KEY_SECRET;
  if (!value) {
    throw new Error("OTP_SECRET (or PROVIDER_KEY_SECRET) is required to hash login codes");
  }
  return value;
}

/** Test helper: forget the cached environment. */
export function resetEnv(): void {
  cached = undefined;
}

export const env: Env = new Proxy({} as Env, {
  get: (_target, prop) => currentEnv()[prop as keyof Env],
  has: (_target, prop) => prop in currentEnv(),
  ownKeys: () => Reflect.ownKeys(currentEnv()),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(currentEnv(), prop),
});

export const isProd = (): boolean => currentEnv().NODE_ENV === "production";