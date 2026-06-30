"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

/**
 * Props for ErrorBoundary component
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fallback UI to render when an error occurs */
  fallback?: ReactNode;
  /** Custom error handler */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Reset key - changing this will reset the error boundary */
  resetKey?: string | number;
  /** Show stack trace in development */
  showStack?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component for catching and displaying React errors
 * Prevents entire app from crashing when a component throws
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log to console in development
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset error boundary when resetKey changes
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 space-y-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="w-8 h-8" />
            <h2 className="text-2xl font-bold">Something went wrong</h2>
          </div>

          <p className="text-muted-foreground text-center max-w-md">
            An unexpected error occurred. You can try refreshing the page or
            going back to the home page.
          </p>

          {/* Error details (development only) */}
          {(this.props.showStack ?? process.env.NODE_ENV !== "production") && this.state.error && (
            <details className="w-full max-w-2xl">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Show error details
              </summary>
              <div className="mt-4 space-y-4">
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                  <p className="font-mono text-sm text-destructive">
                    {this.state.error.name}: {this.state.error.message}
                  </p>
                </div>
                {this.state.error.stack && (
                  <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-48">
                    {this.state.error.stack}
                  </pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-48">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            </details>
          )}

          <div className="flex gap-4">
            <Button onClick={this.reset} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
            <Button onClick={() => (window.location.href = "/")} variant="default">
              <Home className="w-4 h-4 mr-2" />
              Go Home
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap any component with an error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, "children">
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || "Component";

  const WithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;

  return WithErrorBoundary;
}

/**
 * Hook to programmatically trigger error boundary
 * Useful for handling errors in event handlers or async operations
 */
export function useErrorBoundary(): {
  showBoundary: (error: Error) => void;
} {
  const [, setError] = React.useState<Error | null>(null);

  const showBoundary = React.useCallback((error: Error) => {
    setError(() => {
      throw error;
    });
  }, []);

  return { showBoundary };
}

/**
 * Simple inline error fallback component
 */
export function ErrorFallback({
  error,
  resetErrorBoundary,
  title = "Something went wrong",
  compact = false,
}: {
  error?: Error;
  resetErrorBoundary?: () => void;
  title?: string;
  compact?: boolean;
}): React.ReactElement {
  if (compact) {
    return (
      <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
        <AlertTriangle className="w-4 h-4 text-destructive" />
        <span className="text-sm text-destructive">{error?.message || title}</span>
        {resetErrorBoundary && (
          <Button size="sm" variant="ghost" onClick={resetErrorBoundary}>
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-4">
      <AlertTriangle className="w-6 h-6 text-destructive" />
      <p className="text-destructive font-medium">{title}</p>
      {error && <p className="text-sm text-muted-foreground">{error.message}</p>}
      {resetErrorBoundary && (
        <Button onClick={resetErrorBoundary} variant="outline" size="sm">
          Try Again
        </Button>
      )}
    </div>
  );
}

/**
 * Async error boundary for handling promise rejections
 */
export function AsyncBoundary({
  children,
  pending,
  fallback,
  onError,
}: {
  children: ReactNode;
  pending?: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}): React.ReactElement {
  return (
    <React.Suspense fallback={pending || <div>Loading...</div>}>
      <ErrorBoundary fallback={fallback} onError={onError ? (e) => onError(e) : undefined}>
        {children}
      </ErrorBoundary>
    </React.Suspense>
  );
}
