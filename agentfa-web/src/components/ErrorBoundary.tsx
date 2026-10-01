import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Rendered instead of the crashed subtree. Receives a reset callback. */
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Catches render errors anywhere below it.
 *
 * Without one, a single thrown error unmounts the whole React tree and leaves a
 * blank page with nothing but a console message.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.reset);
    return this.props.children;
  }
}
