/**
 * `/api` itself. Everything nested under it is served by `api/[...path].ts`;
 * both entries re-export the one implementation in `_handler.ts`.
 */
export { default } from "./_handler";
