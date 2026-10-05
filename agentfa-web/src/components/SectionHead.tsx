import type { ReactNode } from "react"

/** The eyebrow + heading + action row every homepage section uses. */
export function SectionHead({
  eyebrow,
  title,
  action,
  id,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
  /** Anchor target for the heading (`/#how`, `/#categories`). */
  id?: string
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={id}>{title}</h2>
      </div>
      {action}
    </div>
  )
}
