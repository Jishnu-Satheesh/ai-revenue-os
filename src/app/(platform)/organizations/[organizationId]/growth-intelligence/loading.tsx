import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped like the workspace it precedes: the profile review card, then the
 * two workspace lanes. A skeleton that does not match causes a visible
 * relayout on arrival.
 */
export default function GrowthIntelligenceLoading() {
  return (
    <div data-testid="growth-intelligence-skeleton" className="flex w-full flex-1 flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64 rounded-md" />
        <Skeleton className="h-4 w-full max-w-xl rounded-md" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
