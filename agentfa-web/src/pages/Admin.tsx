import { useEffect, useState } from "react"
import { Plug, Save, Trash2 } from "lucide-react"
import { agents } from "../data/agents"
import { useI18n } from "../lib/i18n"
import { ApiError, api, type PublicProvider } from "../lib/account"

type MeterMode = "tokens" | "time"

type Draft = {
  label: string
  baseUrl: string
  model: string
  apiKey: string
  meter: MeterMode
  tomanPer1kTokens: number
  tomanPerMinute: number
  agentScopeText: string
  enabled: boolean
}

const EMPTY_DRAFT: Draft = {
  label: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  meter: "tokens",
  tomanPer1kTokens: 2000,
  tomanPerMinute: 30000,
  agentScopeText: "",
  enabled: true,
}

function ProviderSection() {
  const { t, n } = useI18n()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saved, setSaved] = useState<PublicProvider | null>(null)
  const [savedFlag, setSavedFlag] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api
      .adminProvider()
      .then(({ provider }) => {
        if (!alive) return
        setSaved(provider)
        if (provider) {
          setDraft({
            label: provider.label,
            baseUrl: provider.baseUrl,
            model: provider.model,
            apiKey: "",
            meter: provider.meter,
            tomanPer1kTokens: provider.tomanPer1kTokens,
            tomanPerMinute: provider.tomanPerMinute,
            agentScopeText: provider.agentScope.includes("*") ? "" : provider.agentScope.join(", "),
            enabled: provider.enabled,
          })
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  function update(patch: Partial<Draft>) {
    setSavedFlag(false)
    setDraft((d) => ({ ...d, ...patch }))
  }

  const scopeIds = draft.agentScopeText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const unknown = scopeIds.filter((id) => !agents.some((a) => a.id === id))

  const problems: string[] = []
  if (!draft.baseUrl.trim()) problems.push("admin.provider.problem.baseUrl")
  else if (!/^https?:\/\//i.test(draft.baseUrl.trim()))
    problems.push("admin.provider.problem.scheme")
  if (!draft.model.trim()) problems.push("admin.provider.problem.model")
  if (!draft.apiKey.trim() && !saved) problems.push("admin.provider.problem.key")

  async function save() {
    setResult("")
    try {
      const { provider } = await api.saveProvider({
        label: draft.label,
        baseUrl: draft.baseUrl,
        model: draft.model,
        apiKey: draft.apiKey || undefined,
        meter: draft.meter,
        tomanPer1kTokens: draft.tomanPer1kTokens,
        tomanPerMinute: draft.tomanPerMinute,
        agentScope: scopeIds.length ? scopeIds : ["*"],
        enabled: draft.enabled,
      })
      setSaved(provider)
      setDraft((d) => ({ ...d, apiKey: "" }))
      setSavedFlag(true)
    } catch (err) {
      setResult(`✕ ${err instanceof ApiError ? err.code : "network"}`)
    }
  }

  async function test() {
    setTesting(true)
    setResult("")
    try {
      const outcome = await api.testProvider()
      if (outcome.ok)
        setResult(
          t("admin.provider.testOk", {
            model: saved?.model ?? draft.model,
            tokens: n(outcome.tokens ?? 0),
            seconds: String(outcome.seconds ?? 0),
          }),
        )
      else setResult(`✕ ${outcome.error ?? "network"}`)
    } catch (err) {
      setResult(`✕ ${err instanceof ApiError ? err.code : "network"}`)
    } finally {
      setTesting(false)
    }
  }

  async function clear() {
    try {
      await api.deleteProvider()
    } catch {
      /* ignore */
    }
    setSaved(null)
    setDraft(EMPTY_DRAFT)
    setSavedFlag(true)
  }

  if (loading) return null

  return (
    <section className="mt-8 rounded-2xl border border-white/10 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">{t("admin.provider.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">{t("admin.provider.body")}</p>
        </div>
        <span className={`badge ${draft.enabled ? "" : "opacity-50"}`}>
          {draft.enabled ? t("admin.provider.active") : t("admin.provider.disabled")}
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="text-slate-400">{t("admin.provider.label")}</span>
          <input
            className="field mt-2"
            value={draft.label}
            onChange={(e) => update({ label: e.target.value })}
            placeholder={t("admin.provider.labelPlaceholder")}
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-400">{t("admin.provider.baseUrl")}</span>
          <input
            className="field mt-2"
            dir="ltr"
            value={draft.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-400">{t("admin.provider.model")}</span>
          <input
            className="field mt-2"
            dir="ltr"
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="deepseek-chat"
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-400">{t("admin.provider.key")}</span>
          <input
            className="field mt-2"
            dir="ltr"
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder={saved ? saved.apiKeyMasked : "sk-…"}
          />
          {saved && !draft.apiKey && (
            <span className="mt-1 block text-xs text-slate-500" dir="ltr">
              {saved.apiKeyMasked}
            </span>
          )}
        </label>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="text-sm">
          <span className="text-slate-400">{t("admin.provider.meter")}</span>
          <div className="mt-2 flex gap-2">
            {(["tokens", "time"] as MeterMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => update({ meter: mode })}
                className={`rounded-xl border px-4 py-2 text-sm ${
                  draft.meter === mode
                    ? "border-violet-400 bg-violet-500/20 text-violet-100"
                    : "border-white/10 text-slate-300"
                }`}
              >
                {t(`admin.provider.meter.${mode}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>
            <span className="text-slate-400">{t("admin.provider.rateTokens")}</span>
            <input
              className="field mt-2"
              dir="ltr"
              inputMode="numeric"
              value={draft.tomanPer1kTokens}
              onChange={(e) =>
                update({ tomanPer1kTokens: Number(e.target.value.replace(/\D/g, "")) })
              }
            />
          </label>
          <label>
            <span className="text-slate-400">{t("admin.provider.rateTime")}</span>
            <input
              className="field mt-2"
              dir="ltr"
              inputMode="numeric"
              value={draft.tomanPerMinute}
              onChange={(e) =>
                update({ tomanPerMinute: Number(e.target.value.replace(/\D/g, "")) })
              }
            />
          </label>
        </div>
      </div>

      <label className="mt-6 block text-sm">
        <span className="text-slate-400">{t("admin.provider.scope")}</span>
        <input
          className="field mt-2"
          dir="ltr"
          value={draft.agentScopeText}
          onChange={(e) => update({ agentScopeText: e.target.value })}
          placeholder={t("admin.provider.scopePlaceholder")}
        />
        <span className="mt-1 block text-xs text-slate-500">
          {scopeIds.length === 0
            ? t("admin.provider.scopeAll", { count: n(agents.length) })
            : t("admin.provider.scopeCount", { count: n(scopeIds.length) })}
        </span>
        {unknown.length > 0 && (
          <span className="mt-1 block text-xs text-amber-300">
            {t("admin.provider.scopeUnknown", { ids: unknown.join(", ") })}
          </span>
        )}
      </label>

      <div className="mt-6 flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          {t("admin.provider.enabled")}
        </label>
      </div>

      {problems.length > 0 && (
        <ul className="mt-5 space-y-1 text-xs text-amber-300">
          {problems.map((key) => (
            <li key={key}>• {t(key)}</li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className="btn text-sm" onClick={save}>
          <Save size={16} /> {t("admin.provider.save")}
        </button>
        <button
          className="btn btn-soft text-sm"
          onClick={test}
          disabled={testing || !saved}
        >
          <Plug size={16} />{" "}
          {testing ? t("admin.provider.testing") : t("admin.provider.test")}
        </button>
        <button className="flex items-center gap-1 text-sm text-red-300" onClick={clear}>
          <Trash2 size={15} /> {t("admin.provider.clear")}
        </button>
        {savedFlag && (
          <span className="text-sm text-emerald-300">{t("admin.provider.saved")}</span>
        )}
      </div>
      {result && (
        <p className="mt-4 break-words text-sm text-slate-300" dir="auto">
          {result}
        </p>
      )}
    </section>
  )
}

export default function Admin() {
  const { t, n, toman } = useI18n()
  const stats: [string, string][] = [
    [toman(39890000), t("admin.totalSales")],
    [n(1280), t("admin.activeUsers")],
    [n(5400000), t("admin.tokensUsed")],
  ]
  return (
    <main className="section">
      <p className="eyebrow">{t("admin.eyebrow")}</p>
      <h1 className="page-title">{t("admin.pageTitle")}</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {stats.map(([v, l]) => (
          <div className="stat" key={l}>
            <b>{v}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <ProviderSection />
      <section className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
        <div className="flex items-center justify-between p-5">
          <h2 className="font-bold">{t("admin.manageAgents")}</h2>
          <button className="btn text-sm">{t("admin.createAgent")}</button>
        </div>
        <table className="w-full min-w-150 text-right text-sm">
          <thead className="border-y border-white/10 text-slate-500">
            <tr>
              <th className="p-4">{t("admin.col.agent")}</th>
              <th>{t("admin.col.category")}</th>
              <th>{t("admin.col.price")}</th>
              <th>{t("admin.col.sales")}</th>
              <th className="p-4">{t("admin.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr className="border-b border-white/5" key={a.id}>
                <td className="p-4">
                  {a.icon} {a.name}
                </td>
                <td>{a.category}</td>
                <td>{toman(a.price)}</td>
                <td>{n(a.sales)}</td>
                <td className="p-4">
                  <button className="text-violet-300">{t("admin.edit")}</button>
                  <button className="mx-4 text-red-300">{t("admin.disable")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="mt-8 rounded-2xl border border-white/10 p-6">
        <h2 className="font-bold">{t("admin.discountCodes")}</h2>
        <p className="mt-3 text-sm text-slate-400">{t("admin.discountBody")}</p>
        <button className="btn btn-soft mt-5">{t("admin.createCode")}</button>
      </section>
    </main>
  )
}