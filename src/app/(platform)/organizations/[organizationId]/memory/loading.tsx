import { Skeleton } from "@/components/ui/skeleton";

export default function MemoryLoading() {
  return (
    <div data-testid="memory-workspace-skeleton" className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-4 w-80 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-8 w-full max-w-sm rounded-lg" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}
