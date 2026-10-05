import { X } from "lucide-react"

/**
 * One active filter. The whole chip is the remove button (rather than a chip
 * plus a tiny "x" inside it), which keeps the hit target large on touch while
 * the label still says exactly what pressing it does.
 */
export function FilterChip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string
  onRemove: () => void
  /** Accessible name for the control, e.g. "Remove filter: Design". */
  removeLabel: string
}) {
  return (
    <button type="button" className="filter-chip" onClick={onRemove} aria-label={removeLabel}>
      {label}
      <X size={12} aria-hidden="true" />
    </button>
  )
}
