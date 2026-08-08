import { Skeleton } from "@/components/ui/skeleton";

export default function IntegrationsLoading() {
  return (
    <div
      data-testid="integration-hub-skeleton"
      className="flex min-h-0 w-full flex-1 flex-col gap-6"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-4 w-72 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-8 w-full max-w-md rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <Skeleton className="h-[26rem] rounded-xl" />
        <Skeleton className="h-[26rem] rounded-xl" />
      </div>
    </div>
  );
}
