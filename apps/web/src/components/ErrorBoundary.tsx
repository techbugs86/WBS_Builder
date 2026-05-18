import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../lib/errorReporter';

interface Props {
  children: ReactNode;
  /** Logical name of the boundary — e.g. "EpicsPage". Goes into the log. */
  scope: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches uncaught render errors in any descendant component so a broken
 * page doesn't render as a blank white screen. Forwards the error to the
 * central log so it can be diagnosed without a console screenshot.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError({
      module: `ErrorBoundary:${this.props.scope}`,
      message: error.message,
      context: { componentStack: info.componentStack ?? '' },
      stack: error.stack,
    });
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center px-6">
        <div
          className="max-w-md w-full rounded-2xl p-7 text-center"
          style={{
            background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))',
            border: '1px solid var(--error-border)',
            boxShadow: '0 12px 40px -12px rgba(0,0,0,0.5)',
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'var(--error-bg)',
              border: '1px solid var(--error-border)',
            }}
          >
            <span style={{ color: 'var(--error-text)', fontSize: 28, lineHeight: 1, fontWeight: 700 }}>!</span>
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Something went wrong on this page
          </h1>
          <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
            The page hit an unexpected error. The failure has been logged — you can try again, or reload to recover.
          </p>
          <p
            className="text-[11px] font-mono px-3 py-2 rounded-lg mb-5 break-all"
            style={{
              background: 'var(--bg-overlay-md)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}
          >
            {this.state.error.message}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150"
              style={{
                background: 'var(--bg-overlay-md)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)',
                color: '#fff',
                boxShadow: '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
