// ══════════════════════════════════════════════════════════════════════════════
// Barrel export for shared components — import from '@/shared'
// ══════════════════════════════════════════════════════════════════════════════

export { default as StatCard } from './StatCard';
export { default as LoadingPage } from './LoadingPage';
export { default as TabRouter } from './TabRouter';
export type { TabConfig } from './TabRouter';

// New shared primitives — use these instead of inline duplicates
export { default as EmptyState } from './EmptyState';
export { default as ErrorState } from './ErrorState';
export { default as AsyncButton } from './AsyncButton';
export { default as ConfirmDialog } from './ConfirmDialog';
