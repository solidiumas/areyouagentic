import { Skeleton } from '@/components/ui/skeleton';

/**
 * Streaming fallback for the report page — it's force-dynamic and awaits the
 * API, so without this the navigation shows a blank screen until the fetch
 * resolves. Mirrors the real page's header + score-grid proportions.
 */
export default function ReportLoading() {
  return (
    <div className="container max-w-5xl py-10 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-8">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <div className="flex items-end gap-6">
          <Skeleton className="h-16 w-14" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        </div>
      </header>
      <div className="grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
