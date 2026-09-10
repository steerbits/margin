import { Component, type ReactNode } from "react";
export class PluginBoundary extends Component<
  { name: string; children: ReactNode; fallback?: ReactNode },
  { failed: boolean; error: string }
> {
  state = { failed: false, error: "" };
  static getDerivedStateFromError(error: unknown) {
    return {
      failed: true,
      error:
        error instanceof Error
          ? error.message || "Unknown rendering error"
          : String(error),
    };
  }
  render() {
    if (this.state.failed)
      return (
        <>
          <div className="notice warning" role="alert">
            Plugin {this.props.name} could not render: {this.state.error}
            <button onClick={() => this.setState({ failed: false, error: "" })}>
              Retry
            </button>
          </div>
          {this.props.fallback}
        </>
      );
    return this.props.children;
  }
}
