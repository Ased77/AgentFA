import { useState } from "react"
import { Check, X } from "lucide-react"
import { ApiError, api, goToGateway } from "../lib/account"
import { useSession } from "../lib/session"
import { useI18n } from "../lib/i18n"

type PlanKey = "free" | "basic" | "pro"

/** Monthly allowance per plan, mirrored from the server's wallet module. */
const PLAN_ALLOWANCE: Record<PlanKey, { tokens: number; minutes: number }> = {
  free: { tokens: 50000, minutes: 60 },
  basic: { tokens: 500000, minutes: 600 },
  pro: { tokens: 2000000, minutes: 2400 },
}

const plans: {
  nameKey: string
  key: PlanKey
  tokens: number
  minutes: number
  price: number
  featured?: boolean
  featureKeys: [string, string]
}[] = [
  {
    nameKey: "plan.free",
    key: "free",
    ...PLAN_ALLOWANCE.free,
    price: 0,
    featureKeys: ["plan.free.f1", "plan.free.f2"],
  },
  {
    nameKey: "plan.basic",
    key: "basic",
    ...PLAN_ALLOWANCE.basic,
    price: 290000,
    featured: true,
    featureKeys: ["plan.basic.f1", "plan.basic.f2"],
  },
  {
    nameKey: "plan.pro",
    key: "pro",
    ...PLAN_ALLOWANCE.pro,
    price: 990000,
    featureKeys: ["plan.pro.f1", "plan.pro.f2"],
  },
]

const bundles: [number, number][] = [
  [100000, 50000],
  [300000, 130000],
  [1000000, 400000],
]

export default function Pricing() {
  const [yearly, setYearly] = useState(false)
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const { user } = useSession()
  const { t, n, toman } = useI18n()

  function price(value: number) {
    if (value === 0) return t("pricing.free")
    return toman(yearly ? Math.round(value * 0.8) : value)
  }

  async function buy(tokens: number, minutes: number, message: string) {
    if (!user) {
      setError(t("chat.error.not_owned"))
      return
    }
    setError("")
    try {
      const { redirectUrl } = await api.topUp(tokens, minutes)
      // Leave the SPA for the gateway's hosted checkout; the purchase is only
      // final once the gateway's callback settles it.
      if (goToGateway(redirectUrl)) return
      setConfirm(message)
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "network")
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
          onClick={() => setYearly(!yearly)}
          className={`mt-7 rounded-full border px-4 py-2 text-sm ${
            yearly
              ? "border-violet-400 bg-violet-500/20 text-violet-200"
              : "border-white/10 text-slate-300"
          }`}
        >
          {t("pricing.yearly")}{" "}
          <span className="mx-2 text-emerald-300">{t("pricing.discount")}</span>
        </button>
      </div>
      {error && <p className="mt-6 text-center text-sm text-rose-300">{error}</p>}
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {plans.map((p) => (
          <article
            className={`relative rounded-3xl border p-6 sm:p-7 ${
              p.featured ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-white/[.03]"
            }`}
            key={p.key}
          >
            {p.featured && (
              <span className="badge absolute -top-3 right-6">{t("pricing.featured")}</span>
            )}
            <h2 className="text-2xl font-black">{t(p.nameKey)}</h2>
            <p className="mt-6 text-4xl font-black">
              {price(p.price)}
              {p.price > 0 && (
                <small className="text-sm font-normal text-slate-400">
                  {" "}
                  {t("pricing.perMonth")}
                </small>
              )}
            </p>
            <p className="mt-3 text-sm text-violet-200">
              {t("pricing.allowance", {
                tokens: n(p.tokens),
                minutes: n(p.minutes),
              })}
            </p>
            <ul className="my-8 space-y-3 text-sm text-slate-300">
              {p.featureKeys.map((f) => (
                <li className="flex gap-2" key={f}>
                  <Check size={17} className="mt-0.5 shrink-0 text-emerald-400" />
                  {t(f)}
                </li>
              ))}
            </ul>
            <button
              onClick={() =>
                void buy(
                  p.tokens,
                  p.minutes,
                  t("pricing.active", { name: t(p.nameKey) }),
                )
              }
              className="btn w-full justify-center"
            >
              {t("pricing.choose")}
            </button>
          </article>
        ))}
      </div>
      <section className="mt-14 sm:mt-18">
        <div className="text-center">
          <p className="eyebrow justify-center">{t("pricing.onetime")}</p>
          <h2 className="mt-3 text-3xl font-black">{t("pricing.bundles")}</h2>
        </div>
        <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-3">
          {bundles.map(([tokens, amount]) => (
            <div
              className="rounded-2xl border border-white/10 bg-white/[.03] p-5 text-center"
              key={tokens}
            >
              <b className="text-xl">{t("pricing.tokensBundle", { tokens: n(tokens) })}</b>
              <p className="mt-2 text-sm text-slate-400">{toman(amount)}</p>
              <button
                onClick={() =>
                  void buy(tokens, 0, t("pricing.added", { tokens: n(tokens) }))
                }
                className="btn btn-soft mt-5"
              >
                {t("pricing.buy")}
              </button>
            </div>
          ))}
        </div>
      </section>
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4">
          <div className="modal-panel w-full max-w-sm rounded-3xl border border-violet-400/30 bg-[#101936] p-6 text-center sm:p-7">
            <button onClick={() => setConfirm("")} className="float-left text-slate-400">
              <X />
            </button>
            <Check className="mx-auto size-10 rounded-full bg-emerald-500/20 p-2 text-emerald-300" />
            <h2 className="mt-5 text-xl font-bold">{t("pricing.success")}</h2>
            <p className="mt-3 text-slate-300">{confirm}</p>
            <button className="btn mt-6" onClick={() => setConfirm("")}>
              {t("pricing.gotIt")}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}