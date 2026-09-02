import { hasOrganizationPermission } from "@/domain/access/permissions";
import {
  classifyEvidenceReadiness,
  type EvidenceReadinessModel,
  type ReadinessTuple,
} from "@/domain/economics/readiness";
import {
  describeReadinessReason,
  describeReadinessState,
  summarizeMissingCosts,
} from "@/domain/economics/readiness-copy";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";
import type { EvidenceReadinessRepository } from "@/modules/economics/application/readiness-ports";

export type ReadinessContext = {
  organizationId: string;
  role: OrganizationRole;
};

/** One tuple, with the labels and sentences the panel renders directly. */
export type ReadinessTupleView = ReadinessTuple & {
  channelName: string;
  branchName: string;
  stateLabel: string;
  stateSummary: string;
  /** What is wrong and what to do, in order, with no duplicates. */
  blockers: readonly { explanation: string; nextStep: string | null }[];
};

export type ReadinessCostComponentView = {
  key: string;
  label: string;
  covered: boolean;
  tier: string | null;
  operatorCanResolve: boolean;
};

export type EvidenceReadinessView = {
  readModelVersion: number;
  digest: string;
  tuples: readonly ReadinessTupleView[];
  costCoverage:
    | { outcome: "checked"; components: readonly ReadinessCostComponentView[] }
    | { outcome: "unchecked" };
  /** The one-line answer to "what prevents an honest contribution margin". */
  costSummary: string;
};

/**
 * Both permissions, not either.
 *
 * The response describes governed report evidence *and* what the organization's
 * cost structure covers. Someone entitled to only one half would otherwise read
 * the other through this surface, which is the kind of quiet widening that
 * makes a permission catalogue stop meaning anything.
 */
function assertMayRead(context: ReadinessContext): void {
  const permitted =
    hasOrganizationPermission(context.role, "report.read") &&
    hasOrganizationPermission(context.role, "economics.read");

  if (!permitted) {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to view economics evidence readiness.",
    );
  }
}

function toView(
  model: EvidenceReadinessModel,
  labels: {
    channels: ReadonlyMap<string, string>;
    branches: ReadonlyMap<string, string>;
  },
): EvidenceReadinessView {
  const missingCostLabels =
    model.costCoverage.outcome === "checked"
      ? model.costCoverage.components
          .filter((component) => !component.covered)
          .map((component) => component.label.toLowerCase())
      : [];

  return {
    readModelVersion: model.readModelVersion,
    digest: model.digest,
    tuples: model.tuples.map((tuple) => {
      const state = describeReadinessState(tuple.state);
      return {
        ...tuple,
        // An unnamed channel is still a real channel. Falling back to the
        // identifier keeps the row visible rather than dropping evidence
        // because a label lookup missed.
        channelName: labels.channels.get(tuple.channelId) ?? "Unnamed channel",
        branchName: labels.branches.get(tuple.branchId) ?? "Unnamed outlet",
        stateLabel: state.label,
        stateSummary: state.summary,
        blockers: tuple.reasons.map((reason) => {
          const copy = describeReadinessReason(reason);
          return { explanation: copy.explanation, nextStep: copy.nextStep };
        }),
      } satisfies ReadinessTupleView;
    }),
    costCoverage:
      model.costCoverage.outcome === "unchecked"
        ? { outcome: "unchecked" }
        : {
            outcome: "checked",
            components: model.costCoverage.components.map((component) => ({
              key: component.key,
              label: component.label,
              covered: component.covered,
              tier: component.tier,
              operatorCanResolve: component.operatorCanResolve,
            })),
          },
    costSummary:
      model.costCoverage.outcome === "unchecked"
        ? "Your cost setup could not be read, so nothing about costs has been checked."
        : summarizeMissingCosts(missingCostLabels),
  };
}

export function createEvidenceReadinessService(repository: EvidenceReadinessRepository) {
  return {
    /**
     * The readiness view for one organization.
     *
     * The feature flag is asserted by the caller — the route and the page
     * loader each do it before reaching here — because a flag is a rollout
     * decision about a surface, and this service is the surface's only reader
     * either way.
     */
    async loadReadiness(context: ReadinessContext): Promise<EvidenceReadinessView> {
      assertMayRead(context);

      const [evidence, costCoverage] = await Promise.all([
        repository.loadEvidence({ organizationId: context.organizationId }),
        repository.loadCostCoverage({ organizationId: context.organizationId }),
      ]);

      const model = classifyEvidenceReadiness({
        observations: evidence.observations,
        costCoverage,
      });

      return toView(model, {
        channels: new Map(evidence.channels.map((channel) => [channel.id, channel.displayName])),
        branches: new Map(evidence.branches.map((branch) => [branch.id, branch.name])),
      });
    },
  };
}
