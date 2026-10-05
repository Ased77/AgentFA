import {
  Bot,
  Box,
  Boxes,
  ClipboardList,
  Code,
  DollarSign,
  FlaskConical,
  Gamepad2,
  GraduationCap,
  LifeBuoy,
  Map,
  Megaphone,
  PenTool,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"

/**
 * The Lucide icons the division set names, keyed by the PascalCase name stored
 * in `divisions.json`. Only the divisions the catalog actually declares are
 * listed; anything else falls back to a generic mark instead of crashing the
 * category grid.
 */
const ICONS: Record<string, LucideIcon> = {
  GraduationCap,
  PenTool,
  Code,
  DollarSign,
  Gamepad2,
  Map,
  Stethoscope,
  Megaphone,
  Target,
  Box,
  ClipboardList,
  Search,
  TrendingUp,
  ShieldCheck,
  Boxes,
  Sparkles,
  LifeBuoy,
  FlaskConical,
}

export function DivisionIcon({
  name,
  size = 18,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const Icon = ICONS[name] ?? Bot
  return <Icon size={size} className={className} aria-hidden="true" />
}
