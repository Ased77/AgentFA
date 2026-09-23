import { env, isProd } from "../env.js";
import { kavenegarGateway } from "./kavenegar.js";
import type { SmsGateway, SmsProviderId, SmsResult } from "./types.js";

/** Every adapter this deployment can be switched to via SMS_PROVIDER. */
const gateways: Record<Exclude<SmsProviderId, "none">, SmsGateway> = {
  kavenegar: kavenegarGateway,
};

type RealProvider = Exclude<SmsProviderId, "none">;

function isProvider(id: string): id is RealProvider {
  return id in gateways;
}

export function smsGatewayById(id: string): SmsGateway | null {
  return isProvider(id) ? gateways[id] : null;
}

/**
 * The gateway selected by SMS_PROVIDER, or `null` when SMS is switched off.
 *
 * Without a provider nobody can log in, so `null` is a hard stop rather than a
 * silent success: the route answers `sms_not_configured` instead of telling the
 * user to watch a phone that will never buzz.
 */
export function activeSmsGateway(): SmsGateway | null {
  const id: SmsProviderId = env.SMS_PROVIDER;
  return isProvider(id) ? gateways[id] : null;
}

/**
 * In development the code is written to the server log and echoed in the API
 * response, so the whole flow is testable without SMS credit. Production never
 * does either — it must have a real provider configured instead.
 */
export function devCodeEnabled(): boolean {
  return !isProd() && env.SMS_PROVIDER === "none";
}

/** Prints the code to the log: the `SMS_PROVIDER=none` development path. */
export function loggingGateway(log: (line: string) => void): SmsGateway {
  return {
    id: "none",
    label: "log (development)",
    send(message): Promise<SmsResult> {
      log(`login code for ${message.phone}: ${message.code}`);
      return Promise.resolve({ ok: true });
    },
  };
}

export type { SmsGateway, SmsMessage, SmsProviderId, SmsResult } from "./types.js";
export { kavenegarGateway } from "./kavenegar.js";
