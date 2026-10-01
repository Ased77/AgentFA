/**
 * Every nested API path: `/api/health`, `/api/auth/me`, `/api/chat/stream`, …
 *
 * A file in `api/` is exposed only at its own path, so without this catch-all
 * `api/index.ts` answered `/api` and nothing else: the SPA's every call to its
 * own backend 404'd at the edge, where the static rewrite could not help it.
 *
 * A dynamic segment is used rather than a `vercel.json` rewrite so the original
 * path reaches Fastify intact — the routes are matched on it.
 *
 * The implementation lives in `api/index.ts` and is re-exported here; the `.js`
 * specifier is required because the compiled output is ESM and Vercel does not
 * rewrite import specifiers.
 */
export { default } from "./index.js";
