"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Home, WifiOff, ServerOff } from "lucide-react";

/**
 * Determine error type for better user messaging
 */
function getErrorType(error: Error): {
  type: 'network' | 'server' | 'client' | 'unknown';
  title: string;
  description: string;
  icon: typeof AlertTriangle;
  retryable: boolean;
} {
  const message = error.message.toLowerCase();

  // Network errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('econnrefused') ||
    message.includes('offline')
  ) {
    return {
      type: 'network',
      title: 'Connection Error',
      description: 'Unable to reach the server. Please check your internet connection.',
      icon: WifiOff,
      retryable: true,
    };
  }

  // Server errors
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('server')
  ) {
    return {
      type: 'server',
      title: 'Server Error',
      description: 'The server encountered an error. Please try again later.',
      icon: ServerOff,
      retryable: true,
    };
  }

  // Client errors (validation, not found, etc.)
  if (
    message.includes('400') ||
    message.includes('404') ||
    message.includes('validation')
  ) {
    return {
      type: 'client',
      title: 'Request Error',
      description: 'There was a problem with the request. Please try a different action.',
      icon: AlertTriangle,
      retryable: false,
    };
  }

  return {
    type: 'unknown',
    title: 'Something went wrong',
    description: 'An unexpected error occurred.',
    icon: AlertTriangle,
    retryable: true,
  };
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const errorInfo = getErrorType(error);
  const Icon = errorInfo.icon;

  useEffect(() => {
    // Log error for debugging
    console.error("[App Error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      type: errorInfo.type,
    });
  }, [error, errorInfo.type]);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      // Small delay to show loading state
      await new Promise((resolve) => setTimeout(resolve, 500));
      reset();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleGoHome = () => {
    window.location.href = "/";
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-6 p-8">
      {/* Error Icon and Title */}
      <div className="flex items-center gap-3 text-destructive">
        <Icon className="w-8 h-8" />
        <h2 className="text-2xl font-bold">{errorInfo.title}</h2>
      </div>

      {/* Description */}
      <p className="text-muted-foreground text-center max-w-md">
        {errorInfo.description}
      </p>

      {/* Error digest for support */}
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4">
        {errorInfo.retryable && (
          <Button onClick={handleRetry} disabled={isRetrying} variant="default">
            {isRetrying ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </>
            )}
          </Button>
        )}
        <Button onClick={handleGoHome} variant="outline">
          <Home className="w-4 h-4 mr-2" />
          Go Home
        </Button>
      </div>

      {/* Error Details Toggle (Development) */}
      {process.env.NODE_ENV !== "production" && (
        <div className="w-full max-w-2xl">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            {showDetails ? "Hide" : "Show"} error details
          </button>

          {showDetails && (
            <div className="mt-4 space-y-4">
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="font-mono text-sm text-destructive break-all">
                  {error.name}: {error.message}
                </p>
              </div>
              {error.stack && (
                <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-64">
                  {error.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
