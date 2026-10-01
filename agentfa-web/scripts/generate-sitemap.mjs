// Writes `dist/sitemap.xml` after the build.
//
// The agent pages are the whole point of this site for search: 264 distinct
// pages, each with its own title and description, and until now not one of them
// was discoverable — there was no sitemap at all and `robots.txt` disallowed
// everything. The routes listed here are the public ones on purpose: `/chat`,
// `/account`, `/admin` and `/dashboard` are per-user or behind a login, and
// offering them to a crawler would only produce redirect chains.
//
// Slugs are read out of the generated catalog as text rather than imported: the
// catalog module is 6,000+ lines of data, and importing it here would make this
// script's own runtime depend on the app's module graph for no benefit.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const site = JSON.parse(readFileSync(path.join(root, 'site.config.json'), 'utf8'))
const origin = String(site.url ?? '').replace(/\/+$/, '')
if (!origin) {
  console.error('site.config.json has no "url": a sitemap needs absolute URLs.')
  process.exit(1)
}

const PUBLIC_ROUTES = ['/', '/marketplace', '/pricing', '/terms', '/privacy', '/contact']

const catalog = readFileSync(path.join(root, 'src/data/catalog.generated.ts'), 'utf8')

/** Slugs inside one exported array of the catalog module. */
function slugsBetween(startMarker, endMarker) {
  const from = catalog.indexOf(startMarker)
  if (from < 0) return null
  const to = catalog.indexOf(endMarker, from)
  const slice = catalog.slice(from, to === -1 ? undefined : to)
  return [...slice.matchAll(/^\s*"slug": "([a-z0-9-]+)"/gm)].map((match) => match[1])
}

// Scoped to the agents array on purpose. Reading the whole file also collects
// the 18 division slugs that follow it, which would publish `/agent/design` and
// seventeen other URLs that do not exist.
const slugs = slugsBetween('export const catalog', 'export const divisions')
const divisionSlugs = slugsBetween('export const divisions', 'export const catalogCount') ?? []

if (!slugs || slugs.length === 0) {
  console.error('No agent slugs found in src/data/catalog.generated.ts — has the catalog format changed?')
  process.exit(1)
}

const published = new Set(divisionSlugs)
const crossed = slugs.filter((slug) => published.has(slug))
if (crossed.length > 0) {
  console.error(`Sitemap would publish division slugs as agents: ${crossed.join(', ')}`)
  process.exit(1)
}

const urls = [...PUBLIC_ROUTES, ...slugs.map((slug) => `/agent/${slug}`)]
const entries = urls.map((url) => `  <url><loc>${origin}${url}</loc></url>`).join('\n')
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`

const target = path.join(root, 'dist', 'sitemap.xml')
writeFileSync(target, xml)
console.log(`sitemap.xml: ${urls.length} URLs (${slugs.length} agent pages, ${divisionSlugs.length} divisions excluded)`)
