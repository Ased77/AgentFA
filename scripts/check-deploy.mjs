#!/usr/bin/env node
/**
 * Verifies a *deployed* AgentFa instance from the outside.
 *
 * This exists because the site failed silently for ten days: the build was red
 * on every commit, `/api/**` never reached the function that serves it, and
 * nothing anywhere noticed. Checking the repository cannot catch either of
 * those — both are properties of the running deployment — so this script talks
 * to a real URL over HTTP and asserts what a user (and a crawler) would see.
 *
 * Usage:
 *   node scripts/check-deploy.mjs                        # production
 *   node scripts/check-deploy.mjs https://example.com    # any deployment
 *   DEPLOY_URL=https://example.com node scripts/check-deploy.mjs
 *
 * Exit code is 0 only when every check passes, so a scheduled run in CI fails
 * loudly instead of reporting a green build over a dead API.
 *
 * The distinction that matters most here is *edge* failures versus *function*
 * failures. Vercel's edge answers `NOT_FOUND` when no route matches, which looks
 * identical to an API route that does not exist unless you check
 * `x-vercel-error`. Reading that difference wrong is exactly how
 * `/api/auth/me` stayed a 404 for a month while `/api/health` looked healthy, so
 * both the nested-path checks and the health checks report which layer answered.
 */

const DEFAULT_BASE = "https://agent-fa-three.vercel.app";

const base = (process.argv[2] ?? process.env.DEPLOY_URL ?? DEFAULT_BASE).replace(/\/+$/, "");

/** Where the Fastify app answers when it boots but the environment is wrong. */
const ENV_HINT =
  "the function booted and crashed — this is configuration, not routing: " +
  "check DATABASE_URL on the Vercel project";

const results = [];

async function probe(path, init) {
  const response = await fetch(`${base}${path}`, { redirect: "manual", ...init });
  const text = await response.text().catch(() => "");
  return { status: response.status, headers: response.headers, text };
}

/**
 * Which layer answered: `edge` (no route matched, so this path is not wired up),
 * `crash` (the function ran and threw), or `app` (the function answered).
 */
function layer(res) {
  const edgeError = res.headers.get("x-vercel-error");
  if (res.status === 500 || edgeError === "FUNCTION_INVOCATION_FAILED") return "crash";
  if (res.status === 404 && (edgeError === "NOT_FOUND" || /NOT_FOUND/.test(res.text))) return "edge";
  return "app";
}

/** Detail shown next to a failure so the cause is named, not guessed. */
function describe(res) {
  const edgeError = res.headers.get("x-vercel-error");
  const body = res.text.replace(/\s+/g, " ").trim().slice(0, 120);
  return `${res.status}${edgeError ? ` ${edgeError}` : ""}${body ? ` — ${body}` : ""}`;
}

async function check(name, run) {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail: detail ?? "ok" });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// --- The SPA itself -------------------------------------------------------

await check("the app shell is served at /", async () => {
  const res = await probe("/");
  expect(res.status === 200, `GET / answered ${describe(res)}`);
  expect(res.text.includes('id="root"'), "GET / did not return the SPA shell");
  const noindex = /name="robots"[^>]*content="[^"]*noindex/i.test(res.text);
  expect(!noindex, "the shell is served with `noindex` — the public site is hidden from search engines");
  expect(/rel="icon"/i.test(res.text), 'the shell has no <link rel="icon"> — no favicon');
  expect(/property="og:image"/i.test(res.text), "the shell has no og:image — shared links render as bare text");
  return `${res.text.length} bytes, metadata present`;
});

await check("a client route is served", async () => {
  const res = await probe("/pricing");
  expect(res.status === 200, `GET /pricing answered ${describe(res)}`);
  expect(res.text.includes('id="root"'), "GET /pricing did not return the SPA shell");
});

await check("an unknown path is a real 404", async () => {
  const res = await probe("/this-route-does-not-exist");
  expect(
    res.status === 404,
    `expected 404, got ${describe(res)} — every URL returning 200 makes the site unmonitorable and hides broken links`,
  );
});

// --- Routing: every /api path must reach the function ---------------------

await check("nested /api/* paths reach the function", async () => {
  // The canary. A bracketed catch-all in `api/` only ever matched one segment,
  // so this path used to be answered by the edge while `/api/health` worked.
  const res = await probe("/api/auth/me");
  expect(
    layer(res) !== "edge",
    `${describe(res)} — the Vercel edge answered, so /api/** is not routed to the function`,
  );
  expect(
    layer(res) === "app",
    `${describe(res)} — reached the function but it crashed (${ENV_HINT})`,
  );
  expect(
    res.status === 401 || res.status === 200,
    `expected 401 from the session probe, got ${describe(res)}`,
  );
  return "401 session probe from the app";
});

await check("single-segment /api/* paths still reach the function", async () => {
  const res = await probe("/api/health");
  expect(layer(res) !== "edge", `${describe(res)} — the edge answered for /api/health`);
  return "reached the function";
});

await check("POST with a body reaches the function", async () => {
  const res = await probe("/api/auth/otp/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "not-a-number" }),
  });
  expect(layer(res) !== "edge", `${describe(res)} — the edge answered a POST`);
  expect(
    [400, 422, 429].includes(res.status),
    `expected a validation error for an invalid phone, got ${describe(res)}`,
  );
  return `${res.status} validation error`;
});

// --- Environment ----------------------------------------------------------

await check("the API is healthy", async () => {
  const res = await probe("/api/health");
  expect(res.status === 200, `GET /api/health answered ${describe(res)} (${ENV_HINT})`);
  const body = JSON.parse(res.text);
  expect(body.status === "ok", `health reported ${JSON.stringify(body.checks ?? body)}`);
  return JSON.stringify(body.checks);
});

await check("pricing is served by the API", async () => {
  const res = await probe("/api/pricing");
  expect(res.status === 200, `GET /api/pricing answered ${describe(res)} (${ENV_HINT})`);
  const body = JSON.parse(res.text);
  expect(body.plans, "the pricing payload has no plans");
  return `${body.plans.length} plans`;
});

// --- Crawlers and delivery ------------------------------------------------

await check("robots.txt allows crawling", async () => {
  const res = await probe("/robots.txt");
  expect(res.status === 200, `GET /robots.txt answered ${describe(res)}`);
  expect(
    !/^\s*disallow:\s*\/\s*$/im.test(res.text),
    "robots.txt disallows the whole site",
  );
  expect(/sitemap:/i.test(res.text), "robots.txt does not point at a sitemap");
  return res.text.replace(/\s+/g, " ").trim().slice(0, 80);
});

await check("a sitemap is published", async () => {
  const res = await probe("/sitemap.xml");
  expect(res.status === 200, `GET /sitemap.xml answered ${describe(res)}`);
  expect(res.text.includes("<urlset"), "GET /sitemap.xml is not XML");
  const urls = res.text.match(/<loc>/g)?.length ?? 0;
  expect(urls > 0, "the sitemap lists no URLs");
  return `${urls} URLs`;
});

await check("hashed assets are cached immutably", async () => {
  const home = await probe("/");
  const asset = home.text.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
  expect(asset, "the shell references no hashed asset to check");
  const res = await probe(asset, { method: "HEAD" });
  expect(res.status === 200, `HEAD ${asset} answered ${describe(res)}`);
  const cache = res.headers.get("cache-control") ?? "";
  expect(
    cache.includes("immutable"),
    `${asset} is served with \`${cache}\` — hashed filenames can never change, so they should be immutable`,
  );
  return cache;
});

await check("security headers are set", async () => {
  const res = await probe("/");
  const missing = ["content-security-policy", "x-content-type-options", "x-frame-options"].filter(
    (header) => !res.headers.get(header),
  );
  expect(missing.length === 0, `missing headers: ${missing.join(", ")}`);
  return "csp, nosniff, frame-ancestors";
});

// --- Report ---------------------------------------------------------------

const failed = results.filter((result) => !result.ok);
const width = Math.max(...results.map((result) => result.name.length));

console.log(`\nChecking ${base}\n`);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name.padEnd(width)}  ${result.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);

if (failed.length > 0) {
  console.error(
    `${failed.length} check(s) failed against ${base}. A deployment is not healthy just because it built.`,
  );
  process.exit(1);
}
