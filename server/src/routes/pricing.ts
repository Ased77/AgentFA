import type { FastifyInstance } from "fastify";
import { priceList } from "../payments/pricing.js";

/**
 * The public price list.
 *
 * Unauthenticated on purpose: the marketing and pricing pages must render the
 * exact amounts the server will charge, and there is nothing private in a price
 * list. The SPA fetches this once and renders bundles, time passes and plans
 * from it instead of carrying its own hardcoded copies.
 */
export async function pricingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/pricing", async () => priceList());
}
