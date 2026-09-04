import { DomainError } from "@/lib/errors";
import type { DecisionReadPort } from "@/modules/decisions/application/ports";
import {
  buildGrowthIntelligenceView,
  type ChannelRecommendationRow,
  type GrowthIntelligenceSection,
  type GrowthIntelligenceView,
  type SynthesizedItemRow,
} from "@/modules/growth-intelligence/application/read-model";

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
};

export type GrowthIntelligenceReadDependencies = {
  workspace: GrowthIntelligenceWorkspaceRepository;
  opportunities: DecisionReadPort;
  now?: () => Date;
};

export type GetWorkspaceInput = {
  organizationId: string;
  actorId: string;
  /** Canonical YYYY-MM; null/undefined resolves the organization's current local month. */
  activityMonth?: string | null;
  sections?: readonly GrowthIntelligenceSection[];
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
    throw new DomainError(
      "VALIDATION_ERROR",
      "The organization's timezone could not be resolved.",
    );
  }
  return rendered.slice(0, 7);
}

/**
 * The composed organization read (spec 022 section 9.1). Reads only: it
 * assembles the workspace from the owning modules' records and starts no
 * work. Mutations stay with the owning module's routes.
 */
export function createGrowthIntelligenceReadService(dependencies: GrowthIntelligenceReadDependencies) {
  const { workspace, opportunities } = dependencies;
  const clock = dependencies.now ?? (() => new Date());

  return {
    async getWorkspace(input: GetWorkspaceInput): Promise<GrowthIntelligenceView> {
      const now = clock();
      const timeZone = await workspace.readOrganizationTimeZone(input.organizationId);
      const activityMonth =
        input.activityMonth ?? currentLocalMonth(timeZone, now);
      if (!CANONICAL_MONTH.test(activityMonth)) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "The activity month must be a canonical YYYY-MM value.",
        );
      }
      const [opportunityItems, recommendations, items] = await Promise.all([
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
      ]);
      return buildGrowthIntelligenceView({
        organizationId: input.organizationId,
        actorId: input.actorId,
        activityMonth,
        timeZone,
        now,
        opportunities: opportunityItems,
        recommendations,
        items,
        sections: input.sections,
      });
    },
  };
}
