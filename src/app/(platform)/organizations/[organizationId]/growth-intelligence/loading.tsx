import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped like the Market Watch it precedes: the profile review card, then a
 * stack of evidence signal cards. A skeleton that does not match causes a
 * visible relayout on arrival.
 */
export default function GrowthIntelligenceLoading() {
  return (
    <div data-testid="growth-intelligence-skeleton" className="flex w-full flex-1 flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64 rounded-md" />
        <Skeleton className="h-4 w-full max-w-xl rounded-md" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((signal) => (
          <Skeleton key={signal} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
