import { DomainError } from "@/lib/errors";
import type { DecisionReadPort } from "@/modules/decisions/application/ports";
import {
  buildGrowthIntelligenceView,
  type ChannelRecommendationRow,
  type DraftRequestState,
  type GrowthIntelligenceSection,
  type GrowthIntelligenceView,
  type SynthesizedItemRow,
} from "@/modules/growth-intelligence/application/read-model";
import type {
  ResearchActivityEvent,
  ResearchItemProvenance,
} from "@/modules/growth-intelligence/application/research-read-model";

/**
 * Source reads behind the composed workspace. Every method takes the
 * organization scope (and the actor where presentation state is personal),
 * returns bounded newest-first pages, and performs no writes.
 */
export type GrowthIntelligenceWorkspaceRepository = {
  readOrganizationTimeZone(organizationId: string): Promise<string>;
  listWorkspaceItems(input: {
    organizationId: string;
    actorId: string;
    throughMonth: string;
    limit: number;
  }): Promise<readonly SynthesizedItemRow[]>;
  listChannelRecommendationRecords(input: {
    organizationId: string;
    actorId: string;
    limit: number;
  }): Promise<readonly ChannelRecommendationRow[]>;
  listDraftRequestStates(input: { organizationId: string }): Promise<readonly DraftRequestState[]>;
};

export type GrowthIntelligenceReadDependencies = {
  workspace: GrowthIntelligenceWorkspaceRepository;
  opportunities: DecisionReadPort;
  /**
   * Research provenance and activity behind Recommendations and Your
   * actions. Optional: when absent the composed view is exactly the
   * pre-research read (cards without provenance, no research timeline).
   * A failing research read never fails the workspace: the failure is
   * reported through onResearchError and the view composes without it.
   */
  research?: GrowthIntelligenceResearchReader;
  onResearchError?: (error: unknown) => void;
  now?: () => Date;
};

/**
 * Pipeline lineage for visible items plus named research lifecycle events.
 * Implemented by the research read repository over signed-in RLS reads.
 */
export type GrowthIntelligenceResearchReader = {
  listItemProvenance(input: {
    organizationId: string;
    items: readonly { itemId: string; runId: string }[];
  }): Promise<Record<string, ResearchItemProvenance>>;
  listResearchActivity(input: {
    organizationId: string;
    branchId: string | null;
    limit?: number;
  }): Promise<readonly ResearchActivityEvent[]>;
};

export type GetWorkspaceInput = {
  organizationId: string;
  actorId: string;
  /** Canonical YYYY-MM; null/undefined resolves the organization's current local month. */
  activityMonth?: string | null;
  sections?: readonly GrowthIntelligenceSection[];
  /** Selected branch for research provenance and activity; null/undefined reads organization-wide. */
  branchId?: string | null;
};

const CANONICAL_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

const WORKSPACE_PAGE_SIZE = 100;

/**
 * The organization's current local calendar month as canonical YYYY-MM.
 * The timezone comes from the stored organization record; an unknown zone
 * fails loudly instead of silently rendering UTC.
 */
export function currentLocalMonth(timeZone: string, now: Date): string {
  let rendered: string;
  try {
    rendered = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "The organization's timezone could not be resolved.");
  }
  return rendered.slice(0, 7);
}

/**
 * The composed organization read (spec 022 section 9.1). Reads only: it
 * assembles the workspace from the owning modules' records and starts no
 * work. Mutations stay with the owning module's routes.
 */
export function createGrowthIntelligenceReadService(
  dependencies: GrowthIntelligenceReadDependencies,
) {
  const { workspace, opportunities, research } = dependencies;
  const clock = dependencies.now ?? (() => new Date());

  return {
    async getWorkspace(input: GetWorkspaceInput): Promise<GrowthIntelligenceView> {
      const now = clock();
      const timeZone = await workspace.readOrganizationTimeZone(input.organizationId);
      const activityMonth = input.activityMonth ?? currentLocalMonth(timeZone, now);
      if (!CANONICAL_MONTH.test(activityMonth)) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "The activity month must be a canonical YYYY-MM value.",
        );
      }
      const [opportunityItems, recommendations, items, draftRequests] = await Promise.all([
        opportunities.listOpportunities(input.organizationId),
        workspace.listChannelRecommendationRecords({
          organizationId: input.organizationId,
          actorId: input.actorId,
          limit: WORKSPACE_PAGE_SIZE,
        }),
        workspace.listWorkspaceItems({
          organizationId: input.organizationId,
          actorId: input.actorId,
          throughMonth: activityMonth,
          limit: WORKSPACE_PAGE_SIZE,
        }),
        workspace.listDraftRequestStates({ organizationId: input.organizationId }),
      ]);
      // Provenance never reorders, refilters or retriages: it only annotates
      // the rows the deterministic builders already selected. A failing
      // annotation read degrades to unattributed cards rather than an
      // empty workspace; the failure is reported, never hidden.
      let researchProvenance: Record<string, ResearchItemProvenance> | undefined;
      let researchActivity: readonly ResearchActivityEvent[] | undefined;
      if (research) {
        try {
          const lineageItems = items
            .filter((item) => item.kind === "recommendation" && item.synthesisRunId)
            .map((item) => ({ itemId: item.id, runId: item.synthesisRunId }));
          [researchProvenance, researchActivity] = await Promise.all([
            research.listItemProvenance({
              organizationId: input.organizationId,
              items: lineageItems,
            }),
            research.listResearchActivity({
              organizationId: input.organizationId,
              branchId: input.branchId ?? null,
            }),
          ]);
        } catch (error) {
          dependencies.onResearchError?.(error);
          researchProvenance = undefined;
          researchActivity = undefined;
        }
      }
      return buildGrowthIntelligenceView({
        organizationId: input.organizationId,
        actorId: input.actorId,
        activityMonth,
        timeZone,
        now,
        opportunities: opportunityItems,
        recommendations,
        items,
        draftRequests,
        sections: input.sections,
        researchProvenance,
        researchActivity,
      });
    },
  };
}
