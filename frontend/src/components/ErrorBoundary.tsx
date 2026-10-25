/**
 * ErrorBoundary Component
 *
 * React error boundary that catches uncaught errors in the component tree.
 * Renders a branded fallback UI with reload option.
 * Logs errors to console for debugging.
 */

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console (no Sentry yet)
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default branded fallback
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-surface-raised border border-surface-border rounded-lg p-8 text-center">
            <div className="w-16 h-16 bg-status-blocked-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-brand-magenta" />
            </div>

            <h1 className="text-2xl font-display text-brand-dark-blue mb-2">
              Something went wrong
            </h1>

            <p className="text-text-muted mb-6">
              We encountered an unexpected error. Please reload the page to continue.
            </p>

            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-blue text-white rounded-lg hover:bg-brand-blue-hover transition-colors font-medium"
            >
              <RotateCcw className="w-4 h-4" />
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * PanelErrorFallback Component
 *
 * Smaller error fallback for individual phase panels in the Dashboard.
 * Used to isolate failures to specific panels without breaking the entire page.
 */

interface PanelErrorFallbackProps {
  phase: string;
}

export function PanelErrorFallback({ phase }: PanelErrorFallbackProps): JSX.Element {
  const handleReload = (): void => {
    window.location.reload();
  };

  return (
    <div className="bg-status-blocked-bg border border-brand-magenta rounded-lg p-6 my-4">
      <div className="flex items-center gap-3 mb-3">
        <AlertTriangle className="w-5 h-5 text-brand-magenta flex-shrink-0" />
        <h3 className="font-display text-brand-dark-blue">
          Error loading {phase} panel
        </h3>
      </div>

      <p className="text-sm text-text-muted mb-4">
        An unexpected error occurred while rendering this section.
      </p>

      <button
        onClick={handleReload}
        className="inline-flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded hover:bg-brand-blue-hover transition-colors text-sm"
      >
        <RotateCcw className="w-4 h-4" />
        Reload Page
      </button>
    </div>
  );
}
