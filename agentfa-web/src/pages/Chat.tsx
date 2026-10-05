import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Lock, Plus, Paperclip, Send, Sparkles, Trash2, Wallet } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { agents } from "../data/agents";
import {
  ApiError,
  api,
  goToGateway,
  streamAgentChat,
  type ConversationSummary,
  type StoredMessage,
  type WalletSnapshot,
} from "../lib/account";
import { Modal } from "../components/Modal";
import { useSession } from "../lib/session";
import { useEntitlements } from "../lib/useEntitlements";
import { usePricing } from "../lib/pricing";
import { useI18n } from "../lib/i18n";

type Message = {
  role: "assistant" | "user";
  text: string;
  /** Pre-formatted clock time for the bubble footer. */
  time: string;
  tokens?: number;
  seconds?: number;
  streaming?: boolean;
};

type Preview = { owned: boolean; limit: number; used: number; remaining: number };

function Code({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <>
      {text.split(/(```[\s\S]*?```)/g).map((part, i) =>
        part.startsWith("```") ? (
          <div className="code-block" key={i}>
            <button onClick={() => navigator.clipboard.writeText(part.slice(3, -3))}>
              {t("common.copy")}
            </button>
            <pre>{part.slice(3, -3)}</pre>
          </div>
        ) : (
          part
        ),
      )}
    </>
  );
}

const EMPTY_WALLET: WalletSnapshot = {
  plan: "free",
  tokenBalance: 0,
  timeBalanceSeconds: 0,
  monthlyTokenLimit: 1,
  monthlyTimeLimitSeconds: 1,
  monthlyUsage: 0,
  monthlyTimeUsedSeconds: 0,
};

export default function Chat() {
  const { agentId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const agent = useMemo(() => agents.find((a) => a.id === agentId), [agentId]);
  const { t, n, toman, lang, agentName, agentPrompts, agentWelcome } = useI18n();
  const { user, loading: sessionLoading } = useSession();
  const { owns, refresh: refreshEntitlements } = useEntitlements();
  const { prices } = usePricing();

  const [wallet, setWallet] = useState<WalletSnapshot>(EMPTY_WALLET);
  const [meter, setMeter] = useState<"tokens" | "time">("tokens");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const owned = agent ? owns(agent.id) : false;
  const locale = lang === "fa" ? "fa-IR" : "en-US";

  const stamp = useCallback(
    (value?: string) =>
      new Date(value ?? Date.now()).toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );

  const fresh = useMemo(
    (): Message[] =>
      agent ? [{ role: "assistant", text: agentWelcome(agent), time: stamp() }] : [],
    [agent, agentWelcome, stamp],
  );
  const [messages, setMessages] = useState<Message[]>(fresh);

  // A fresh agent (or a fresh greeting) starts a new thread.
  useEffect(() => {
    setMessages(fresh);
    setActiveId(null);
  }, [fresh]);

  const preset = params.get("prompt");
  useEffect(() => {
    if (preset) setInput(preset);
  }, [preset]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refreshConversations = useCallback(async () => {
    if (!agent || !user) return;
    try {
      const { conversations: list } = await api.conversations(agent.id);
      setConversations(list);
    } catch {
      /* an empty sidebar is not worth an error banner */
    }
  }, [agent, user]);

  // Server-side wallet and preview state; neither is ever trusted from storage.
  useEffect(() => {
    if (!agent || !user) return;
    let alive = true;
    void api
      .wallet()
      .then((w) => alive && setWallet(w))
      .catch(() => {});
    void api
      .preview(agent.id)
      .then((p) => alive && setPreview(p))
      .catch(() => {});
    void refreshConversations();
    return () => {
      alive = false;
    };
  }, [agent, user, refreshConversations]);

  if (sessionLoading) return null;

  if (!agent)
    return (
      <main className="section text-center">
        <h1 className="text-3xl font-black">{t("chat.notFound")}</h1>
      </main>
    );

  const previewExhausted = !owned && preview !== null && preview.remaining <= 0;
  const previewActive = !owned && !previewExhausted;

  const appendDelta = (chunk: string) =>
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant" && last.streaming)
        copy[copy.length - 1] = { ...last, text: last.text + chunk };
      return copy;
    });

  /** Stores the dictionary key so the message follows a language switch. */
  function fail(code: string) {
    const key = `chat.error.${code}`;
    // `t` returns the key itself when neither dictionary has it.
    const known = t(key) !== key;
    setError(known ? key : "chat.error.server");
  }

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages(fresh);
    setActiveId(null);
    setInput("");
    setError("");
    setLoading(false);
  }

  async function openConversation(id: string) {
    setError("");
    try {
      const { conversation } = await api.conversation(id);
      setActiveId(conversation.id);
      setMessages(
        conversation.messages.map((m: StoredMessage) => ({
          role: m.role,
          text: m.content,
          time: stamp(m.createdAt),
          tokens: m.tokens || undefined,
          seconds: m.seconds || undefined,
        })),
      );
    } catch (err) {
      fail(err instanceof ApiError ? err.code : "network");
    }
  }

  async function removeConversation(id: string) {
    if (!window.confirm(t("chat.deleteConversation"))) return;
    try {
      await api.deleteConversation(id);
      setConversations((list) => list.filter((c) => c.id !== id));
      if (activeId === id) reset();
    } catch {
      /* the list is refreshed below either way */
    }
    void refreshConversations();
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const target = agent;
    if (!target || !input.trim() || loading) return;

    if (!user) return nav("/login");
    if (previewExhausted) return;

    const text = input;
    const now = stamp();
    setMessages((m) => [...m, { role: "user", text, time: now }]);
    setInput("");
    setError("");
    setLoading(true);
    setMessages((m) => [...m, { role: "assistant", text: "", time: now, streaming: true }]);

    const history = messages
      .filter((m) => !m.streaming && m.text)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.text }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAgentChat({
        agentId: target.id,
        conversationId: activeId ?? undefined,
        message: text,
        history,
        lang,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "delta") {
            appendDelta(event.chunk);
            return;
          }
          if (event.type === "done") {
            setMeter(event.meter);
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant")
                copy[copy.length - 1] = {
                  ...last,
                  streaming: false,
                  tokens: event.meter === "tokens" ? event.charged : undefined,
                  seconds: event.meter === "time" ? event.charged : undefined,
                };
              return copy;
            });
            if (event.truncated) setError("chat.error.budget");
            // The thread now exists server-side: remember it so the next turn
            // continues the same conversation and the sidebar shows it.
            setActiveId((current) => current ?? event.conversationId);
            setPreview((p) =>
              p && !p.owned
                ? { ...p, used: p.used + 1, remaining: event.previewRemaining ?? Math.max(0, p.remaining - 1) }
                : p,
            );
            void api.wallet().then(setWallet).catch(() => {});
            void refreshConversations();
            return;
          }
          if (event.type === "error") fail(event.error);
        },
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "network";
      fail(code);
      if (code === "not_owned") void api.preview(target.id).then(setPreview).catch(() => {});
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          if (last.text) copy[copy.length - 1] = { ...last, streaming: false };
          else copy.pop();
        }
        return copy;
      });
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  async function topUp(tokens: number, minutes: number) {
    try {
      const { redirectUrl } = await api.topUp(tokens, minutes);
      // The balance only changes once the gateway confirms the payment; until
      // then we hand off to checkout and let /payment-required report the result.
      if (goToGateway(redirectUrl)) return;
      setWallet(await api.wallet());
      setModal(false);
      void refreshEntitlements();
    } catch (err) {
      fail(err instanceof ApiError ? err.code : "network");
    }
  }

  function download() {
    const target = agent;
    if (!target) return;
    const data = messages
      .map((m) => `[${m.time}] ${m.role === "user" ? t("chat.you") : agentName(target)}: ${m.text}`)
      .join("\n\n");
    const u = URL.createObjectURL(new Blob([data], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = `chat-${target.slug}.txt`;
    a.click();
    URL.revokeObjectURL(u);
  }

  const ratio =
    meter === "time"
      ? wallet.timeBalanceSeconds / Math.max(1, wallet.monthlyTimeLimitSeconds)
      : wallet.tokenBalance / Math.max(1, wallet.monthlyTokenLimit);
  const used = messages.reduce((acc, m) => acc + (m.tokens || 0), 0);
  const spent = messages.reduce((acc, m) => acc + (m.seconds || 0), 0);
  const minutes = (seconds: number) => n(Math.max(1, Math.round(seconds / 60)));

  if (!user)
    return (
      <main className="section grid min-h-[60vh] place-items-center text-center">
        <div className="max-w-lg rounded-3xl border border-line bg-surface p-8">
          <Lock className="mx-auto text-brand" />
          <h1 className="mt-5 text-2xl font-black">{t("chat.lockedTitle")}</h1>
          <p className="mt-4 leading-8 text-ink-muted">{t("chat.lockedBody")}</p>
          <Link className="btn mt-7" to="/login">
            {t("nav.login")}
          </Link>
        </div>
      </main>
    );

  if (previewExhausted)
    return (
      <main className="section grid min-h-[60vh] place-items-center text-center">
        <div className="max-w-lg rounded-3xl border border-line bg-surface p-8">
          <Sparkles className="mx-auto text-brand" />
          <h1 className="mt-5 text-2xl font-black">{t("chat.previewEnded")}</h1>
          <p className="mt-4 leading-8 text-ink-muted">{t("chat.lockedBody")}</p>
          <Link className="btn mt-7" to={`/agent/${agent.slug}`}>
            {t("chat.buyAgent")}
          </Link>
        </div>
      </main>
    );

  return (
    <main className="chat-shell mx-auto flex max-w-7xl gap-4 p-3 sm:p-4">
      <aside className="hidden w-70 shrink-0 rounded-2xl border border-line bg-surface-2/50 p-4 lg:block">
        <button className="btn w-full justify-center text-sm" onClick={reset}>
          <Plus size={15} /> {t("chat.newChat")}
        </button>
        <p className="mt-7 text-xs text-ink-muted">{t("chat.conversations")}</p>
        <div className="mt-3 space-y-2">
          {conversations.length === 0 && (
            <p className="text-xs text-ink-muted">{t("chat.noConversations")}</p>
          )}
          {conversations.map((conversation) => (
            <div
              className={`group flex items-center gap-1 rounded-xl p-2 text-sm ${
                activeId === conversation.id ? "bg-surface" : "hover:bg-surface"
              }`}
              key={conversation.id}
            >
              <button
                className="min-w-0 flex-1 text-start"
                onClick={() => void openConversation(conversation.id)}
              >
                <span className="block truncate">{conversation.title || t("chat.untitled")}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {n(conversation.totalTokens)} {t("common.token")}
                </span>
              </button>
              <button
                className="icon-btn size-7 shrink-0 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                onClick={() => void removeConversation(conversation.id)}
                aria-label={t("common.delete")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-line bg-surface">
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-2xl">{agent.icon}</span>
            <div className="min-w-0">
              <b className="block truncate">{agentName(agent)}</b>
              <small className="block text-emerald-400">● {t("chat.online")}</small>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* The wallet sidebar is xl-only, so phones need their own way in. */}
            <button
              className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted xl:hidden"
              onClick={() => setModal(true)}
              title={t("chat.buyMore")}
              aria-label={t("chat.buyMore")}
            >
              <Wallet size={14} />
              {n(wallet.tokenBalance)}
            </button>
            <button className="icon-btn" onClick={download} aria-label={t("chat.download")}>
              <Download size={18} />
            </button>
            <button className="icon-btn" onClick={reset} aria-label={t("chat.clearChat")}>
              <Trash2 size={18} />
            </button>
          </div>
        </header>
        {previewActive && (
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-soft p-3 text-sm sm:mx-5 sm:mt-4">
            <span className="text-ink">
              <b>{t("chat.previewBadge")}</b> ·{" "}
              {t("chat.previewLeft", { count: n(preview?.remaining ?? 0) })}
            </span>
            <Link className="text-brand underline" to={`/agent/${agent.slug}`}>
              {t("chat.buyAgent")}
            </Link>
          </div>
        )}
        {!previewActive && ratio < 0.2 && (
          <div
            className={`mx-4 mt-3 rounded-xl p-3 text-sm sm:mx-5 sm:mt-4 ${
              ratio < 0.1 ? "bg-red-500/15 text-red-100" : "bg-amber-400/10 text-amber-100"
            }`}
          >
            {t(meter === "time" ? "chat.lowTime" : "chat.lowBalance")}
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:space-y-5 sm:p-5">
          {messages.map((m, i) => (
            <div className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`} key={i}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 ${
                  m.role === "user" ? "bg-brand" : "border border-line bg-surface-2"
                }`}
              >
                <Code text={m.text} />
                <small className="mt-2 block text-ink-muted">
                  {m.tokens ? `${t("chat.usagePrefix", { tokens: n(m.tokens) })} · ` : ""}
                  {m.seconds ? `${t("chat.usageTime", { minutes: minutes(m.seconds) })} · ` : ""}
                  {m.time}
                </small>
              </div>
            </div>
          ))}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2">
              {agentPrompts(agent).map((p) => (
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
          {error && !modal && <p className="text-sm text-red-200">{t(error)}</p>}
        </div>
        <form onSubmit={submit} className="border-t border-line p-4">
          <div className="flex items-end gap-3 rounded-2xl border border-line bg-surface-2 p-2">
            <button type="button" disabled className="icon-btn opacity-35" aria-label={t("chat.attach")}>
              <Paperclip size={18} />
            </button>
            <textarea
              className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                }
              }}
              placeholder={t("chat.inputPlaceholder")}
            />
            <button
              className="icon-btn bg-brand text-white"
              aria-label={t("chat.send")}
              disabled={loading}
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </section>
      <aside className="hidden w-62 shrink-0 rounded-2xl border border-line bg-surface-2/50 p-5 xl:block">
        <span className="text-4xl">{agent.icon}</span>
        <h2 className="mt-3 font-bold">{agentName(agent)}</h2>
        <p className="mt-1 text-sm text-ink-muted">{agent.category}</p>
        <div className="mt-8 border-y border-line py-5">
          <p className="text-xs text-ink-muted">{t("chat.thisChatUsage")}</p>
          <b className="mt-1 block">
            {n(used)} {t("common.token")}
          </b>
          <b className="mt-1 block">
            {minutes(spent)} {t("chat.minutes")}
          </b>
          <p className="mt-4 text-xs text-ink-muted">{t("chat.yourBalance")}</p>
          <b className="mt-1 block text-xl">{n(wallet.tokenBalance)}</b>
          <p className="mt-2 text-xs text-ink-muted">{t("chat.yourTime")}</p>
          <b className="mt-1 block text-xl">{minutes(wallet.timeBalanceSeconds)}</b>
        </div>
        <button
          className="btn btn-soft mt-5 w-full justify-center text-xs"
          onClick={() => setModal(true)}
        >
          <Wallet size={15} /> {t("chat.buyMore")}
        </button>
        <Link className="btn btn-soft mt-3 w-full justify-center text-xs" to="/pricing">
          {t("chat.upgrade")}
        </Link>
      </aside>
      {modal && (
        <Modal
          title={t("chat.buyTokens")}
          onClose={() => setModal(false)}
          closeLabel={t("common.close")}
        >
          <p className="text-sm leading-7 text-ink-muted">{error || t("chat.chooseBundle")}</p>
          <div className="mt-6 grid gap-3">
            {prices.bundles.map((bundle) => (
              <button
                key={bundle.tokens}
                onClick={() => void topUp(bundle.tokens, 0)}
                disabled={loading}
                className="flex justify-between rounded-xl border border-line p-4 hover:border-brand-border"
              >
                <b>
                  {n(bundle.tokens)} {t("common.token")}
                </b>
                <span className="text-brand">{toman(bundle.price)}</span>
              </button>
            ))}
          </div>
          <h3 className="mt-7 text-sm font-bold">{t("chat.timePasses")}</h3>
          <div className="mt-3 grid gap-3">
            {prices.timePasses.map((pass) => (
              <button
                key={pass.minutes}
                onClick={() => void topUp(0, pass.minutes)}
                disabled={loading}
                className="flex justify-between rounded-xl border border-line p-4 hover:border-brand-border"
              >
                <b>
                  {n(pass.minutes)} {t("chat.minutes")}
                </b>
                <span className="text-brand">{toman(pass.price)}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </main>
  );
}
