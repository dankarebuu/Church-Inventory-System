import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const CHUNK_LOAD_ERROR_PATTERN =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading chunk/i;

export function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  return CHUNK_LOAD_ERROR_PATTERN.test(error.message);
}

/**
 * React Error Boundary that catches unexpected render/lazy-import failures,
 * distinguishes stale post-deploy chunk errors, and offers one-click reload
 * or route recovery without crashing to a blank screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uncaught application error:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== 'undefined') {
      window.location.assign('/dashboard');
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const chunkError = isChunkLoadError(this.state.error);

    return (
      <div
        role="alert"
        className="mx-auto my-10 flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-destructive/30 bg-card p-6 text-center text-card-foreground shadow-card sm:p-8"
      >
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-destructive/12 text-destructive"
        >
          <AlertTriangle className="size-6" />
        </span>

        <div className="space-y-1.5">
          <h2 className="font-display text-xl font-bold text-foreground">
            {chunkError ? 'New App Version Available' : 'Something went wrong'}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {chunkError
              ? 'This view failed to load because a newer version of Steward may have been deployed. Reload the page to fetch the latest files.'
              : this.state.error?.message ||
                'An unexpected error occurred while rendering this view.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <Button type="button" onClick={this.handleReload}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Reload Page</span>
          </Button>
          {!chunkError && (
            <Button type="button" variant="outline" onClick={this.handleReset}>
              <span>Try Again</span>
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={this.handleGoHome}>
            <Home className="size-4" aria-hidden="true" />
            <span>Dashboard</span>
          </Button>
        </div>
      </div>
    );
  }
}
