import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

/**
 * Vercel Function entry point for the whole API — `/api` and every nested path
 * beneath it.
 *
 * There is deliberately **no** `api/[...path].ts`. In a plain (non-Next) Vercel
 * project that "catch-all" only matches a *single* path segment: `/api/auth`
 * reached the function while `/api/auth/me` was answered by the edge with
 * `NOT_FOUND`, because a filesystem route cannot express a nested catch-all
 * here. The comment that used to sit in that file claimed the opposite, which is
 * why the API looked wired up while two thirds of its routes 404'd in
 * production. A `vercel.json` rewrite (see the root `vercel.json`) is the
 * supported way to send `/api/**` to one function; do not reintroduce a
 * bracketed catch-all.
 *
 * The SPA and this function ship as one Vercel project, so the browser only ever
 * talks to its own origin: first-party cookies, no CORS, and the existing static
 * deploy keeps working. The Fastify instance is created once per warm instance
 * (Fluid compute) and reused across invocations.
 */
const holder = globalThis as unknown as { __agentfaApp?: Promise<FastifyInstance> };

/** The rewrite's destination; seeing this path means our own rewrite ran. */
const REWRITE_DESTINATION = "/api/index";

/** The capture is passed through the query string by `vercel.json`. */
const CAPTURE_PARAM = "__path";

/** A substituted capture looks like a path. An unsubstituted `$1` does not. */
const looksLikePath = (value: string): boolean => /^[\w\-./%~]*$/.test(value);

/**
 * Give Fastify the path it must route on.
 *
 * A rewrite replaces the request path with its destination, so `req.url` may
 * arrive as `/api/index?__path=auth/me` instead of `/api/auth/me`. Fastify
 * matches routes on `req.url`, so the original path has to be put back. When
 * Vercel keeps the original path instead, `req.url` is already correct and this
 * does nothing — both behaviours are handled, which is why the routing contract
 * is asserted by `scripts/check-deploy.mjs` rather than assumed.
 */
function restoreOriginalPath(req: IncomingMessage): void {
  const raw = req.url ?? "/";
  const queryAt = raw.indexOf("?");
  const pathname = queryAt === -1 ? raw : raw.slice(0, queryAt);
  if (pathname !== REWRITE_DESTINATION) return;

  const params = new URLSearchParams(queryAt === -1 ? "" : raw.slice(queryAt + 1));
  const captured = params.get(CAPTURE_PARAM);
  // An unsubstituted capture (`$1`) leaves the destination path as the only
  // signal we have, and guessing from it would be worse than failing loudly.
  if (captured === null || !looksLikePath(captured)) return;

  params.delete(CAPTURE_PARAM);
  const path = `/api/${captured.replace(/^\/+/, "")}`;
  const query = params.toString();
  req.url = query ? `${path}?${query}` : path;
}

async function getApp(): Promise<FastifyInstance> {
  const existing = holder.__agentfaApp;
  if (existing) return existing;

  const boot = (async () => {
    // Imported at request time: the compiled server is a separate ESM package.
    const { buildApp } = await import("../server/dist/app.js");
    const instance = await buildApp();
    await instance.ready();
    return instance;
  })();

  holder.__agentfaApp = boot;
  boot.catch(() => {
    // Never cache a failed boot: the next invocation may succeed.
    holder.__agentfaApp = undefined;
  });
  return boot;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  restoreOriginalPath(req);
  // TEMPORARY VERIFICATION — removed in the next commit. The function crashes on
  // the missing database before Fastify routes anything, so this is the only way
  // to confirm what path the rewrite actually hands us.
  console.log(`[api] ${req.method} ${req.url}`);
  const instance = await getApp();
  // Hand the raw Node request/response to Fastify rather than adding a proxy
  // layer, so the SSE frames written by the chat route reach the client as they
  // are produced.
  instance.server.emit("request", req, res);
}
