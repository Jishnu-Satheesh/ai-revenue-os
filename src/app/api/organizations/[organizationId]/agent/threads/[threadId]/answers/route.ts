import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { questionnaireSpecSchema } from "@/domain/agent-router/contracts";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";
import { researchProjectScheduleSchema } from "@/domain/growth-intelligence/project";
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
import {
  buildThreadIdempotencyKey,
  createPreparedWatch,
  giResearchLink,
  matchWatchCandidate,
  messageDigestFor,
  prepareWatchCreate,
  requestWatchFromChoice,
  resolveWatchBranchId,
  watchCompetitorSchema,
  type WatchTapOutcome,
  type WatchCandidate,
  type WatchCardEdits,
} from "@/modules/agent-chat/application/executors";
import { createAuthenticatedOrganizationCompetitorRepository } from "@/modules/growth-intelligence/infrastructure/organization-competitor-repository";
import { createAuthenticatedResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";
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
 *
 * Task B4 (L3 one-tap watches): a `duplicate_watch` choice — or a
 * `missing_fields` submit whose re-route stays `watch` — executes behind
 * the same POST with the auto-prepared payload (card answers plus the
 * routing note's question, branch bound against live rows, cadence and
 * areas defaulted with assumptions stated). The response carries the
 * `watchChoice` envelope: created/replayed receipt plus Market
 * Intelligence link, the converged duplicate card, the viewed link, the
 * applied update, the scope proposal, or the honest blocked copy. A
 * watch-seam failure propagates like a draft failure. Creates and
 * replays publish the reused `agent_thread.watch_created` event with an
 * identifier-only payload; no new event names are minted.
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

/**
 * Server-side watch reads for the one-tap lane (Task B4). Narrow
 * structural ports over the caller's session — RLS owns isolation, the
 * same shape as the draft-opportunity resolver above. Every row is
 * Zod-disposed; an unreadable row degrades to null (the executor reports
 * the honest blocked copy), never a guess.
 */
const watchBranchRowSchema = z
  .object({ id: z.string().uuid(), name: z.string().trim().min(1).max(200) })
  .strict();

async function readWatchBranchRows(
  supabase: unknown,
  organizationId: string,
): Promise<Array<{ id: string; name: string }>> {
  const reader = supabase as unknown as {
    from(table: "branches"): {
      select(columns: string): {
        eq(column: string, value: string): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
  const { data, error } = await reader
    .from("branches")
    .select("id,name")
    .eq("organization_id", organizationId);
  if (error || !Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const parsed = watchBranchRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

async function readWatchProjectRow(
  supabase: unknown,
  input: { organizationId: string; projectId: string },
): Promise<{
  title: string;
  question: string;
  mode: "one-time" | "recurring";
  branchId: string;
  schedule: z.infer<typeof researchProjectScheduleSchema>;
} | null> {
  const reader = supabase as unknown as {
    from(table: "growth_intelligence_research_projects"): {
      select(columns: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): {
            maybeSingle(): Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
  const { data, error } = await reader
    .from("growth_intelligence_research_projects")
    .select("title,question,mode,branch_id,schedule")
    .eq("organization_id", input.organizationId)
    .eq("id", input.projectId)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200),
      question: z.string().trim().min(1).max(2000),
      mode: z.enum(["one-time", "recurring"]),
      branch_id: z.string().uuid(),
      schedule: researchProjectScheduleSchema,
    })
    .strict()
    .safeParse(data);
  if (!parsed.success) return null;
  return {
    title: parsed.data.title,
    question: parsed.data.question,
    mode: parsed.data.mode,
    branchId: parsed.data.branch_id,
    schedule: parsed.data.schedule,
  };
}

async function readWatchBriefDocument(
  supabase: unknown,
  input: { organizationId: string; projectId: string },
): Promise<z.infer<typeof briefRevisionSchema> | null> {
  const reader = supabase as unknown as {
    from(table: "growth_intelligence_brief_revisions"): {
      select(columns: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): {
            order(column: string, options?: { ascending?: boolean }): {
              order(column: string, options?: { ascending?: boolean }): {
                limit(count: number): {
                  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
                };
              };
            };
          };
        };
      };
    };
  };
  const { data, error } = await reader
    .from("growth_intelligence_brief_revisions")
    .select("document")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .order("revision_number", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const document = (data as { document?: unknown }).document;
  const parsed = briefRevisionSchema.safeParse(document);
  return parsed.success ? parsed.data : null;
}

/**
 * Pack context for the one-tap watch create (Task B4 fix round 1): the
 * branch timezone through the pack's own context reader, plus the
 * organization's saved competitors from the registry the New-research
 * dialog maintains (the monitoring projects route round-trips the same
 * table on create, so names saved on either path pre-fill the other).
 * Either leg degrades openly on a read failure — the executor then
 * states the UTC / no-competitors assumption inline — with an
 * identifier-only warn so the gap stays observable, never silent.
 * Malformed or unparseable rows are skipped, never papered over.
 */
async function resolveWatchPrefillPack(input: {
  supabase: Parameters<typeof createAgentContextReaders>[0];
  organizationId: string;
  branchId?: string;
  threadId: string;
  correlationId: string;
}): Promise<{
  branchTimezone?: string;
  competitors: Array<z.infer<typeof watchCompetitorSchema>>;
}> {
  let branchTimezone: string | undefined;
  try {
    const readers = createAgentContextReaders(input.supabase);
    const resolved = await readers.resolveBranchTimezone?.({
      organizationId: input.organizationId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
    });
    const trimmed = typeof resolved === "string" ? resolved.trim() : "";
    // The schedule contract only accepts real IANA zones (same Intl
    // check): a garbage row degrades to the stated UTC assumption,
    // never a 500 on the tap.
    if (trimmed.length > 0 && trimmed.length <= 100) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: trimmed }).format();
        branchTimezone = trimmed;
      } catch {
        // Invalid zone on file — leave it absent (UTC assumption).
      }
    }
  } catch {
    logger.warn("agent_thread.watch_prefill_timezone_degraded", {
      organizationId: input.organizationId,
      threadId: input.threadId,
      correlationId: input.correlationId,
    });
  }
  let competitors: Array<z.infer<typeof watchCompetitorSchema>> = [];
  try {
    const saved = await createAuthenticatedOrganizationCompetitorRepository(
      input.supabase,
    ).listCompetitors({ organizationId: input.organizationId });
    competitors = saved
      .flatMap((entry) => {
        const parsed = watchCompetitorSchema.safeParse({
          name: entry.name,
          ...(entry.website ? { website: entry.website } : {}),
          ...(entry.locationHint ? { locationHint: entry.locationHint } : {}),
          source: "suggestion",
        });
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, 20);
  } catch {
    logger.warn("agent_thread.watch_prefill_competitors_degraded", {
      organizationId: input.organizationId,
      threadId: input.threadId,
      correlationId: input.correlationId,
    });
  }
  return {
    ...(branchTimezone ? { branchTimezone } : {}),
    competitors,
  };
}

const watchSiblingRowSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200),
    title: z.string().max(200).optional(),
    question: z.string().trim().min(1).max(2000),
    mode: z.enum(["one-time", "recurring"]),
    branchId: z.string().trim().min(1).max(200).optional(),
    scopeFingerprint: z.string().nullable().optional(),
  })
  .passthrough();

function mapWatchSiblings(rows: unknown): WatchCandidate[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const parsed = watchSiblingRowSchema.safeParse(row);
    if (!parsed.success) return [];
    return [
      {
        projectId: parsed.data.projectId,
        title: parsed.data.title ?? "",
        question: parsed.data.question,
        mode: parsed.data.mode,
        scopeFingerprint: parsed.data.scopeFingerprint ?? null,
      },
    ];
  });
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

    const threadsRepo = createThreadRepository(agentPersistenceFor(context.supabase));
    const service = createThreadService({
      threads: threadsRepo,
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

    // Watch one-tap (Task B4, L3): the duplicate choice — or a
    // missing-fields submit whose re-route stays watch — executes behind
    // the single card submit with the auto-prepared payload. Grants come
    // from the server-owned role (never client claims); the candidate
    // resolves server-side through `matchWatchCandidate` (the card's
    // echoed project id is never trusted); the question is the thread's
    // latest non-answers user message (the routing note's ask). A watch
    // failure propagates like a draft failure: the answers row is already
    // persisted and replay-safe, so a same-key retry replays the answers
    // and resumes the watch — nothing half-created.
    let watchChoice: WatchTapOutcome | null = null;
    if (spec.kind === "duplicate_watch" || (spec.kind === "missing_fields" && intent === "watch")) {
      const rawChoice = spec.kind === "duplicate_watch" ? answers["choice"] : "create";
      if (
        rawChoice !== "view_existing" &&
        rawChoice !== "update_fields" &&
        rawChoice !== "start_fresh" &&
        rawChoice !== "cancel" &&
        rawChoice !== "create"
      ) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      if (rawChoice === "cancel") {
        watchChoice = { outcome: "cancelled" };
      } else {
        const projects = createAuthenticatedResearchProjectRepository(context.supabase);
        const listed = await threadsRepo.listMessages({
          organizationId,
          threadId: rawParams.threadId,
          limit: 20,
        });
        const ask = [...listed.messages]
          .reverse()
          .find(
            (entry) =>
              entry.role === "user" &&
              (entry.body ?? "").trim().length > 0 &&
              !(entry.body ?? "").startsWith("[answers "),
          );
        const question = ask?.body?.trim() || null;
        const { thread } = await service.getThread({
          organizationId,
          threadId: rawParams.threadId,
        });
        const siblingRows = await projects.listActiveProjects({ organizationId, limit: 50 });
        // Matching runs on the raw rows (they carry branchId); the mapped
        // candidates feed the executor's twin check, which needs less.
        const siblings = mapWatchSiblings(siblingRows);
        const branchAnswer = answers["branch"]?.trim() ? answers["branch"].trim() : undefined;
        // Fresh and missing-fields creates always need the branch rows
        // (uuid check plus single-branch auto-bind); view and update only
        // resolve a branch when the card named one.
        const needBranches = rawChoice !== "view_existing" || !!branchAnswer;
        const branchRows = needBranches
          ? await readWatchBranchRows(context.supabase, organizationId)
          : [];
        const branchRes = branchAnswer
          ? resolveWatchBranchId(branchRows, branchAnswer)
          : null;
        const matched = question
          ? matchWatchCandidate(siblingRows, {
              question,
              ...(branchRes && branchRes.ok ? { branchId: branchRes.branchId } : {}),
            })
          : null;
        const matchedId =
          matched && z.string().uuid().safeParse(matched).success ? matched : null;
        const linked = z.string().uuid().safeParse(thread.linkedResearchProjectId ?? "").success
          ? (thread.linkedResearchProjectId as string)
          : null;
        const candidate = matchedId ?? linked ?? null;
        const existingLinks = {
          ...(thread.linkedResearchProjectId
            ? { projectId: thread.linkedResearchProjectId }
            : {}),
          ...(thread.linkedRequestId ? { requestId: thread.linkedRequestId } : {}),
          ...(thread.linkedDraftRequestId ? { draftRequestId: thread.linkedDraftRequestId } : {}),
          ...(thread.linkedCampaignId ? { campaignId: thread.linkedCampaignId } : {}),
        };
        const answerDigest = messageDigestFor({
          threadId: rawParams.threadId,
          messageId: message.id,
          body: message.body ?? "",
        });

        if (rawChoice === "view_existing") {
          watchChoice = {
            outcome: "view_existing",
            projectId: candidate,
            link: giResearchLink(organizationId, candidate ? { projectId: candidate } : {}),
          };
        } else if (rawChoice === "update_fields") {
          watchChoice = await requestWatchFromChoice(
            {
              organizationId,
              actorId: context.user.id,
              threadId: rawParams.threadId,
              idempotencyKey: buildThreadIdempotencyKey(
                rawParams.threadId,
                `${answerDigest}:watch-answer-update`,
              ),
              choice: "update_fields",
              permissions: permissionsForRole(context.membership.role),
              candidateProjectId: candidate,
              // Server-validated answers forwarded for executor disposal:
              // a forged value fails the executor's Zod contract (400),
              // never a silent mis-dispatch.
              cardEdits: {
                ...(answers["frequency"] ? { frequency: answers["frequency"] } : {}),
                ...(answers["end_date"] ? { endDate: answers["end_date"] } : {}),
                ...(branchRes && branchRes.ok ? { branchId: branchRes.branchId } : {}),
                ...(answers["research_area"] ? { researchArea: answers["research_area"] } : {}),
                ...(answers["competitors"] ? { competitorName: answers["competitors"] } : {}),
              } as WatchCardEdits,
              existingLinks,
            },
            {
              watchProjects: {
                listActive: async () => siblings,
                createKeyed: (input) => projects.createProject(input),
                readProject: (readInput) => readWatchProjectRow(context.supabase, readInput),
                readBrief: (readInput) => readWatchBriefDocument(context.supabase, readInput),
                updateWatch: (input) => projects.updateProjectSchedule(input),
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
                    ...(linkInput.draftRequestId
                      ? { draftRequestId: linkInput.draftRequestId }
                      : {}),
                    ...(linkInput.campaignId ? { campaignId: linkInput.campaignId } : {}),
                  }),
              },
            },
          );
        } else {
          // `start_fresh` or a missing-fields create: full pre-fill from
          // the card answers plus the routing note's question and the
          // pack (branch timezone + saved competitors). Unbound
          // fields return the named missing set — never an invented scope.
          // The timezone scope binds the same branch resolution the
          // payload uses (uuid answer, unique name, or single-branch
          // auto-bind); ambiguity falls back to the org default, never a
          // guess.
          const packBranch = resolveWatchBranchId(branchRows, branchAnswer);
          const pack = await resolveWatchPrefillPack({
            supabase: context.supabase,
            organizationId,
            ...(packBranch.ok ? { branchId: packBranch.branchId } : {}),
            threadId: rawParams.threadId,
            correlationId,
          });
          const prepared = prepareWatchCreate(
            {
              ...(question ? { question } : {}),
              ...(answers["frequency"] ? { cadence: answers["frequency"] } : {}),
              ...(branchAnswer ? { branch: branchAnswer } : {}),
              ...(answers["research_area"] ? { researchArea: answers["research_area"] } : {}),
              ...(answers["competitors"] ? { competitorName: answers["competitors"] } : {}),
              ...(answers["end_date"] ? { endDate: answers["end_date"] } : {}),
            },
            { branchRows, pack },
          );
          if (!prepared.ok) {
            watchChoice = {
              outcome: "needs_input",
              missing: prepared.missing,
              copy: prepared.copy,
            };
          } else {
            const watchKey = buildThreadIdempotencyKey(
              rawParams.threadId,
              `${answerDigest}:watch-answer`,
            );
            const createSeams = {
              watchProjects: {
                listActive: async () => siblings,
                createKeyed: (input: {
                  organizationId: string;
                  branchId: string;
                  title: string;
                  question: string;
                  mode: "one-time" | "recurring";
                  schedule?: z.infer<typeof researchProjectScheduleSchema>;
                  actorId: string;
                  idempotencyKey: string;
                  scopeFingerprint: string;
                }) => projects.createProject(input),
              },
              links: {
                setThreadLinks: (linkInput: {
                  organizationId: string;
                  actorId: string;
                  threadId: string;
                  projectId: string;
                  requestId?: string;
                  draftRequestId?: string;
                  campaignId?: string;
                }) =>
                  service.setThreadLinks({
                    organizationId: linkInput.organizationId,
                    actorId: linkInput.actorId,
                    role: context.membership.role,
                    threadId: linkInput.threadId,
                    ...(linkInput.projectId ? { projectId: linkInput.projectId } : {}),
                    ...(linkInput.requestId ? { requestId: linkInput.requestId } : {}),
                    ...(linkInput.draftRequestId
                      ? { draftRequestId: linkInput.draftRequestId }
                      : {}),
                    ...(linkInput.campaignId ? { campaignId: linkInput.campaignId } : {}),
                  }),
              },
            };
            watchChoice =
              rawChoice === "start_fresh"
                ? await requestWatchFromChoice(
                    {
                      organizationId,
                      actorId: context.user.id,
                      threadId: rawParams.threadId,
                      idempotencyKey: watchKey,
                      choice: "start_fresh",
                      permissions: permissionsForRole(context.membership.role),
                      prepared: prepared.payload,
                      assumptions: prepared.assumptions,
                      candidateProjectId: candidate,
                      existingLinks,
                    },
                    createSeams,
                  )
                : await createPreparedWatch(
                    {
                      organizationId,
                      actorId: context.user.id,
                      threadId: rawParams.threadId,
                      idempotencyKey: watchKey,
                      permissions: permissionsForRole(context.membership.role),
                      prepared: prepared.payload,
                      assumptions: prepared.assumptions,
                      existingLinks,
                    },
                    createSeams,
                  );
            if (watchChoice.outcome === "created" || watchChoice.outcome === "replayed") {
              await createEventPublisher().publish({
                organizationId,
                eventId: crypto.randomUUID(),
                eventName: "agent_thread.watch_created",
                occurredAt: new Date().toISOString(),
                actorType: "user",
                actorId: context.user.id,
                correlationId,
                schemaVersion: 1,
                payload: {
                  threadId: rawParams.threadId,
                  projectId: watchChoice.projectId,
                  idempotencyKey: watchKey,
                  outcome: watchChoice.outcome,
                },
              });
            }
          }
        }
      }
      logger.info("agent_thread.watch_choice_resolved", {
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
        ...(watchChoice ? { watchChoice } : {}),
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
