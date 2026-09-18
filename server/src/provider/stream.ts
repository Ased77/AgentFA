import type { ProviderConfig } from "@prisma/client";
import { decryptSecret } from "./crypto.js";
import { endpointFor } from "./validate.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type StreamOutcome = {
  text: string;
  tokens: number;
  estimated: boolean;
  seconds: number;
  truncated: boolean;
};

export type Budget = { tokens: number; seconds: number };

const IDLE_TIMEOUT_MS = 30_000;
export const HISTORY_LIMIT = 10;

/** Persian-aware rough estimate: ~2 chars per token. Used only as a fallback
    when the provider omits `usage.total_tokens`. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}

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
  return [
    `You are "${input.name}", a specialised agent on the AgentFA platform.`,
    input.description ? `Scope: ${input.description}` : "",
    input.persona.trim(),
    language,
    "Stay in character, be concrete, and never invent capabilities you don't have.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type StreamInput = {
  config: ProviderConfig;
  system: string;
  history: ChatTurn[];
  message: string;
  budget?: Budget;
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
};

export class ProviderFailure extends Error {
  constructor(
    readonly kind:
      | "invalid_key"
      | "rate_limited"
      | "not_found"
      | "server"
      | "network"
      | "bad_response"
      | "timeout"
      | "aborted",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}

const fromStatus = (status: number, url: string): ProviderFailure => {
  if (status === 401 || status === 403) return new ProviderFailure("invalid_key", url, status);
  if (status === 404) return new ProviderFailure("not_found", url, status);
  if (status === 429) return new ProviderFailure("rate_limited", url, status);
  if (status >= 500) return new ProviderFailure("server", url, status);
  return new ProviderFailure("bad_response", url, status);
};

const numericUsage = (payload: unknown): number | null => {
  const total = (payload as { usage?: { total_tokens?: unknown } })?.usage?.total_tokens;
  return typeof total === "number" && total > 0 ? Math.round(total) : null;
};

/** Stream one completion server-side. The provider key never leaves here. */
export async function streamChat(input: StreamInput): Promise<StreamOutcome> {
  const { config, system, history, message, budget, onDelta, signal } = input;
  if (!system.trim()) throw new ProviderFailure("bad_response", "missing persona");

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
    const response = await fetch(endpointFor(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${decryptSecret(config.apiKeyCipher)}`,
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: system },
          ...history.slice(-HISTORY_LIMIT).map((t) => ({ role: t.role, content: t.content })),
          { role: "user", content: message },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw fromStatus(response.status, config.baseUrl);

    if (!response.body) {
      const body = (await response.json().catch(() => null)) as any;
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
          continue;
        }
        if (typeof event?.error?.message === "string")
          throw new ProviderFailure("bad_response", event.error.message);
        const delta = event?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          text += delta;
          onDelta(delta);
          if (overBudget()) {
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
    if (error instanceof ProviderFailure) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderFailure(
        controller.signal.reason === "idle" ? "timeout" : "aborted",
        "stream aborted",
      );
    }
    throw new ProviderFailure(
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