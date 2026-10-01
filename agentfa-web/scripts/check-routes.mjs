// Fails when a client route has no matching rewrite in the root `vercel.json`.
//
// The deploy deliberately does *not* rewrite every path to the SPA any more.
// A blanket `/((?!api/).*)` rewrite meant every unknown URL returned the app
// shell with a 200, so a typo, a deleted page and a working page were
// indistinguishable to a crawler — and to the uptime check. The cost of that fix
// is that each client route needs an explicit entry, and a route added without
// one would 404 in production while working perfectly in `vite dev`. This check
// is what makes that impossible to miss.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '..')

const routes = readFileSync(path.join(root, 'src/routes.tsx'), 'utf8')
const config = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'))

/** `path: "marketplace"` inside the router, ignoring the catch-all. */
const declared = [...routes.matchAll(/path: "([^"]+)"/g)]
  .map((match) => match[1])
  .filter((route) => route !== '*')

const sources = new Set((config.rewrites ?? []).map((rewrite) => rewrite.source))

/**
 * A static route needs an exact rewrite; a parameterised one (`agent/:slug`)
 * needs a prefix rewrite, because the value cannot be enumerated at build time.
 */
function expectedSource(route) {
  const normalized = route.startsWith('/') ? route : `/${route}`
  const [first] = normalized.slice(1).split('/')
  return normalized.includes('/:') ? `/${first}/(.*)` : normalized
}

const missing = []
for (const route of declared) {
  // `/` needs no rewrite: Vercel serves the output directory's index.html for it.
  if (route === '/') continue
  const source = expectedSource(route)
  if (!sources.has(source)) missing.push(`${route} -> { "source": "${source}" }`)
}

if (missing.length > 0) {
  console.error('Client routes missing from vercel.json rewrites:')
  for (const entry of missing) console.error(`  ${entry}`)
  console.error('\nAdd them to `rewrites` in vercel.json, or the route will 404 in production.')
  process.exit(1)
}

console.log(`routes OK — ${declared.length - 1} client routes are routed in vercel.json.`)
