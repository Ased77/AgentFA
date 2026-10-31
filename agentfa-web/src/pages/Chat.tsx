import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Paperclip, Plus, Sparkles, Trash2, Wallet } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import PromptBar, { type PromptBarLabels, type PromptBarModel, type PromptBarSource } from "../components/PromptBar";
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

/** Effort step (low → high) → how many characters of each attached file enter the prompt. */
const ATTACH_CAPS = [2_000, 6_000, 12_000, 18_000];
/** Effort slider labels, low → high, per interface language. */
const FA_EFFORTS = ["کم", "متوسط", "زیاد", "بیشینه"];
const EN_EFFORTS = ["Low", "Medium", "High", "Max"];
/** The chat API rejects messages above 20,000 characters; leave a little margin. */
const MESSAGE_CAP = 19_000;
/** Files whose text can be read synchronously in the browser. */
const TEXT_ACCEPT =
  ".txt,.md,.markdown,.json,.csv,.tsv,.log,.xml,.yml,.yaml,.html,.css," +
  ".js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.php,.sql,.sh";

/**
 * Builds the outgoing message: the draft plus each attachment's excerpt. Walks
 * the caps from the chosen effort downwards until everything fits `MESSAGE_CAP`;
 * null means even the smallest excerpt would not fit.
 */
function composeMessage(
  draft: string,
  attachments: { name: string; text: string }[],
  capIndex: number,
): string | null {
  for (let i = capIndex; i >= 0; i -= 1) {
    let out = draft;
    for (const file of attachments) {
      const cap = ATTACH_CAPS[i];
      out += `\n\n--- ${file.name} ---\n${file.text.slice(0, cap)}${file.text.length > cap ? "…" : ""}`;
    }
    if (out.length <= MESSAGE_CAP) return out;
  }
  return null;
}

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

  // Composer extras: `auto` follows the interface language; "fa"/"en" pin it
  // for the model replies only. Attachment texts live in a ref keyed by name.
  const [replyLang, setReplyLang] = useState<"auto" | "fa" | "en">("auto");
  const chatLang = replyLang === "auto" ? (lang === "fa" ? "fa" : "en") : replyLang;
  const filesRef = useRef<Map<string, string>>(new Map());

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

  // Composer data: the effort slider is the per-attachment excerpt depth, the
  // commands are this agent's preset prompts, and the "model" picker is the
  // reply language (the only per-request knob the chat API actually accepts).
  const effortLabels = lang === "fa" ? FA_EFFORTS : EN_EFFORTS;
  const composerSources: PromptBarSource[] = [
    {
      key: "files",
      name: t("chat.attachFiles"),
      description: t("chat.attachFilesDesc"),
      icon: <Paperclip size={15} strokeWidth={2} />,
      attach: true,
    },
  ];
  const composerCommands = useMemo(
    () => (agent ? agentPrompts(agent).map((prompt, i) => ({ key: `prompt-${i}`, name: prompt })) : []),
    [agent, agentPrompts],
  );
  const composerModels: PromptBarModel[] = [
    { key: "auto", name: t("chat.replyLang.auto"), tag: t("chat.replyLang.autoTag") },
    { key: "fa", name: "فارسی", tag: "fa-IR" },
    { key: "en", name: "English", tag: "en-US" },
  ];
  const composerLabels: PromptBarLabels = {
    addSources: t("chat.addSources"),
    chooseModel: t("chat.chooseReplyLang"),
    chooseEffort: t("chat.chooseAttachDetail"),
    effortTitle: t("chat.detail.title"),
    effortHint: t("chat.detail.hint"),
    effortFaster: t("chat.detail.less"),
    effortSmarter: t("chat.detail.more"),
    menuSources: t("chat.menuSources"),
    menuCommands: t("chat.menuCommands"),
    menuModels: t("chat.menuModels"),
    menuEffort: t("chat.menuEffort"),
    prompt: t("chat.promptAria"),
    listening: t("chat.listening"),
    dictate: t("chat.dictate"),
    stopDictate: t("chat.dictateStop"),
    send: t("chat.send"),
    stop: t("chat.stop"),
    noMatches: (query) => t("chat.noMatches", { query }),
    removeFile: (file) => t("chat.removeFile", { file }),
  };

  /** Opens a text-file picker; contents are kept in `filesRef`, names are the chips. */
  async function pickTextFiles(): Promise<string[]> {
    const chosen = await new Promise<File[]>((resolve) => {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = TEXT_ACCEPT;
      picker.multiple = true;
      let settled = false;
      const settle = (files: File[]) => {
        if (settled) return;
        settled = true;
        picker.remove();
        resolve(files);
      };
      picker.addEventListener("change", () => settle(Array.from(picker.files ?? [])));
      picker.addEventListener("cancel", () => settle([]));
      document.body.appendChild(picker);
      picker.click();
    });
    const names: string[] = [];
    for (const file of chosen) {
      try {
        filesRef.current.set(file.name, (await file.text()).slice(0, 200_000));
        names.push(file.name);
      } catch {
        /* unreadable file: leave it out */
      }
    }
    return names;
  }

  /** Speech-to-text; rejects when unsupported or when nothing was heard. */
  function dictate(): Promise<string> {
    const recognitionCtor =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!recognitionCtor) return Promise.reject(new Error("unsupported"));
    type Recognition = {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
      onend: (() => void) | null;
      onerror: ((event: { error?: string }) => void) | null;
      start: () => void;
    };
    const recognition = new (recognitionCtor as new () => Recognition)();
    recognition.lang = chatLang === "fa" ? "fa-IR" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    return new Promise<string>((resolve, reject) => {
      let closed = false;
      let transcript = "";
      recognition.onresult = (event) => {
        for (let i = 0; i < event.results.length; i += 1) {
          if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
        }
      };
      recognition.onend = () => {
        if (closed) return;
        closed = true;
        const text = transcript.trim();
        if (text) resolve(text);
        else reject(new Error("no_speech"));
      };
      recognition.onerror = (event) => {
        if (closed) return;
        closed = true;
        reject(new Error(event.error ?? "error"));
      };
      recognition.start();
    });
  }

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

  // `text` comes from the composer (PromptBar); the Enter key and the send tile
  // both land here. `meta` carries the picked attachment names (contents held in
  // `filesRef`) and the effort step, which caps how much of each attached file
  // enters the prompt. AbortError after a manual stop is not an error to report.
  async function submit(text?: string, meta?: { attachments?: string[]; effort?: string }) {
    const target = agent;
    const draftText = (text ?? input).trim();
    if (!target || !draftText || loading) return;

    if (!user) return nav(`/login?next=${encodeURIComponent(`/chat/${target.id}`)}`);
    if (previewExhausted) return;

    // Attachment excerpts: the effort slider picks the cap, then smaller caps
    // are tried until the whole message fits the API's 20k-character limit.
    const capIndex = Math.max(0, effortLabels.indexOf(meta?.effort ?? effortLabels[1]));
    const attachments = (meta?.attachments ?? []).flatMap((name) => {
      const body = filesRef.current.get(name);
      return body ? [{ name, text: body }] : [];
    });
    const message = composeMessage(draftText, attachments, capIndex);
    if (!message) {
      fail("tooLong");
      return;
    }
    filesRef.current.clear();

    const now = stamp();
    setMessages((m) => [...m, { role: "user", text: message, time: now }]);
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
        message: message,
        history,
        lang: chatLang,
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
      // The user pressed stop: keep any partial reply visible, drop the empty
      // streaming bubble, and stay quiet instead of showing an error banner.
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            if (last.text) copy[copy.length - 1] = { ...last, streaming: false };
            else copy.pop();
          }
          return copy;
        });
      } else {
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
      }
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

  // Signed-out visitors never reach this page: the route guard sends them to
  // /login with a return path, so there is no second lock screen to maintain.
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
        {/* AgentFA: the React Bits PromptBar drives the composer with every
            feature wired to something real: the @/plus menu picks text files
            (contents are inlined into the prompt, effort caps the excerpt),
            the / menu lists this agent's preset prompts, the model picker is
            the reply language (the `lang` the API accepts), and the mic uses
            the browser's speech recognition. Send/stop drive the stream. */}
        <div className="border-t border-line p-4">
          <PromptBar
            value={input}
            onValueChange={setInput}
            placeholder={t("chat.inputPlaceholder")}
            sources={composerSources}
            commands={composerCommands}
            models={composerModels}
            efforts={effortLabels}
            busy={loading}
            onSend={(text, meta) => void submit(text, meta)}
            onStop={() => abortRef.current?.abort()}
            onAttach={pickTextFiles}
            onModelChange={(row) => setReplyLang(row.key === "fa" || row.key === "en" ? row.key : "auto")}
            onDictate={() =>
              dictate().catch((err) => {
                if ((err as Error)?.message !== "no_speech") fail("dictation");
                throw err;
              })
            }
            background="var(--color-surface-2)"
            color="var(--color-ink)"
            menuBackground="var(--color-surface)"
            sparkColor="var(--color-brand)"
            // `width` is capped at the parent, so a large value simply fills
            // the chat column like the previous full-width composer.
            width={1600}
            labels={composerLabels}
          />
        </div>
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
