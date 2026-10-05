import { useI18n } from "../lib/i18n"

/** One card-shaped placeholder, matching the real card's layout closely enough
    that the grid does not jump when the catalog chunk arrives. */
export function AgentCardSkeleton() {
  return (
    <div className="agent-card" aria-hidden="true">
      <div className="skeleton size-14 rounded-2xl" />
      <div className="skeleton mt-5 h-3 w-16" />
      <div className="skeleton mt-3 h-5 w-2/3" />
      <div className="skeleton mt-3 h-3 w-full" />
      <div className="skeleton mt-2 h-3 w-5/6" />
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton size-9 rounded-xl" />
      </div>
    </div>
  )
}

export function AgentGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <AgentCardSkeleton key={index} />
      ))}
    </div>
  )
}

/**
 * The catalog loads asynchronously (see `useCatalog`); this is what the
 * marketplace and detail routes render meanwhile. The visible label is read by
 * screen readers only — a sighted user sees the shape of the page instead.
 */
export function CatalogSkeleton() {
  const { t } = useI18n()
  return (
    <main className="section" aria-busy="true">
      <p className="sr-only" role="status">
        {t("common.loading")}
      </p>
      <div className="skeleton h-4 w-28" />
      <div className="skeleton mt-6 h-10 w-72 max-w-full" />
      <div className="skeleton mt-10 h-12 w-full max-w-2xl rounded-xl" />
      <div className="mt-8">
        <AgentGridSkeleton />
      </div>
    </main>
  )
}
