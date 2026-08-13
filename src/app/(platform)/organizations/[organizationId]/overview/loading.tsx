import { Skeleton } from "@/components/ui/skeleton";

export default function OrganizationOverviewLoading() {
  return (
    <div
      data-testid="organization-overview-skeleton"
      className="flex min-h-0 w-full flex-1 flex-col gap-6"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64 rounded-md" />
          <Skeleton className="h-4 w-80 max-w-full rounded-md" />
        </div>
      </div>
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-12">
        <Skeleton className="h-64 rounded-xl lg:col-span-8" />
        <Skeleton className="h-64 rounded-xl lg:col-span-4" />
        <Skeleton className="h-96 rounded-xl lg:col-span-8" />
        <Skeleton className="h-96 rounded-xl lg:col-span-4" />
      </div>
    </div>
  );
}
