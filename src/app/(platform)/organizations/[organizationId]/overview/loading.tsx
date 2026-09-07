import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped like the report it precedes: the full-bleed verdict band, the status
 * strip, then chapters that pair an eight-column card with a four-column rail.
 * A skeleton that does not match causes a visible relayout on arrival.
 */
export default function OrganizationOverviewLoading() {
  return (
    <div
      data-testid="organization-overview-skeleton"
      className="flex min-h-0 w-full flex-1 flex-col gap-8"
    >
      <div className="-mx-4 border-b border-border bg-emerald-50/40 px-4 py-14 sm:-mx-8 sm:px-8 lg:py-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <Skeleton className="h-4 w-56 rounded-md" />
            <Skeleton className="h-24 w-full max-w-2xl rounded-lg" />
            <Skeleton className="h-10 w-full max-w-xl rounded-md" />
          </div>
          <Skeleton className="h-56 rounded-lg lg:col-span-5" />
        </div>
      </div>

      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-7 w-96 max-w-full rounded-md" />

      <div className="flex flex-col gap-10">
        {[0, 1, 2].map((chapter) => (
          <div key={chapter} className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <Skeleton className="h-64 rounded-xl lg:col-span-8" />
            <div className="flex flex-col gap-4 lg:col-span-4">
              <Skeleton className="h-10 w-48 rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
