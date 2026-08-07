import { Skeleton } from "@/components/ui/skeleton";

export default function OnboardingLoading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
      <Skeleton className="h-[32rem] rounded-xl" />
      <Skeleton className="min-h-[32rem] rounded-xl" />
    </div>
  );
}
