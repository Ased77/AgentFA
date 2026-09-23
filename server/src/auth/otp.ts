import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { currentEnv, otpSecret } from "../env.js";
import { HttpError, badRequest, tooMany, unauthorized } from "../lib/errors.js";
import { enforceLimit } from "../lib/limiter.js";
import { maskPhone, normalizePhone } from "../lib/phone.js";
import { activeSmsGateway, devCodeEnabled, loggingGateway } from "../sms/index.js";
import type { SmsGateway } from "../sms/types.js";

/**
 * SMS login codes.
 *
 * Design rules, in the order they matter:
 *
 *  1. The code is never stored in the clear. It is hashed with HMAC-SHA256 keyed
 *     by a server secret *and* bound to the phone number, so a leaked row cannot
 *     be replayed for a different number — and six digits are not reversible the
 *     way an unkeyed digest would be.
 *  2. One live code per number. Requesting a new code retires the previous one,
 *     so an old SMS stops working the moment the user asks again.
 *  3. Guessing is bounded: five wrong attempts burn the code, and both endpoints
 *     are rate limited per number *and* per IP, because an attacker controls
 *     neither.
 *  4. Verification is constant-time, and a consumed code can never be replayed.
 */

export const CODE_LENGTH = 6;

/** A six-digit code from the CSPRNG, zero-padded (`"004213"` is valid). */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Keyed digest of `phone + code`. The phone binding is deliberate. */
export function hashCode(phone: string, code: string, secret = otpSecret()): string {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

/** Constant-time comparison, tolerant of a malformed stored hash. */
export function codeMatches(
  storedHash: string,
  phone: string,
  code: string,
  secret = otpSecret(),
): boolean {
  const expected = Buffer.from(hashCode(phone, code, secret));
  const stored = Buffer.from(storedHash);
  if (expected.length !== stored.length) return false;
  return timingSafeEqual(expected, stored);
}

/** True while a challenge row can still be used. */
export function isUsable(
  row: { expiresAt: Date; consumedAt: Date | null; attempts: number },
  now = Date.now(),
  maxAttempts = currentEnv().OTP_MAX_ATTEMPTS,
): boolean {
  return row.consumedAt === null && row.expiresAt.getTime() > now && row.attempts < maxAttempts;
}

export type ChallengeStart = {
  phone: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Present only in development with no provider configured. */
  devCode?: string;
};

/** Where the code goes: the configured gateway, or the development logger. */
export function gatewayFor(log: (line: string) => void): SmsGateway | null {
  return activeSmsGateway() ?? (devCodeEnabled() ? loggingGateway(log) : null);
}

/**
 * Send a fresh code, replacing any live one.
 *
 * Throws:
 *  - 400 `phone_required` / `invalid_phone` when the number is not a usable
 *    Iranian mobile;
 *  - 429 when the number or the IP is asking too often (the resend cooldown and
 *    the hourly ceiling are one limiter at two window sizes);
 *  - 503 `sms_not_configured` when production has no provider — login is
 *    impossible rather than silently insecure;
 *  - 502 `sms_failed` when the provider rejects the message, with the pending
 *    code removed first so nobody is told to wait for an SMS that never went out.
 */
export async function startChallenge(input: {
  phone: string;
  ip?: string;
  log?: (line: string) => void;
}): Promise<ChallengeStart> {
  const { phone } = input;
  const env = currentEnv();
  const log = input.log ?? (() => {});

  await enforceLimit(`otp:start:phone:${phone}`, [
    { windowSeconds: env.OTP_RESEND_SECONDS, max: 1 },
    { windowSeconds: 3600, max: 6 },
  ]);
  if (input.ip) {
    await enforceLimit(`otp:start:ip:${input.ip}`, [{ windowSeconds: 3600, max: 30 }]);
  }

  const gateway = gatewayFor(log);
  if (!gateway) throw new HttpError(503, "sms_not_configured");

  const code = generateCode();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  // One live code per number: retire anything still pending.
  await prisma.loginCode.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const challenge = await prisma.loginCode.create({
    data: { phone, codeHash: hashCode(phone, code), expiresAt, ip: input.ip ?? null },
  });

  const result = await gateway.send({
    phone,
    code,
    text: `کد ورود ایجنت‌فا: ${code}\nAgentFa login code: ${code}`,
  });

  if (!result.ok) {
    await prisma.loginCode.delete({ where: { id: challenge.id } }).catch(() => {});
    log(`sms send failed for ${maskPhone(phone)}: ${result.reason} (${gateway.label})`);
    throw new HttpError(502, "sms_failed", { reason: result.reason });
  }

  return {
    phone,
    expiresInSeconds: env.OTP_TTL_SECONDS,
    resendInSeconds: env.OTP_RESEND_SECONDS,
    ...(devCodeEnabled() ? { devCode: code } : {}),
  };
}

export type VerifyOutcome =
  | { ok: true; userId: string; isNewUser: boolean }
  | { ok: false; reason: "invalid_code" | "code_expired" | "too_many_attempts" };

/**
 * Check a code and resolve the account it unlocks.
 *
 * The account is created here, not when the code is requested, so asking for a
 * code against somebody else's number leaves no trace — and signup and login are
 * the same flow, which is why a first-time visitor and a returning user see an
 * identical screen.
 */
export async function consumeChallenge(input: {
  phone: string;
  code: string;
  ip?: string;
  log?: (line: string) => void;
}): Promise<VerifyOutcome> {
  const { phone } = input;
  const env = currentEnv();
  const log = input.log ?? (() => {});
  // Autofill sometimes carries spaces or a stray non-breaking character.
  const digits = input.code.replace(/\D/g, "");

  if (input.ip) {
    await enforceLimit(`otp:verify:ip:${input.ip}`, [{ windowSeconds: 3600, max: 60 }]);
  }
  await enforceLimit(`otp:verify:phone:${phone}`, [{ windowSeconds: 3600, max: 30 }]);

  const row = await prisma.loginCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, reason: "code_expired" };

  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.loginCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return { ok: false, reason: "code_expired" };
  }
  if (row.attempts >= env.OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  if (digits.length !== CODE_LENGTH || !codeMatches(row.codeHash, phone, digits)) {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= env.OTP_MAX_ATTEMPTS;
    await prisma.loginCode.update({
      where: { id: row.id },
      data: { attempts, ...(exhausted ? { consumedAt: new Date() } : {}) },
    });
    log(`wrong login code for ${maskPhone(phone)} (attempt ${attempts}/${env.OTP_MAX_ATTEMPTS})`);
    return { ok: false, reason: exhausted ? "too_many_attempts" : "invalid_code" };
  }

  // Single use: the code dies here, before the session exists.
  await prisma.loginCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });

  const { userId, isNewUser } = await findOrCreateUser(phone);
  return { ok: true, userId, isNewUser };
}

/**
 * Resolve the account behind a verified number, creating it on first login.
 *
 * The wallet is created with the schema defaults (the 50 000-token gift), so a
 * brand-new account lands with the balance the marketing site promises. A
 * unique-constraint race (two tabs verifying at once) resolves by re-reading the
 * row the other request created.
 */
export async function findOrCreateUser(
  phone: string,
): Promise<{ userId: string; isNewUser: boolean }> {
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) return { userId: existing.id, isNewUser: false };

  try {
    const created = await prisma.user.create({ data: { phone, wallet: { create: {} } } });
    return { userId: created.id, isNewUser: true };
  } catch {
    const raced = await prisma.user.findUnique({ where: { phone } });
    if (raced) return { userId: raced.id, isNewUser: false };
    throw new Error("could not create the user for a verified phone number");
  }
}

/** Route-level input parsing: normalize, or 400 with a specific reason. */
export function requirePhone(input: unknown): string {
  const result = normalizePhone(String(input ?? ""));
  if (!result.ok) throw badRequest(result.reason === "empty" ? "phone_required" : "invalid_phone");
  return result.phone;
}

/** Map a failed verification onto the error its route should return. */
export function verificationError(reason: Exclude<VerifyOutcome, { ok: true }>["reason"]) {
  if (reason === "too_many_attempts") return tooMany("too_many_attempts");
  return unauthorized(reason);
}
