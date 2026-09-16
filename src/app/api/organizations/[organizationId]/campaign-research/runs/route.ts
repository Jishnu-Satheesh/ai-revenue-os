import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  refusalToDomainError,
  requestCampaignResearch,
  type ResearchAdmissionPersistence,
} from "@/modules/campaigns/application/research-dispatch";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { dispatchResearchWorker } from "@/modules/campaigns/infrastructure/research-worker-dispatch";
import {
  createResearchPolicyRepository,
  type ResearchPersistence,
} from "@/modules/campaigns/infrastructure/research-policy-repository";

/**
 * Asking the platform to work out what campaign to run.
 *
 * This route is the entry the proposal pipeline never had. Everything
 * downstream — admission against the allowance, the claim and its lease, the
 * worker, the proposal document, the approval gate, the review surface — was
 * built and then left with nothing to start it.
 *
 * The permission is `campaign.research_request`, the same one that sets the
 * allowance, because this spends it. The database checks it again inside the
 * admission function, so this check is a courtesy to the client rather than the
 * fence.
 *
 * Every figure sent to the database is read from the policy in force, never
 * chosen here and never defaulted. A research budget is a numeric operating
 * limit; a route that picked one would be inventing the client's spending rules
 * (D06).
 */

const researchRequesterRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter((role) => hasOrganizationPermission(role, "campaign.research_request"));

const bodySchema = z.strictObject({
  /**
   * Why research is being asked for. Only `manual_request` is accepted from a
   * person: a scheduled or signal-driven run is something the platform decides,
   * and letting a request name itself one would misattribute how it began.
   */
  triggerKind: z.literal("manual_request").default("manual_request"),
  /** Supplied by the client so a double-click replays rather than admitting twice. */
  idempotencyKey: z.string().trim().min(8).max(200),
});

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => {
    throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
  });
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("VALIDATION_ERROR", "The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, researchRequesterRoles);
    // After membership, never before: refusing an unknown organization with
    // "not enabled" would let an outsider learn which ones exist.
    assertCampaignsEnabled(context.organizationId);

    const body = bodySchema.parse(await parseJsonObject(request));

    // The policy in force decides what this run may cost and what evidence it
    // may still trust. Read on the caller's own session, so a person who may
    // not read the policy cannot spend against it either.
    const ledger = await createResearchPolicyRepository(
      context.supabase as unknown as ResearchPersistence,
    ).readLedger({ organizationId: context.organizationId });

    if (ledger.policy === null || !ledger.policy.enabled) {
      // Answered here rather than by letting the database refuse, so the reader
      // is told the one thing they can act on: it has not been set up.
      return apiErrorResponse(
        new DomainError(
          "FEATURE_NOT_AVAILABLE",
          "Research is not switched on for this organization yet. An owner or admin can set it up in Research settings.",
        ),
      );
    }

    const correlationId = randomUUID();
    // What was asked, as a value. There are no parameters to a manual request —
    // the question is "what should we do next" — so the digest covers the
    // tenant, the kind and the exact policy version that admitted it, which is
    // what makes one request distinguishable from the same question asked under
    // different spending rules.
    const requestDigest = createHash("sha256")
      .update(
        JSON.stringify({
          organizationId: context.organizationId,
          triggerKind: body.triggerKind,
          policyVersion: ledger.policy.version,
          idempotencyKey: body.idempotencyKey,
        }),
        "utf8",
      )
      .digest("hex");

    const outcome = await requestCampaignResearch(
      context.supabase as unknown as ResearchAdmissionPersistence,
      dispatchResearchWorker,
      {
        organizationId: context.organizationId,
        triggerKind: body.triggerKind,
        // The ceiling this run reserves against the window. Taken from the
        // policy, so it is the client's own figure.
        budgetMinor: ledger.policy.perRunAllowance.amountMinor,
        allowanceCurrency: ledger.policy.perRunAllowance.currency,
        requestDigest,
        idempotencyKey: body.idempotencyKey,
        sourceFingerprint: null,
        // Sent so a policy that changed between the read above and the
        // admission below is refused rather than silently applied.
        knownPolicyVersion: ledger.policy.version,
        correlationId,
        evidenceMaxAgeDays: ledger.policy.evidenceMaxAgeDays,
      },
    );

    if (outcome.status === "refused") {
      return apiErrorResponse(refusalToDomainError(outcome.refusal));
    }

    // `LogContext` is an allowlist, so the outcome is carried by which event
    // is named rather than by a field. Two events, because "admitted" and
    // "a worker has it" are different facts and only one of them means the
    // person should expect a proposal.
    logger.info("campaign.research_requested", {
      organizationId: context.organizationId,
      runId: outcome.runId,
      correlationId,
    });
    if (outcome.status === "not_started") {
      logger.warn("campaign.research_awaiting_worker", {
        organizationId: context.organizationId,
        runId: outcome.runId,
        correlationId,
      });
    }

    // 202: the run is admitted and recorded. It is not proof that research
    // finished, and `not_started` says plainly that no worker has it yet.
    return NextResponse.json(
      outcome.status === "started"
        ? { outcome: outcome.outcome, runId: outcome.runId, started: true }
        : { outcome: "saved", runId: outcome.runId, started: false },
      { status: 202 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
