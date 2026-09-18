export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "request_failed");
  }
  return (await res.json()) as T;
}

export type SessionUser = { id: string; email: string; role: "user" | "admin" };

export type WalletSnapshot = {
  plan: "free" | "basic" | "pro";
  tokenBalance: number;
  timeBalanceSeconds: number;
  monthlyTokenLimit: number;
  monthlyTimeLimitSeconds: number;
  monthlyUsage: number;
  monthlyTimeUsedSeconds: number;
};

export type PublicProvider = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  meter: "tokens" | "time";
  tomanPer1kTokens: number;
  tomanPerMinute: number;
  agentScope: string[];
  enabled: boolean;
};

export const api = {
  register: (email: string, password: string) =>
    request<{ user: SessionUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: () => request<{ user: SessionUser }>("/api/auth/me"),

  catalog: () =>
    request<{
      agents: Array<Record<string, unknown>>;
      divisions: Array<Record<string, unknown>>;
    }>("/api/catalog"),

  ownedAgents: () => request<{ owned: string[] }>("/api/agents/owned"),

  persona: (agentId: string) =>
    request<{ agentId: string; persona: string }>(`/api/agents/${agentId}/persona`),

  buyAgent: (agentId: string) =>
    request<{ transactionId: string; redirectUrl: string; price: number }>(
      `/api/agents/${agentId}/buy`,
      { method: "POST" },
    ),

  wallet: () => request<WalletSnapshot>("/api/wallet"),

  topUp: (tokens: number, minutes: number) =>
    request<{ transactionId: string; redirectUrl: string }>("/api/wallet/topup", {
      method: "POST",
      body: JSON.stringify({ tokens, minutes }),
    }),

  adminProvider: () => request<{ provider: PublicProvider | null }>("/api/admin/provider"),

  saveProvider: (input: Record<string, unknown>) =>
    request<{ provider: PublicProvider }>("/api/admin/provider", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  deleteProvider: () =>
    request<{ ok: true }>("/api/admin/provider", { method: "DELETE" }),

  testProvider: () =>
    request<{ ok: boolean; tokens?: number; seconds?: number; error?: string }>(
      "/api/admin/provider/test",
      { method: "POST" },
    ),
};

export { API_BASE };

export type ChatStreamEvent =
  | { type: "delta"; chunk: string }
  | {
      type: "done";
      tokens: number;
      seconds: number;
      estimated: boolean;
      truncated: boolean;
      charged: number;
      meter: "tokens" | "time";
    }
  | { type: "error"; error: string };

export async function streamAgentChat(input: {
  agentId: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  lang: "fa" | "en";
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: input.agentId,
      message: input.message,
      history: input.history,
      lang: input.lang,
    }),
    signal: input.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "chat_failed");
  }
  if (!res.body) throw new ApiError(500, "no_stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event:"));
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!eventLine || !dataLine) continue;
      const type = eventLine.slice(6).trim();
      const data = JSON.parse(dataLine.slice(5).trim());
      if (type === "delta") input.onEvent({ type: "delta", chunk: data.chunk });
      else if (type === "done") input.onEvent({ type: "done", ...data });
      else if (type === "error") input.onEvent({ type: "error", error: data.error });
    }
  }
}