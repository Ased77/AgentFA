import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  ApiError,
  api,
  goToGateway,
  type BillingPeriod,
  type PlanKey,
  type WalletSnapshot,
} from "../lib/account";
import { Modal } from "../components/Modal";
import { useSession } from "../lib/session";
import { useI18n } from "../lib/i18n";
import { usePricing } from "../lib/pricing";

/**
 * Plans and top-ups.
 *
 * Every amount on this page comes from `GET /api/pricing`, and every purchase is
 * priced again by the server, so what is shown and what is charged cannot drift
 * apart — which is exactly how the old page came to advertise a free plan that
 * charged 55,000 Toman. The yearly toggle is server-side too: the discount is
 * applied where the plan price is computed, not in the browser.
 */
export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PlanKey | number | null>(null);
  const { user } = useSession();
  const { t, n, toman } = useI18n();
  const { prices, source } = usePricing();

  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  useEffect(() => {
    if (!user) {
      setWallet(null);
      return;
    }
    let alive = true;
    void api
      .wallet()
      .then((snapshot) => alive && setWallet(snapshot))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user]);

  const billing: BillingPeriod = yearly ? "yearly" : "monthly";

  /** The amount one period costs. Mirrors `planPrice()` on the server. */
  function periodPrice(monthlyPrice: number): number {
    if (monthlyPrice === 0) return 0;
    return yearly ? Math.round(monthlyPrice * (1 - prices.yearlyDiscount) * 12) : monthlyPrice;
  }

  function localizedError(err: unknown): string {
    const code = err instanceof ApiError ? err.code : "network";
    const key = `purchase.error.${code}`;
    const message = t(key);
    return message === key ? t("purchase.error.generic") : message;
  }

  async function choosePlan(key: PlanKey) {
    if (!user) {
      setError(t("pricing.loginRequired"));
      return;
    }
    setError("");
    setConfirm("");
    setBusy(key);
    try {
      const result = await api.plan(key, billing);
      // A paid plan goes through the gateway; the wallet only changes once the
      // verified callback settles the transaction.
      if (result.redirectUrl && goToGateway(result.redirectUrl)) return;
      setConfirm(
        result.redirectUrl
          ? t("pricing.planPending")
          : t("pricing.active", { name: t(`plan.${key}`) }),
      );
      setWallet(await api.wallet());
    } catch (err) {
      setError(localizedError(err));
    } finally {
      setBusy(null);
    }
  }

  async function buy(tokens: number, minutes: number, message: string) {
    if (!user) {
      setError(t("pricing.loginRequired"));
      return;
    }
    setError("");
    setConfirm("");
    setBusy(tokens || minutes);
    try {
      const { redirectUrl } = await api.topUp(tokens, minutes);
      if (goToGateway(redirectUrl)) return;
      setConfirm(message);
      setWallet(await api.wallet());
    } catch (err) {
      setError(localizedError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="section">
      <div className="text-center">
        <p className="eyebrow justify-center">{t("pricing.eyebrow")}</p>
        <h1 className="page-title mt-3">
          {t("pricing.title1")} <span>{t("pricing.title2")}</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl leading-8 text-slate-400">{t("pricing.body")}</p>
        <button
          type="button"
          onClick={() => setYearly(!yearly)}
          aria-pressed={yearly}
          className={`mt-7 rounded-full border px-4 py-2 text-sm ${
            yearly
              ? "border-violet-400 bg-violet-500/20 text-violet-200"
              : "border-white/10 text-slate-300"
          }`}
        >
          {t("pricing.yearly")}{" "}
          <span className="mx-2 text-emerald-300">
            {t("pricing.discount", { percent: Math.round(prices.yearlyDiscount * 100) })}
          </span>
        </button>
        {source === "fallback" && (
          <p className="mt-4 text-xs text-amber-300">{t("pricing.offlinePrices")}</p>
        )}
      </div>
      {error && (
        <p className="mt-6 text-center text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {prices.plans.map((plan) => {
          const total = periodPrice(plan.monthlyPrice);
          const current = wallet?.plan === plan.key;
          return (
            <article
              className={`relative rounded-3xl border p-6 sm:p-7 ${
                plan.featured
                  ? "border-violet-400 bg-violet-500/10"
                  : "border-white/10 bg-white/[.03]"
              }`}
              key={plan.key}
            >
              {plan.featured && (
                <span className="badge absolute -top-3 right-6">{t("pricing.featured")}</span>
              )}
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-black">{t(`plan.${plan.key}`)}</h2>
                {current && <span className="badge">{t("pricing.current")}</span>}
              </div>
              <p className="mt-6 text-4xl font-black">
                {total === 0 ? t("pricing.free") : toman(total)}
                {total > 0 && (
                  <small className="text-sm font-normal text-slate-400">
                    {" "}
                    {t(yearly ? "pricing.perYear" : "pricing.perMonth")}
                  </small>
                )}
              </p>
              {yearly && total > 0 && (
                <p className="mt-1 text-xs text-slate-400">
                  {t("pricing.perMonthShort", { price: toman(plan.monthlyEquivalent) })} ·{" "}
                  {t("pricing.billedYearly")}
                </p>
              )}
              <p className="mt-3 text-sm text-violet-200">
                {t("pricing.allowance", { tokens: n(plan.tokens), minutes: n(plan.minutes) })}
              </p>
              <ul className="my-8 space-y-3 text-sm text-slate-300">
                {[`plan.${plan.key}.f1`, `plan.${plan.key}.f2`].map((key) => (
                  <li className="flex gap-2" key={key}>
                    <Check size={17} className="mt-0.5 shrink-0 text-emerald-400" />
                    {t(key)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void choosePlan(plan.key)}
                disabled={busy !== null || current}
                className="btn w-full justify-center disabled:opacity-60"
              >
                {current ? t("pricing.current") : t("pricing.choose")}
              </button>
            </article>
          );
        })}
      </div>
      <section className="mt-14 sm:mt-18">
        <div className="text-center">
          <p className="eyebrow justify-center">{t("pricing.onetime")}</p>
          <h2 className="mt-3 text-3xl font-black">{t("pricing.bundles")}</h2>
        </div>
        <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-3">
          {prices.bundles.map((bundle) => (
            <div
              className="rounded-2xl border border-white/10 bg-white/[.03] p-5 text-center"
              key={`t${bundle.tokens}`}
            >
              <b className="text-xl">{t("pricing.tokensBundle", { tokens: n(bundle.tokens) })}</b>
              <p className="mt-2 text-sm text-slate-400">{toman(bundle.price)}</p>
              <button
                type="button"
                onClick={() =>
                  void buy(bundle.tokens, 0, t("pricing.added", { tokens: n(bundle.tokens) }))
                }
                disabled={busy !== null}
                className="btn btn-soft mt-5"
              >
                {t("pricing.buy")}
              </button>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-6 grid max-w-4xl gap-4 md:grid-cols-3">
          {prices.timePasses.map((pass) => (
            <div
              className="rounded-2xl border border-white/10 bg-white/[.03] p-5 text-center"
              key={`m${pass.minutes}`}
            >
              <b className="text-xl">
                {t("pricing.minutesBundle", { minutes: n(pass.minutes) })}
              </b>
              <p className="mt-2 text-sm text-slate-400">{toman(pass.price)}</p>
              <button
                type="button"
                onClick={() =>
                  void buy(
                    0,
                    pass.minutes,
                    t("pricing.minutesAdded", { minutes: n(pass.minutes) }),
                  )
                }
                disabled={busy !== null}
                className="btn btn-soft mt-5"
              >
                {t("pricing.buy")}
              </button>
            </div>
          ))}
        </div>
      </section>
      {confirm && (
        <Modal
          title={t("pricing.success")}
          onClose={() => setConfirm("")}
          closeLabel={t("common.close")}
        >
          <div className="text-center">
            <Check className="mx-auto size-10 rounded-full bg-emerald-500/20 p-2 text-emerald-300" />
            <p className="mt-4 text-slate-300">{confirm}</p>
            <button className="btn mt-6" onClick={() => setConfirm("")}>
              {t("pricing.gotIt")}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
