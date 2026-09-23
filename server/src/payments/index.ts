import { env } from "../env.js";
import { stripeGateway } from "./stripe.js";
import { PaymentError, type PaymentGateway, type PaymentProviderId } from "./types.js";
import { zarinpalGateway } from "./zarinpal.js";

/** Every adapter this deployment can be switched to via PAYMENT_PROVIDER. */
const gateways: Record<PaymentProviderId, PaymentGateway> = {
  zarinpal: zarinpalGateway,
  stripe: stripeGateway,
};

export function gatewayById(id: string): PaymentGateway | null {
  return gateways[id as PaymentProviderId] ?? null;
}

/** The gateway selected by PAYMENT_PROVIDER; `null` means payments are off. */
export function activeGateway(): PaymentGateway | null {
  const id = env.PAYMENT_PROVIDER;
  if (id === "none") return null;
  return gateways[id] ?? null;
}

/** Like `activeGateway()`, but errors instead of returning null when disabled. */
export function requireGateway(): PaymentGateway {
  const gateway = activeGateway();
  if (!gateway) {
    throw new PaymentError("gateway_not_configured", "no payment gateway is enabled", 503);
  }
  return gateway;
}

export { PaymentError } from "./types.js";
export type {
  CallbackOutcome,
  CallbackPayload,
  CallbackReference,
  PaymentGateway,
  PaymentProviderId,
  TransactionRef,
} from "./types.js";
