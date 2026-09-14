import { FormEvent, useEffect, useMemo, useState } from "react"
import {
  createBrowserRouter,
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom"
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Languages,
  LayoutDashboard,
  MessageSquare,
  Search,
  Sparkles,
  Wallet,
} from "lucide-react"
import { agents, divisions, Agent } from "./data/agents"
import { useI18n } from "./lib/i18n"
import Chat from "./pages/Chat"
import Pricing from "./pages/Pricing"
import Admin from "./pages/Admin"

const bought = () =>
  JSON.parse(localStorage.getItem("agentfa-bought") || "[]") as string[]
const logged = () => localStorage.getItem("agentfa-user") || ""
const buy = (id: string) =>
  localStorage.setItem(
    "agentfa-bought",
    JSON.stringify([...new Set([...bought(), id])]),
  )

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
  useEffect(() => {
    const page =
      pathname === "/"
        ? t("titles.home")
        : pathname.includes("marketplace")
          ? t("nav.marketplace")
          : pathname.includes("chat")
            ? t("titles.chat")
            : pathname.includes("dashboard")
              ? t("nav.dashboard")
              : pathname.includes("pricing")
                ? t("nav.pricing")
                : t("titles.account")
    document.title = `${page} | ${t("brand.name")}`
  }, [pathname, t])
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0b1124]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5">
          <Link
            to="/"
            className="flex items-center gap-2 text-xl font-black tracking-tight"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-violet-500 text-white">
              <Bot size={20} />
            </span>
            {t("brand.name")}
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
            <Link to="/marketplace">{t("nav.marketplace")}</Link>
            <Link to="/pricing">{t("nav.pricing")}</Link>
            <a href="#how">{t("nav.how")}</a>
            <Link to="/admin" className="text-violet-300">
              {t("nav.admin")}
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {logged() ? (
              <Link className="btn btn-soft" to="/dashboard">
                <LayoutDashboard size={17} /> {t("nav.dashboard")}
              </Link>
            ) : (
              <>
                <Link className="text-sm text-slate-300" to="/login">
                  {t("nav.login")}
                </Link>
                <Link className="btn" to="/signup">
                  {t("nav.signup")} <ArrowLeft size={16} />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="border-t border-white/8 py-10 text-center text-sm text-slate-500">
        © {t("brand.name")} · {t("footer.tagline")}
      </footer>
    </>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const own = bought().includes(agent.id)
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
          className="icon-btn"
          aria-label={t("common.view")}
        >
          <ArrowLeft size={18} />
        </Link>
      </div>
    </article>
  )
}

function Landing() {
  const { t, n } = useI18n()
  const steps = [
    ["۰۱", t("landing.step1t"), t("landing.step1d")],
    ["۰۲", t("landing.step2t"), t("landing.step2d")],
    ["۰۳", t("landing.step3t"), t("landing.step3d")],
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
        <div className="mx-auto grid min-h-[620px] max-w-7xl place-items-center px-5 py-24 text-center">
          <div className="max-w-4xl">
            <p className="eyebrow">
              <Sparkles size={14} /> {t("landing.eyebrow")}
            </p>
            <h1 className="mt-7 text-5xl font-black leading-[1.2] tracking-tight md:text-7xl">
              {t("landing.title1")}
              <br />
              <span className="text-violet-300">{t("landing.title2")}</span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-slate-300">
              {t("landing.subtitle")}
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link className="btn btn-large" to="/signup">
                {t("landing.cta")} <ArrowLeft size={18} />
              </Link>
              <Link className="btn btn-soft btn-large" to="/marketplace">
                {t("landing.seeAgents")}
              </Link>
            </div>
            <div className="mt-14 flex flex-wrap justify-center gap-8 text-sm text-slate-400">
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
            {t("landing.seeAll")} ←
          </Link>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {agents
            .filter((a) => a.featured)
            .slice(0, 6)
            .map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
        </div>
      </section>
      <section id="how" className="section">
        <p className="eyebrow">{t("landing.howEyebrow")}</p>
        <h2 className="mb-10">{t("landing.howTitle")}</h2>
        <div className="grid gap-px overflow-hidden rounded-3xl border border-white/8 bg-white/8 md:grid-cols-3">
          {steps.map((x) => (
            <div className="bg-[#101936] p-8" key={x[0]}>
              <b className="text-4xl text-violet-400">{n(Number(x[0]))}</b>
              <h3 className="mt-12 text-xl font-bold">{x[1]}</h3>
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
            <details className="group px-6 py-5" key={q}>
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
  const cats = useMemo(
    () => [
      { slug: "all", label: t("common.all") },
      ...divisions.map((d) => ({ slug: d.slug, label: division(d) })),
    ],
    [divisions, division, t],
  )
  const allLabel = t("common.all")
  const list = useMemo(
    () =>
      agents
        .filter(
          (a) =>
            (!cat || cat === allLabel || a.category === cat) &&
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
    [q, cat, sort, allLabel, agentName, agentDescription, agentDivision],
  )
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
      <div className="mt-6 flex flex-wrap gap-2">
        {cats.map((c) => (
          <button
            onClick={() => setCat(c.label)}
            className={`tab ${cat === c.label ? "active" : ""}`}
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
  const a = agents.find((x) => x.slug === slug)
  const nav = useNavigate()
  const [notice, setNotice] = useState("")
  const { t, n, toman, agentDivision } = useI18n()
  if (!a) return <Navigate to="/marketplace" />
  const agentId = a.id
  const own = bought().includes(agentId)
  function purchase() {
    if (!logged()) return nav("/login")
    buy(agentId)
    setNotice(t("common.owned"))
  }
  return (
    <main className="section">
      <Link to="/marketplace" className="text-sm text-slate-400">
        → {t("detail.back")}
      </Link>
      <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_.8fr]">
        <div>
          <div className="flex gap-5">
            <span className="grid size-22 place-items-center rounded-3xl bg-violet-500/15 text-5xl">
              {a.icon}
            </span>
            <div>
              <p className="eyebrow">{agentDivision(a)}</p>
              <h1 className="mt-2 text-4xl font-black">{a.name}</h1>
              <p className="mt-2 text-amber-300">
                ★ {n(a.rating)}{" "}
                <span className="mx-2 text-slate-500">
                  ({n(a.sales)} {t("common.sales")})
                </span>
              </p>
            </div>
          </div>
          <p className="mt-10 max-w-2xl text-lg leading-9 text-slate-300">
            {a.longDescription}
          </p>
          <h2 className="mt-10 text-xl font-bold">{t("detail.whatItDoes")}</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {a.features.map((f) => (
              <li className="flex gap-2 text-slate-300" key={f}>
                <Check size={18} className="text-emerald-400" />
                {f}
              </li>
            ))}
          </ul>
          <h2 className="mt-10 text-xl font-bold">{t("detail.startHere")}</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {a.prompts.map((p) => (
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
        <aside className="sticky top-24 h-fit rounded-3xl border border-violet-400/25 bg-violet-500/8 p-7">
          <span className="badge">{t("detail.guarantee")}</span>
          <div className="mt-8 text-3xl font-black">{toman(a.price)}</div>
          <p className="mt-2 text-sm text-slate-400">{t("detail.lifetime")}</p>
          <button
            className="btn mt-7 w-full justify-center"
            onClick={own ? () => nav(`/chat/${a.id}`) : purchase}
          >
            {own ? t("common.startChat") : t("common.buy")}
            <ArrowLeft size={17} />
          </button>
          <button
            className="btn btn-soft mt-3 w-full justify-center"
            onClick={() => nav(`/chat/${a.id}`)}
          >
            {t("detail.preview")}
          </button>
          {notice && <p className="mt-4 text-sm text-emerald-300">✓ {notice}</p>}
        </aside>
      </div>
    </main>
  )
}

function Auth({ signup = false }: { signup?: boolean }) {
  const nav = useNavigate()
  const [gift, setGift] = useState(false)
  const { t } = useI18n()
  function submit(e: FormEvent) {
    e.preventDefault()
    localStorage.setItem("agentfa-user", t("dash.friend"))
    if (signup) setGift(true)
    else nav("/dashboard")
  }
  return (
    <main className="grid min-h-[calc(100vh-73px)] place-items-center p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[.03] p-7 shadow-2xl"
      >
        <p className="eyebrow">{t("auth.welcome")}</p>
        <h1 className="mt-3 text-3xl font-black">
          {signup ? t("auth.signupTitle") : t("auth.loginTitle")}
        </h1>
        {signup && (
          <input className="field mt-8" placeholder={t("auth.fullName")} required />
        )}
        <input
          className="field mt-4"
          type="email"
          placeholder={t("auth.email")}
          required
        />
        <input
          className="field mt-4"
          type="password"
          placeholder={t("auth.password")}
          required
        />
        {signup && (
          <input
            className="field mt-4"
            type="password"
            placeholder={t("auth.confirmPassword")}
            required
          />
        )}
        <button className="btn mt-6 w-full justify-center">
          {signup ? t("auth.signupBtn") : t("auth.loginBtn")}
          <ArrowLeft size={17} />
        </button>
        <div className="my-6 h-px bg-white/10" />
        <button
          type="button"
          onClick={() => {
            localStorage.setItem("agentfa-user", t("dash.friend"))
            nav("/dashboard")
          }}
          className="btn btn-soft w-full justify-center"
        >
          {t("auth.google")}
        </button>
        {!signup && (
          <Link
            className="mt-5 block text-center text-sm text-violet-300"
            to="/reset-password"
          >
            {t("auth.forgot")}
          </Link>
        )}
        <p className="mt-6 text-center text-sm text-slate-400">
          {signup ? (
            <>
              {t("auth.haveAccount")}{" "}
              <Link className="text-violet-300" to="/login">
                {t("auth.enter")}
              </Link>
            </>
          ) : (
            <>
              {t("auth.noAccount")}{" "}
              <Link className="text-violet-300" to="/signup">
                {t("auth.join")}
              </Link>
            </>
          )}
        </p>
      </form>
      {gift && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4">
          <div className="w-full max-w-sm rounded-3xl border border-violet-400/30 bg-[#101936] p-7 text-center">
            <Sparkles className="mx-auto text-violet-300" />
            <h2 className="mt-5 text-2xl font-black">{t("auth.giftTitle")}</h2>
            <p className="mt-3 text-slate-300">{t("auth.giftBody")}</p>
            <button className="btn mt-7" onClick={() => nav("/dashboard")}>
              {t("auth.goDashboard")} <ArrowLeft size={16} />
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

function Verify() {
  const { t } = useI18n()
  return (
    <main className="grid min-h-[calc(100vh-73px)] place-items-center p-5">
      <section className="max-w-md rounded-3xl border border-white/10 bg-white/[.03] p-8 text-center">
        <Sparkles className="mx-auto text-violet-300" />
        <h1 className="mt-5 text-2xl font-black">{t("verify.title")}</h1>
        <p className="mt-4 leading-8 text-slate-400">{t("verify.body")}</p>
        <button className="btn btn-soft mt-7">{t("verify.resend")}</button>
      </section>
    </main>
  )
}

function Reset() {
  const [done, setDone] = useState(false)
  const { t } = useI18n()
  return (
    <main className="grid min-h-[calc(100vh-73px)] place-items-center p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setDone(true)
        }}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[.03] p-7"
      >
        <h1 className="text-2xl font-black">{t("reset.title")}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          {t("reset.body")}
        </p>
        <input
          className="field mt-6"
          type="email"
          placeholder={t("auth.email")}
          required
        />
        <button className="btn mt-5 w-full justify-center">
          {t("reset.btn")}
        </button>
        {done && (
          <p className="mt-4 text-center text-sm text-emerald-300">
            {t("reset.sent")}
          </p>
        )}
      </form>
    </main>
  )
}

function Dashboard() {
  const own = agents.filter((a) => bought().includes(a.id))
  const { t, n } = useI18n()
  const stats: [string, string, typeof Wallet][] = [
    ["۵۰٬۰۰۰", t("dash.balance"), Wallet],
    [n(own.length), t("dash.myAgents"), Bot],
    ["۰", t("dash.chats"), MessageSquare],
  ]
  return (
    <main className="section">
      <p className="eyebrow">{t("dash.eyebrow")}</p>
      <h1 className="page-title">
        {t("dash.hello", { name: logged() || t("dash.friend") })}
      </h1>
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
          <div className="chart mt-8 flex items-end gap-2">
            {[24, 38, 29, 54, 41, 67, 47, 72, 58, 87, 65, 38].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
        </section>
        <section className="rounded-3xl border border-violet-400/20 bg-violet-500/8 p-6">
          <Sparkles className="text-violet-300" />
          <h2 className="mt-8 text-xl font-bold">{t("dash.ready")}</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            {t("dash.readyBody")}
          </p>
          <Link className="btn mt-6" to="/marketplace">
            {t("dash.goShop")} <ArrowLeft size={16} />
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
    </main>
  )
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Shell,
    children: [
      { index: true, Component: Landing },
      { path: "marketplace", Component: Marketplace },
      { path: "agent/:slug", Component: Detail },
      { path: "chat/:agentId", Component: Chat },
      { path: "dashboard", Component: Dashboard },
      { path: "pricing", Component: Pricing },
      { path: "admin", Component: Admin },
      { path: "login", Component: () => <Auth /> },
      { path: "signup", Component: () => <Auth signup /> },
      { path: "verify", Component: Verify },
      { path: "reset-password", Component: Reset },
      { path: "*", Component: () => <Navigate to="/" /> },
    ],
  },
])
