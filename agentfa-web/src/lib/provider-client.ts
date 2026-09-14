/**
 * OpenAI-compatible chat client (streaming).
 *
 * Speaks the lowest common denominator of every OpenAI-compatible endpoint
 * (`POST {baseUrl}/chat/completions` with `stream: true`) so DeepSeek, Qwen,
 * OpenRouter, Groq, vLLM, llama.cpp and Ollama's OpenAI shim all work through
 * one code path.
 *
 * Usage accounting: we ask for `stream_options.include_usage`; providers that
 * honour it report the real token count, the rest fall back to a character
 * estimate (flagged on the outcome so the UI can say which one it charged).
 * Time is always measured — it is the only signal every provider gives us.
 *
 * Every call must carry an agent persona; there is no general-purpose path.
 */

import {
  providerEndpoint,
  type MeterMode,
  type ProviderProfile,
} from "./provider";

export type ChatErrorCode =
  | "no_provider"
  | "not_owned"
  | "not_covered"
  | "invalid_key"
  | "rate_limited"
  | "not_found"
  | "network"
  | "server"
  | "bad_response"
  | "timeout"
  | "aborted";

export class ProviderError extends Error {
  readonly code: ChatErrorCode;
  readonly status?: number;
  readonly detail?: string;

  constructor(code: ChatErrorCode, detail?: string, status?: number) {
    super(detail || code);
    this.name = "ProviderError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type StreamOutcome = {
  text: string;
  /** Tokens to charge — provider-reported when available, else estimated. */
  tokens: number;
  estimated: boolean;
  /** Wall-clock seconds spent streaming, billed by the time meter. */
  seconds: number;
  /** True when the stream was cut short to stay inside the paid allowance. */
  truncated: boolean;
};

/** Hard stops for one response, derived from what's left on the meter. */
export type Budget = { tokens: number; seconds: number };

/** Rough token count for providers that don't report usage. Persian text runs
    ~2 chars per token; the same divisor the balance pre-check uses. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}

/** How many prior messages ride along as context. */
export const HISTORY_LIMIT = 10;

/** Abort a stream when the provider goes quiet for this long. */
const IDLE_TIMEOUT_MS = 30_000;

/** Build the system message: the agent's persona, framed for the model.
    This is the "agents only" core — no call exists without one. */
export function agentSystemPrompt(input: {
  name: string;
  description: string;
  persona: string;
  lang: "fa" | "en";
}): string {
  const language =
    input.lang === "fa"
      ? "Always answer in fluent Persian (فارسی), even when the user writes in English."
      : "Always answer in the user's language.";
  const persona = input.persona.trim();
  return [
    `You are "${input.name}", a specialised agent on the AgentFA platform.`,
    input.description ? `Scope: ${input.description}` : "",
    persona,
    language,
    "Stay in character, be concrete, and never invent capabilities you don't have.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type StreamOptions = {
  profile: ProviderProfile;
  /** System message — the agent persona. Required. */
  system: string;
  history: ChatTurn[];
  message: string;
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
  /** Stop streaming once this much has been spent, so a runaway answer can't
      overspend a paid allowance. The partial reply is kept and charged. */
  budget?: Budget;
};

/**
 * Stream one completion. Resolves with the assembled text plus what it should
 * cost; throws `ProviderError` for every failure the UI can talk about.
 */
export async function streamChat(options: StreamOptions): Promise<StreamOutcome> {
  const { profile, system, history, message, onDelta, signal, budget } = options;
  if (!system.trim()) throw new ProviderError("no_provider", "missing persona");

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort);

  let idle: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => controller.abort("idle"), IDLE_TIMEOUT_MS);
  };

  const started = Date.now();
  let text = "";
  let reported: number | null = null;
  let truncated = false;

  /** Spend so far, in whichever unit the budget caps. */
  const spent = () => ({
    tokens: estimateTokens(system) + estimateTokens(message) + estimateTokens(text),
    seconds: (Date.now() - started) / 1000,
  });
  const overBudget = () => {
    if (!budget) return false;
    const used = spent();
    return used.tokens >= budget.tokens || used.seconds >= budget.seconds;
  };

  try {
    armIdle();
    const response = await fetch(providerEndpoint(profile), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify({
        model: profile.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: system },
          ...history.slice(-HISTORY_LIMIT).map((turn) => ({
            role: turn.role,
            content: turn.content,
          })),
          { role: "user", content: message },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw fromStatus(response.status, profile);

    // Providers that ignore `stream: true` answer with one JSON body.
    if (!response.body) {
      const body = await response.json().catch(() => null);
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        text = content;
        onDelta(content);
      }
      reported = numericUsage(body);
      return finish();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          continue; // keep-alive noise / partial frame
        }
        if (typeof event?.error?.message === "string")
          throw new ProviderError("bad_response", event.error.message);
        const delta = event?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          text += delta;
          onDelta(delta);
          if (overBudget()) {
            // Stop reading (and stop the provider from generating more) but
            // keep the partial answer — the user pays for what arrived.
            truncated = true;
            await reader.cancel().catch(() => {});
            return finish();
          }
        }
        const usage = numericUsage(event);
        if (usage != null) reported = usage;
      }
    }

    return finish();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      // Distinguish "we hung" from "the user navigated away".
      throw new ProviderError(controller.signal.reason === "idle" ? "timeout" : "aborted");
    }
    throw new ProviderError(
      "network",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (idle) clearTimeout(idle);
    signal?.removeEventListener("abort", forwardAbort);
  }

  function finish(): StreamOutcome {
    const estimated = reported == null;
    return {
      text,
      tokens: reported ?? Math.max(1, estimateTokens(message) + estimateTokens(text)),
      estimated,
      seconds: Math.max(1, Math.ceil((Date.now() - started) / 1000)),
      truncated,
    };
  }
}

function numericUsage(payload: any): number | null {
  const total = payload?.usage?.total_tokens;
  return typeof total === "number" && total > 0 ? Math.round(total) : null;
}

function fromStatus(status: number, profile: ProviderProfile): ProviderError {
  const url = profile.baseUrl;
  if (status === 401 || status === 403) return new ProviderError("invalid_key", url, status);
  if (status === 404) return new ProviderError("not_found", url, status);
  if (status === 429) return new ProviderError("rate_limited", url, status);
  if (status >= 500) return new ProviderError("server", url, status);
  return new ProviderError("bad_response", url, status);
}

/** Admin-only connectivity check. Runs through the same guarded client with a
    throwaway persona and never touches the wallet. */
export async function testConnection(profile: ProviderProfile): Promise<StreamOutcome> {
  return streamChat({
    profile,
    system:
      "You are a connectivity probe for the AgentFA platform. Reply with the single word: ok.",
    history: [],
    message: "Reply with the single word: ok.",
    onDelta: () => {},
  });
}

/** i18n key for a failure code — one place so web + admin agree. */
export function providerErrorKey(code: ChatErrorCode): string {
  return `chat.error.${code}`;
}

/** Which allowance a completed call debits. */
export function chargeFor(meter: MeterMode, outcome: StreamOutcome): number {
  return meter === "time" ? outcome.seconds : outcome.tokens;
}
