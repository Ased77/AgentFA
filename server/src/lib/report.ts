import { createHash } from "node:crypto";

/**
 * Turns a browser's crash report into a row that is safe to store and possible
 * to triage.
 *
 * Three things happen here, and all three are pure functions so they can be
 * tested without a database:
 *
 * 1. **Redaction.** A message, a stack and a URL are attacker-influenced strings
 *    that routinely contain a token, a phone number or an email. What lands in
 *    the table is the redacted form, and the original is kept alongside it only
 *    when a rule actually fired — otherwise there is no way to tell whether a
 *    value was removed or simply never sent.
 * 2. **Normalization.** Identifiers and numbers are replaced with placeholders
 *    before hashing, so "Failed to fetch /agent/level-designer" and
 *    "Failed to fetch /agent/writer" become one group instead of 264 rows.
 * 3. **Fingerprinting.** Two reports share a fingerprint when they are the same
 *    failure, which is what makes a count meaningful.
 *
 * None of this trusts the client: the fingerprint and the grouping key are
 * derived here, and every field is capped, so a hostile report can only waste a
 * row.
 */

export const LIMITS = {
  message: 500,
  stack: 4_000,
  source: 300,
  route: 300,
  release: 60,
  lang: 8,
  viewport: 20,
  userAgent: 300,
} as const;

/** The only `kind` values accepted. An unknown kind is stored as `unknown`. */
export const KINDS = [
  "error",
  "unhandledrejection",
  "react",
  "fetch",
  "asset",
  "csp",
  "unknown",
] as const;

export type ReportKind = (typeof KINDS)[number];

/** `stack` lines that come from the framework are noise, not the cause. */
const FRAMEWORK_FRAME =
  /node_modules|react-dom|react\.production|scheduler|webpack|vite\/|@react-refresh|@vite\/client/;

/**
 * Ordered: the first rule that matches wins, so specific credentials are
 * removed before the generic long-blob rule can mangle the surrounding text.
 */
const REDACTIONS: { pattern: RegExp; replace: string }[] = [
  // The scheme is removed before the generic `key: value` rule, which would
  // otherwise consume only the word "Bearer" and leave the token behind.
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: "Bearer [redacted]" },
  // A JWT: three dot-separated base64url segments, the first always `eyJ…`.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
    replace: "[jwt]",
  },
  // `token=…`, `code: "…"`, `password=…` — in a URL, a message or a stack.
  {
    pattern:
      /\b(token|code|password|passwd|secret|api_?key|access_?token|refresh_?token|authorization|otp|pin|signature|authority)\b\s*[:=]\s*["']?[^\s"'&,;)]+/gi,
    replace: "$1=[redacted]",
  },
  // Payment callbacks and share links carry secrets in the query string.
  {
    pattern: /([?&])(authority|token|code|key|signature|sig|auth)=[^\s&#]*/gi,
    replace: "$1$2=[redacted]",
  },
  // Iranian mobile numbers, in both the local and the +98 shapes.
  { pattern: /(?:\+?98|0)9\d{9}\b/g, replace: "[phone]" },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: "[email]" },
  // Session tokens, API keys and hashes: long runs of hex or base64-ish text.
  { pattern: /\b[A-Fa-f0-9]{32,}\b/g, replace: "[hash]" },
  // No `/` in this class: with it, the rule matches across path separators and
  // swallows a whole route (`/reset-password/<token>` became `/[blob]`).
  { pattern: /\b[A-Za-z0-9+=_-]{40,}\b/g, replace: "[blob]" },
  // A cookie header or a serialized cookie jar.
  { pattern: /\b(agentfa_session|session|sid)=[^\s;,"}]+/gi, replace: "$1=[redacted]" },
];

/** What a redaction pass produced. `rawMessage` is set only if something changed. */
export type Redacted = { message: string; rawMessage: string | null };

export function redact(input: string): Redacted {
  let output = input;
  for (const rule of REDACTIONS) output = output.replace(rule.pattern, rule.replace);
  return {
    message: output,
    // Kept only when a rule fired: a stored copy of every message would defeat
    // the point of redacting, and an always-null field tells you nothing.
    rawMessage: output === input ? null : input,
  };
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Replaces the parts of a string that differ between instances of the *same*
 * bug: ids, numbers, quoted values and fingerprinted asset names.
 */
export function normalizeForFingerprint(text: string): string {
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/"[^"]{0,120}"/g, "<str>")
    .replace(/'[^']{0,120}'/g, "<str>")
    .replace(/\/(?:[0-9a-f]{6,}|c[a-z0-9]{20,})(?=\/|$|\?)/gi, "/<id>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Strips the origin and the build hash from a file path.
 *
 * `/assets/index-f6HKisvP.js` and `/assets/index-B_K787ei.js` are the same file
 * across two builds, and a fingerprint that changes on every deploy is not a
 * group — it is a log line.
 */
export function normalizeAsset(file: string): string {
  return (
    file
      .replace(/^[a-z]+:\/\/[^/]+/i, "")
      // The query goes first: `chat-abc123.css?v=2` does not end in `.css`.
      .replace(/[?#].*$/, "")
      .replace(/-[A-Za-z0-9_-]{6,}\.(js|css|mjs)$/i, ".$1")
  );
}

/**
 * The frame most likely to be the cause: the first one that is not the
 * framework's own machinery, with line and column kept (two different bugs
 * inside one function must not collapse into one group).
 */
export function topFrame(stack: string): string {
  for (const line of stack.split("\n").slice(1)) {
    const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?)(?::(\d+):(\d+))?\)?\s*$/);
    if (!match) continue;
    const [, fn, file, row, column] = match;
    if (!file || FRAMEWORK_FRAME.test(file)) continue;
    return `${fn || "<anonymous>"}@${normalizeAsset(file)}:${row ?? "0"}:${column ?? "0"}`;
  }
  return "";
}

/** Two reports share a fingerprint when they are the same failure. */
export function fingerprint(parts: {
  kind: string;
  message: string;
  stack: string;
  source: string;
}): string {
  const basis = [
    parts.kind,
    normalizeForFingerprint(parts.message),
    topFrame(parts.stack) || normalizeForFingerprint(parts.source),
  ].join("|");
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

export type ClientReportInput = {
  kind?: unknown;
  message?: unknown;
  stack?: unknown;
  source?: unknown;
  route?: unknown;
  release?: unknown;
  lang?: unknown;
  viewport?: unknown;
};

export type NormalizedReport = {
  kind: ReportKind;
  message: string;
  rawMessage: string | null;
  stack: string;
  source: string;
  route: string;
  release: string;
  lang: string;
  viewport: string;
  fingerprint: string;
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const truncateSafe = (value: string): string => truncate(value, LIMITS.message);

/**
 * A token in a *path* is not caught by the `key=value` rules: password-reset and
 * invite links put the secret in a segment, like `/reset-password/<token>`.
 *
 * Only segments that cannot be a slug are removed — a lowercase, hyphenated
 * word is a page (`/agent/level-designer`), while mixed-case-and-digits or a
 * long hex run is a credential. Redacting real slugs would merge every agent
 * page into one group and make the route useless.
 */
function redactPathSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (/^[0-9a-f]{24,}$/i.test(segment)) return "[redacted]";
      if (segment.length >= 24 && /^[A-Za-z0-9_-]+$/.test(segment)) {
        const mixed = /[A-Z]/.test(segment) && /[a-z]/.test(segment) && /\d/.test(segment);
        if (mixed) return "[redacted]";
      }
      return segment;
    })
    .join("/");
}

/**
 * A route is a path, never a URL with a query string: `/chat?agentId=x` groups
 * with `/chat`, and a token that reached a query string never gets stored.
 */
export function normalizeRoute(value: unknown): string {
  const raw = str(value).trim();
  if (!raw) return "";
  let path = raw;
  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname;
    } catch {
      // Unparseable URL: drop the scheme rather than fabricate a path for it.
      path = raw.replace(/^[a-z]+:\/\//i, "");
    }
  }
  path = path.split(/[?#]/)[0] ?? path;
  if (!path.startsWith("/")) path = `/${path}`;
  return truncate(path, LIMITS.route);
}

export function normalizeReport(input: ClientReportInput): NormalizedReport {
  const kind = (KINDS as readonly string[]).includes(str(input.kind))
    ? (str(input.kind) as ReportKind)
    : "unknown";

  const message = truncate(str(input.message).trim() || "(no message)", LIMITS.message);
  const { message: safeMessage, rawMessage } = redact(message);
  const safeStack = redact(truncate(str(input.stack), LIMITS.stack)).message;
  const safeSource = redact(truncate(str(input.source).trim(), LIMITS.source)).message;

  return {
    kind,
    message: safeMessage,
    rawMessage: rawMessage ? truncateSafe(rawMessage) : null,
    stack: safeStack,
    source: safeSource,
    // A path can carry a secret too: password-reset and invite links put a
    // token in the path, not the query string. Segments are handled before the
    // generic pass so the path survives as `/reset-password/[redacted]`.
    route: redact(redactPathSegments(normalizeRoute(input.route))).message,
    release: truncate(str(input.release).trim(), LIMITS.release),
    lang: truncate(str(input.lang).trim(), LIMITS.lang),
    viewport: truncate(str(input.viewport).trim(), LIMITS.viewport),
    // Grouping runs on the redacted text, so a report that leaked a token and
    // one that never contained one land in the same group.
    fingerprint: fingerprint({ kind, message: safeMessage, stack: safeStack, source: safeSource }),
  };
}
