import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import { resolveDraftItemDestination } from "@/domain/growth-intelligence/acceptance";
import { DomainError } from "@/lib/errors";
import type { AssembledReportView } from "@/modules/growth-intelligence/application/report-reader";

/**
 * Market Monitoring review, acceptance and feed handoff (Slice 6).
 *
 * Version-bound draft-advice selection is accepted through the owning
 * module's fenced `accept_draft_item` RPC — one call per item on the exact
 * key of report version id plus item key, so replays converge on the kept
 * row instead of duplicating feed items. The acceptance row IS the feed
 * handoff record: accepted actions read as Recommendations and accepted
 * findings as Insights through the composed read model, each keeping its
 * exact source-report link. No feed-lifecycle rows are copied anywhere, and
 * acceptance never grants Campaign execution approval.
 */

export const MARKET_RESEARCH_EVENT_NAMES = [
  "market_research.project_created",
  "market_research.brief_revision_saved",
  "market_research.report_ready",
  "market_research.draft_accepted",
  "market_research.draft_acceptance_replayed",
  "market_research.report_reviewed",
] as const;

export type MarketResearchEventName = (typeof MARKET_RESEARCH_EVENT_NAMES)[number];

const uuidSchema = z.string().uuid();

/**
 * Identifier-only audit payloads. Titles, questions, summaries, advice text
 * and evidence bytes never enter an event: the stream says what happened to
 * which record, and the record itself stays in its table.
 */
export const marketResearchProjectCreatedPayloadSchema = z
  .object({
    projectId: uuidSchema,
    branchId: uuidSchema,
    mode: z.enum(["one-time", "recurring"]),
  })
  .strict();

export const marketResearchBriefRevisionSavedPayloadSchema = z
  .object({
    projectId: uuidSchema,
    revisionId: uuidSchema,
    revisionNumber: z.number().int().min(1),
  })
  .strict();

export const marketResearchReportReadyPayloadSchema = z
  .object({
    projectId: uuidSchema,
    reportVersionId: uuidSchema,
    briefRevisionId: uuidSchema,
    draftItemCount: z.number().int().min(0),
  })
  .strict();

export const marketResearchDraftAcceptedPayloadSchema = z
  .object({
    projectId: uuidSchema,
    reportVersionId: uuidSchema,
    briefRevisionId: uuidSchema,
    itemKey: z.string().trim().min(1).max(160),
    acceptanceKey: z.string().trim().min(1).max(400),
    destination: z.enum(["Recommendations", "Insights"]),
  })
  .strict();

export const marketResearchReportReviewedPayloadSchema = z
  .object({
    projectId: uuidSchema,
    reportVersionId: uuidSchema,
    briefRevisionId: uuidSchema,
    itemCount: z.literal(0),
  })
  .strict();

export type MarketResearchDraftAcceptedPayload = z.infer<
  typeof marketResearchDraftAcceptedPayloadSchema
>;

function publishEvent(
  events: EventPublisher,
  input: {
    organizationId: string;
    eventName: MarketResearchEventName;
    actorType: "user" | "system";
    actorId?: string;
    correlationId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  return events.publish({
    organizationId: input.organizationId,
    eventId: crypto.randomUUID(),
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    actorType: input.actorType,
    actorId: input.actorId,
    correlationId: input.correlationId,
    schemaVersion: 1,
    payload: input.payload,
  });
}

const acceptItemSchema = z
  .object({
    itemKey: z.string().trim().min(1).max(160),
    kind: z.enum(["action", "finding"]),
  })
  .strict();

export const acceptSelectedItemsInputSchema = z
  .object({
    organizationId: uuidSchema,
    reportVersionId: uuidSchema,
    branchId: uuidSchema.optional(),
    actorId: uuidSchema,
    correlationId: uuidSchema,
    idempotencyKey: z.string().trim().min(1).max(200),
    items: z.array(acceptItemSchema).min(1).max(100),
  })
  .strict();

export type AcceptSelectedItemsInput = z.infer<typeof acceptSelectedItemsInputSchema>;

export const markReportReviewedInputSchema = z
  .object({
    organizationId: uuidSchema,
    reportVersionId: uuidSchema,
    branchId: uuidSchema.optional(),
    actorId: uuidSchema,
    correlationId: uuidSchema,
  })
  .strict();

export type MarkReportReviewedInput = z.infer<typeof markReportReviewedInputSchema>;

export type AcceptanceReportLoader = (input: {
  organizationId: string;
  reportVersionId: string;
  branchId?: string;
}) => Promise<AssembledReportView>;

/**
 * The owning module's write path, narrowed to the single governed call this
 * slice may use. The repository's `acceptDraftItem` is that path; the port
 * exists so tests run it against fakes and the route binds the real one.
 */
export type AcceptanceWriter = {
  acceptDraftItem(input: {
    organizationId: string;
    reportVersionId: string;
    itemKey: string;
    kind: "action" | "finding";
    actorId: string;
  }): Promise<{
    acceptanceKey: string;
    destination: string;
    outcome: string;
    grantsExecutionApproval: boolean;
  }>;
  /**
   * Durable item-less review through the fenced mark_report_reviewed RPC.
   * Idempotent per report version: replays return the kept reviewer row,
   * and the service publishes no second event for a replay.
   */
  markReportReviewed(input: {
    organizationId: string;
    reportVersionId: string;
    actorId: string;
  }): Promise<{
    reportVersionId: string;
    reviewedBy: string;
    reviewedAt: string;
    replayed: boolean;
  }>;
};

export type AcceptanceServiceDependencies = {
  loader: AcceptanceReportLoader;
  writer: AcceptanceWriter;
  events: EventPublisher;
  now?: () => Date;
};

export type PromotedFeedItem = {
  itemKey: string;
  kind: "action" | "finding";
  destination: "Recommendations" | "Insights";
  acceptanceKey: string;
  outcome: "accepted" | "already_accepted";
  /** Exact source-report links: version, project and pinned brief revision. */
  reportVersionId: string;
  projectId: string;
  briefRevisionId: string;
  organizationId: string;
  grantsExecutionApproval: false;
};

export type AcceptSelectedItemsResult = {
  reportVersionId: string;
  projectId: string;
  briefRevisionId: string;
  items: PromotedFeedItem[];
  replayedAll: boolean;
  idempotencyKey: string;
  correlationId: string;
};

export type MarkReportReviewedResult = {
  reportVersionId: string;
  projectId: string;
  briefRevisionId: string;
  reviewedBy: string;
  reviewedAt: string;
  itemCount: 0;
};

function locationMismatch(): never {
  throw new DomainError(
    "TENANT_SCOPE_ERROR",
    "This report could not be found in your organization.",
  );
}

/**
 * F9 decision, enforced in code: the authoritative location pin is the
 * report's project branch — the reader assembly already proved
 * report.locationId equals the project branch before this service ever runs.
 * The brief document's `locationId` is an informational echo of that same
 * branch (set from it at save time); it is never consulted for routing, so
 * same-tenant document drift cannot move an acceptance to another branch.
 * An explicit branch scope that disagrees with the pinned report reads as
 * not-found, never as another location's content.
 */
export function resolveAcceptanceLocationPin(input: {
  reportLocationId: string;
  branchId?: string;
}): string {
  const pinned = z.string().uuid().parse(input.reportLocationId);
  if (input.branchId === undefined) return pinned;
  const scoped = z.string().uuid().parse(input.branchId);
  if (scoped !== pinned) locationMismatch();
  return pinned;
}

const writerOutcomeSchema = z.enum(["accepted", "already_accepted"]);

function toPromotedItem(input: {
  organizationId: string;
  reportVersionId: string;
  projectId: string;
  briefRevisionId: string;
  itemKey: string;
  kind: "action" | "finding";
  acceptanceKey: string;
  destination: string;
  outcome: string;
  grantsExecutionApproval: boolean;
}): PromotedFeedItem {
  const outcome = writerOutcomeSchema.safeParse(input.outcome);
  if (!outcome.success) {
    throw new DomainError("DOMAIN_ERROR", "This draft acceptance could not be read.");
  }
  // Fail closed on both derived fields: the database CHECKs make a mismatch
  // unreachable, so reaching here means the write path itself is broken.
  if (input.grantsExecutionApproval !== false) {
    throw new DomainError("DOMAIN_ERROR", "This draft acceptance could not be saved.");
  }
  if (input.acceptanceKey !== `${input.reportVersionId}:${input.itemKey}`) {
    throw new DomainError("DOMAIN_ERROR", "This draft acceptance could not be read.");
  }
  if (input.destination !== resolveDraftItemDestination(input.kind)) {
    throw new DomainError("DOMAIN_ERROR", "This draft acceptance could not be saved.");
  }
  return {
    itemKey: input.itemKey,
    kind: input.kind,
    destination: resolveDraftItemDestination(input.kind),
    acceptanceKey: input.acceptanceKey,
    outcome: outcome.data,
    reportVersionId: input.reportVersionId,
    projectId: input.projectId,
    briefRevisionId: input.briefRevisionId,
    organizationId: input.organizationId,
    grantsExecutionApproval: false,
  };
}

export function createMarketMonitoringAcceptanceService(
  dependencies: AcceptanceServiceDependencies,
) {
  const now = dependencies.now ?? (() => new Date());

  async function loadPinnedView(input: {
    organizationId: string;
    reportVersionId: string;
    branchId?: string;
  }): Promise<AssembledReportView> {
    const view = await dependencies.loader({
      organizationId: input.organizationId,
      reportVersionId: input.reportVersionId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
    });
    // The loader pins organization and version; the branch pin is rechecked
    // here so the F9 informational-declaration above holds even for loaders
    // that ignore the optional scope.
    resolveAcceptanceLocationPin({
      reportLocationId: view.identity.locationId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
    });
    return view;
  }

  return {
    async acceptSelectedItems(input: AcceptSelectedItemsInput): Promise<AcceptSelectedItemsResult> {
      const parsed = acceptSelectedItemsInputSchema.parse(input);
      const view = await loadPinnedView({
        organizationId: parsed.organizationId,
        reportVersionId: parsed.reportVersionId,
        ...(parsed.branchId ? { branchId: parsed.branchId } : {}),
      });
      const byKey = new Map(view.draftAdvice.map((advice) => [advice.itemKey, advice] as const));

      // Validate every selected item before writing any: an unknown key or a
      // kind presented for another type refuses the whole batch, so a
      // kind-to-destination mismatch is never written.
      for (const requested of parsed.items) {
        const draft = byKey.get(requested.itemKey);
        if (!draft) {
          throw new DomainError("DOMAIN_ERROR", "This draft item could not be found in this report.");
        }
        if (draft.kind !== requested.kind) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "This draft item was presented for another type; reload the report and try again.",
          );
        }
      }

      const items: PromotedFeedItem[] = [];
      for (const requested of parsed.items) {
        const written = await dependencies.writer.acceptDraftItem({
          organizationId: parsed.organizationId,
          reportVersionId: parsed.reportVersionId,
          itemKey: requested.itemKey,
          kind: requested.kind,
          actorId: parsed.actorId,
        });
        const promoted = toPromotedItem({
          organizationId: parsed.organizationId,
          reportVersionId: parsed.reportVersionId,
          projectId: view.identity.projectId,
          briefRevisionId: view.identity.briefRevisionId,
          itemKey: requested.itemKey,
          kind: requested.kind,
          acceptanceKey: written.acceptanceKey,
          destination: written.destination,
          outcome: written.outcome,
          grantsExecutionApproval: written.grantsExecutionApproval,
        });
        items.push(promoted);
        const payload = marketResearchDraftAcceptedPayloadSchema.parse({
          projectId: view.identity.projectId,
          reportVersionId: parsed.reportVersionId,
          briefRevisionId: view.identity.briefRevisionId,
          itemKey: requested.itemKey,
          acceptanceKey: promoted.acceptanceKey,
          destination: promoted.destination,
        });
        await publishEvent(dependencies.events, {
          organizationId: parsed.organizationId,
          eventName:
            promoted.outcome === "accepted"
              ? "market_research.draft_accepted"
              : "market_research.draft_acceptance_replayed",
          actorType: "user",
          actorId: parsed.actorId,
          correlationId: parsed.correlationId,
          occurredAt: now().toISOString(),
          payload,
        });
      }

      return {
        reportVersionId: parsed.reportVersionId,
        projectId: view.identity.projectId,
        briefRevisionId: view.identity.briefRevisionId,
        items,
        replayedAll: items.every((item) => item.outcome === "already_accepted"),
        idempotencyKey: parsed.idempotencyKey,
        correlationId: parsed.correlationId,
      };
    },

    /**
     * F3 decision, durable (Slice 7): reports with zero draft items get an
     * explicit reviewed path — the fenced mark_report_reviewed RPC records
     * one reviewer row per report version, and this method emits the audit
     * event only for the first review. Replays return the kept reviewer
     * identity without appending another event. No feed writes by
     * construction (the writer holds no feed path).
     */
    async markReportReviewed(input: MarkReportReviewedInput): Promise<MarkReportReviewedResult> {
      const parsed = markReportReviewedInputSchema.parse(input);
      const view = await loadPinnedView({
        organizationId: parsed.organizationId,
        reportVersionId: parsed.reportVersionId,
        ...(parsed.branchId ? { branchId: parsed.branchId } : {}),
      });
      if (view.draftAdvice.length > 0) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "This report carries draft items; review each one instead of marking the report.",
        );
      }
      const written = await dependencies.writer.markReportReviewed({
        organizationId: parsed.organizationId,
        reportVersionId: parsed.reportVersionId,
        actorId: parsed.actorId,
      });
      if (written.replayed) {
        return {
          reportVersionId: parsed.reportVersionId,
          projectId: view.identity.projectId,
          briefRevisionId: view.identity.briefRevisionId,
          reviewedBy: written.reviewedBy,
          reviewedAt: written.reviewedAt,
          itemCount: 0,
        };
      }
      const reviewedAt = written.reviewedAt;
      const payload = marketResearchReportReviewedPayloadSchema.parse({
        projectId: view.identity.projectId,
        reportVersionId: parsed.reportVersionId,
        briefRevisionId: view.identity.briefRevisionId,
        itemCount: 0,
      });
      await publishEvent(dependencies.events, {
        organizationId: parsed.organizationId,
        eventName: "market_research.report_reviewed",
        actorType: "user",
        actorId: parsed.actorId,
        correlationId: parsed.correlationId,
        occurredAt: reviewedAt,
        payload,
      });
      return {
        reportVersionId: parsed.reportVersionId,
        projectId: view.identity.projectId,
        briefRevisionId: view.identity.briefRevisionId,
        reviewedBy: written.reviewedBy,
        reviewedAt,
        itemCount: 0,
      };
    },
  };
}

export type MarketMonitoringAcceptanceService = ReturnType<
  typeof createMarketMonitoringAcceptanceService
>;
