/**
 * Custom (non-Claude) AI provider profile.
 *
 * AgentFа ships no inference of its own for these chats: an admin configures
 * ONE OpenAI-compatible endpoint (base URL + API key + model) and agent chats
 * stream through it. Access is metered either by tokens consumed or by
 * wall-clock time spent — the profile chooses the meter (see `meter`).
 *
 * "Agents only" is enforced on three levels, and this module owns the middle
 * one: a call is only ever issued from inside an *owned* agent conversation
 * (`providerCoversAgent` + `ownsAgent` in `mock-store`) and always carries the
 * agent's persona as the system message.
 *
 * Persisted in localStorage (`agentfa-provider`). The API key is readable by
 * any script on this origin — accepted for the MVP and documented in
 * `plans/custom-provider-agents-only.md`; a backend proxy is the follow-up.
 */

export type MeterMode = "tokens" | "time";

export type ProviderProfile = {
  version: 1;
  id: string;
  /** Human label shown in Admin / chat ("My gateway"). */
  label: string;
  /** OpenAI-compatible root, e.g. `https://api.example.com/v1`. */
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Which allowance a chat debits. */
  meter: MeterMode;
  /** Display/charging rate for the token meter (Toman per 1k tokens). */
  tomanPer1kTokens: number;
  /** Display/charging rate for the time meter (Toman per minute). */
  tomanPerMinute: number;
  /** Agent ids this credential may be used for. `["*"]` = any owned agent. */
  agentScope: string[];
  enabled: boolean;
  /** Dev-only escape hatch: route through the Vite `/provider-proxy` entry. */
  useDevProxy: boolean;
};

export const PROVIDER_STORAGE_KEY = "agentfa-provider";
export const DEV_PROXY_PREFIX = "/provider-proxy";

export const defaultProfile: ProviderProfile = {
  version: 1,
  id: "custom-1",
  label: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  meter: "tokens",
  tomanPer1kTokens: 2000,
  tomanPerMinute: 30000,
  agentScope: ["*"],
  enabled: true,
  useDevProxy: false,
};

/** Strip a trailing slash so `${base}/chat/completions` never doubles up. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function coerce(raw: unknown): ProviderProfile {
  const value = (raw ?? {}) as Partial<ProviderProfile>;
  const meter: MeterMode = value.meter === "time" ? "time" : "tokens";
  const scope = Array.isArray(value.agentScope)
    ? value.agentScope.filter((a): a is string => typeof a === "string" && !!a.trim())
    : defaultProfile.agentScope;
  return {
    ...defaultProfile,
    ...value,
    version: 1,
    baseUrl: typeof value.baseUrl === "string" ? normalizeBaseUrl(value.baseUrl) : "",
    model: (value.model ?? "").trim(),
    apiKey: (value.apiKey ?? "").trim(),
    meter,
    tomanPer1kTokens: Number.isFinite(value.tomanPer1kTokens)
      ? Math.max(0, Math.round(value.tomanPer1kTokens as number))
      : defaultProfile.tomanPer1kTokens,
    tomanPerMinute: Number.isFinite(value.tomanPerMinute)
      ? Math.max(0, Math.round(value.tomanPerMinute as number))
      : defaultProfile.tomanPerMinute,
    agentScope: scope.length ? scope : defaultProfile.agentScope,
    enabled: value.enabled !== false,
    useDevProxy: value.useDevProxy === true,
  };
}

/** Read the persisted profile (never throws; malformed JSON falls back). */
export function getProvider(): ProviderProfile {
  if (typeof localStorage === "undefined") return { ...defaultProfile };
  try {
    return coerce(JSON.parse(localStorage.getItem(PROVIDER_STORAGE_KEY) || "{}"));
  } catch {
    return { ...defaultProfile };
  }
}

/** Merge a partial update into the stored profile and persist it. */
export function saveProvider(patch: Partial<ProviderProfile>): ProviderProfile {
  const next = coerce({ ...getProvider(), ...patch });
  localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Wipe the profile back to defaults (Admin "remove provider"). */
export function clearProvider(): ProviderProfile {
  localStorage.removeItem(PROVIDER_STORAGE_KEY);
  return { ...defaultProfile };
}

/** A profile that can actually be called: enabled, complete, and scoped. */
export function providerReady(profile: ProviderProfile = getProvider()): boolean {
  return (
    profile.enabled &&
    !!normalizeBaseUrl(profile.baseUrl) &&
    !!profile.model &&
    !!profile.apiKey &&
    profile.agentScope.length > 0
  );
}

/** The profile to call, or null when chat should stay in demo mode. */
export function activeProvider(): ProviderProfile | null {
  const profile = getProvider();
  return providerReady(profile) ? profile : null;
}

/** Whether this credential is allowed to serve `agentId`. */
export function providerCoversAgent(
  profile: ProviderProfile,
  agentId: string,
): boolean {
  return profile.agentScope.includes("*") || profile.agentScope.includes(agentId);
}

/** `sk-ab…9f2c` — enough to recognise a key, not enough to use it. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** `/chat/completions` endpoint for a profile (dev-proxy aware). */
export function providerEndpoint(profile: ProviderProfile): string {
  const path = `${normalizeBaseUrl(profile.baseUrl)}/chat/completions`;
  return profile.useDevProxy ? `${DEV_PROXY_PREFIX}${path.replace(/^https?:\/\/[^/]+/, "")}` : path;
}

/** Admin-facing problems, as i18n keys — empty means the profile is usable. */
export function profileProblems(profile: ProviderProfile): string[] {
  const problems: string[] = [];
  if (!normalizeBaseUrl(profile.baseUrl))
    problems.push("admin.provider.problem.baseUrl");
  else if (!/^https?:\/\//i.test(normalizeBaseUrl(profile.baseUrl)))
    problems.push("admin.provider.problem.scheme");
  if (!profile.model) problems.push("admin.provider.problem.model");
  if (!profile.apiKey) problems.push("admin.provider.problem.key");
  if (!profile.agentScope.length) problems.push("admin.provider.problem.scope");
  return problems;
}
