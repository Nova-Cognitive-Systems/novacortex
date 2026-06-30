"use client";

import React, { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Database,
  Search,
  Plus,
  FolderOpen,
  FileText,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface EmptyStateProps {
  /** Icon to display */
  icon?: ReactNode;
  /** Main heading */
  title: string;
  /** Description text */
  description?: string;
  /** Primary action button */
  action?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
  };
  /** Secondary action */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Custom class name */
  className?: string;
}

/**
 * Empty state component for displaying when there's no data
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = "md",
  className = "",
}: EmptyStateProps): React.ReactElement {
  const sizeClasses = {
    sm: "py-6 px-4",
    md: "py-12 px-6",
    lg: "py-16 px-8",
  };

  const iconSizes = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  const titleSizes = {
    sm: "text-base",
    md: "text-lg",
    lg: "text-xl",
  };

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${sizeClasses[size]} ${className}`}
    >
      {icon && (
        <div className={`${iconSizes[size]} text-muted-foreground mb-4`}>{icon}</div>
      )}

      <h3 className={`font-semibold ${titleSizes[size]} mb-2`}>{title}</h3>

      {description && (
        <p className="text-muted-foreground text-sm max-w-md mb-6">{description}</p>
      )}

      {(action || secondaryAction) && (
        <div className="flex gap-3">
          {action && (
            <Button onClick={action.onClick}>
              {action.icon && <span className="mr-2">{action.icon}</span>}
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Pre-configured empty states for common scenarios
 */

export function EmptyMemories({
  onCreateClick,
}: {
  onCreateClick?: () => void;
}): React.ReactElement {
  return (
    <EmptyState
      icon={<Database className="w-full h-full" />}
      title="No memories yet"
      description="Start by creating your first memory. Memories can store facts, events, or any information you want to remember."
      action={
        onCreateClick
          ? {
              label: "Create Memory",
              onClick: onCreateClick,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

export function EmptySearchResults({
  query,
  onClearSearch,
}: {
  query?: string;
  onClearSearch?: () => void;
}): React.ReactElement {
  return (
    <EmptyState
      icon={<Search className="w-full h-full" />}
      title="No results found"
      description={
        query
          ? `No memories match "${query}". Try adjusting your search terms.`
          : "Try searching with different keywords."
      }
      action={
        onClearSearch
          ? {
              label: "Clear Search",
              onClick: onClearSearch,
            }
          : undefined
      }
    />
  );
}

export function EmptyNamespace({
  namespace,
  onCreateClick,
}: {
  namespace: string;
  onCreateClick?: () => void;
}): React.ReactElement {
  return (
    <EmptyState
      icon={<FolderOpen className="w-full h-full" />}
      title={`No memories in "${namespace}"`}
      description="This namespace is empty. Create a memory to get started."
      action={
        onCreateClick
          ? {
              label: "Create Memory",
              onClick: onCreateClick,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

export function EmptyDocuments({
  onUploadClick,
}: {
  onUploadClick?: () => void;
}): React.ReactElement {
  return (
    <EmptyState
      icon={<FileText className="w-full h-full" />}
      title="No documents"
      description="Upload documents to add them to your knowledge base."
      action={
        onUploadClick
          ? {
              label: "Upload Document",
              onClick: onUploadClick,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

export function EmptyRelations({
  onCreateClick,
}: {
  onCreateClick?: () => void;
}): React.ReactElement {
  return (
    <EmptyState
      icon={<Database className="w-full h-full" />}
      title="No relations"
      description="This memory has no connections to other memories yet."
      action={
        onCreateClick
          ? {
              label: "Create Relation",
              onClick: onCreateClick,
              icon: <Plus className="w-4 h-4" />,
            }
          : undefined
      }
      size="sm"
    />
  );
}

/**
 * Error state component
 */
export function ErrorState({
  error,
  onRetry,
  title = "Something went wrong",
}: {
  error?: Error | string;
  onRetry?: () => void;
  title?: string;
}): React.ReactElement {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <EmptyState
      icon={<AlertCircle className="w-full h-full text-destructive" />}
      title={title}
      description={errorMessage || "An unexpected error occurred. Please try again."}
      action={
        onRetry
          ? {
              label: "Try Again",
              onClick: onRetry,
              icon: <RefreshCw className="w-4 h-4" />,
            }
          : undefined
      }
    />
  );
}

/**
 * Loading state with skeleton
 */
export function LoadingState({
  message = "Loading...",
  size = "md",
}: {
  message?: string;
  size?: "sm" | "md" | "lg";
}): React.ReactElement {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-12 w-12",
    lg: "h-16 w-16",
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div
        className={`${sizeClasses[size]} border-4 border-primary border-t-transparent rounded-full animate-spin mb-4`}
      />
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

/**
 * Connection status indicator
 */
export function ConnectionStatus({
  isConnected,
  isLoading,
  onRetry,
}: {
  isConnected: boolean;
  isLoading?: boolean;
  onRetry?: () => void;
}): React.ReactElement | null {
  if (isConnected && !isLoading) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
        <RefreshCw className="w-4 h-4 animate-spin text-yellow-600" />
        <span className="text-sm text-yellow-600">Connecting...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md">
      <AlertCircle className="w-4 h-4 text-destructive" />
      <span className="text-sm text-destructive">Connection lost</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry} className="ml-2">
          Retry
        </Button>
      )}
    </div>
  );
}
