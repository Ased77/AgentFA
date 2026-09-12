import { Navigate } from "react-router-dom"
import { agents } from "../data/agents"
import { useI18n } from "../lib/i18n"

export default function Admin() {
  const { t, n, toman } = useI18n()
  if (localStorage.getItem("agentfa-is-admin") !== "true")
    return <Navigate to="/dashboard" replace />
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