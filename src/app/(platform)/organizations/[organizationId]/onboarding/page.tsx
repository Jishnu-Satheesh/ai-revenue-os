import { ArrowLeft, Compass, BadgeInfo } from "lucide-react";
import Link from "next/link";

import { overviewPath } from "@/lib/routes";
import { OnboardingClient } from "@/components/onboarding/onboarding-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { industryLabels, normalizeIndustry } from "@/domain/organizations/industries";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createEventPublisher } from "@/domain/events/publisher";
import { createOnboardingService } from "@/modules/onboarding/application/service";
import { createOnboardingRepository } from "@/modules/onboarding/infrastructure/repository";

type PageProps = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ section?: string }>;
};

export default async function OnboardingPage({ params, searchParams }: PageProps) {
  const context = await getOrganizationContext(params, ["owner", "admin", "operator"]);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const service = createOnboardingService({
    repository: createOnboardingRepository(context.supabase),
    publisher: createEventPublisher(),
  });
  await service.startOrResumeSession({
    organizationId: context.organizationId,
    userId: context.user.id,
  });
  const snapshot = await service.getSnapshot(context.organizationId);
  const industrySlug = normalizeIndustry(organization.industry);
  const industryLabel = industrySlug ? industryLabels[industrySlug] : organization.industry;

  return (
    // The page fills the shell's remaining height: the heading block is pinned
    // and the workspace below it owns all vertical scrolling.
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <div className="flex shrink-0 flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Button asChild variant="link" className="h-auto p-0 text-muted-foreground">
            <Link href={overviewPath(context.organizationId)}>
              <ArrowLeft data-icon="inline-start" />
              Overview
            </Link>
          </Button>
          <div className="mt-4 flex items-start gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Compass />
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Guided onboarding</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {organization.name} · {industryLabel} · organization-scoped workspace
              </p>
            </div>
          </div>
        </div>
        <Alert className="max-w-sm bg-primary/5">
          <BadgeInfo className="text-accent" />
          <AlertTitle>Complete what is known, request what is missing</AlertTitle>
          <AlertDescription>Save a draft at any point.</AlertDescription>
        </Alert>
      </div>

      <OnboardingClient
        organizationId={context.organizationId}
        organization={{
          name: organization.name,
          industry: organization.industry,
          baseCurrency: organization.base_currency,
        }}
        initialSnapshot={snapshot}
        requestedSection={(await searchParams).section}
      />
    </div>
  );
}
