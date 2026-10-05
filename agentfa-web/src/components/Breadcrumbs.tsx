import { Fragment } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Link } from "react-router-dom"
import { useI18n } from "../lib/i18n"

export type Crumb = {
  label: string
  /** Absent on the current page: the last crumb is text, not a link. */
  to?: string
}

/**
 * Breadcrumbs for the agent detail page. The separator arrow follows the
 * reading direction (like `ForwardArrow`), so it points the way the eye moves
 * in both Persian and English.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t, isRtl } = useI18n()
  const Separator = isRtl ? ChevronLeft : ChevronRight
  return (
    <nav aria-label={t("common.breadcrumb")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {items.map((crumb, index) => (
        <Fragment key={`${crumb.label}-${index}`}>
          {index > 0 && <Separator size={14} className="text-ink-muted/60" aria-hidden="true" />}
          {crumb.to ? (
            <Link to={crumb.to} className="text-ink-muted transition hover:text-ink">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-ink" aria-current="page">
              {crumb.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
