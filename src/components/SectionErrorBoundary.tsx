import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Optional label shown in the error fallback (e.g. "Sadhana Leaderboard") */
  sectionName?: string;
  /** Optional compact mode — shows a smaller inline error rather than a card */
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Section-level error boundary for dashboard panels and complex components.
 * Wrapping each major section with this ensures a single panel failure does NOT
 * unmount the entire dashboard — only that section shows the error fallback.
 *
 * Usage:
 *   <SectionErrorBoundary sectionName="Sadhana Leaderboard">
 *     <SadhanaLeaderboard ... />
 *   </SectionErrorBoundary>
 */
export default class SectionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { sectionName = 'This section', compact = false } = this.props;
    const msg = this.state.error?.message || 'An unexpected error occurred';

    if (compact) {
      return (
        <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{sectionName} failed to load. <button className="underline" onClick={this.handleRetry}>Retry</button></span>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <p className="font-medium text-destructive mb-1">{sectionName} failed to load</p>
        <p className="text-xs text-muted-foreground mb-3 max-w-xs mx-auto">{msg}</p>
        <button
          className="text-xs px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          onClick={this.handleRetry}
        >
          Try again
        </button>
      </div>
    );
  }
}
