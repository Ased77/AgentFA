import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { flush, report } from "../lib/report";

type Props = {
  /** Rendered instead of the crashed subtree. Receives a reset callback. */
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
};

type BoundaryState = { error: Error | null; key: number };

type State = BoundaryState;

/**
 * Catches render errors anywhere below it.
 *
 * Without one, a single thrown error unmounts the whole React tree and leaves a
 * blank page with nothing but a console message.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error", error, info.componentStack);
    // The component stack names the component that threw; the JS stack names
    // the function. A report without both is much harder to act on.
    report({
      kind: "react",
      message: error.message || error.name,
      stack: [error.stack ?? "", info.componentStack ?? ""].filter(Boolean).join("\n"),
    });
    // Send immediately: a user who sees this screen may close the tab, and
    // `sendBeacon` on `pagehide` does not fire for every kind of teardown.
    flush();
  }

  reset = (): void => {
    // Remount the subtree: clearing the error alone would leave the crashed
    // component's state in place, so the same error returns on the next render.
    this.setState(({ key }) => ({ error: null, key: key + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.reset);
    return <Fragment key={this.state.key}>{this.props.children}</Fragment>;
  }
}
