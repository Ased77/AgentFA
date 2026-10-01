# Third-party notices

The storefront is licensed under the MIT license in the repository root
([`../LICENSE`](../LICENSE)). It redistributes the works below; the ones whose
licenses require their text to travel with the distributed material have it
vendored in [`licenses/`](./licenses).

## Vazirmatn (font)

- **Used for:** every glyph in the UI. Bundled and self-hosted rather than fetched
  from a font CDN, so the built site ships the woff2 files under `dist/assets/`.
- **License:** SIL Open Font License 1.1 — `licenses/Vazirmatn-OFL-1.1.txt`
- **Copyright:** 2015 The Vazirmatn Project Authors (<https://github.com/rastikerdar/vazirmatn>)
- **Package:** `@fontsource/vazirmatn` (OFL-1.1) — the packaging of the same font.

The OFL permits redistribution (including bundled in a web app) provided the
license accompanies the font and the font itself is not sold on its own, which is
why the full text is kept in the repository.

## Lucide (icons)

- **Used for:** every icon in the interface, via `lucide-react`. ISC requires the
  copyright notice and permission notice to appear in all copies, so the text is
  vendored.
- **License:** ISC — `licenses/Lucide-ISC.txt`
- **Package:** `lucide-react` (ISC)

## React, React DOM, React Router

- **Used for:** the UI runtime, routing and lazy page loading.
- **License:** MIT — `licenses/React-MIT.txt` (representative text; each package
  ships the same MIT terms in its own `LICENSE`).
- **Packages:** `react`, `react-dom` (MIT), `react-router-dom` (MIT)

## Recharts

- **Used for:** the usage chart on the account and admin pages.
- **License:** MIT
- **Package:** `recharts` (MIT)

## Tailwind CSS

- **Used for:** styling, through `@tailwindcss/vite`. The compiled utilities are
  emitted into the built stylesheet.
- **License:** MIT
- **Packages:** `tailwindcss`, `@tailwindcss/vite` (MIT)

## Agent copy and personas

- **Used for:** the agent names, descriptions, categories and persona bodies shown
  in the marketplace and fed to the model during chat.
- **License:** MIT — the same license as this repository ([`../LICENSE`](../LICENSE)).
- **Source:** the agent corpus in the repository root, compiled by
  `bun run export:server-content` into `server/content/seed.json`.

The datastore that backs the API is Postgres via Prisma (Apache-2.0) and the API
itself is Fastify (MIT) and zod (MIT); those are not redistributed in the built
site, so their texts are not duplicated here. See `../server/README.md`.
