import { useEffect, useState } from "react";
import { api, type PriceListData } from "./account";

/**
 * The price list the UI renders.
 *
 * Prices are owned by the server (`GET /api/pricing`) so what a visitor sees is
 * always what they are charged. The fallback below mirrors
 * `server/src/payments/pricing.ts` and only exists so the page still renders
 * when the API is unreachable — it is never used to charge anything.
 */
export const FALLBACK_PRICES: PriceListData = {
  currency: "IRT",
  yearlyDiscount: 0.2,
  bundles: [
    { tokens: 100_000, price: 50_000 },
    { tokens: 300_000, price: 150_000 },
    { tokens: 1_000_000, price: 500_000 },
  ],
  timePasses: [
    { minutes: 60, price: 30_000 },
    { minutes: 300, price: 150_000 },
    { minutes: 1_200, price: 600_000 },
  ],
  plans: [
    { key: "free", tokens: 50_000, minutes: 60, monthlyPrice: 0, monthlyEquivalent: 0 },
    { key: "basic", tokens: 500_000, minutes: 600, monthlyPrice: 290_000, monthlyEquivalent: 232_000, featured: true },
    { key: "pro", tokens: 2_000_000, minutes: 2_400, monthlyPrice: 990_000, monthlyEquivalent: 792_000 },
  ],
};

let cache: PriceListData | null = null;
let inflight: Promise<PriceListData | null> | null = null;

function load(): Promise<PriceListData | null> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .pricing()
      .then((list) => {
        cache = list;
        return list;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function usePricing(): { prices: PriceListData; source: "server" | "fallback" } {
  const [prices, setPrices] = useState<PriceListData>(cache ?? FALLBACK_PRICES);
  const [source, setSource] = useState<"server" | "fallback">(cache ? "server" : "fallback");

  useEffect(() => {
    let alive = true;
    void load().then((list) => {
      if (!alive || !list) return;
      setPrices(list);
      setSource("server");
    });
    return () => {
      alive = false;
    };
  }, []);

  return { prices, source };
}
