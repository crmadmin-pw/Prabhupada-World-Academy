interface Props { status: string; isOverdue?: boolean; }

const CONFIG: Record<string, { label: string; className: string }> = {
  assigned: { label: '⏳ Pending', className: 'bg-blue-100 text-blue-700' },
  completed: { label: '✅ Done', className: 'bg-green-100 text-green-700' },
  overdue:   { label: '🔴 Overdue', className: 'bg-red-100 text-red-700 font-semibold' },
  swapped:   { label: '🔄 Swapped', className: 'bg-orange-100 text-orange-700' },
};

export default function ServiceStatusBadge({ status, isOverdue }: Props) {
  const key = isOverdue ? 'overdue' : status;
  const cfg = CONFIG[key] ?? CONFIG.assigned;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${cfg.className}`}>{cfg.label}</span>;
}
