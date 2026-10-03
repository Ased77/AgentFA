import { report } from "./report";

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

/**
 * Same-origin by default: the SPA and the API are served by one Vercel project,
 * so requests go to `/api/*` on the current origin (first-party cookies, no
 * CORS). Set VITE_API_BASE only to point a deployment at a separate API host.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      // Only claim a JSON body when one is actually sent: endpoints like
      // /api/agents/:id/buy take no input.
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    // The API being unreachable is the failure mode the uptime check cannot
    // see from inside a page: the shell loads, then every request dies.
    report({
      kind: "fetch",
      message: `network failure on ${method(init)} ${path}`,
      source: path,
    });
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = (body as { error?: string }).error ?? "request_failed";
    // 4xx is the caller's business (a wrong code, a missing entitlement) and is
    // already shown to the user. 5xx is ours: nothing on the page can explain it,
    // and if it is a deploy-wide failure nobody is told.
    if (res.status >= 500) {
      report({
        kind: "fetch",
        message: `${method(init)} ${path} answered ${res.status} ${code}`,
        source: path,
      });
    }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

/** The verb, for a message that has to be readable a week later. */
const method = (init?: RequestInit): string => (init?.method ?? "GET").toUpperCase();

/** The signed-in user. A mobile number is the only identity there is. */
export type SessionUser = { id: string; phone: string; role: "user" | "admin" };

/** What `otp/start` answers with. `devCode` only ever appears in development. */
export type OtpStart = {
  phone: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  devCode?: string;
};

/**
 * Send the browser to the payment gateway the API handed back.
 *
 * Returns false when `redirectUrl` is not an absolute URL (a gateway that runs
 * in-process, or payments disabled in development), letting the caller show its
 * "payment pending" notice instead. The transaction is already `pending` in
 * either case; only the gateway's verified callback settles it.
 */
export function goToGateway(redirectUrl: string): boolean {
  if (!redirectUrl.startsWith("http")) return false
  window.location.assign(redirectUrl)
  return true
}

export type WalletSnapshot = {
  plan: "free" | "basic" | "pro";
  tokenBalance: number;
  timeBalanceSeconds: number;
  monthlyTokenLimit: number;
  monthlyTimeLimitSeconds: number;
  monthlyUsage: number;
  monthlyTimeUsedSeconds: number;
};

export type PlanKey = "free" | "basic" | "pro";
export type BillingPeriod = "monthly" | "yearly";

/** The server-owned price list (`GET /api/pricing`). */
export type PriceListData = {
  currency: string;
  yearlyDiscount: number;
  bundles: { tokens: number; price: number }[];
  timePasses: { minutes: number; price: number }[];
  plans: {
    key: PlanKey;
    tokens: number;
    minutes: number;
    monthlyPrice: number;
    monthlyEquivalent: number;
    featured?: boolean;
  }[];
};

export type TransactionRow = {
  id: string;
  orderId: string;
  type: "topup" | "purchase" | "plan" | "refund";
  status: "pending" | "success" | "failed";
  amount: number;
  currency: string;
  tokens: number;
  minutes: number;
  agentId: string | null;
  plan: PlanKey | null;
  billingPeriod: string | null;
  createdAt: string;
  paidAt: string | null;
  failureReason: string | null;
};

export type ConversationSummary = {
  id: string;
  agentId: string;
  title: string;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  seconds: number;
  model: string | null;
  createdAt: string;
};

export type ConversationDetail = ConversationSummary & { messages: StoredMessage[] };

export type UsagePoint = { day: string; tokens: number; seconds: number };

export type AdminStats = {
  users: number;
  agents: number;
  divisions: number;
  purchases: number;
  pendingRefunds: number;
  revenueToman: number;
  tokensUsed: number;
};

/** One grouped browser failure, as the admin panel reads it. */
export type ClientErrorRow = {
  id: string;
  fingerprint: string;
  kind: string;
  message: string;
  /** The unredacted message, present only when redaction changed it. */
  rawMessage: string | null;
  stack: string;
  source: string;
  route: string;
  release: string;
  userAgent: string;
  lang: string;
  viewport: string;
  userId: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type RefundRow = {
  id: string;
  orderId: string;
  userId: string;
  agentId: string | null;
  amount: number;
  currency: string;
  provider: string | null;
  createdAt: string;
  user: { phone: string | null };
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
  /** Ask for a login code. Creates nothing: the account appears on verify. */
  startOtp: (phone: string) =>
    request<OtpStart>("/api/auth/otp/start", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),

  /** Verify the code: signs in, and creates the account on a first login. */
  verifyOtp: (phone: string, code: string) =>
    request<{ user: SessionUser; isNewUser: boolean }>("/api/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: () => request<{ user: SessionUser }>("/api/auth/me"),

  ownedAgents: () => request<{ owned: string[] }>("/api/agents/owned"),

  buyAgent: (agentId: string) =>
    request<{ transactionId: string; redirectUrl: string; price: number }>(
      `/api/agents/${agentId}/buy`,
      { method: "POST" },
    ),

  pricing: () => request<PriceListData>("/api/pricing"),

  wallet: () => request<WalletSnapshot>("/api/wallet"),

  topUp: (tokens: number, minutes: number) =>
    request<{ transactionId: string; redirectUrl: string }>("/api/wallet/topup", {
      method: "POST",
      body: JSON.stringify({ tokens, minutes }),
    }),

  plan: (plan: PlanKey, billing: BillingPeriod) =>
    request<{ plan?: PlanKey; transactionId: string | null; redirectUrl: string | null }>(
      "/api/wallet/plan",
      { method: "POST", body: JSON.stringify({ plan, billing }) },
    ),

  transactions: () => request<{ transactions: TransactionRow[] }>("/api/wallet/transactions"),

  usage: (days = 30) =>
    request<{ days: number; points: UsagePoint[] }>(`/api/wallet/usage?days=${days}`),

  transaction: (id: string) => request<TransactionRow>(`/api/payments/${id}`),

  /**
   * How much of the free preview is left on an agent. The allowance lives on the
   * server, so the composer asks rather than counting locally.
   */
  preview: (agentId: string) =>
    request<{ owned: boolean; limit: number; used: number; remaining: number }>(
      `/api/chat/preview?agentId=${encodeURIComponent(agentId)}`,
    ),

  conversations: (agentId: string) =>
    request<{ conversations: ConversationSummary[] }>(
      `/api/chat/conversations?agentId=${encodeURIComponent(agentId)}`,
    ),

  conversation: (id: string) =>
    request<{ conversation: ConversationDetail }>(`/api/chat/conversations/${id}`),

  newConversation: (agentId: string) =>
    request<{ conversation: ConversationDetail }>("/api/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),

  deleteConversation: (id: string) =>
    request<{ ok: true }>(`/api/chat/conversations/${id}`, { method: "DELETE" }),

  refundAgent: (agentId: string) =>
    request<{ refundId: string; status: string; amount: number }>(
      `/api/agents/${agentId}/refund`,
      { method: "POST" },
    ),

  deleteAccount: () => request<{ ok: true }>("/api/account", { method: "DELETE" }),

  startPhoneChange: (phone: string) =>
    request<OtpStart>("/api/account/phone/start", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),

  verifyPhoneChange: (phone: string, code: string) =>
    request<{ user: SessionUser }>("/api/account/phone/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
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

  adminStats: () => request<AdminStats>("/api/admin/stats"),

  adminRefunds: () => request<{ refunds: RefundRow[] }>("/api/admin/refunds"),

  adminClientErrors: (limit = 50) =>
    request<{ errors: ClientErrorRow[]; total: number; groupsLast24h: number }>(
      `/api/admin/client-errors?limit=${limit}`,
    ),

  approveRefund: (id: string) =>
    request<{ settled: boolean }>(`/api/admin/refunds/${id}/approve`, { method: "POST" }),

  rejectRefund: (id: string, reason: string) =>
    request<{ ok: true }>(`/api/admin/refunds/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
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
      conversationId: string;
      preview: boolean;
      previewRemaining: number | null;
    }
  | { type: "error"; error: string };

export async function streamAgentChat(input: {
  agentId: string;
  conversationId?: string;
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
      conversationId: input.conversationId,
      message: input.message,
      history: input.history,
      lang: input.lang,
    }),
    signal: input.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = (body as { error?: string }).error ?? "chat_failed";
    if (res.status >= 500) {
      report({
        kind: "fetch",
        message: `POST /api/chat/stream answered ${res.status} ${code}`,
        source: "/api/chat/stream",
      });
    }
    throw new ApiError(res.status, code);
  }
  if (!res.body) {
    report({
      kind: "fetch",
      message: "POST /api/chat/stream returned no stream body",
      source: "/api/chat/stream",
    });
    throw new ApiError(500, "no_stream");
  }

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