import { FormEvent, useState } from "react"
import { Download, Paperclip, Send, Trash2, Wallet, X } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { agents } from "../data/agents"
import {
  canSend,
  getWallet,
  recordUsage,
  topUp,
  Wallet as WalletType,
} from "../lib/mock-store"
import { useI18n } from "../lib/i18n"

type Message = {
  role: "assistant" | "user"
  text: string
  time: string
  tokens?: number
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

export default function Chat() {
  const { agentId } = useParams()
  const agent = agents.find((a) => a.id === agentId)
  const { t, n, toman, lang } = useI18n()
  const [wallet, setWallet] = useState<WalletType>(getWallet())
  const fresh = () =>
    agent
      ? [{ role: "assistant" as const, text: agent.welcome, time: t("chat.now") }]
      : []
  const [messages, setMessages] = useState<Message[]>(fresh)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [modal, setModal] = useState(false)

  if (!agent)
    return (
      <main className="section text-center">
        <h1 className="text-3xl font-black">{t("chat.notFound")}</h1>
      </main>
    )

  const estimate = (s: string) =>
    Math.max(
      80,
      Math.ceil(s.length / 2) +
        messages.slice(-10).reduce((acc, m) => acc + m.text.length / 2, 0) +
        120,
    )

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!input.trim() || loading) return
    const need = estimate(input)
    const result = canSend(need)
    if (!result.ok) {
      setError(
        result.code === "rate" ? t("chat.errorRequests") : t("chat.errorBalance"),
      )
      setModal(true)
      return
    }
    const now = new Date().toLocaleTimeString(
      lang === "fa" ? "fa-IR" : "en-US",
      { hour: "2-digit", minute: "2-digit" },
    )
    setMessages((m) => [...m, { role: "user", text: input, time: now }])
    setInput("")
    setLoading(true)
    setError("")
    setTimeout(() => {
      const used = Math.min(need, 256)
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `${t("chat.mockReply")}\n\n\`\`\`ts\nawait chat.stream(message)\n\`\`\``,
          time: now,
          tokens: used,
        },
      ])
      setWallet(recordUsage(used))
      setLoading(false)
    }, 600)
  }

  function download() {
    const data = messages
      .map(
        (m) =>
          `[${m.time}] ${
            m.role === "user" ? t("chat.you") : agent!.name
          }: ${m.text}`,
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

  const percentage = wallet.tokenBalance / wallet.monthlyTokenLimit
  const used = messages.reduce((acc, m) => acc + (m.tokens || 0), 0)

  return (
    <main className="mx-auto flex h-[calc(100vh-73px)] max-w-7xl gap-4 p-4">
      <aside className="hidden w-70 shrink-0 rounded-2xl border border-white/8 bg-white/[.03] p-4 lg:block">
        <button
          className="btn w-full justify-center text-sm"
          onClick={() => setMessages(fresh())}
        >
          {t("chat.newChat")}
        </button>
        <p className="mt-7 text-xs text-slate-500">{t("chat.agentChats")}</p>
        <div className="mt-3 rounded-xl bg-white/7 p-3 text-sm">
          {t("chat.newChatTitle")}
          <br />
          <span className="text-xs text-slate-500">
            {t("chat.now")} · {n(used)} {t("common.token")}
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
                ● {t("chat.online")}
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
              onClick={() => setMessages(fresh())}
              aria-label={t("chat.clearChat")}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </header>
        {percentage < 0.2 && (
          <div
            className={`mx-5 mt-4 rounded-xl p-3 text-sm ${
              percentage < 0.1
                ? "bg-red-500/15 text-red-100"
                : "bg-amber-400/10 text-amber-100"
            }`}
          >
            {t("chat.lowBalance")}
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
                    ? `${t("chat.usagePrefix", {
                        tokens: n(m.tokens),
                      })} · `
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
          <p className="mt-4 text-xs text-slate-500">{t("chat.yourBalance")}</p>
          <b className="mt-1 block text-xl">{n(wallet.tokenBalance)}</b>
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
                  <span className="text-violet-300">
                    {toman([50000, 130000, 400000][i])}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}