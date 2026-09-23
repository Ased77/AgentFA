/**
 * The SMS contract.
 *
 * Login must not depend on one vendor: adding a provider means writing one
 * adapter in this directory and registering it in `./index.ts`. The OTP flow and
 * the routes only ever see these types.
 */

/** A real provider, or `none` for the development logger. */
export type SmsProviderId = "none" | "kavenegar";

/** What an adapter needs to deliver a login code. */
export type SmsMessage = {
  /** Normalized E.164 destination, e.g. `+989121234567`. */
  phone: string;
  /** The code itself, for providers with verification templates. */
  code: string;
  /** Ready-to-send body, for providers that just take text. */
  text: string;
};

export type SmsResult =
  | { ok: true; providerRef?: string }
  | { ok: false; reason: string; detail?: unknown };

export type SmsGateway = {
  id: SmsProviderId;
  label: string;
  send(message: SmsMessage): Promise<SmsResult>;
};
