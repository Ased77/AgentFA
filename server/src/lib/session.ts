import { randomBytes, createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { env, isProd } from "../env.js";

export type SessionUser = {
  id: string;
  email: string;
  role: "user" | "admin";
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd() || env.COOKIE_SECURE,
    path: "/",
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

/** Issue a session token for a user and set the cookie. */
export async function startSession(
  reply: FastifyReply,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  reply.setCookie(env.SESSION_COOKIE, token, cookieOptions());
  return token;
}

/** Resolve the request's session user, or null. Expired rows are ignored. */
export async function readSession(req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies?.[env.SESSION_COOKIE];
  if (!token) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  return { id: row.user.id, email: row.user.email, role: row.user.role };
}

/** Delete the current session and clear the cookie. */
export async function endSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies?.[env.SESSION_COOKIE];
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => {});
  }
  reply.clearCookie(env.SESSION_COOKIE, { path: "/" });
}