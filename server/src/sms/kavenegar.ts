import { env } from "../env.js";
import type { SmsGateway, SmsMessage, SmsResult } from "./types.js";

/**
 * Kavenegar (https://kavenegar.com) — the SMS gateway used for login codes.
 *
 * Two delivery modes, chosen by configuration:
 *
 *   verify/lookup.json  a pre-approved template ("کد ورود شما: %token") where the
 *                       provider only substitutes the code. Iranian regulators
 *                       require registered templates for transactional SMS, and
 *                       templates are cheaper and faster, so this is preferred.
 *   sms/send.json       plain text, used when no template is configured (and by
 *                       local stubs, which speak the same API).
 *
 * Both are a single GET with the API key in the path; the response is always an
 * HTTP 200 with a `return.status` field, so the status must be checked rather
 * than the HTTP code.
 *
 * A different provider (SMS.ir, Melipayamak, a webhook) means editing only this
 * file plus a registry entry.
 */

const PRODUCTION_HOST = "https://api.kavenegar.com";

function host(): string {
  return (env.KAVENEGAR_BASE_URL ?? PRODUCTION_HOST).replace(/\/+$/, "");
}

/** Kavenegar's documented return codes, mapped to short loggable reasons. */
const RETURN_REASONS: Record<number, string> = {
  411: "invalid_receptor",
  412: "invalid_sender",
  413: "invalid_message",
  414: "message_too_long",
  417: "invalid_template",
  418: "template_not_found",
  424: "insufficient_credit",
  426: "daily_limit_reached",
  428: "account_disabled",
  431: "duplicate_message",
  432: "rate_limited",
};

export function returnReason(status: unknown, message: unknown): string {
  const code = typeof status === "number" ? status : Number(status);
  const known = Number.isFinite(code) ? RETURN_REASONS[code] : undefined;
  const suffix = typeof message === "string" && message.trim() ? `:${message.trim().slice(0, 80)}` : "";
  if (known) return `${known}${suffix}`;
  return Number.isFinite(code) ? `gateway_${code}${suffix}` : "gateway_unreachable";
}

/** Kavenegar expects the number without `+` but with the country code. */
export function receptorOf(phone: string): string {
  return phone.replace(/^\+/, "");
}

async function call(path: string, params: Record<string, string>): Promise<SmsResult> {
  const apiKey = env.KAVENEGAR_API_KEY;
  if (!apiKey) return { ok: false, reason: "sms_not_configured" };

  const url = new URL(`${host()}/v1/${apiKey}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { ok: false, reason: "gateway_unreachable", detail: String(error) };
  }

  const body = (await response.json().catch(() => null)) as
    | { return?: { status?: unknown; message?: unknown }; entries?: { messageid?: unknown }[] }
    | null;
  const status = body?.return?.status;
  if (response.status >= 400 || Number(status) !== 200) {
    return {
      ok: false,
      reason: returnReason(status ?? response.status, body?.return?.message),
      detail: body,
    };
  }
  const messageId = body?.entries?.[0]?.messageid;
  return { ok: true, providerRef: messageId == null ? undefined : String(messageId) };
}

export const kavenegarGateway: SmsGateway = {
  id: "kavenegar",
  label: "Kavenegar",

  send(message: SmsMessage): Promise<SmsResult> {
    const receptor = receptorOf(message.phone);
    // A configured template means the provider owns the wording, so the code is
    // passed as the token instead of the full text.
    if (env.KAVENEGAR_TEMPLATE) {
      return call("verify/lookup.json", {
        receptor,
        token: message.code,
        template: env.KAVENEGAR_TEMPLATE,
        type: "sms",
        sender: env.KAVENEGAR_SENDER ?? "",
      });
    }
    if (!env.KAVENEGAR_SENDER) {
      return Promise.resolve({ ok: false, reason: "invalid_sender" });
    }
    return call("sms/send.json", {
      receptor,
      sender: env.KAVENEGAR_SENDER,
      message: message.text,
    });
  },
};
