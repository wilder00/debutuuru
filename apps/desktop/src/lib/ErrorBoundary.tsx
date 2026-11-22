import { Component, type ReactNode } from "react";

/** Keeps a failure inside one panel (a viewer that throws while rendering)
 *  from blanking the whole app: the panel shows the error instead. `resetKey`
 *  changes (another file, another commit) try again. */
export class ErrorBoundary extends Component<{ resetKey?: unknown; children: ReactNode }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { error: Error | null; key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  render() {
    return this.state.error ? <div className="empty danger">{this.state.error.message}</div> : this.props.children;
  }
}
