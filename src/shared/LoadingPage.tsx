import { Skeleton } from '@/components/ui/skeleton';

interface LoadingPageProps {
  /** Number of skeleton rows (default: 3) */
  rows?: number;
}

export default function LoadingPage({ rows = 3 }: LoadingPageProps) {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-6xl space-y-4 pt-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-6 w-48" />
        <div className="grid gap-4 md:grid-cols-3 mt-6">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl mt-4" />
      </div>
    </div>
  );
}
