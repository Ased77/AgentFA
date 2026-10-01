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
 * production. A `vercel.json` rewrite is the supported way to send `/api/**` to
 * one function; do not reintroduce a bracketed catch-all.
 *
 * What that rewrite actually does was confirmed from the deployment logs rather
 * than assumed, because it decides whether Fastify can route at all: it keeps the
 * original path **and** appends the capture from its destination to the query
 * string. A request for `/api/auth/me` therefore arrived as
 * `/api/auth/me?__path=auth%2Fme`. The path needed no repair, but that stray
 * parameter had to go — it would otherwise land in `request.query` on every
 * route.
 *
 * The SPA and this function ship as one Vercel project, so the browser only ever
 * talks to its own origin: first-party cookies, no CORS, and the existing static
 * deploy keeps working. The Fastify instance is created once per warm instance
 * (Fluid compute) and reused across invocations.
 */
const holder = globalThis as unknown as { __agentfaApp?: Promise<FastifyInstance> };

/** The rewrite's destination; seeing this path means it had to be rebuilt. */
const REWRITE_DESTINATION = "/api/index";

/** Reserved parameter the rewrite uses to carry its capture — never a real one. */
const CAPTURE_PARAM = "__path";

/** A substituted capture looks like a path. An unsubstituted `$1` does not. */
const looksLikePath = (value: string): boolean => /^[\w\-./%~]*$/.test(value);

/**
 * Undo the rewrite's effect on the URL Fastify will route on.
 *
 * Two things can be true when a request arrives, and both are handled here:
 * Vercel keeps the original path (the observed behaviour) or it hands over the
 * destination, in which case the captured path has to be put back. Either way the
 * capture parameter is removed, because it exists only to make this possible.
 */
function restoreOriginalUrl(req: IncomingMessage): void {
  const raw = req.url ?? "/";
  const queryAt = raw.indexOf("?");
  if (queryAt === -1) return;

  const pathname = raw.slice(0, queryAt);
  const params = new URLSearchParams(raw.slice(queryAt + 1));
  if (!params.has(CAPTURE_PARAM)) return;

  const captured = params.get(CAPTURE_PARAM) ?? "";
  params.delete(CAPTURE_PARAM);

  const path =
    pathname === REWRITE_DESTINATION && looksLikePath(captured)
      ? `/api/${captured.replace(/^\/+/, "")}`
      : pathname;

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
  restoreOriginalUrl(req);
  // TEMPORARY VERIFICATION — removed in the next commit. The function crashes on
  // the missing database before Fastify routes anything, so this is the only way
  // to confirm what URL the rewrite actually hands us.
  console.log(`[api] ${req.method} ${req.url}`);
  const instance = await getApp();
  // Hand the raw Node request/response to Fastify rather than adding a proxy
  // layer, so the SSE frames written by the chat route reach the client as they
  // are produced.
  instance.server.emit("request", req, res);
}
