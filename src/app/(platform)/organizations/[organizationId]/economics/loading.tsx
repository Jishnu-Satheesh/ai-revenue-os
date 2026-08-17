import { Skeleton } from "@/components/ui/skeleton";

export default function ChannelEconomicsLoading() {
  return (
    <div
      data-testid="channel-economics-skeleton"
      className="flex min-h-0 w-full flex-1 flex-col gap-6"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-4 w-80 rounded-md" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-56 rounded-md" />
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}
