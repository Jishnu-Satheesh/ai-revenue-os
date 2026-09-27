import { tasks } from "@trigger.dev/sdk";

import { questionnaireSpecSchema } from "@/domain/agent-router/contracts";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { createLightModelProvider } from "@/modules/agent-router/infrastructure/light-model-provider";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createAgentContextReaders } from "@/modules/agent-chat/application/api";
import {
  createResearchAutoSeams,
  createThreadService,
  permissionsForRole,
} from "@/modules/agent-chat/application/thread-service";
import type { agentResearchOnceTask } from "@/trigger/agent-chat";
import {
  requestDraftFromIdeaPick,
  selectDraftOpportunity,
  type IdeaDraftOutcome,
} from "@/modules/agent-chat/application/campaign-advise";
import { createCampaignDraftService } from "@/modules/decisions/application/campaign-draft-service";
import {
  submitAnswersBodySchema,
  threadRouteParamsSchema,
} from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";

/**
 * Agent thread questionnaire answers (spec section 8, ruling F2).
 *
 * POST validates the submitted answers against the echoed spec, appends
 * them to thread messages through the fenced keyed RPC, and re-triggers
 * routing in the same call. Operator role or above; viewers are refused
 * before persistence. The body carries the idempotency key, the resume
 * key of the card being answered, the echoed spec, and the answer record
 * — thread, organization, actor, and correlation ids are server-owned.
 * The response carries the re-route's fresh intent, confidence, and
 * reason codes (Slice C F2/M6), digested over the real context pack
 * (Slice C M7) — never the previous turn's codes.
 *
 * Streaming-synthesis Task 6 (executor inversion): a `campaign_ideas`
 * pick calls the draft seam immediately in the same POST, under a
 * deterministic thread-linked key derived from the picked idea, and the
 * response carries the one-payload `ideaDraft` envelope — draft id plus
 * inline approve action plus Studio hyperlink, or the pre-filled brief
 * when ineligible. A draft-seam failure propagates (the answers row is
 * already persisted and replay-safe, so a retry with the same keys
 * replays the answers and resumes the draft — nothing half-created).
 */

/**
 * Server-side draft-opportunity resolution for the ideas pick (fix round:
 * production happy path). Reads the org's opportunities through the
 * caller's session (RLS owns isolation — the same narrow structural port
 * the dispatch route's opportunity resolver uses, not the typed client)
 * and binds through `selectDraftOpportunity`: exactly one eligible
 * proposal, or the brief fallback. A read failure propagates like a draft
 * failure: the answers row is already persisted and replay-safe, so a
 * same-key retry replays the answers and re-resolves.
 */
async function resolveDraftOpportunity(input: {
  supabase: unknown;
  organizationId: string;
  now: Date;
}): Promise<ReturnType<typeof selectDraftOpportunity>> {
  const reader = input.supabase as unknown as {
    from(table: "opportunities"): {
      select(columns: string): {
        eq(column: string, value: string): Promise<{
          data: Array<Record<string, unknown>> | null;
          error: unknown;
        }>;
      };
    };
  };
  const { data, error } = await reader
    .from("opportunities")
    .select("id,organization_id,version,status,action_key,expires_at,assertions")
    .eq("organization_id", input.organizationId);
  if (error) {
    throw new DomainError(
      "INTEGRATION_ERROR",
      "Your draft request could not be recorded. Try again in a moment.",
    );
  }
  return selectDraftOpportunity(data ?? [], input.now);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; threadId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = threadRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
    correlationId = correlation.parseAfterAuthorization();

    const body = submitAnswersBodySchema.parse(await request.json().catch(() => ({})));
    const spec = questionnaireSpecSchema.parse(body.spec);
    // Watch dispatch fence (spec section 12): answers that drive watch
    // create/update carry the duplicate_watch card, and creating or
    // changing a watch needs growth_intelligence.manage. Checked by grant
    // rather than role name so the refusal follows the permission map;
    // every other card keeps the operator-plus gate below.
    if (
      spec.kind === "duplicate_watch" &&
      !hasOrganizationPermission(context.membership.role, "growth_intelligence.manage")
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "Watch changes need the growth_intelligence.manage grant.",
      );
    }
    if (context.membership.role === "viewer") {
      throw new DomainError("AUTHORIZATION_ERROR", "Viewers cannot change this chat.");
    }
    const url = new URL(request.url);
    const page = url.searchParams.get("page") ?? undefined;

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      proposeRouter: async (args) => createLightModelProvider().propose({ ...args, correlationId }),
      // Slice C M7: the answers re-route digests the real HEAVY pack,
      // like the classify-only route does — no more placeholder digest
      // with its context-unavailable limitation on this path.
      contextReaders: createAgentContextReaders(context.supabase),
      // Task B3: the answers re-route auto-enqueues like a send, so it
      // carries the same research seams (Trigger transport plus the
      // authenticated readers).
      dispatchSeams: createResearchAutoSeams({
        triggerResearchRun: async (payload) => {
          const handle = await tasks.trigger<typeof agentResearchOnceTask>(
            "agent-chat.research-once",
            {
              organizationId: payload.organizationId,
              actorId: payload.actorId,
              threadId: payload.threadId,
              messageDigest: payload.messageDigest,
              profileVersionId: payload.profileVersionId,
              profileDigest: payload.profileDigest,
              correlationId: payload.correlationId,
              idempotencyKey: payload.idempotencyKey,
            },
            { idempotencyKey: payload.idempotencyKey },
          );
          return { runId: handle.id };
        },
        readers: createAgentContextReaders(context.supabase),
      }),
      correlationId,
    });
    const { message, replayed, answers, intent, confidence, reasonCodes, questionnaire, research } =
      await service.submitAnswers({
        organizationId,
        actorId: context.user.id,
        role: context.membership.role,
        threadId: rawParams.threadId,
        spec,
        answers: body.answers,
        idempotencyKey: body.idempotencyKey,
        ...(page ? { page } : {}),
      });
    logger.info("agent_thread.answers_submitted", {
      organizationId,
      threadId: rawParams.threadId,
      correlationId,
    });

    // Pick to instant draft: the ideas pick drafts in this same POST.
    // Grants come from the server-owned role (never client claims); the
    // opportunity resolves server-side through `selectDraftOpportunity`
    // (exactly one eligible proposal binds — no caller can steer execution
    // toward an unchosen proposal, and zero/several resolve to the brief).
    let ideaDraft: IdeaDraftOutcome | null = null;
    if (spec.kind === "campaign_ideas") {
      const pickedValue = answers["idea"];
      const pickedOption =
        typeof pickedValue === "string"
          ? spec.items.flatMap((item) => item.options ?? []).find(
              (option) => option.value === pickedValue,
            )
          : undefined;
      if (!pickedOption || !pickedOption.description) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const { thread } = await service.getThread({
        organizationId,
        threadId: rawParams.threadId,
      });
      const resolution = await resolveDraftOpportunity({
        supabase: context.supabase,
        organizationId,
        now: new Date(),
      });
      ideaDraft = await requestDraftFromIdeaPick(
        {
          organizationId,
          actorId: context.user.id,
          threadId: rawParams.threadId,
          resumeKey: body.resumeKey,
          permissions: permissionsForRole(context.membership.role),
          opportunity:
            resolution.outcome === "bound"
              ? {
                  id: resolution.opportunity.id,
                  version: resolution.opportunity.version,
                  assertions: resolution.opportunity.assertions,
                }
              : null,
          opportunityAmbiguous: resolution.outcome === "ambiguous",
          idea: {
            value: pickedOption.value,
            title: pickedOption.label,
            description: pickedOption.description,
            recommended: pickedOption.recommended ?? false,
          },
          correlationId,
          existingLinks: {
            ...(thread.linkedResearchProjectId
              ? { projectId: thread.linkedResearchProjectId }
              : {}),
            ...(thread.linkedRequestId ? { requestId: thread.linkedRequestId } : {}),
            ...(thread.linkedCampaignId ? { campaignId: thread.linkedCampaignId } : {}),
          },
        },
        {
          drafts: {
            requestDraft: (draftInput) =>
              createCampaignDraftService({
                rpc: async (name, args) => {
                  const { data, error } = await context.supabase.rpc(name, args);
                  return {
                    data: data as {
                      requestId: string;
                      status: string;
                      draftRequestStatus: string;
                    } | null,
                    error: error as { code: string | null; message: string } | null,
                  };
                },
              }).requestDraft(draftInput),
          },
          links: {
            setThreadLinks: (linkInput) =>
              service.setThreadLinks({
                organizationId: linkInput.organizationId,
                actorId: linkInput.actorId,
                role: context.membership.role,
                threadId: linkInput.threadId,
                ...(linkInput.projectId ? { projectId: linkInput.projectId } : {}),
                ...(linkInput.requestId ? { requestId: linkInput.requestId } : {}),
                ...(linkInput.draftRequestId ? { draftRequestId: linkInput.draftRequestId } : {}),
                ...(linkInput.campaignId ? { campaignId: linkInput.campaignId } : {}),
              }),
          },
        },
      );
      logger.info("agent_thread.idea_draft_resolved", {
        organizationId,
        threadId: rawParams.threadId,
        correlationId,
      });
    }

    return agentJsonResponse(
      {
        message,
        replayed,
        answers,
        resumeKey: body.resumeKey,
        intent,
        // Slice C F2/M6: the re-route's fresh confidence + reason codes
        // travel in this response, so the drawer never renders the
        // previous turn's codes beside the new card.
        confidence,
        reasonCodes,
        questionnaire,
        research,
        ...(ideaDraft ? { ideaDraft } : {}),
      },
      correlationId,
      replayed ? 200 : 201,
    );
  } catch (error) {
    logger.warn("agent_thread.answers_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
