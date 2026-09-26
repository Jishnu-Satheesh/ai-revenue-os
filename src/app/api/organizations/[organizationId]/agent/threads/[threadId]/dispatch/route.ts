import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { getOrganizationContext } from "@/lib/api/organization-context";
import { toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createAgentContextReaders } from "@/modules/agent-chat/application/api";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import {
  dispatchBodySchema,
  threadRouteParamsSchema,
  type DispatchAction,
} from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";
import { createCampaignDraftService } from "@/modules/decisions/application/campaign-draft-service";
import type {
  agentResearchOnceTask,
  agentWatchCreateTask,
  agentWatchUpdateTask,
} from "@/trigger/agent-chat";

/**
 * Agent thread governed dispatch (Slice B, spec sections 10-12).
 *
 * POST enqueues one governed lane for the thread's latest message:
 * `research_once` / `watch_create` / `watch_update` hand a
 * thread-linked idempotency key to the matching `agent-chat.*` Trigger
 * task (the worker owns gating, spend, and outcome, and emits
 * `agent_thread.research_triggered` / `agent_thread.watch_created`
 * itself); `campaign_advice` resolves the bound opportunity in-org and
 * admits one governed draft through `adviseCampaign`, emitting
 * `agent_thread.draft_requested` with identifiers only.
 *
 * Fences: any member may not dispatch — viewers are refused before
 * persistence, research/watch recheck `growth_intelligence.manage`
 * and drafts recheck `campaign.create` from the server-owned role, and
 * nothing enqueues without the operator's explicit confirmation. The
 * same client token replays the kept outcome without a duplicate
 * enqueue. No service role in this path: trigger transport plus the
 * caller's session client only.
 */

const profilePointerSchema = z
  .object({
    status: z.literal("current"),
    versionId: z.string().trim().min(1).max(200),
    digest: z.string().trim().min(1).max(256),
  })
  .passthrough();

function dispatchIntent(action: DispatchAction) {
  return action === "campaign_advice"
    ? ("campaign_advice" as const)
    : action === "research_once"
      ? ("research_once" as const)
      : ("watch" as const);
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

    const body = dispatchBodySchema.parse(await request.json().catch(() => ({})));

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      correlationId,
      dispatchSeams: {
        // Trigger is transport and nothing else: the payload carries
        // identifiers plus one server-resolved pointer, and the worker
        // re-reads everything it acts on through its claim. The
        // thread-linked key dedups the run dispatch itself.
        triggerResearchOnce: async (payload) => {
          const handle = await tasks.trigger<typeof agentResearchOnceTask>(
            "agent-chat.research-once",
            {
              organizationId: payload.organizationId,
              actorId: payload.actorId as string,
              threadId: payload.threadId as string,
              messageDigest: payload["messageDigest"] as string,
              profileVersionId: payload["profileVersionId"] as string,
              profileDigest: payload["profileDigest"] as string,
              correlationId: payload.correlationId,
              idempotencyKey: payload.idempotencyKey,
            },
            { idempotencyKey: payload.idempotencyKey },
          );
          return { runId: handle.id };
        },
        triggerWatchCreate: async (payload) => {
          const handle = await tasks.trigger<typeof agentWatchCreateTask>(
            "agent-chat.watch-create",
            {
              organizationId: payload.organizationId,
              actorId: payload.actorId as string,
              threadId: payload.threadId as string,
              branchId: payload["branchId"] as string,
              ...(typeof payload["title"] === "string" ? { title: payload["title"] } : {}),
              question: payload["question"] as string,
              mode: payload["mode"] as "one-time" | "recurring",
              ...(payload["schedule"] !== undefined ? { schedule: payload["schedule"] } : {}),
              researchArea: payload["researchArea"] as string,
              competitors: (payload["competitors"] ?? []) as unknown[],
              investigationAreas: (payload["investigationAreas"] ?? ["demand"]) as string[],
              ...(typeof payload["businessContextSnapshotId"] === "string"
                ? { businessContextSnapshotId: payload["businessContextSnapshotId"] }
                : {}),
              correlationId: payload.correlationId,
              idempotencyKey: payload.idempotencyKey,
            },
            { idempotencyKey: payload.idempotencyKey },
          );
          return { runId: handle.id };
        },
        triggerWatchUpdate: async (payload) => {
          const handle = await tasks.trigger<typeof agentWatchUpdateTask>(
            "agent-chat.watch-update",
            {
              organizationId: payload.organizationId,
              actorId: payload.actorId as string,
              threadId: payload.threadId as string,
              projectId: payload["projectId"] as string,
              edits: (payload["edits"] ?? {}) as Record<string, unknown>,
              correlationId: payload.correlationId,
              idempotencyKey: payload.idempotencyKey,
            },
            { idempotencyKey: payload.idempotencyKey },
          );
          return { runId: handle.id };
        },
        // Research scope resolves server-side: the current approved
        // Market Profile pointer through the authenticated readers (the
        // same lane the context pack uses). A client can never widen
        // scope, and the worker re-validates the digest before spending.
        resolveProfilePointer: async ({ organizationId: scopeOrganizationId }) => {
          const readers = createAgentContextReaders(context.supabase);
          const pointer = await readers.getMarketProfile?.({
            organizationId: scopeOrganizationId,
          });
          const parsed = profilePointerSchema.safeParse(pointer);
          return parsed.success
            ? { versionId: parsed.data.versionId, digest: parsed.data.digest }
            : null;
        },
        // Opportunity resolver: the bound row read in-org through the
        // caller's session (RLS owns isolation). Existence plus version
        // match here; the draft RPC rechecks admission underneath. The
        // table is deliberately untyped (see UNTYPED_TABLES), so this
        // reads through the same narrow structural port the decisions
        // repository uses rather than the typed client.
        resolveOpportunity: async ({ organizationId: scopeOrganizationId, opportunityId }) => {
          const reader = context.supabase as unknown as {
            from(table: "opportunities"): {
              select(columns: string): {
                eq(column: string, value: string): {
                  eq(column: string, value: string): {
                    maybeSingle(): Promise<{
                      data: Record<string, unknown> | null;
                      error: unknown;
                    }>;
                  };
                };
              };
            };
          };
          const { data, error } = await reader
            .from("opportunities")
            .select("id,organization_id,version,status,action_key")
            .eq("organization_id", scopeOrganizationId)
            .eq("id", opportunityId)
            .maybeSingle();
          if (error || !data) return null;
          if (
            typeof data["id"] !== "string" ||
            typeof data["version"] !== "number" ||
            typeof data["status"] !== "string"
          ) {
            return null;
          }
          return {
            id: data["id"],
            version: data["version"],
            status: data["status"],
            actionKey: typeof data["action_key"] === "string" ? data["action_key"] : "",
          };
        },
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
    });
    const outcome = await service.dispatch({
      organizationId,
      actorId: context.user.id,
      role: context.membership.role,
      threadId: rawParams.threadId,
      action: body.action,
      idempotencyKey: body.idempotencyKey,
      confirmation: body.confirmation,
      ...(body.watchCreate ? { watchCreate: body.watchCreate } : {}),
      ...(body.watchUpdate ? { watchUpdate: body.watchUpdate } : {}),
      ...(body.campaignAdvice ? { campaignAdvice: body.campaignAdvice } : {}),
    });
    // The dispatched intent plus outcome travel in the log (bounded
    // vocabulary and identifiers only, inside the LogContext allowlist).
    logger.info("agent_thread.dispatched", {
      organizationId,
      threadId: rawParams.threadId,
      intent: dispatchIntent(body.action),
      correlationId,
    });
    const status = outcome.replayed || outcome.outcome === "brief_prefilled" ? 200 : 201;
    return agentJsonResponse({ ...outcome }, correlationId, status);
  } catch (error) {
    logger.warn("agent_thread.dispatch_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
