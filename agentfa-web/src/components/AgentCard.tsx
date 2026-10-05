import { Link } from "react-router-dom"
import type { Agent } from "../data/agents"
import { useEntitlements } from "../lib/useEntitlements"
import { useI18n } from "../lib/i18n"
import { ForwardArrow } from "./ForwardArrow"

/**
 * The one agent card used by the landing page, the marketplace, the dashboard
 * and the related-agents row.
 *
 * The whole card is clickable: the arrow anchor stretches over it with a
 * pseudo-element, so the hit target matches what looks clickable while exactly
 * one link exists for keyboard and screen-reader users.
 */
export function AgentCard({ agent }: { agent: Agent }) {
  const { owns } = useEntitlements()
  const own = owns(agent.id)
  const { t, n, toman, agentName, agentDescription, agentDivision } = useI18n()
  return (
    <article className="agent-card group relative">
      <div className="flex items-start justify-between gap-3">
        <span
          className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-3xl ring-1 ring-line"
          aria-hidden="true"
        >
          {agent.icon}
        </span>
        {agent.featured && <span className="badge">{t("common.bestSeller")}</span>}
      </div>
      <p className="mt-5 text-xs font-medium text-brand">{agentDivision(agent)}</p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold leading-7">{agentName(agent)}</h3>
        <span className="mt-0.5 shrink-0 text-xs text-ink-muted">★ {n(agent.rating)}</span>
      </div>
      <p className="mt-2 h-12 overflow-hidden text-sm leading-6 text-ink-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
        {agentDescription(agent)}
      </p>
      <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
        <div className="flex flex-col">
          <b className="text-sm font-semibold">{toman(agent.price)}</b>
          <span className="text-xs text-ink-muted">
            {n(agent.sales)} {t("common.sales")}
          </span>
        </div>
        <Link
          to={own ? `/chat/${agent.id}` : `/agent/${agent.slug}`}
          className="icon-btn after:absolute after:inset-0 after:content-['']"
          aria-label={`${t("common.view")} ${agentName(agent)}`}
        >
          <ForwardArrow size={18} />
        </Link>
      </div>
    </article>
  )
}
