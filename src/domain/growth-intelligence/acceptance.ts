import { z } from "zod";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";

/**
 * Draft item and acceptance contracts.
 *
 * A report carries draft advice; nothing enters Recommendations or Insights
 * before explicit acceptance. The destination derives from the item type:
 * action advice routes to Recommendations, informational findings route to
 * Insights. Acceptance is idempotent on the exact key of report version id
 * plus item key: replaying the same key returns the already-accepted record
 * without duplication. Acceptance never grants execution approval — every
 * record carries an explicit marker saying so.
 */

export const DRAFT_ITEM_KINDS = ["action", "finding"] as const;

export type DraftItemKind = (typeof DRAFT_ITEM_KINDS)[number];

export const DRAFT_ITEM_DESTINATIONS = ["Recommendations", "Insights"] as const;

export type DraftItemDestination = (typeof DRAFT_ITEM_DESTINATIONS)[number];

export const draftItemKindSchema = z.enum(DRAFT_ITEM_KINDS);

export function resolveDraftItemDestination(kind: DraftItemKind): DraftItemDestination {
  const parsed = draftItemKindSchema.parse(kind);
  return parsed === "action" ? "Recommendations" : "Insights";
}

export const draftItemSchema = z
  .object({
    reportVersionId: z.string().uuid(),
    itemKey: z.string().trim().min(1).max(160),
    kind: draftItemKindSchema,
    title: z.string().trim().min(1).max(240),
    detail: z.string().trim().min(1).max(2_000),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
  })
  .strict();

export type DraftItem = z.infer<typeof draftItemSchema>;

/** The exact acceptance identity: report version id plus item key. */
export function buildAcceptanceKey(reportVersionId: string, itemKey: string): string {
  const versionId = z.string().uuid().parse(reportVersionId);
  const key = z.string().trim().min(1).max(160).parse(itemKey);
  return `${versionId}:${key}`;
}

export const acceptanceRecordSchema = z
  .object({
    acceptanceKey: z.string().trim().min(1).max(400),
    reportVersionId: z.string().uuid(),
    itemKey: z.string().trim().min(1).max(160),
    kind: draftItemKindSchema,
    destination: z.enum(DRAFT_ITEM_DESTINATIONS),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    acceptedAtUtc: z.string().datetime(),
    grantsExecutionApproval: z.literal(false),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.acceptanceKey !== `${record.reportVersionId}:${record.itemKey}`) {
      context.addIssue({
        code: "custom",
        path: ["acceptanceKey"],
        message: "Acceptance identity must be exactly the report version id plus the item key.",
      });
    }
    if (record.destination !== resolveDraftItemDestination(record.kind)) {
      context.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Acceptance destination must derive from the draft item type.",
      });
    }
  });

export type AcceptanceRecord = z.infer<typeof acceptanceRecordSchema>;

export type AcceptanceOutcome = "accepted" | "already_accepted";

/**
 * Accepts a draft item, or replays the existing record for the same exact
 * key. A record presented for a different key, kind, or organization is a
 * conflict, never a silent overwrite.
 */
export function applyAcceptance(
  item: DraftItem,
  existing: unknown,
  acceptedAtUtc: string,
): { outcome: AcceptanceOutcome; record: AcceptanceRecord } {
  const parsed = draftItemSchema.parse(item);
  const acceptedAt = z.string().datetime().parse(acceptedAtUtc);
  const acceptanceKey = buildAcceptanceKey(parsed.reportVersionId, parsed.itemKey);

  if (existing === null || existing === undefined) {
    return {
      outcome: "accepted",
      record: acceptanceRecordSchema.parse({
        acceptanceKey,
        reportVersionId: parsed.reportVersionId,
        itemKey: parsed.itemKey,
        kind: parsed.kind,
        destination: resolveDraftItemDestination(parsed.kind),
        organizationId: parsed.organizationId,
        projectId: parsed.projectId,
        acceptedAtUtc: acceptedAt,
        grantsExecutionApproval: false,
      }),
    };
  }

  const kept = acceptanceRecordSchema.parse(existing);
  if (kept.acceptanceKey !== acceptanceKey) {
    throw new GrowthIntelligenceError(
      "ACCEPTANCE_KEY_CONFLICT",
      "This acceptance record belongs to another report version or item.",
    );
  }
  if (kept.organizationId !== parsed.organizationId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_TENANT_MISMATCH",
      "This acceptance belongs to another organization.",
    );
  }
  if (kept.kind !== parsed.kind) {
    throw new GrowthIntelligenceError(
      "ACCEPTANCE_KEY_CONFLICT",
      "This acceptance record was made for another draft item type.",
    );
  }
  return { outcome: "already_accepted", record: kept };
}
