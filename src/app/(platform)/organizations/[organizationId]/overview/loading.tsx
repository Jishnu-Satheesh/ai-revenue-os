import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped like the home it precedes: the masthead (identity plus context row
 * and actions), the campaign covers, the creative gallery, then attention.
 * A skeleton that does not match causes a visible relayout on arrival.
 * The pulse is modest and switches off under prefers-reduced-motion.
 */
export default function OrganizationOverviewLoading() {
  return (
    <div
      data-testid="organization-overview-skeleton"
      className="flex min-h-0 w-full flex-1 flex-col gap-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Skeleton className="h-10 w-72 max-w-full rounded-lg motion-reduce:animate-none" />
          <Skeleton className="h-4 w-full max-w-xl rounded-md motion-reduce:animate-none" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-6 w-24 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-6 w-32 rounded-full motion-reduce:animate-none" />
            <Skeleton className="h-6 w-40 rounded-full motion-reduce:animate-none" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-36 rounded-md motion-reduce:animate-none" />
          <Skeleton className="h-9 w-32 rounded-md motion-reduce:animate-none" />
        </div>
      </div>

      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-7 w-48 rounded-md motion-reduce:animate-none" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-52 rounded-xl motion-reduce:animate-none" />
          <Skeleton className="h-52 rounded-xl motion-reduce:animate-none" />
        </div>
        <Skeleton className="h-16 w-full rounded-xl motion-reduce:animate-none" />
      </div>

      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-7 w-44 rounded-md motion-reduce:animate-none" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((thumb) => (
            <Skeleton key={thumb} className="h-28 rounded-lg motion-reduce:animate-none" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-7 w-52 rounded-md motion-reduce:animate-none" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-14 w-full rounded-lg motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </div>
  );
}
