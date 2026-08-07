"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { BranchesOperationsSection } from "@/components/onboarding/sections/branches-operations-section";
import { BrandAssetsSection } from "@/components/onboarding/sections/brand-assets-section";
import { BusinessIdentitySection } from "@/components/onboarding/sections/business-identity-section";
import { ChannelsPresenceSection } from "@/components/onboarding/sections/channels-presence-section";
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
import type { ReadinessResult } from "@/domain/onboarding/readiness";
import type { OnboardingSectionKey } from "@/domain/onboarding/types";
import type {
  OnboardingSectionStateRecord,
  OnboardingSnapshot,
} from "@/modules/onboarding/application/service";

type OrganizationSummary = {
  name: string;
  industry: string;
};

type Props = {
  organizationId: string;
  organization: OrganizationSummary;
  initialSnapshot: OnboardingSnapshot;
};

const queryKey = (organizationId: string) =>
  ["organizations", organizationId, "onboarding"] as const;

function sectionPayload(state: OnboardingSectionStateRecord | undefined) {
  if (!state) return {};
  return Object.fromEntries(
    Object.entries(state.payload).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.join("; ")
        : typeof value === "boolean"
          ? String(value)
          : String(value ?? ""),
    ]),
  );
}

function splitList(value: string) {
  return value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTrue(value: string) {
  return ["true", "yes", "y", "confirmed", "connected", "available"].includes(
    value.trim().toLowerCase(),
  );
}

function normalizeSectionPayload(sectionKey: OnboardingSectionKey, values: Record<string, string>) {
  const payload: Record<string, unknown> = { ...values };
  if (sectionKey === "branches_operations") payload.branches = splitList(values.branches ?? "");
  if (sectionKey === "products_services") payload.items = splitList(values.items ?? "");
  if (sectionKey === "channels_presence") {
    payload.channels = splitList(values.channels ?? "");
    payload.conversionTracking = isTrue(values.conversionTracking ?? "");
  }
  if (sectionKey === "historical_performance") payload.metrics = splitList(values.metrics ?? "");
  if (sectionKey === "customers_consent") {
    payload.consentConfirmed = isTrue(values.consentConfirmed ?? "");
    if (!payload.consentConfirmed && values.consentConfirmed?.trim().toLowerCase() === "unknown")
      payload.unknown = true;
  }
  if (sectionKey === "governance") payload.goals = splitList(values.goals ?? "");
  if (sectionKey === "integrations_uploads") payload.sources = splitList(values.sources ?? "");
  return payload;
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
      values: Record<string, string>;
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
            payload: normalizeSectionPayload(input.sectionKey, input.values),
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
    return (values: Record<string, string>, status: "in_progress" | "complete") =>
      saveSection.mutateAsync({ sectionKey, status, values }).then(() => undefined);
  }

  async function confirmReview() {
    const result = await generateReadiness.mutateAsync();
    const blockers = Array.isArray(result.readiness?.blockers) ? result.readiness.blockers : [];
    if (blockers.length > 0 || !snapshot.session) return false;
    await saveSection.mutateAsync({
      sectionKey: "review_readiness",
      status: "complete",
      values: { operatorConfirmed: "true" },
    });
    return true;
  }

  const contents = {
    business_identity: (
      <BusinessIdentitySection
        defaultValues={{
          name: organization.name,
          industry: organization.industry,
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
      <div className="flex flex-col gap-6">
        <IntegrationsUploadsSection
          defaultValues={sectionPayload(sectionStates.get("integrations_uploads"))}
          onSave={save("integrations_uploads")}
          onUpload={(file) => uploadSource.mutateAsync(file).then(() => undefined)}
        />
        <UploadStatusList uploads={snapshot.uploads} />
        <CandidateReview
          candidates={snapshot.candidates.filter((candidate) => candidate.status === "pending")}
          onReview={(candidateId, input) =>
            reviewCandidate.mutateAsync({ candidateId, ...input }).then(() => undefined)
          }
        />
      </div>
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
    <div className="flex flex-col gap-6">
      {onboardingQuery.isFetching ? (
        <Spinner className="self-end" aria-label="Refreshing onboarding" />
      ) : null}
      <OnboardingWorkspace
        sections={sections}
        contents={contents}
        initialSectionKey={initialSectionKey}
      />
    </div>
  );
}
