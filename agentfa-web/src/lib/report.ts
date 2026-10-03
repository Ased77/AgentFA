/**
 * Client-side crash reporting.
 *
 * The uptime check watches HTTP; it cannot see a React tree that threw. Without
 * this, a broken render in a visitor's browser produced a console message and
 * nothing else — a blank page could sit there until someone happened to reload.
 *
 * Design constraints, in order of importance:
 *
 * 1. **It must never break the page it is reporting on.** Everything is wrapped,
 *    nothing throws, and a failure to report is swallowed.
 * 2. **It must not become the crash.** A crash loop would otherwise send an
 *    unbounded number of requests, so reports are deduplicated by message and
 *    capped per page view.
 * 3. **It must not slow anything down.** Reports are batched and sent with
 *    `sendBeacon`, which does not block navigation and survives a page unload —
 *    the exact case a crash report is about.
 * 4. **It must not leak.** The server redacts as well, but a token that reaches
 *    the network is already gone, so obvious secrets are dropped here first.
 */

const ENDPOINT = "/api/client-errors";

/** A crash loop must not send forever; the server rate-limits on top of this. */
const MAX_REPORTS_PER_VIEW = 12;
const FLUSH_DELAY_MS = 2_000;
const STORAGE_KEY = "agentfa-crash-stamp";
const STAMP_COOLDOWN_MS = 60_000;

export type ReportKind = "error" | "unhandledrejection" | "react" | "fetch" | "asset" | "csp";

export type Report = {
  kind: ReportKind;
  message: string;
  stack?: string;
  source?: string;
  route?: string;
  release?: string;
  lang?: string;
  viewport?: string;
};

/** Set once at startup. Until then reports are queued, not dropped. */
let release = "";
let lang = "";

export function setRelease(tag: string): void {
  release = tag;
}

export function setReportLang(value: string): void {
  lang = value;
}

const seen = new Set<string>();
const queue: Report[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sent = 0;
let listening = false;

/**
 * Trimmed here as well as on the server: the network copy should not carry a
 * query string full of ids, and a token in a path is not worth sending at all.
 */
function safeRoute(): string {
  try {
    const path = window.location.pathname.split(/[?#]/)[0] ?? "/";
    return path.replace(/\/([A-Za-z0-9_-]{24,})(?=\/|$)/g, "/[redacted]");
  } catch {
    return "";
  }
}

function viewport(): string {
  try {
    return `${window.innerWidth}x${window.innerHeight}`;
  } catch {
    return "";
  }
}

/**
 * A last line of defence before the data leaves the browser. The server redacts
 * too — this exists so a secret never reaches the network at all.
 */
function scrub(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(
      /\b(token|code|password|secret|api_?key|authorization|otp|pin|signature|authority)\b\s*[:=]\s*["']?[^\s"'&,;)]+/gi,
      "$1=[redacted]",
    )
    .replace(/(?:\+?98|0)9\d{9}\b/g, "[phone]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 2_000);
}

function errorText(value: unknown): { message: string; stack: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack ?? "" };
  }
  if (typeof value === "string") return { message: value, stack: "" };
  try {
    return { message: JSON.stringify(value) ?? String(value), stack: "" };
  } catch {
    return { message: String(value), stack: "" };
  }
}

/** Queues a report, deduplicating by kind+message so a loop is one row. */
export function report(input: Report): void {
  try {
    if (sent >= MAX_REPORTS_PER_VIEW) return;
    const message = scrub(input.message).trim() || "(no message)";
    const key = `${input.kind}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);

    queue.push({
      kind: input.kind,
      message,
      stack: input.stack ? scrub(input.stack) : undefined,
      source: input.source ? scrub(input.source) : undefined,
      route: input.route ?? safeRoute(),
      release,
      lang,
      viewport: viewport(),
    });

    if (timer === null) timer = setTimeout(flush, FLUSH_DELAY_MS);
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}

/** Sends what is queued. Safe to call at any time; a no-op when empty. */
export function flush(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;

  const body = JSON.stringify({ reports: queue.splice(0, queue.length) });
  sent += 1;

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      // A `false` return means the browser refused to queue it — fall through.
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }

  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing left to try.
  }
}

/**
 * The white-screen detector.
 *
 * A blank page usually happens *before* any app code runs — the bundle fails to
 * parse, or React never mounts — so nothing in the app can notice. Each load
 * leaves a stamp here; mounting clears it. A load that finds a stamp still set
 * is looking at the wreckage of the previous one, and reports it.
 */
function checkPreviousLoad(): boolean {
  try {
    const stamp = Number(window.sessionStorage.getItem(STORAGE_KEY) ?? 0);
    window.sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    // The cooldown keeps a permanently broken build from reporting on every
    // single navigation for the rest of the session.
    return stamp > 0 && Date.now() - stamp > STAMP_COOLDOWN_MS;
  } catch {
    // Storage disabled: the detector is simply unavailable.
    return false;
  }
}

/** Called once the app has actually rendered: this load is not a white screen. */
export function markAlive(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

function onError(event: ErrorEvent): void {
  const { message, stack } = errorText(event.error ?? event.message);
  const target = event.target as HTMLElement | null;
  const isAsset =
    target instanceof HTMLScriptElement ||
    target instanceof HTMLLinkElement ||
    target instanceof HTMLImageElement;

  if (isAsset) {
    // A resource error does not bubble to `window`; it is caught in the capture
    // phase instead, and `event.message` is empty for it.
    const src =
      (target as HTMLScriptElement).src ?? (target as HTMLLinkElement).href ?? "unknown";
    report({ kind: "asset", message: `failed to load ${src}`, source: src });
    return;
  }

  report({
    kind: "error",
    message,
    stack,
    source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
  });
}

function onRejection(event: PromiseRejectionEvent): void {
  const { message, stack } = errorText(event.reason);
  report({ kind: "unhandledrejection", message, stack });
}

function onSecurityPolicyViolation(event: SecurityPolicyViolationEvent): void {
  report({
    kind: "csp",
    message: `blocked ${event.violatedDirective} on ${event.blockedURI}`,
    source: event.sourceFile ?? undefined,
  });
}

/**
 * Attaches every listener once. Idempotent so a hot reload or a second call
 * cannot double-report.
 */
export function install(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("securitypolicyviolation", onSecurityPolicyViolation);
  // A report about a crash is most valuable exactly when the page is going away.
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  // Checked and stamped before the app starts: if the render below throws, the
  // stamp survives and the next load reports this one.
  if (checkPreviousLoad()) {
    report({ kind: "react", message: "previous load did not finish rendering" });
  }
}
