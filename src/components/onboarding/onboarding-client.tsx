"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { BranchesOperationsSection } from "@/components/onboarding/sections/branches-operations-section";
import { BrandAssetsSection } from "@/components/onboarding/sections/brand-assets-section";
import { BusinessIdentitySection } from "@/components/onboarding/sections/business-identity-section";
import { ChannelsPresenceSection } from "@/components/onboarding/sections/channels-presence-section";
import { CostStructureSection } from "@/components/onboarding/sections/cost-structure-section";
import { CustomersConsentSection } from "@/components/onboarding/sections/customers-consent-section";
import { GovernanceSection } from "@/components/onboarding/sections/governance-section";
import { HistoricalPerformanceSection } from "@/components/onboarding/sections/historical-performance-section";
import { IntegrationsUploadsSection } from "@/components/onboarding/sections/integrations-uploads-section";
import { ProductsServicesSection } from "@/components/onboarding/sections/products-services-section";
import { ReviewReadinessSection } from "@/components/onboarding/sections/review-readiness-section";
import { CandidateReview } from "@/components/onboarding/candidate-review";
import { UploadStatusList } from "@/components/onboarding/upload-status-list";
import { OnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";
import type { RailSection } from "@/components/onboarding/onboarding-section-rail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { onboardingSectionRegistry } from "@/domain/onboarding/section-registry";
import { normalizeIndustry } from "@/domain/organizations/industries";
import type { ReadinessResult } from "@/domain/onboarding/readiness";
import type { OnboardingSectionKey } from "@/domain/onboarding/types";
import type {
  OnboardingSectionStateRecord,
  OnboardingSnapshot,
} from "@/modules/onboarding/application/service";

type OrganizationSummary = {
  name: string;
  industry: string;
  baseCurrency: string;
};

type Props = {
  organizationId: string;
  organization: OrganizationSummary;
  initialSnapshot: OnboardingSnapshot;
};

const queryKey = (organizationId: string) =>
  ["organizations", organizationId, "onboarding"] as const;

/**
 * Section editors read and write the stored payload directly. Each control
 * owns its own shape, so nothing is flattened to a string on the way in or
 * parsed back out of one on the way through.
 */
function sectionPayload(state: OnboardingSectionStateRecord | undefined): Record<string, unknown> {
  return state?.payload ?? {};
}

/**
 * Channels the operator listed in Channels and presence.
 *
 * Cost structure offers these as scopes rather than a free-text box, so a
 * channel-specific commission attaches to a channel the ledger will actually
 * see in the data instead of a near-miss spelling of one.
 */
function channelsNamedEarlier(state: OnboardingSectionStateRecord | undefined): string[] {
  const channels = sectionPayload(state).channels;
  return Array.isArray(channels) ? channels.map(String) : [];
}

function mapReadiness(snapshot: OnboardingSnapshot): ReadinessResult | null {
  const row = snapshot.readiness;
  if (!row) return null;
  const nextActions = Array.isArray(row.next_actions) ? row.next_actions : [];
  return {
    rubricVersion: row.rubric_version === "v1" ? "v1" : "v1",
    overallScore: row.overall_score,
    capabilityScores: Object.fromEntries(
      Object.entries(row.capability_scores).map(([key, value]) => [
        key,
        typeof value === "number" ? value : 0,
      ]),
    ),
    capabilities: {},
    criticalBlockers: Array.isArray(row.blockers) ? row.blockers.map(String) : [],
    reasons: [],
    nextActions: nextActions.flatMap((action) => {
      if (!action || typeof action !== "object") return [];
      const value = action as Record<string, unknown>;
      if (typeof value.reasonId !== "string") return [];
      return [
        {
          reasonId: value.reasonId,
          owner:
            value.owner === "client_contact"
              ? ("client_contact" as const)
              : ("agency_operator" as const),
          effort:
            value.effort === "large"
              ? ("large" as const)
              : value.effort === "medium"
                ? ("medium" as const)
                : ("small" as const),
        },
      ];
    }),
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Onboarding request failed.");
  return body as T;
}

export function OnboardingClient({ organizationId, organization, initialSnapshot }: Props) {
  const queryClient = useQueryClient();
  const onboardingQuery = useQuery({
    queryKey: queryKey(organizationId),
    queryFn: async () =>
      responseJson<{ snapshot: OnboardingSnapshot }>(
        await fetch(`/api/organizations/${organizationId}/onboarding`),
      ).then((body) => body.snapshot),
    initialData: initialSnapshot,
  });
  const snapshot = onboardingQuery.data ?? initialSnapshot;

  const saveSection = useMutation({
    mutationFn: async (input: {
      sectionKey: OnboardingSectionKey;
      status: "in_progress" | "complete";
      payload: Record<string, unknown>;
    }) => {
      if (!snapshot.session) throw new Error("Onboarding session is not available.");
      const response = await fetch(
        `/api/organizations/${organizationId}/onboarding/sections/${input.sectionKey}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: snapshot.session.id,
            status: input.status,
            payload: input.payload,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      return responseJson<{ state: OnboardingSectionStateRecord }>(response);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(organizationId) }),
  });

  const generateReadiness = useMutation({
    mutationFn: async () => {
      if (!snapshot.session) throw new Error("Onboarding session is not available.");
      const response = await fetch(`/api/organizations/${organizationId}/onboarding/readiness`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: snapshot.session.id }),
      });
      return responseJson<{ readiness: OnboardingSnapshot["readiness"] }>(response);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(organizationId) }),
  });

  const uploadSource = useMutation({
    mutationFn: async (file: File) => {
      if (!snapshot.session) throw new Error("Onboarding session is not available.");
      const body = new FormData();
      body.append("sessionId", snapshot.session.id);
      body.append("sectionKey", "integrations_uploads");
      body.append("file", file);
      const uploadResponse = await responseJson<{ upload: OnboardingSnapshot["uploads"][number] }>(
        await fetch(`/api/organizations/${organizationId}/onboarding/uploads`, {
          method: "POST",
          body,
        }),
      );
      await responseJson(
        await fetch(
          `/api/organizations/${organizationId}/onboarding/uploads/${uploadResponse.upload.id}/complete`,
          { method: "POST" },
        ),
      );
      return uploadResponse;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(organizationId) }),
  });

  const reviewCandidate = useMutation({
    mutationFn: async (input: {
      candidateId: string;
      action: "confirm" | "edit" | "reject" | "unknown";
      payload?: Record<string, unknown>;
      evidence: Array<{ sourceReference: string; location?: string }>;
    }) =>
      responseJson(
        await fetch(
          `/api/organizations/${organizationId}/onboarding/candidates/${input.candidateId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: input.action,
              payload: input.payload,
              evidence: input.evidence,
            }),
          },
        ),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(organizationId) }),
  });

  const sections = useMemo<readonly RailSection[]>(
    () =>
      onboardingSectionRegistry.map((definition) => ({
        ...definition,
        status:
          snapshot.sections.find((state) => state.section_key === definition.key)?.status ??
          "not_started",
      })),
    [snapshot.sections],
  );
  const sectionStates = useMemo(
    () => new Map(snapshot.sections.map((state) => [state.section_key, state])),
    [snapshot.sections],
  );
  const initialSectionKey = onboardingSectionRegistry.some(
    (section) => section.key === snapshot.session?.current_section_key,
  )
    ? (snapshot.session?.current_section_key as OnboardingSectionKey)
    : "business_identity";
  const readiness = mapReadiness(snapshot);

  function save(sectionKey: OnboardingSectionKey) {
    return (payload: Record<string, unknown>, status: "in_progress" | "complete") =>
      saveSection.mutateAsync({ sectionKey, status, payload }).then(() => undefined);
  }

  async function confirmReview() {
    const result = await generateReadiness.mutateAsync();
    const blockers = Array.isArray(result.readiness?.blockers) ? result.readiness.blockers : [];
    if (blockers.length > 0 || !snapshot.session) return false;
    await saveSection.mutateAsync({
      sectionKey: "review_readiness",
      status: "complete",
      payload: { operatorConfirmed: true },
    });
    return true;
  }

  // Typed as the complete record rather than a partial one. The workspace
  // accepts a partial and falls back to a placeholder, so a section added to
  // the registry and forgotten here would render as an empty panel with no
  // error anywhere. This turns that into a build failure.
  const contents: Record<OnboardingSectionKey, React.ReactNode> = {
    business_identity: (
      <BusinessIdentitySection
        defaultValues={{
          name: organization.name,
          industry: normalizeIndustry(organization.industry) ?? "",
          ...sectionPayload(sectionStates.get("business_identity")),
        }}
        onSave={save("business_identity")}
      />
    ),
    branches_operations: (
      <BranchesOperationsSection
        defaultValues={sectionPayload(sectionStates.get("branches_operations"))}
        onSave={save("branches_operations")}
      />
    ),
    products_services: (
      <ProductsServicesSection
        defaultValues={sectionPayload(sectionStates.get("products_services"))}
        onSave={save("products_services")}
      />
    ),
    channels_presence: (
      <ChannelsPresenceSection
        defaultValues={sectionPayload(sectionStates.get("channels_presence"))}
        onSave={save("channels_presence")}
      />
    ),
    historical_performance: (
      <HistoricalPerformanceSection
        defaultValues={sectionPayload(sectionStates.get("historical_performance"))}
        onSave={save("historical_performance")}
      />
    ),
    cost_structure: (
      <CostStructureSection
        components={snapshot.costComponents}
        // The channels the operator already named, so a commission that differs
        // by marketplace is scoped to a channel they actually sell on rather
        // than one they have to retype.
        channels={channelsNamedEarlier(sectionStates.get("channels_presence"))}
        currency={organization.baseCurrency}
        defaultValues={sectionPayload(sectionStates.get("cost_structure"))}
        onSave={save("cost_structure")}
      />
    ),
    customers_consent: (
      <CustomersConsentSection
        defaultValues={sectionPayload(sectionStates.get("customers_consent"))}
        onSave={save("customers_consent")}
      />
    ),
    brand_assets: (
      <BrandAssetsSection
        defaultValues={sectionPayload(sectionStates.get("brand_assets"))}
        onSave={save("brand_assets")}
      />
    ),
    governance: (
      <GovernanceSection
        defaultValues={sectionPayload(sectionStates.get("governance"))}
        onSave={save("governance")}
      />
    ),
    integrations_uploads: (
      <IntegrationsUploadsSection
        defaultValues={sectionPayload(sectionStates.get("integrations_uploads"))}
        onSave={save("integrations_uploads")}
        onUpload={(file) => uploadSource.mutateAsync(file).then(() => undefined)}
      >
        <UploadStatusList uploads={snapshot.uploads} />
        <CandidateReview
          candidates={snapshot.candidates.filter((candidate) => candidate.status === "pending")}
          onReview={(candidateId, input) =>
            reviewCandidate.mutateAsync({ candidateId, ...input }).then(() => undefined)
          }
        />
      </IntegrationsUploadsSection>
    ),
    review_readiness: (
      <ReviewReadinessSection readiness={readiness} onConfirm={() => confirmReview()} />
    ),
  } satisfies Partial<Record<OnboardingSectionKey, React.ReactNode>>;

  if (onboardingQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Onboarding could not be refreshed</AlertTitle>
        <AlertDescription>
          {onboardingQuery.error instanceof Error ? onboardingQuery.error.message : "Try again."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      {onboardingQuery.isFetching ? (
        <Spinner className="absolute -top-7 right-0 z-10" aria-label="Refreshing onboarding" />
      ) : null}
      <OnboardingWorkspace
        sections={sections}
        contents={contents}
        initialSectionKey={initialSectionKey}
      />
    </div>
  );
}
