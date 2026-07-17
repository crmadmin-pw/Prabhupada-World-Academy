// ══════════════════════════════════════════════════════════════════════════════
// EmptyState — Single source of truth for empty content states.
// Use this everywhere instead of inline empty-state markup.
// ══════════════════════════════════════════════════════════════════════════════

import { InboxIcon } from 'lucide-react';
import type { ElementType } from 'react';

interface EmptyStateProps {
  /** Lucide icon component. Defaults to InboxIcon. */
  icon?: ElementType;
  /** Main message (required) */
  title: string;
  /** Optional supporting description */
  description?: string;
  /** Optional action button or link */
  action?: React.ReactNode;
  /** Extra className on the wrapper */
  className?: string;
}

export default function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-14 text-center px-4 ${className}`}>
      <Icon className="h-10 w-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
