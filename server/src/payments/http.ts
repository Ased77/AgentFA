import { PaymentError } from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/** JSON request against a gateway. Never throws for a non-2xx status: the
 *  adapter decides whether the response is an error envelope or a rejection. */
export async function postJson(
  url: string,
  body: unknown,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ status: number; body: unknown }> {
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    timeoutMs: init.timeoutMs,
  });
}

/** Form-encoded request (Stripe's REST API is form based). */
export async function postForm(
  url: string,
  form: URLSearchParams,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ status: number; body: unknown }> {
  return request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init.headers ?? {}),
    },
    body: form.toString(),
    timeoutMs: init.timeoutMs,
  });
}

async function request(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; timeoutMs?: number },
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // DNS failure, TLS problem, timeout — never a user error.
    throw new PaymentError(
      "gateway_unreachable",
      `payment gateway is unreachable: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* gateways sometimes answer with HTML; keep the text for the logs */
  }
  return { status: response.status, body: parsed };
}
