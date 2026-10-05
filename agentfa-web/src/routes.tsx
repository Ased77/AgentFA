import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import {
  createBrowserRouter,
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom"
import {
  Bot,
  Check,
  ChevronDown,
  Languages,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  X,
} from "lucide-react"
import type { Agent, CatalogDivision } from "./data/agents"
// The featured list and the 18 division rows are small and belong to the landing
// page; the full catalog is fetched on demand by the routes that need all 264 agents.
import { featuredAgents } from "./data/featured.generated"
import { divisions as divisionCatalog } from "./data/divisions.generated"
import { useCatalog } from "./data/useCatalog"
import { useI18n } from "./lib/i18n"
import { useSession } from "./lib/session"
import { useEntitlements } from "./lib/useEntitlements"
import {
  api,
  ApiError,
  goToGateway,
  type TransactionRow,
  type UsagePoint,
  type WalletSnapshot,
} from "./lib/account"
import { AgentCard } from "./components/AgentCard"
import { Breadcrumbs, type Crumb } from "./components/Breadcrumbs"
import { DivisionIcon } from "./components/DivisionIcon"
import { EmptyState } from "./components/EmptyState"
import { FilterChip } from "./components/FilterChip"
import { ForwardArrow } from "./components/ForwardArrow"
import { Modal } from "./components/Modal"
import { SectionHead } from "./components/SectionHead"
import { CatalogSkeleton } from "./components/Skeleton"
import Legal from "./pages/Legal"
import NotFound from "./pages/NotFound"

// Everything except the landing/marketplace/detail/ dashboard surface is split
// out: the initial bundle used to carry Admin, Chat, Login and Pricing whether or
// not they were ever opened.
const Admin = lazy(() => import("./pages/Admin"))
const Chat = lazy(() => import("./pages/Chat"))
const Login = lazy(() => import("./pages/Login"))
const Pricing = lazy(() => import("./pages/Pricing"))
const Account = lazy(() => import("./pages/Account"))
const PaymentReturn = lazy(() => import("./pages/PaymentReturn"))

function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "fa" ? "en" : "fa")}
      className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-brand-border hover:text-ink"
      title={t("nav.lang")}
      aria-label={t("nav.lang")}
    >
      <Languages size={14} />
      <span className="text-xs font-medium">{lang === "fa" ? "FA" : "EN"}</span>
    </button>
  )
}

function Shell() {
  const { pathname, hash } = useLocation()
  const { t } = useI18n()
  const { user, logout } = useSession()
  const [menu, setMenu] = useState(false)
  // A menu left open across a navigation is a bug, so follow the route.
  useEffect(() => setMenu(false), [pathname])
  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menu])
  useEffect(() => {
    // Order matters: `/agent` must not be caught by `/account`.
    const page = pathname === "/"
      ? t("titles.home")
      : pathname.startsWith("/marketplace")
        ? t("titles.marketplace")
        : pathname.startsWith("/agent")
          ? t("titles.agent")
          : pathname.startsWith("/chat")
            ? t("titles.chat")
            : pathname.startsWith("/dashboard")
              ? t("nav.dashboard")
              : pathname.startsWith("/account")
                ? t("titles.account")
                : pathname.startsWith("/pricing")
                  ? t("titles.pricing")
                  : pathname.startsWith("/admin")
                    ? t("titles.admin")
                    : pathname.startsWith("/payment-required")
                      ? t("pay.title")
                      : pathname.startsWith("/terms")
                        ? t("footer.terms")
                        : pathname.startsWith("/privacy")
                          ? t("footer.privacy")
                          : pathname.startsWith("/contact")
                            ? t("footer.contact")
                            : pathname.startsWith("/login") || pathname.startsWith("/signup")
                              ? t("titles.login")
                              : t("notFound.title")
    document.title = `${page} | ${t("brand.name")}`
    // The canonical lives here, not in the static shell: one shell serves every
    // route, so a baked-in href would tell search engines that all 264 agent
    // pages are `/`. Writing it per route keeps each URL self-canonical; query
    // strings are dropped because no public route is distinguished by one.
    const origin = window.location.origin
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement("link")
      canonical.rel = "canonical"
      document.head.appendChild(canonical)
    }
    canonical.href = `${origin}${pathname}`
  }, [pathname, t])
  // `/#how` and `/#categories` must work from other routes too, so the hash is
  // followed on the page that just rendered, not just when a link is in view.
  useEffect(() => {
    if (!hash) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(hash.slice(1))
      if (!target) return
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, hash])
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-18 sm:px-5">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 text-lg font-bold tracking-tight sm:text-xl"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-white">
              <Bot size={20} />
            </span>
            <span className="truncate">{t("brand.name")}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm md:flex">
            {[
              {
                to: "/marketplace",
                label: t("nav.marketplace"),
                active: pathname.startsWith("/marketplace") || pathname.startsWith("/agent"),
              },
              { to: "/#categories", label: t("nav.categories"), active: false },
              { to: "/pricing", label: t("nav.pricing"), active: pathname.startsWith("/pricing") },
              { to: "/#how", label: t("nav.how"), active: false },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={item.active ? "page" : undefined}
                className={`transition ${item.active ? "font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
              >
                {item.label}
              </Link>
            ))}
            {user?.role === "admin" && (
              <Link to="/admin" className="text-accent transition hover:text-ink">
                {t("nav.admin")}
              </Link>
            )}
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            {user ? (
              <>
                <Link
                  className="btn btn-soft"
                  to="/dashboard"
                  aria-label={t("nav.dashboard")}
                >
                  <LayoutDashboard size={17} />{" "}
                  <span className="hidden sm:inline">{t("nav.dashboard")}</span>
                </Link>
                <Link className="text-sm text-ink-muted transition hover:text-ink" to="/account">
                  {t("account.title")}
                </Link>
                {/* Logging out lives in the menu on phones, where space is short. */}
                <button
                  className="hidden text-sm text-ink-muted transition hover:text-ink md:block"
                  onClick={() => void logout()}
                >
                  {t("nav.logout")}
                </button>
              </>
            ) : (
              <>
                {/* One entry point: /login creates the account on first use. */}
                <Link className="btn" to="/login">
                  {t("nav.login")} <ForwardArrow size={16} />
                </Link>
              </>
            )}
            <button
              type="button"
              className="icon-btn md:hidden"
              onClick={() => setMenu((open) => !open)}
              aria-label={t("nav.menu")}
              aria-expanded={menu}
              aria-controls="mobile-nav"
            >
              {menu ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        {menu && (
          <nav
            id="mobile-nav"
            className="grid gap-1 border-t border-line px-4 pb-4 pt-3 text-sm md:hidden"
          >
            {[
              {
                to: "/marketplace",
                label: t("nav.marketplace"),
                active: pathname.startsWith("/marketplace") || pathname.startsWith("/agent"),
              },
              { to: "/#categories", label: t("nav.categories"), active: false },
              { to: "/pricing", label: t("nav.pricing"), active: pathname.startsWith("/pricing") },
              { to: "/#how", label: t("nav.how"), active: false },
              ...(user?.role === "admin"
                ? [{ to: "/admin", label: t("nav.admin"), active: false }]
                : []),
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                aria-current={link.active ? "page" : undefined}
                onClick={() => setMenu(false)}
                className={`rounded-xl px-3 py-3 transition hover:bg-surface-2 ${link.active ? "font-medium text-ink" : "text-ink-muted"}`}
              >
                {link.label}
              </Link>
            ))}
            <div className="my-2 h-px bg-line" />
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  onClick={() => setMenu(false)}
                  className="rounded-xl px-3 py-3 text-ink-muted transition hover:bg-surface-2"
                >
                  {t("nav.dashboard")}
                </Link>
                <Link
                  to="/account"
                  onClick={() => setMenu(false)}
                  className="rounded-xl px-3 py-3 text-ink-muted transition hover:bg-surface-2"
                >
                  {t("account.title")}
                </Link>
                <button
                  className="rounded-xl px-3 py-3 text-start text-ink-muted transition hover:bg-surface-2"
                  onClick={() => void logout()}
                >
                  {t("nav.logout")}
                </button>
              </>
            ) : (
              <Link
                to="/login"
                onClick={() => setMenu(false)}
                className="rounded-xl px-3 py-3 text-ink-muted transition hover:bg-surface-2"
              >
                {t("nav.login")}
              </Link>
            )}
          </nav>
        )}
      </header>
      <Outlet />
      <footer className="border-t border-line bg-surface-2/60">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-5">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-brand text-white">
                <Bot size={16} />
              </span>
              <div>
                <p className="text-sm font-bold">{t("brand.name")}</p>
                <p className="text-xs text-ink-muted">{t("footer.tagline")}</p>
              </div>
            </div>
            <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-ink-muted sm:flex sm:flex-wrap sm:gap-x-6">
              <Link to="/marketplace" className="transition hover:text-ink">{t("nav.marketplace")}</Link>
              <Link to="/pricing" className="transition hover:text-ink">{t("nav.pricing")}</Link>
              <Link to="/#how" className="transition hover:text-ink">{t("nav.how")}</Link>
              <Link to="/terms" className="transition hover:text-ink">{t("footer.terms")}</Link>
              <Link to="/privacy" className="transition hover:text-ink">{t("footer.privacy")}</Link>
              <Link to="/contact" className="transition hover:text-ink">{t("footer.contact")}</Link>
            </nav>
          </div>
          <p className="mt-8 text-xs text-ink-muted/80">
            © {t("brand.name")} · {t("footer.tagline")}
          </p>
        </div>
      </footer>
    </>
  )
}

/**
 * Stable empty fallbacks for the catalog's own loading state.
 *
 * A fresh `[]` on every render would change identity each time and make the
 * `useMemo`s keyed on the divisions recompute on every keystroke.
 */
const EMPTY_AGENTS: Agent[] = []
const EMPTY_DIVISIONS: CatalogDivision[] = []

/** Cards rendered per page; "Show more" extends the grid without a round-trip. */
const PAGE_SIZE = 24
type SortKey = "popular" | "cheap" | "expensive"
type PriceKey = "low" | "mid" | "high"

// The three ranges the real price set (29k–69k) actually falls into. There are
// no free agents in the catalog, so a free/paid toggle would always show an
// empty column — ranges instead.
const PRICE_TIERS: Record<PriceKey, (price: number) => boolean> = {
  low: (price) => price <= 39_000,
  mid: (price) => price > 39_000 && price <= 49_000,
  high: (price) => price > 49_000,
}

function Landing() {
  const { t, n, lang, division } = useI18n()
  const nav = useNavigate()
  const [query, setQuery] = useState("")
  const steps: [number, string, string][] = [
    [1, t("landing.step1t"), t("landing.step1d")],
    [2, t("landing.step2t"), t("landing.step2d")],
    [3, t("landing.step3t"), t("landing.step3d")],
  ]
  // One answer per question: the old single shared `landing.faqA` answered the
  // first question only and left the other three with an unrelated paragraph.
  const faqs: [string, string][] = [
    [t("landing.faqQ1"), t("landing.faqA1")],
    [t("landing.faqQ2"), t("landing.faqA2")],
    [t("landing.faqQ3"), t("landing.faqA3")],
    [t("landing.faqQ4"), t("landing.faqA4")],
  ]
  // The most populated real divisions first: the grid and the hero shortcuts are
  // the generated division set with its real counts, not a hand-written list.
  const categories = useMemo(
    () => [...divisionCatalog].sort((a, b) => b.count - a.count).slice(0, 8),
    [],
  )
  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const value = query.trim()
    // The marketplace owns search state; the hero just hands the query over.
    nav(value ? `/marketplace?q=${encodeURIComponent(value)}` : "/marketplace")
  }
  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="hero-glow" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-5 pb-16 pt-16 text-center sm:pb-20 sm:pt-24">
          <p className="eyebrow justify-center">
            <Sparkles size={14} aria-hidden="true" /> {t("landing.eyebrow")}
          </p>
          <h1 className="mt-6 text-[2rem] font-bold leading-[1.35] tracking-tight sm:text-5xl sm:leading-[1.25]">
            {t("landing.title1")}
            <br />
            <span className="text-brand">{t("landing.title2")}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-ink-muted sm:text-lg">
            {t("landing.subtitle")}
          </p>
          <form
            onSubmit={submitSearch}
            role="search"
            className="hero-search mx-auto mt-8 max-w-2xl text-start"
          >
            <Search size={20} className="shrink-0 text-ink-muted" aria-hidden="true" />
            <label htmlFor="hero-search" className="sr-only">
              {t("landing.searchSubmit")}
            </label>
            <input
              id="hero-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("landing.searchPlaceholder")}
              autoComplete="off"
              enterKeyHint="search"
            />
            <button type="submit" className="btn shrink-0">
              {t("landing.searchSubmit")}
            </button>
          </form>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="text-ink-muted">{t("landing.popular")}:</span>
            {categories.slice(0, 4).map((d) => (
              <Link key={d.slug} to={`/marketplace?cat=${d.slug}`} className="prompt">
                {division(d)}
              </Link>
            ))}
          </div>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link className="btn btn-large" to="/login">
              {t("landing.cta")} <ForwardArrow size={18} />
            </Link>
            <Link className="btn btn-soft btn-large" to="/marketplace">
              {t("landing.seeAgents")}
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-muted">
            <span>✓ {t("landing.noCard")}</span>
            <span>✓ {t("landing.fluent")}</span>
            <span>✓ {t("landing.oneTime")}</span>
          </div>
        </div>
      </section>

      <section id="categories" className="section scroll-mt-20">
        <SectionHead
          eyebrow={t("nav.categories")}
          title={t("landing.catTitle")}
          action={
            <Link to="/marketplace" className="text-sm font-medium text-brand transition hover:text-accent">
              {t("landing.catAll")}
            </Link>
          }
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.map((d) => (
            <Link key={d.slug} to={`/marketplace?cat=${d.slug}`} className="category-card">
              <span className="category-icon">
                <DivisionIcon name={d.icon} />
              </span>
              <span className="font-medium">{division(d)}</span>
              <span className="text-xs text-ink-muted">
                {t("market.count", { count: n(d.count) })}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section pt-0">
        <SectionHead
          eyebrow={t("landing.findEyebrow")}
          title={t("landing.findTitle")}
          action={
            <Link to="/marketplace" className="text-sm font-medium text-brand transition hover:text-accent">
              {t("landing.seeAll")} <ForwardArrow size={16} />
            </Link>
          }
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {featuredAgents.slice(0, 8).map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </section>

      <section id="how" className="section scroll-mt-20">
        <SectionHead eyebrow={t("landing.howEyebrow")} title={t("landing.howTitle")} />
        <div className="grid gap-px overflow-hidden rounded-3xl border border-line bg-line md:grid-cols-3">
          {steps.map((x) => (
            <div className="bg-surface p-6 sm:p-8" key={x[0]}>
              <b className="text-4xl text-brand">{n(x[0]).padStart(2, lang === "fa" ? "۰" : "0")}</b>
              <h3 className="mt-6 text-lg font-semibold sm:mt-12 sm:text-xl">{x[1]}</h3>
              <p className="mt-3 text-sm leading-6 text-ink-muted">{x[2]}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="section pt-0">
        <SectionHead eyebrow={t("landing.faqEyebrow")} title={t("landing.faqTitle")} />
        <div className="mx-auto max-w-3xl divide-y divide-line rounded-2xl border border-line bg-surface">
          {faqs.map(([question, answer]) => (
            <details className="group px-5 py-4 sm:px-6 sm:py-5" key={question}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                {question}
                <ChevronDown
                  className="shrink-0 transition group-open:rotate-180"
                  size={18}
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-ink-muted">{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  )
}

/** URL-backed state: `?q=`, `?cat=`, `?price=`, `?sort=` are deep-linkable —
    which is what the hero search and the landing category cards rely on. */
function Marketplace() {
  const [params, setParams] = useSearchParams()
  const q = params.get("q") ?? ""
  const cat = params.get("cat")
  const price = params.get("price") as PriceKey | null
  const sort = (params.get("sort") as SortKey | null) ?? "popular"
  const { t, n, division, agentName, agentDescription, agentDivision } = useI18n()
  const catalog = useCatalog()
  const agents = catalog?.agents ?? EMPTY_AGENTS
  const divisions = catalog?.divisions ?? EMPTY_DIVISIONS
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [drawer, setDrawer] = useState(false)

  // One writer for every filter: resets paging and merges into the URL.
  const update = (patch: Record<string, string | null>) => {
    setVisible(PAGE_SIZE)
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key)
        else next.set(key, value)
      }
      return next
    })
  }
  const reset = () => {
    setVisible(PAGE_SIZE)
    setParams(new URLSearchParams())
  }

  // Unknown ?cat=/?price= values act as "all" instead of filtering everything out.
  const activeCat = cat && divisions.some((d) => d.slug === cat) ? cat : null
  const activePrice = price && price in PRICE_TIERS ? price : null

  const filterGroups = useMemo(
    () => [
      {
        key: "market.filter.category",
        options: [
          { key: "all", label: t("common.all"), count: agents.length },
          ...divisions.map((d) => ({ key: d.slug, label: division(d), count: d.count })),
        ],
        selected: activeCat ?? "all",
        onSelect: (key: string) => update({ cat: key === "all" ? null : key }),
      },
      {
        key: "market.filter.price",
        options: [
          { key: "low", label: t("market.price.low"), count: 0 },
          { key: "mid", label: t("market.price.mid"), count: 0 },
          { key: "high", label: t("market.price.high"), count: 0 },
        ],
        selected: activePrice ?? "",
        onSelect: (key: string) => update({ price: activePrice === key ? null : key }),
      },
    ],
    // `update`/`reset` are recreated each render but the groups only recompute
    // when the underlying data or selection changes; the closures read current
    // state at click time through the component scope.
    [divisions, agents.length, activeCat, activePrice, division, t],
  )
  const activeFilterCount = (activeCat ? 1 : 0) + (activePrice ? 1 : 0) + (q ? 1 : 0)

  const list = useMemo(
    () =>
      agents
        .filter(
          (a) =>
            // Filter by division slug, never by a localized label: the previous
            // version compared the English chip text against the Persian
            // `category`, so every category returned nothing in English.
            (!activeCat || a.division === activeCat) &&
            (!activePrice || PRICE_TIERS[activePrice](a.price)) &&
            (agentName(a).toLowerCase().includes(q.toLowerCase()) ||
              agentDescription(a).toLowerCase().includes(q.toLowerCase()) ||
              agentDivision(a).toLowerCase().includes(q.toLowerCase())),
        )
        .sort((a, b) =>
          sort === "cheap"
            ? a.price - b.price
            : sort === "expensive"
              ? b.price - a.price
              : b.sales - a.sales,
        ),
    // `agents` belongs in this list now that it arrives asynchronously: it was a
    // module constant when it was imported at the top of the file, and leaving it
    // out meant the grid stayed computed from the empty placeholder and rendered
    // "No agents match your search" with a fully populated category row above it.
    [q, activeCat, activePrice, sort, agents, agentName, agentDescription, agentDivision],
  )
  // Wait for the catalog instead of flashing an empty grid and filling it in a
  // moment later. This is where the 264-agent chunk is actually requested.
  if (!catalog) return <CatalogSkeleton />
  return (
    <main className="section min-h-screen">
      <p className="eyebrow">{t("market.eyebrow")}</p>
      <h1 className="page-title">
        {t("market.title1")} <span>{t("market.title2")}</span>
      </h1>

      <div className="mt-9 flex items-start gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block" aria-label={t("market.filters")}>
          <div className="sticky top-24 grid gap-6">
            {filterGroups.map((group) => (
              <div key={group.key}>
                <h2 className="mb-2 text-sm font-semibold text-ink">{t(group.key)}</h2>
                <div className="grid gap-1">
                  {group.options.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className="filter-option"
                      aria-pressed={group.selected === option.key}
                      onClick={group.onSelect.bind(null, option.key)}
                    >
                      <span className="truncate">{option.label}</span>
                      {option.count > 0 && (
                        <span className="filter-option-count">{n(option.count)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {activeFilterCount > 0 && (
              <button type="button" className="btn btn-soft w-full justify-center text-xs" onClick={reset}>
                {t("market.clear")}
              </button>
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">{t("market.search")}</span>
              <input
                value={q}
                onChange={(event) => update({ q: event.target.value || null })}
                placeholder={t("market.search")}
                type="search"
              />
            </label>
            <div className="flex gap-3">
              <label className="sr-only" htmlFor="market-sort">{t("market.sort.label")}</label>
              <select
                id="market-sort"
                value={sort}
                onChange={(event) => update({ sort: event.target.value === "popular" ? null : event.target.value })}
                className="select"
              >
                <option value="popular">{t("market.sort.popular")}</option>
                <option value="cheap">{t("market.sort.cheap")}</option>
                <option value="expensive">{t("market.sort.expensive")}</option>
              </select>
              {/* Mobile filter trigger */}
              <button
                type="button"
                className="btn btn-soft shrink-0 lg:hidden"
                onClick={() => setDrawer(true)}
                aria-haspopup="dialog"
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                <span className="relative">
                  {t("market.filters")}
                  {activeFilterCount > 0 && <span className="filter-badge absolute -top-2 -end-2">{activeFilterCount}</span>}
                </span>
              </button>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {q && (
                <FilterChip
                  label={t("market.chip.query", { query: q })}
                  onRemove={() => update({ q: null })}
                  removeLabel={t("market.removeFilter", { name: q })}
                />
              )}
              {activeCat && (
                <FilterChip
                  label={division(divisions.find((d) => d.slug === activeCat)!)}
                  onRemove={() => update({ cat: null })}
                  removeLabel={t("market.removeFilter", {
                    name: division(divisions.find((d) => d.slug === activeCat)!),
                  })}
                />
              )}
              {activePrice && (
                <FilterChip
                  label={t(`market.price.${activePrice}`)}
                  onRemove={() => update({ price: null })}
                  removeLabel={t("market.removeFilter", { name: t(`market.price.${activePrice}`) })}
                />
              )}
              <button type="button" className="text-xs text-ink-muted underline-offset-4 transition hover:text-ink hover:underline" onClick={reset}>
                {t("market.clear")}
              </button>
            </div>
          )}

          <p className="mt-6 text-sm text-ink-muted" role="status">
            {t("market.showing", { shown: n(Math.min(visible, list.length)), total: n(list.length) })}
          </p>

          <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {list.slice(0, visible).map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>

          {list.length > visible && (
            <div className="mt-10 text-center">
              <button type="button" className="btn btn-soft" onClick={() => setVisible((count) => count + PAGE_SIZE)}>
                {t("market.loadMore")} ({n(list.length - visible)})
              </button>
            </div>
          )}

          {!list.length && (
            <EmptyState
              message={t("market.empty")}
              hint={t("market.emptyHint")}
              action={
                <button type="button" className="btn" onClick={reset}>
                  {t("market.clear")}
                </button>
              }
            />
          )}
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawer && (
        <Modal title={t("market.filters")} onClose={() => setDrawer(false)} closeLabel={t("common.close")}>
          <div className="grid gap-6">
            {filterGroups.map((group) => (
              <div key={group.key}>
                <h3 className="mb-2 text-sm font-semibold text-ink">{t(group.key)}</h3>
                <div className="grid gap-1">
                  {group.options.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className="filter-option"
                      aria-pressed={group.selected === option.key}
                      onClick={() => {
                        group.onSelect(option.key)
                      }}
                    >
                      <span className="truncate">{option.label}</span>
                      {option.count > 0 && (
                        <span className="filter-option-count">{n(option.count)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="grid gap-2">
              {activeFilterCount > 0 && (
                <button type="button" className="btn btn-soft w-full justify-center" onClick={reset}>
                  {t("market.clear")}
                </button>
              )}
              <button type="button" className="btn w-full justify-center" onClick={() => setDrawer(false)}>
                {t("market.showResults", { count: n(list.length) })}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}

function Detail() {
  const { slug } = useParams()
  const nav = useNavigate()
  const [notice, setNotice] = useState("")
  const [buying, setBuying] = useState(false)
  const { t, n, toman, agentDivision, agentName, agentLongDescription, agentFeatures, agentPrompts } =
    useI18n()
  const { user } = useSession()
  const { owns, refresh } = useEntitlements()
  const [error, setError] = useState("")
  const [refunding, setRefunding] = useState(false)
  const catalog = useCatalog()
  // Both waits belong *after* every hook in this component. Returning early
  // above them changes how many hooks run between two renders, and React rejects
  // that outright with "Rendered more hooks than during the previous render" —
  // which is exactly how this broke when the catalog became asynchronous. The
  // not-found return was already in this position for the same reason.
  if (!catalog) return <PageLoading />
  const a = catalog.agents.find((x) => x.slug === slug)
  if (!a) return <NotFound />
  const agentId = a.id
  const own = owns(agentId)
  // Related by the only real link the data has: the division. Self excluded,
  // capped at four — no invented "similar score" behind it.
  const related = catalog.agents.filter((x) => x.division === a.division && x.id !== a.id).slice(0, 4)

  // An unknown error code falls back to the generic message instead of leaking a
  // raw code into the UI. The *key* is returned, not the message, so the notice
  // re-translates when the language changes — storing rendered text froze it in
  // whichever language was showing at the time of the failure.
  const errorKey = (code: string) => {
    const key = `purchase.error.${code}`
    return t(key) === key ? "purchase.error.generic" : key
  }

  async function purchase() {
    if (!user) return nav("/login")
    setBuying(true)
    setNotice("")
    setError("")
    try {
      const { redirectUrl } = await api.buyAgent(agentId)
      // Hand off to the gateway's hosted checkout; the agent unlocks only after
      // the gateway's verified callback settles the transaction.
      if (!goToGateway(redirectUrl)) setNotice("payment.pending")
      await refresh()
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : "network"))
    } finally {
      setBuying(false)
    }
  }

  async function refund() {
    if (!window.confirm(t("refund.request"))) return
    setRefunding(true)
    setNotice("")
    setError("")
    try {
      await api.refundAgent(agentId)
      setNotice("refund.requested")
      await refresh()
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : "network"))
    } finally {
      setRefunding(false)
    }
  }
  return (
    <main className="section">
      <Breadcrumbs
        items={[
          { label: t("nav.home"), to: "/" },
          { label: t("nav.marketplace"), to: "/marketplace" },
          { label: agentDivision(a), to: `/marketplace?cat=${a.division}` },
          { label: agentName(a) },
        ]}
      />
      <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_.8fr]">
        <div>
          <div className="flex flex-wrap items-start gap-4 sm:gap-5">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand-soft text-4xl ring-1 ring-brand-border sm:size-22 sm:rounded-3xl sm:text-5xl">
              {a.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{agentDivision(a)}</p>
              <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{agentName(a)}</h1>
              <p className="mt-2 text-sm text-ink-muted">
                <span className="text-accent">★ {n(a.rating)}</span>
                <span className="ms-2">
                  ({n(a.sales)} {t("common.sales")})
                </span>
              </p>
            </div>
          </div>
          <p className="mt-8 max-w-2xl text-base leading-8 text-ink-muted sm:mt-10 sm:text-lg sm:leading-9">
            {agentLongDescription(a)}
          </p>
          <h2 className="mt-10 text-xl font-bold">{t("detail.whatItDoes")}</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {agentFeatures(a).map((f) => (
              <li className="flex gap-2 text-ink-muted" key={f}>
                <Check size={18} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
          <h2 className="mt-10 text-xl font-bold">{t("detail.startHere")}</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {agentPrompts(a).map((p) => (
              <Link
                to={`/chat/${a.id}?prompt=${encodeURIComponent(p)}`}
                className="prompt"
                key={p}
              >
                {p}
              </Link>
            ))}
          </div>
        </div>
        <aside className="h-fit rounded-3xl border border-brand-border bg-brand-soft p-6 sm:p-7 lg:sticky lg:top-24">
          <span className="badge">{t("detail.guarantee")}</span>
          <div className="mt-8 text-3xl font-bold">{toman(a.price)}</div>
          <p className="mt-2 text-sm text-ink-muted">{t("detail.lifetime")}</p>
          <button
            className="btn mt-7 w-full justify-center"
            onClick={own ? () => nav(`/chat/${a.id}`) : () => void purchase()}
            disabled={buying}
          >
            {own ? t("common.startChat") : t("common.buy")}
            <ForwardArrow size={17} />
          </button>
          <button
            className="btn btn-soft mt-3 w-full justify-center"
            onClick={() => nav(`/chat/${a.id}`)}
          >
            {t("detail.preview")}
          </button>
          {notice && <p className="mt-4 text-sm text-emerald-300">✓ {t(notice)}</p>}
          {error && (
            <p className="mt-4 text-sm text-rose-300" role="alert">
              {t(error)}
            </p>
          )}
          {own && (
            <button
              className="btn btn-soft mt-3 w-full justify-center text-xs"
              onClick={() => void refund()}
              disabled={refunding}
            >
              {t("refund.request")}
            </button>
          )}
        </aside>
      </div>
      {related.length > 0 && (
        <section className="mt-14 border-t border-line pt-10" aria-labelledby="related-title">
          <div className="section-head">
            <h2 id="related-title" className="!mb-0 text-xl font-bold">{t("detail.related")}</h2>
            <Link
              to={`/marketplace?cat=${a.division}`}
              className="text-sm font-medium text-brand transition hover:text-accent"
            >
              {t("landing.seeAll")}
            </Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {related.map((r) => (
              <AgentCard key={r.id} agent={r} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

// Authentication lives in ./pages/Login: a mobile number plus an SMS code. The
// email/password, email-verification and password-reset screens that used to sit
// here are gone with the password — there is nothing left for them to do.

function Dashboard() {
  const { user } = useSession()
  const { owned } = useEntitlements()
  const catalog = useCatalog()
  const own = (catalog?.agents ?? EMPTY_AGENTS).filter((a) => owned.includes(a.id))
  const { t, n, toman, phone, agentName, lang } = useI18n()
  const locale = lang === "fa" ? "fa-IR" : "en-US"
  // Set right after a first login, when the gift balance was just created.
  const [params] = useSearchParams()
  const welcome = params.get("welcome") === "1"

  // Real figures: the balance, the chart and the receipts all come from the
  // wallet endpoints instead of hardcoded Persian digits and fake bars.
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null)
  const [usage, setUsage] = useState<UsagePoint[]>([])
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  useEffect(() => {
    if (!user) return
    let alive = true
    void api.wallet().then((w) => alive && setWallet(w)).catch(() => {})
    void api.usage(30).then((u) => alive && setUsage(u.points)).catch(() => {})
    void api.transactions().then((x) => alive && setTransactions(x.transactions)).catch(() => {})
    return () => {
      alive = false
    }
  }, [user])

  const planKey = wallet?.plan ?? "free"
  const stats: [string, string, typeof Wallet][] = [
    [n(wallet?.tokenBalance ?? 0), t("dash.balance"), Wallet],
    [n(own.length), t("dash.myAgents"), Bot],
    [t(`plan.${planKey}`), t("dash.currentPlan"), MessageSquare],
  ]
  const peak = Math.max(1, ...usage.map((point) => point.tokens))
  const txLabel = (row: TransactionRow) => {
    const agent = row.agentId ? catalog?.agents.find((a) => a.id === row.agentId) : undefined;
    return row.type === "purchase" && agent
      ? `${t("dash.tx.purchase")} · ${agentName(agent)}`
      : t(`dash.tx.${row.type}`);
  }
  return (
    <main className="section">
      <p className="eyebrow">{t("dash.eyebrow")}</p>
      <h1 className="page-title wrap-anywhere">
        {t("dash.hello", { name: user?.phone ? phone(user.phone) : t("dash.friend") })}
      </h1>
      {welcome && (
        <p className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          {t("auth.welcomeGift")}
        </p>
      )}
      <div className="mt-9 grid gap-4 md:grid-cols-3">
        {stats.map(([value, label, Icon]) => (
          <div className="stat" key={label}>
            <Icon className="text-brand" />
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-line bg-surface p-6">
          <div className="flex justify-between">
            <h2 className="font-bold">{t("dash.usage")}</h2>
            <span className="text-sm text-ink-muted">{t("common.token")}</span>
          </div>
          {usage.length ? (
            <div className="chart mt-8 flex items-end gap-2">
              {usage.map((point) => (
                <span
                  key={point.day}
                  title={`${point.day}: ${n(point.tokens)} ${t("common.token")}`}
                  style={{ height: `${Math.max(4, Math.round((point.tokens / peak) * 100))}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="mt-8 text-sm text-ink-muted">{t("dash.usageEmpty")}</p>
          )}
        </section>
        <section className="rounded-3xl border border-brand-border bg-brand-soft p-6">
          <Sparkles className="text-brand" />
          <h2 className="mt-8 text-xl font-bold">{t("dash.ready")}</h2>
          <p className="mt-3 text-sm leading-7 text-ink-muted">
            {t("dash.readyBody")}
          </p>
          <Link className="btn mt-6" to="/marketplace">
            {t("dash.goShop")} <ForwardArrow size={16} />
          </Link>
        </section>
      </div>
      <div className="section px-0">
        <div className="section-head">
          <h2>{t("dash.myAgents")}</h2>
          <Link className="text-sm text-brand" to="/marketplace">
            {t("dash.manage")}
          </Link>
        </div>
        {own.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {own.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>
        ) : (
          <div className="empty">
            {t("dash.empty")}{" "}
            <Link className="text-brand" to="/marketplace">
              {t("dash.start")}
            </Link>
          </div>
        )}
      </div>
      <div className="section px-0">
        <div className="section-head">
          <h2>{t("dash.billing")}</h2>
          <span className="text-sm text-ink-muted">
            {t("dash.currentPlan")}: {t(`plan.${planKey}`)}
          </span>
        </div>
        {transactions.length ? (
          <div className="table-scroll rounded-2xl border border-line">
            <table className="w-full min-w-[34rem] text-start text-sm">
              <tbody>
                {transactions.map((row) => (
                  <tr className="border-b border-line/60" key={row.id}>
                    <td className="p-3">{txLabel(row)}</td>
                    <td className="p-3 text-ink-muted">
                      {new Date(row.createdAt).toLocaleDateString(locale)}
                    </td>
                    <td className="p-3">{toman(row.amount)}</td>
                    <td className="p-3">
                      <span
                        className={
                          row.status === "success"
                            ? "text-emerald-300"
                            : row.status === "failed"
                              ? "text-rose-300"
                              : "text-amber-300"
                        }
                      >
                        {t(`dash.status.${row.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">{t("dash.noTransactions")}</div>
        )}
      </div>
    </main>
  )
}

function PageLoading() {
  const { t } = useI18n()
  return <main className="section text-center text-ink-muted">{t("common.loading")}</main>
}

/**
 * Guards a lazily-loaded page and shows a fallback while its chunk loads.
 * `loading` is the session check, so an authenticated page never flashes its
 * logged-out state.
 */
function LazyPage({ children, guard }: { children: ReactNode; guard?: "user" | "admin" }) {
  const { user, loading } = useSession()
  if (loading) return <PageLoading />
  if (guard === "user" && !user) return <Navigate to="/login" replace />
  if (guard === "admin" && user?.role !== "admin") return <Navigate to="/dashboard" replace />
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Shell,
    children: [
      { index: true, Component: Landing },
      { path: "marketplace", Component: Marketplace },
      { path: "agent/:slug", Component: Detail },
      {
        path: "chat/:agentId",
        Component: () => (
          <LazyPage guard="user">
            <Chat />
          </LazyPage>
        ),
      },
      {
        path: "dashboard",
        Component: () => (
          <LazyPage guard="user">
            <Dashboard />
          </LazyPage>
        ),
      },
      {
        path: "account",
        Component: () => (
          <LazyPage guard="user">
            <Account />
          </LazyPage>
        ),
      },
      { path: "pricing", Component: () => <LazyPage><Pricing /></LazyPage> },
      {
        path: "admin",
        Component: () => (
          <LazyPage guard="admin">
            <Admin />
          </LazyPage>
        ),
      },
      { path: "login", Component: () => <LazyPage><Login /></LazyPage> },
      // Sign up and log in are the same flow: an unknown number gets an account
      // the moment its first code is verified.
      { path: "signup", Component: () => <LazyPage><Login /></LazyPage> },
      // Where the payment gateway returns the payer.
      { path: "payment-required", Component: () => <LazyPage><PaymentReturn /></LazyPage> },
      { path: "terms", Component: () => <Legal kind="terms" /> },
      { path: "privacy", Component: () => <Legal kind="privacy" /> },
      { path: "contact", Component: () => <Legal kind="contact" /> },
      // Kept as redirects so old links and bookmarks keep working.
      { path: "verify", Component: () => <Navigate to="/login" replace /> },
      { path: "reset-password", Component: () => <Navigate to="/login" replace /> },
      // A real 404 instead of silently bouncing to the marketing page.
      { path: "*", Component: NotFound },
    ],
  },
])
