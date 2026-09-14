import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { Download, Lock, Paperclip, Send, Sparkles, Trash2, Wallet, X } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { agents } from "../data/agents"
import {
  MIN_TIME_CHARGE_SECONDS,
  canSend,
  getWallet,
  ownsAgent,
  recordUsage,
  topUp,
  Wallet as WalletType,
} from "../lib/mock-store"
import {
  ProviderError,
  agentSystemPrompt,
  chargeFor,
  estimateTokens,
  providerErrorKey,
  streamChat,
} from "../lib/provider-client"
import {
  activeProvider,
  providerCoversAgent,
  type MeterMode,
} from "../lib/provider"
import { useI18n } from "../lib/i18n"

type Message = {
  role: "assistant" | "user"
  text: string
  time: string
  tokens?: number
  seconds?: number
  /** True while chunks are still arriving. */
  streaming?: boolean
}

function Code({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <>
      {text.split(/(```[\s\S]*?```)/g).map((part, i) =>
        part.startsWith("```") ? (
          <div className="code-block" key={i}>
            <button
              onClick={() => navigator.clipboard.writeText(part.slice(3, -3))}
            >
              {t("common.copy")}
            </button>
            <pre>{part.slice(3, -3)}</pre>
          </div>
        ) : (
          part
        ),
      )}
    </>
  )
}

const bundleTokens = [100000, 300000, 1000000]
const bundlePrices = [50000, 130000, 400000]
/** Time passes, for profiles on the time meter: [minutes, Toman]. */
const timePasses: [number, number][] = [
  [60, 30000],
  [300, 120000],
  [1200, 400000],
]

export default function Chat() {
  const { agentId } = useParams()
  const [params] = useSearchParams()
  const agent = useMemo(() => agents.find((a) => a.id === agentId), [agentId])
  const { t, n, toman, lang } = useI18n()
  const [wallet, setWallet] = useState<WalletType>(getWallet())
  const [persona, setPersona] = useState("")
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [modal, setModal] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const profile = activeProvider()
  const owned = agent ? ownsAgent(agent.id) : false
  const covered = !profile || !agent ? true : providerCoversAgent(profile, agent.id)
  const meter: MeterMode = profile?.meter ?? "tokens"

  const fresh = useMemo(
    (): Message[] =>
      agent
        ? [{ role: "assistant", text: agent.welcome, time: t("chat.now") }]
        : [],
    [agent, t],
  )
  const [messages, setMessages] = useState<Message[]>(fresh)

  // Personas ship as a separate generated chunk — never loaded by the
  // marketplace, only when a chat actually opens.
  useEffect(() => {
    let alive = true
    import("../data/personas.generated")
      .then((mod) => {
        if (alive) setPersona(agent ? mod.personas[agent.id] || "" : "")
      })
      .catch(() => alive && setPersona(""))
    return () => {
      alive = false
    }
  }, [agent])

  // A different agent starts a different conversation; language changes don't.
  useEffect(() => setMessages(fresh), [agent])

  const preset = params.get("prompt")
  useEffect(() => {
    if (preset) setInput(preset)
  }, [preset])

  // Never leave a stream running against an unmounted page.
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!agent)
    return (
      <main className="section text-center">
        <h1 className="text-3xl font-black">{t("chat.notFound")}</h1>
      </main>
    )

  const estimate = (s: string) =>
    Math.max(
      80,
      estimateTokens(s) +
        messages.slice(-10).reduce((acc, m) => acc + estimateTokens(m.text), 0) +
        120,
    )

  const need = () =>
    meter === "time" ? MIN_TIME_CHARGE_SECONDS : estimate(input)

  const stamp = () =>
    new Date().toLocaleTimeString(lang === "fa" ? "fa-IR" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    })

  const appendDelta = (chunk: string) =>
    setMessages((m) => {
      const copy = [...m]
      const last = copy[copy.length - 1]
      if (last?.role === "assistant" && last.streaming)
        copy[copy.length - 1] = { ...last, text: last.text + chunk }
      return copy
    })

  function fail(code: string) {
    setError(t(providerErrorKey(code as Parameters<typeof providerErrorKey>[0])))
  }

  function reset() {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages(fresh)
    setInput("")
    setError("")
    setLoading(false)
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const target = agent
    if (!target || !input.trim() || loading) return

    // "Agents only" — a provider call needs an owned agent and a covered
    // credential, before we spend anything.
    if (!owned) return fail("not_owned")
    if (!covered) return fail("not_covered")

    const check = canSend(meter, need())
    if (!check.ok) {
      setError(
        check.code === "rate"
          ? t("chat.errorRequests")
          : t(meter === "time" ? "chat.errorTime" : "chat.errorBalance"),
      )
      setModal(true)
      return
    }

    const text = input
    const now = stamp()
    setMessages((m) => [...m, { role: "user", text, time: now }])
    setInput("")
    setError("")
    setLoading(true)

    // No provider configured → stay in demo mode so the app still shows its
    // shape end to end (clearly labelled as such).
    if (!profile) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `${t("chat.demoNotice")}\n\n${t("chat.mockReply")}\n\n\`\`\`ts\nawait chat.stream(message)\n\`\`\``,
          time: now,
          tokens: Math.min(estimate(text), 256),
        },
      ])
      setWallet(recordUsage("tokens", Math.min(estimate(text), 256)))
      setLoading(false)
      return
    }

    const history = messages
      .filter((m) => !m.streaming && m.text)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.text }))

    setMessages((m) => [...m, { role: "assistant", text: "", time: now, streaming: true }])
    const controller = new AbortController()
    abortRef.current = controller

    // Hard stop at the allowance boundary: the pre-check reserves an estimate,
    // this makes sure a runaway answer can't spend past what's actually left.
    const budget = {
      tokens:
        meter === "time"
          ? Number.MAX_SAFE_INTEGER
          : Math.max(
              0,
              Math.min(
                wallet.tokenBalance,
                wallet.monthlyTokenLimit - wallet.monthlyUsage,
              ),
            ),
      seconds:
        meter === "tokens"
          ? Number.MAX_SAFE_INTEGER
          : Math.max(
              0,
              Math.min(
                wallet.timeBalanceSeconds,
                wallet.monthlyTimeLimitSeconds - wallet.monthlyTimeUsedSeconds,
              ),
            ),
    }

    try {
      const outcome = await streamChat({
        profile,
        system: agentSystemPrompt({
          name: target.name,
          description: target.description,
          persona:
            persona || `${target.longDescription}\n\n${target.features.join("\n")}`,
          lang,
        }),
        history,
        message: text,
        onDelta: appendDelta,
        signal: controller.signal,
        budget,
      })
      setMessages((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last?.role === "assistant")
          copy[copy.length - 1] = {
            ...last,
            text: outcome.text || last.text,
            streaming: false,
            tokens: meter === "tokens" ? outcome.tokens : undefined,
            seconds: meter === "time" ? outcome.seconds : undefined,
          }
        return copy
      })
      setWallet(recordUsage(meter, chargeFor(meter, outcome)))
      if (outcome.truncated) setError(t("chat.error.budget"))
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : "network"
      fail(code)
      // Drop the empty bubble; keep a partial answer if some text arrived.
      setMessages((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last?.role === "assistant" && last.streaming) {
          if (last.text) copy[copy.length - 1] = { ...last, streaming: false }
          else copy.pop()
        }
        return copy
      })
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  function download() {
    const data = messages
      .map(
        (m) =>
          `[${m.time}] ${m.role === "user" ? t("chat.you") : agent!.name}: ${m.text}`,
      )
      .join("\n\n")
    const u = URL.createObjectURL(
      new Blob([data], { type: "text/plain;charset=utf-8" }),
    )
    const a = document.createElement("a")
    a.href = u
    a.download = `chat-${agent!.slug}.txt`
    a.click()
    URL.revokeObjectURL(u)
  }

  const ratio =
    meter === "time"
      ? wallet.timeBalanceSeconds / wallet.monthlyTimeLimitSeconds
      : wallet.tokenBalance / wallet.monthlyTokenLimit
  const used = messages.reduce((acc, m) => acc + (m.tokens || 0), 0)
  const spent = messages.reduce((acc, m) => acc + (m.seconds || 0), 0)
  const minutes = (seconds: number) => n(Math.max(1, Math.round(seconds / 60)))

  if (!owned)
    return (
      <main className="section grid min-h-[60vh] place-items-center text-center">
        <div className="max-w-lg rounded-3xl border border-white/10 bg-white/[.03] p-8">
          <Lock className="mx-auto text-violet-300" />
          <h1 className="mt-5 text-2xl font-black">{t("chat.lockedTitle")}</h1>
          <p className="mt-4 leading-8 text-slate-400">{t("chat.lockedBody")}</p>
          <Link className="btn mt-7" to={`/agent/${agent.slug}`}>
            {t("chat.lockedCta")}
          </Link>
        </div>
      </main>
    )

  return (
    <main className="mx-auto flex h-[calc(100vh-73px)] max-w-7xl gap-4 p-4">
      <aside className="hidden w-70 shrink-0 rounded-2xl border border-white/8 bg-white/[.03] p-4 lg:block">
        <button
          className="btn w-full justify-center text-sm"
          onClick={reset}
        >
          {t("chat.newChat")}
        </button>
        <p className="mt-7 text-xs text-slate-500">{t("chat.agentChats")}</p>
        <div className="mt-3 rounded-xl bg-white/7 p-3 text-sm">
          {t("chat.newChatTitle")}
          <br />
          <span className="text-xs text-slate-500">
            {t("chat.now")} ·{" "}
            {meter === "time"
              ? `${minutes(spent)} ${t("chat.minutes")}`
              : `${n(used)} ${t("common.token")}`}
          </span>
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-white/8 bg-[#101936]">
        <header className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex gap-3">
            <span className="text-2xl">{agent.icon}</span>
            <div>
              <b>{agent.name}</b>
              <small className="block text-emerald-400">
                ● {t(profile ? "chat.online" : "chat.demoMode")}
              </small>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="icon-btn"
              onClick={download}
              aria-label={t("chat.download")}
            >
              <Download size={18} />
            </button>
            <button
              className="icon-btn"
              onClick={reset}
              aria-label={t("chat.clearChat")}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </header>
        {ratio < 0.2 && (
          <div
            className={`mx-5 mt-4 rounded-xl p-3 text-sm ${
              ratio < 0.1
                ? "bg-red-500/15 text-red-100"
                : "bg-amber-400/10 text-amber-100"
            }`}
          >
            {t(meter === "time" ? "chat.lowTime" : "chat.lowBalance")}
          </div>
        )}
        {!profile && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-violet-500/10 p-3 text-sm text-violet-100">
            <Sparkles size={16} className="mt-1 shrink-0" />
            {t("chat.demoNotice")}
          </div>
        )}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div
              className={`flex ${
                m.role === "user" ? "justify-start" : "justify-end"
              }`}
              key={i}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 ${
                  m.role === "user"
                    ? "bg-violet-600"
                    : "border border-white/8 bg-white/[.04]"
                }`}
              >
                <Code text={m.text} />
                <small className="mt-2 block text-slate-500">
                  {m.tokens
                    ? `${t("chat.usagePrefix", { tokens: n(m.tokens) })} · `
                    : ""}
                  {m.seconds
                    ? `${t("chat.usageTime", { minutes: minutes(m.seconds) })} · `
                    : ""}
                  {m.time}
                </small>
              </div>
            </div>
          ))}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2">
              {agent.prompts.map((p) => (
                <button className="prompt" key={p} onClick={() => setInput(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div className="typing">
              <i />
              <i />
              <i />
            </div>
          )}
          {error && !modal && <p className="text-sm text-red-200">{error}</p>}
        </div>
        <form onSubmit={submit} className="border-t border-white/8 p-4">
          <div className="flex items-end gap-3 rounded-2xl border border-white/10 bg-[#0b1124] p-2">
            <button
              type="button"
              disabled
              className="icon-btn opacity-35"
              aria-label={t("chat.attach")}
            >
              <Paperclip size={18} />
            </button>
            <textarea
              className="min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={t("chat.inputPlaceholder")}
            />
            <button
              className="icon-btn bg-violet-600 text-white"
              aria-label={t("chat.send")}
              disabled={loading}
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </section>
      <aside className="hidden w-62 shrink-0 rounded-2xl border border-white/8 bg-white/[.03] p-5 xl:block">
        <span className="text-4xl">{agent.icon}</span>
        <h2 className="mt-3 font-bold">{agent.name}</h2>
        <p className="mt-1 text-sm text-slate-500">{agent.category}</p>
        <div className="mt-8 border-y border-white/8 py-5">
          <p className="text-xs text-slate-500">{t("chat.thisChatUsage")}</p>
          <b className="mt-1 block">
            {n(used)} {t("common.token")}
          </b>
          <b className="mt-1 block">
            {minutes(spent)} {t("chat.minutes")}
          </b>
          <p className="mt-4 text-xs text-slate-500">{t("chat.yourBalance")}</p>
          <b className="mt-1 block text-xl">{n(wallet.tokenBalance)}</b>
          <p className="mt-2 text-xs text-slate-500">{t("chat.yourTime")}</p>
          <b className="mt-1 block text-xl">
            {minutes(wallet.timeBalanceSeconds)}
          </b>
        </div>
        <button
          className="btn btn-soft mt-5 w-full justify-center text-xs"
          onClick={() => setModal(true)}
        >
          <Wallet size={15} /> {t("chat.buyMore")}
        </button>
        <Link
          className="btn btn-soft mt-3 w-full justify-center text-xs"
          to="/pricing"
        >
          {t("chat.upgrade")}
        </Link>
      </aside>
      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101936] p-6">
            <button
              onClick={() => setModal(false)}
              className="float-left text-slate-400"
            >
              <X />
            </button>
            <h2 className="text-xl font-bold">{t("chat.buyTokens")}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              {error || t("chat.chooseBundle")}
            </p>
            <div className="mt-6 grid gap-3">
              {bundleTokens.map((tokens, i) => (
                <button
                  key={tokens}
                  onClick={() => {
                    setWallet(topUp(tokens))
                    setError("")
                    setModal(false)
                  }}
                  className="flex justify-between rounded-xl border border-white/10 p-4 hover:border-violet-400"
                >
                  <b>
                    {n(tokens)} {t("common.token")}
                  </b>
                  <span className="text-violet-300">{toman(bundlePrices[i])}</span>
                </button>
              ))}
            </div>
            <h3 className="mt-7 text-sm font-bold">{t("chat.timePasses")}</h3>
            <div className="mt-3 grid gap-3">
              {timePasses.map(([mins, price]) => (
                <button
                  key={mins}
                  onClick={() => {
                    setWallet(topUp(0, mins))
                    setError("")
                    setModal(false)
                  }}
                  className="flex justify-between rounded-xl border border-white/10 p-4 hover:border-violet-400"
                >
                  <b>
                    {n(mins)} {t("chat.minutes")}
                  </b>
                  <span className="text-violet-300">{toman(price)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
