import { ArrowLeft, Compass, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { OnboardingClient } from "@/components/onboarding/onboarding-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createEventPublisher } from "@/domain/events/publisher";
import { createOnboardingService } from "@/modules/onboarding/application/service";
import { createOnboardingRepository } from "@/modules/onboarding/infrastructure/repository";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function OnboardingPage({ params }: PageProps) {
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

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Button asChild variant="link" className="h-auto p-0 text-muted-foreground">
            <Link href={`/organizations/${context.organizationId}/digital-twin`}>
              <ArrowLeft data-icon="inline-start" />
              Digital Twin overview
            </Link>
          </Button>
          <div className="mt-5 flex items-start gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Compass />
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Guided onboarding</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {organization.name} · {organization.industry} · organization-scoped workspace
              </p>
            </div>
          </div>
        </div>
        <Card className="max-w-md border-accent/20 bg-accent/5">
          <CardHeader className="flex-row items-start gap-3 space-y-0 pb-3">
            <ShieldCheck className="mt-0.5 text-accent" />
            <div>
              <CardTitle className="text-base">Trust before automation</CardTitle>
              <CardDescription className="mt-1">
                Unknowns stay visible, evidence remains attached, and sensitive actions stay
                approval-gated.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>
      <Alert>
        <Compass />
        <AlertTitle>Complete what is known, request what is missing</AlertTitle>
        <AlertDescription>
          Save a draft at any point. A section becomes complete only when its deterministic
          requirements are met.
        </AlertDescription>
      </Alert>
      <OnboardingClient
        organizationId={context.organizationId}
        organization={{ name: organization.name, industry: organization.industry }}
        initialSnapshot={snapshot}
      />
    </div>
  );
}
