/**
 * Every nested API path: `/api/health`, `/api/auth/me`, `/api/chat/stream`, …
 *
 * A file in `api/` is only exposed at its own path, so without this catch-all
 * `api/index.ts` answered `/api` and nothing else: the SPA's every call to its
 * own backend 404'd at the edge, where the static rewrite could not help it.
 *
 * A dynamic segment is used rather than a `vercel.json` rewrite so the original
 * path reaches Fastify intact — the routes are matched on it.
 */
export { default } from "./_handler";
