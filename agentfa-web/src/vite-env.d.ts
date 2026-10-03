/// <reference types="vite/client" />

/**
 * The commit the running bundle was built from, injected by `define` in
 * `vite.config.ts` (`dev` outside a Vercel build). Attached to every crash
 * report, because a stack without a build is a stack you cannot place.
 */
declare const __RELEASE__: string;
