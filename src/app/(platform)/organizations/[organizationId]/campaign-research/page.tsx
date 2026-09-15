import { FlaskConical } from "lucide-react";

import { ResearchSettingsPanel } from "@/components/campaigns/research-settings-panel";
import type { ResearchLedgerView } from "@/components/campaigns/research-settings-form";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  createResearchPolicyRepository,
  type ResearchPersistence,
} from "@/modules/campaigns/infrastructure/research-policy-repository";

type PageProps = { params: Promise<{ organizationId: string }> };

/**
 * What the platform may spend finding out what to do next.
 *
 * This page exists because the research machine did not have one. Everything
 * behind it — admission, allowances, the claim lifecycle, the worker — was
 * built against a policy no code could create, so none of it could run.
 *
 * Reading the policy takes the same permission as spending against it, and the
 * database checks that permission again inside its own function. Someone
 * without it is told so plainly rather than shown an empty form they cannot
 * save, or a "not found" that implies the page is missing.
 */
export default async function CampaignResearchSettingsPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const role = context.membership.role as OrganizationRole;

  if (!hasOrganizationPermission(role, "campaign.research_request")) {
    return (
      <div className="flex min-h-0 flex-col gap-6">
        <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlaskConical />
            </EmptyMedia>
            <EmptyTitle>Research settings are for owners and admins</EmptyTitle>
            <EmptyDescription>
              Research spends money with outside providers, so whoever may spend it is whoever may
              set it. Ask an owner or an admin to configure it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  // Read on the caller's own session. A failed read is reported as unset rather
  // than crashing the page, and the form then says nothing is set up — which is
  // true either way from the person's point of view, because nothing can run.
  const ledger: ResearchLedgerView = await createResearchPolicyRepository(
    context.supabase as unknown as ResearchPersistence,
  )
    .readLedger({ organizationId: context.organizationId })
    .then((read) => ({
      policy:
        read.policy === null
          ? null
          : {
              version: read.policy.version,
              enabled: read.policy.enabled,
              timezone: read.policy.timezone,
              evidenceMaxAgeDays: read.policy.evidenceMaxAgeDays,
              cooldownSeconds: read.policy.cooldownSeconds,
              maxPendingProposals: read.policy.maxPendingProposals,
              maxAttempts: read.policy.maxAttempts,
              perRunAllowance: read.policy.perRunAllowance,
              windowAllowance: read.policy.windowAllowance,
              windowDays: read.policy.windowDays,
            },
      pendingCount: read.pendingCount,
      windowSpentMinor: read.windowSpentMinor,
      lastAdmittedAt: read.lastAdmittedAt,
    }))
    .catch(() => ({
      policy: null,
      pendingCount: 0,
      windowSpentMinor: 0,
      lastAdmittedAt: null,
    }));

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Research settings</h1>
        <p className="text-sm text-muted-foreground">
          Before the platform proposes a campaign, it researches what is worth doing. That
          research costs money with outside providers, and this is the limit it works inside.
        </p>
      </header>

      <div className="max-w-2xl">
        <ResearchSettingsPanel
          organizationId={context.organizationId}
          ledger={ledger}
          timezone={organization.default_timezone}
          organizationCurrency={organization.base_currency}
        />
      </div>
    </div>
  );
}
