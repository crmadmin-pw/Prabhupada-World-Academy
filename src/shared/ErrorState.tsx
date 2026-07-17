// ══════════════════════════════════════════════════════════════════════════════
// ErrorState — Single source of truth for error display states.
// Use this everywhere instead of inline error markup.
// ══════════════════════════════════════════════════════════════════════════════

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  /** Error message to display */
  message?: string;
  /** Optional retry callback */
  onRetry?: () => void;
  /** Extra className on the wrapper */
  className?: string;
}

export default function ErrorState({
  message = 'Something went wrong. Please try again.',
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-14 text-center px-4 ${className}`}>
      <AlertCircle className="h-10 w-10 text-destructive/50 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
