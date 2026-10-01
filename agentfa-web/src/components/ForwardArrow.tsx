import { ArrowLeft, ArrowRight } from "lucide-react";
import { useI18n } from "../lib/i18n";

/**
 * The "go forward" arrow.
 *
 * Directional icons are not part of the layout engine: an arrow that points left
 * is correct in Persian (RTL) and backwards in English (LTR). Every forward CTA
 * uses this so the direction follows the reading direction instead of being
 * hardcoded to RTL.
 */
export function ForwardArrow({ size = 16 }: { size?: number }) {
  const { isRtl } = useI18n();
  return isRtl ? <ArrowLeft size={size} /> : <ArrowRight size={size} />;
}
