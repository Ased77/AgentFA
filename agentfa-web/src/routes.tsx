import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react"
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
  Sparkles,
  Wallet,
  X,
} from "lucide-react"
import type { Agent, CatalogDivision } from "./data/agents"
// The featured list is small and belongs to the landing page; the full catalog
// is fetched on demand by the routes that need all 264 agents.
import { featuredAgents } from "./data/featured.generated"
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
import { ForwardArrow } from "./components/ForwardArrow"
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
      className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-violet-400/50 hover:text-white"
      title={t("nav.lang")}
      aria-label={t("nav.lang")}
    >
      <Languages size={14} />
      <span className="text-xs font-medium">{lang === "fa" ? "FA" : "EN"}</span>
    </button>
  )
}

function Shell() {
  const { pathname } = useLocation()
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
  }, [pathname, t])
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0b1124]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-18 sm:px-5">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 text-lg font-black tracking-tight sm:text-xl"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-500 text-white">
              <Bot size={20} />
            </span>
            <span className="truncate">{t("brand.name")}</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
            <Link to="/marketplace">{t("nav.marketplace")}</Link>
            <Link to="/pricing">{t("nav.pricing")}</Link>
            <a href="#how">{t("nav.how")}</a>
            {user?.role === "admin" && (
              <Link to="/admin" className="text-violet-300">
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
                <Link className="text-sm text-slate-300" to="/account">
                  {t("account.title")}
                </Link>
                {/* Logging out lives in the menu on phones, where space is short. */}
                <button
                  className="hidden text-sm text-slate-400 md:block"
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
            className="grid gap-1 border-t border-white/8 px-4 pb-4 pt-3 text-sm md:hidden"
          >
            {[
              { to: "/marketplace", label: t("nav.marketplace") },
              { to: "/pricing", label: t("nav.pricing") },
              ...(user?.role === "admin"
                ? [{ to: "/admin", label: t("nav.admin") }]
                : []),
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-xl px-3 py-3 text-slate-200 transition hover:bg-white/5"
              >
                {link.label}
              </Link>
            ))}
            <a
              href="#how"
              className="rounded-xl px-3 py-3 text-slate-200 transition hover:bg-white/5"
              onClick={() => setMenu(false)}
            >
              {t("nav.how")}
            </a>
            <div className="my-2 h-px bg-white/8" />
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  className="rounded-xl px-3 py-3 text-slate-200 transition hover:bg-white/5"
                >
                  {t("nav.dashboard")}
                </Link>
                <Link
                  to="/account"
                  className="rounded-xl px-3 py-3 text-slate-200 transition hover:bg-white/5"
                >
                  {t("account.title")}
                </Link>
                <button
                  className="rounded-xl px-3 py-3 text-start text-slate-400 transition hover:bg-white/5"
                  onClick={() => void logout()}
                >
                  {t("nav.logout")}
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-xl px-3 py-3 text-slate-200 transition hover:bg-white/5"
              >
                {t("nav.login")}
              </Link>
            )}
          </nav>
        )}
      </header>
      <Outlet />
      <footer className="border-t border-white/8 py-10 text-center text-sm text-slate-500">
        <nav className="mb-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link to="/terms">{t("footer.terms")}</Link>
          <Link to="/privacy">{t("footer.privacy")}</Link>
          <Link to="/contact">{t("footer.contact")}</Link>
        </nav>
        © {t("brand.name")} · {t("footer.tagline")}
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

function AgentCard({ agent }: { agent: Agent }) {
  const { owns } = useEntitlements()
  const own = owns(agent.id)
  const { t, n, toman, agentName, agentDescription } = useI18n()
  return (
    <article className="agent-card group relative">
      <div className="mb-7 flex items-start justify-between">
        <span className="grid size-15 place-items-center rounded-2xl bg-white/6 text-3xl">
          {agent.icon}
        </span>
        {agent.featured && (
          <span className="badge">{t("common.bestSeller")}</span>
        )}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold">{agentName(agent)}</h3>
        <span className="text-sm text-amber-300">★ {n(agent.rating)}</span>
      </div>
      <p className="h-12 overflow-hidden text-sm leading-6 text-slate-400 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
        {agentDescription(agent)}
      </p>
      <div className="mt-6 flex items-center justify-between border-t border-white/8 pt-5">
        <div>
          <b className="text-sm">{toman(agent.price)}</b>
          <span className="mx-2 text-xs text-slate-500">
            {n(agent.sales)} {t("common.sales")}
          </span>
        </div>
        <Link
          to={own ? `/chat/${agent.id}` : `/agent/${agent.slug}`}
          // The pseudo-element stretches this link across the whole card, so the
          // entire card is clickable while the arrow stays the only anchor.
          className="icon-btn after:absolute after:inset-0 after:content-['']"
          aria-label={`${t("common.view")} ${agentName(agent)}`}
        >
          <ForwardArrow size={18} />
        </Link>
      </div>
    </article>
  )
}

function Landing() {
  const { t, n, lang } = useI18n()
  const steps: [number, string, string][] = [
    [1, t("landing.step1t"), t("landing.step1d")],
    [2, t("landing.step2t"), t("landing.step2d")],
    [3, t("landing.step3t"), t("landing.step3d")],
  ]
  const faqs = [
    t("landing.faqQ1"),
    t("landing.faqQ2"),
    t("landing.faqQ3"),
    t("landing.faqQ4"),
  ]
  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="hero-orb" />
        <div className="mx-auto grid max-w-7xl place-items-center px-5 py-20 text-center sm:py-24 lg:min-h-[620px]">
          <div className="max-w-4xl">
            <p className="eyebrow">
              <Sparkles size={14} /> {t("landing.eyebrow")}
            </p>
            <h1 className="mt-6 text-[2rem] font-black leading-[1.3] tracking-tight sm:mt-7 sm:text-5xl sm:leading-[1.2] md:text-7xl">
              {t("landing.title1")}
              <br />
              <span className="text-violet-300">{t("landing.title2")}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:mt-7 sm:text-lg">
              {t("landing.subtitle")}
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link className="btn btn-large" to="/login">
                {t("landing.cta")} <ForwardArrow size={18} />
              </Link>
              <Link className="btn btn-soft btn-large" to="/marketplace">
                {t("landing.seeAgents")}
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap justify-center gap-4 text-sm text-slate-400 sm:mt-14 sm:gap-8">
              <span>✓ {t("landing.noCard")}</span>
              <span>✓ {t("landing.fluent")}</span>
              <span>✓ {t("landing.oneTime")}</span>
            </div>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">{t("landing.findEyebrow")}</p>
            <h2>{t("landing.findTitle")}</h2>
          </div>
          <Link to="/marketplace" className="text-sm text-violet-300">
            {t("landing.seeAll")} <ForwardArrow size={16} />
          </Link>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {featuredAgents.slice(0, 6).map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </section>
      <section id="how" className="section">
        <p className="eyebrow">{t("landing.howEyebrow")}</p>
        <h2 className="mb-10">{t("landing.howTitle")}</h2>
        <div className="grid gap-px overflow-hidden rounded-3xl border border-white/8 bg-white/8 md:grid-cols-3">
          {steps.map((x) => (
            <div className="bg-[#101936] p-6 sm:p-8" key={x[0]}>
              <b className="text-4xl text-violet-400">{n(x[0]).padStart(2, lang === "fa" ? "۰" : "0")}</b>
              <h3 className="mt-6 text-lg font-bold sm:mt-12 sm:text-xl">{x[1]}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{x[2]}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="faq" className="section">
        <p className="eyebrow">{t("landing.faqEyebrow")}</p>
        <h2 className="mb-8">{t("landing.faqTitle")}</h2>
        <div className="mx-auto max-w-3xl divide-y divide-white/8 rounded-2xl border border-white/8 bg-white/[.03]">
          {faqs.map((q) => (
            <details className="group px-5 py-4 sm:px-6 sm:py-5" key={q}>
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {q}
                <ChevronDown
                  className="transition group-open:rotate-180"
                  size={18}
                />
              </summary>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">
                {t("landing.faqA")}
              </p>
            </details>
          ))}
        </div>
      </section>
    </main>
  )
}

function Marketplace() {
  const [q, setQ] = useState("")
  const [cat, setCat] = useState<string | null>(null)
  const [sort, setSort] = useState<"popular" | "cheap" | "expensive">("popular")
  const { t, division, agentName, agentDescription, agentDivision } = useI18n()
  const catalog = useCatalog()
  const agents = catalog?.agents ?? EMPTY_AGENTS
  const divisions = catalog?.divisions ?? EMPTY_DIVISIONS

  const cats = useMemo(
    () => [
      { slug: "all", label: t("common.all") },
      ...divisions.map((d) => ({ slug: d.slug, label: division(d) })),
    ],
    [divisions, division, t],
  )
  const list = useMemo(
    () =>
      agents
        .filter(
          (a) =>
            // Filter by division slug, never by a localized label: the previous
            // version compared the English chip text against the Persian
            // `category`, so every category returned nothing in English.
            (!cat || cat === "all" || a.division === cat) &&
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
    [q, cat, sort, agentName, agentDescription, agentDivision],
  )
  // Wait for the catalog instead of flashing an empty grid and filling it in a
  // moment later. This is where the 264-agent chunk is actually requested.
  if (!catalog) return <PageLoading />
  return (
    <main className="section min-h-screen">
      <p className="eyebrow">{t("market.eyebrow")}</p>
      <h1 className="page-title">
        {t("market.title1")} <span>{t("market.title2")}</span>
      </h1>
      <div className="mt-10 flex flex-col gap-4 lg:flex-row">
        <label className="search">
          <Search size={19} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("market.search")}
          />
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="select"
        >
          <option value="popular">{t("market.sort.popular")}</option>
          <option value="cheap">{t("market.sort.cheap")}</option>
          <option value="expensive">{t("market.sort.expensive")}</option>
        </select>
      </div>
      <div className="chip-row mt-6">
        {cats.map((c) => (
          <button
            onClick={() => setCat(c.slug)}
            className={`tab ${cat === c.slug ? "active" : ""}`}
            key={c.slug}
            title={`${c.label}${
              c.slug !== "all"
                ? ` — ${t("market.count", {
                    count: divisions.find((d) => d.slug === c.slug)?.count ?? 0,
                  })}`
                : ""
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {list.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
      </div>
      {!list.length && <div className="empty">{t("market.empty")}</div>}
    </main>
  )
}

function Detail() {
  const { slug } = useParams()
  const catalog = useCatalog()
  if (!catalog) return <PageLoading />
  const a = catalog.agents.find((x) => x.slug === slug)
  const nav = useNavigate()
  const [notice, setNotice] = useState("")
  const [buying, setBuying] = useState(false)
  const { t, n, toman, agentDivision, agentName, agentLongDescription, agentFeatures, agentPrompts } =
    useI18n()
  const { user } = useSession()
  const { owns, refresh } = useEntitlements()
  const [error, setError] = useState("")
  const [refunding, setRefunding] = useState(false)
  if (!a) return <NotFound />
  const agentId = a.id
  const own = owns(agentId)

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
      <Link to="/marketplace" className="text-sm text-slate-400">
        <ForwardArrow size={16} /> {t("detail.back")}
      </Link>
      <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_.8fr]">
        <div>
          <div className="flex flex-wrap items-start gap-4 sm:gap-5">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-4xl sm:size-22 sm:rounded-3xl sm:text-5xl">
              {a.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{agentDivision(a)}</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">{agentName(a)}</h1>
              <p className="mt-2 text-amber-300">
                ★ {n(a.rating)}{" "}
                <span className="mx-2 text-slate-500">
                  ({n(a.sales)} {t("common.sales")})
                </span>
              </p>
            </div>
          </div>
          <p className="mt-8 max-w-2xl text-base leading-8 text-slate-300 sm:mt-10 sm:text-lg sm:leading-9">
            {agentLongDescription(a)}
          </p>
          <h2 className="mt-10 text-xl font-bold">{t("detail.whatItDoes")}</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {agentFeatures(a).map((f) => (
              <li className="flex gap-2 text-slate-300" key={f}>
                <Check size={18} className="mt-1 shrink-0 text-emerald-400" />
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
        <aside className="h-fit rounded-3xl border border-violet-400/25 bg-violet-500/8 p-6 sm:p-7 lg:sticky lg:top-24">
          <span className="badge">{t("detail.guarantee")}</span>
          <div className="mt-8 text-3xl font-black">{toman(a.price)}</div>
          <p className="mt-2 text-sm text-slate-400">{t("detail.lifetime")}</p>
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
            <Icon className="text-violet-300" />
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-white/8 bg-white/[.03] p-6">
          <div className="flex justify-between">
            <h2 className="font-bold">{t("dash.usage")}</h2>
            <span className="text-sm text-slate-500">{t("common.token")}</span>
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
            <p className="mt-8 text-sm text-slate-500">{t("dash.usageEmpty")}</p>
          )}
        </section>
        <section className="rounded-3xl border border-violet-400/20 bg-violet-500/8 p-6">
          <Sparkles className="text-violet-300" />
          <h2 className="mt-8 text-xl font-bold">{t("dash.ready")}</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">
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
          <Link className="text-sm text-violet-300" to="/marketplace">
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
            <Link className="text-violet-300" to="/marketplace">
              {t("dash.start")}
            </Link>
          </div>
        )}
      </div>
      <div className="section px-0">
        <div className="section-head">
          <h2>{t("dash.billing")}</h2>
          <span className="text-sm text-slate-500">
            {t("dash.currentPlan")}: {t(`plan.${planKey}`)}
          </span>
        </div>
        {transactions.length ? (
          <div className="table-scroll rounded-2xl border border-white/10">
            <table className="w-full min-w-[34rem] text-start text-sm">
              <tbody>
                {transactions.map((row) => (
                  <tr className="border-b border-white/5" key={row.id}>
                    <td className="p-3">{txLabel(row)}</td>
                    <td className="p-3 text-slate-400">
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
  return <main className="section text-center text-slate-500">{t("common.loading")}</main>
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
