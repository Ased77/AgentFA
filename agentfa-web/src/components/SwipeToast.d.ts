// AgentFA: typing for the React Bits SwipeToast (`SwipeToast.jsx`). The
// implementation stays plain JavaScript and is excluded from typechecking.
import type { ReactNode } from "react";

export type ToastCloseReason = "timeout" | "swipe" | "action" | "close" | "escape" | "programmatic";

export type SwipeToastProps = {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  open?: boolean;
  onClose?: (reason: ToastCloseReason) => void;
  background?: string;
  color?: string;
  fuseColor?: string;
  width?: number;
  radius?: number;
  slideMs?: number;
  settleBounce?: number;
  swipeDistance?: number;
  duration?: number;
  fuse?: "bottom" | "top" | "none";
  pauseOnHover?: boolean;
  closeButton?: boolean;
  /** In flow inside the parent instead of fixed to the viewport. */
  inline?: boolean;
  dismissible?: boolean;
  className?: string;
};

declare function SwipeToast(props: SwipeToastProps): ReactNode;
export default SwipeToast;
