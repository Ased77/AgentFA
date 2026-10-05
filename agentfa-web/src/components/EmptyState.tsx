import type { ReactNode } from "react"

/** "Nothing here" with an explanation and, where one exists, a way out. */
export function EmptyState({
  message,
  hint,
  action,
}: {
  message: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="empty" role="status">
      <p className="font-medium text-ink">{message}</p>
      {hint && <p className="mt-2 text-sm">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}
