import { z } from "zod";

import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { routeAgentMessage } from "@/modules/agent-router/application/router-service";
import { createAgentContextReaders } from "@/modules/agent-chat/application/api";
import { threadRouteParamsSchema } from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";
import {
  answerDraftSchema,
  buildAnswerIdempotencyKey,
  buildFallbackAnswer,
  buildSynthesisPrompt,
  createAnswerSynthesizer,
  encodeAnswerBody,
  synthesisCandidateSchema,
  type AnswerDraft,
} from "@/modules/agent-chat/application/answer-writer";
import type { ContextPack } from "@/modules/agent-chat/application/context-pack";
import { resolvePackContextDigest } from "@/modules/agent-chat/application/executors";
import {
  permissionsForRole,
  routingContextDigest,
} from "@/modules/agent-chat/application/thread-service";
import {
  createThreadRepository,
  type ThreadMode,
} from "@/modules/agent-chat/infrastructure/thread-repository";

/**
 * Agent thread SSE stream route (ADR 0072, spec section 4).
 *
 * GET opens one server-sent-events connection per thread. The server picks
 * the model by the thread's tier (Quick → `AI_ANSWER_MODEL`, DeepThink →
 * `AI_ANSWER_STRONG_MODEL`, via the Task 1 `createAnswerSynthesizer`
 * seam — null without config stays the honest fallback), forwards body
 * tokens as frames, validates the full candidate through the existing
 * strict synthesis schema at stream end, and persists the encoded durable
 * assistant row under the existing nonce-derived idempotency key, so
 * retries replay instead of double-posting.
 *
 * Streaming is transport only: durable rows stay the system of record.
 * Reconnects and reopens read durable rows, never resume dead streams.
 * Viewers stream read-only (draft, no stored row); conflicting or failed
 * appends degrade to draft-only rather than failing the stream.
 */

// ---------------------------------------------------------------------------
// Frame protocol (Task 4 consumes this verbatim — field names, order, close)
// ---------------------------------------------------------------------------
//
// Request:
//
//   GET /api/organizations/:organizationId/agent/threads/:threadId/stream
//       ?messageId=<user-message-uuid>&page=<page-key>
//   Accept: text/event-stream
//
//   `messageId` is optional; without it the newest user message is
//   answered. `page` defaults to `overview` (same 1-120 rule as the
//   classify-only route).
//
// Response headers: `Content-Type: text/event-stream`,
// `Cache-Control: no-store`, `Connection: keep-alive`, plus
// `x-correlation-id` (same correlation-id pattern as the sibling routes).
//
// Frames, in this exact order — zero or more `token`, exactly one `done`,
// exactly one `end` — then the server closes the connection:
//
//   event: token
//   data: {"text":"<body chunk>"}
//
//   event: done
//   data: [DONE]
//
//   event: end
//   data: {"messageId":...,"replayed":...,"fallback":...,"reason":...,
//           "draft":{"body":...,"citations":[...],"limitations":[...],
//                    "estimates":[{"label":"Estimate","value":...,
//                                  "inputs":[...],"assumptions":[...]}]},
//           "correlationId":"..."}
//
// Rules the drawer can rely on:
//
// - Every `token` data line is JSON `{"text": <non-empty string>}`. The
//   chunks arrive in order; joining every `text` with `""` reproduces the
//   streamed body preview.
// - `done` carries the literal `[DONE]` (no JSON). It means the token
//   stream is complete; the `end` frame follows immediately.
// - `end` carries the validated end payload (schema below). `draft` is
//   the same content the server persisted (when `messageId` is non-null)
//   and always validates through `answerDraftSchema`.
// - `messageId` is the durable assistant row id, or null for viewers and
//   for conflicting/failed appends (draft-only). `replayed` is true when
//   the idempotency key replayed a kept row.
// - `fallback` with its `reason` names the honest path taken:
//   `not_configured` (tier unconfigured), `timeout` (15 s synthesis
//   budget), `invalid_candidate` (model text failed strict validation and
//   was discarded), `synthesis_failed` (model threw), `append_conflict`
//   (valid draft, row not stored). A null `reason` means a model draft.
// - On an invalid candidate the already-forwarded tokens stay on the
//   wire; the client discards them and renders the fallback `draft` from
//   `end` instead — the same swap it performs on every stream.
// - On a transport drop before `done`, the client keeps its partial text
//   with a "stopped here" note and reads the durable row on reconnect.
//   The server never resumes a dead stream.
// - Errors before the first frame (auth, tenancy, validation) return the
//   sibling JSON error shape, never a half-open stream.

export const STREAM_EVENT_TOKEN = "token";
export const STREAM_EVENT_DONE = "done";
export const STREAM_EVENT_END = "end";
/** Done-marker payload: literal, never JSON. */
export const STREAM_DONE_DATA = "[DONE]";
/** Synthesis budget per stream (spec: 15 s timeouts, fail-closed fallback). */
export const STREAM_SYNTHESIS_TIMEOUT_MS = 15_000;
/** Token-frame target width; slices keep join("") === body exact. */
const STREAM_TOKEN_WIDTH = 48;
const STREAM_MAX_TOKENS = 2000;

export const streamQuerySchema = z
  .object({
    messageId: z.string().uuid().optional(),
    page: z.string().trim().min(1).max(120).default("overview"),
  })
  .strict();
export type StreamQuery = z.infer<typeof streamQuerySchema>;

export const streamTokenFrameSchema = z.object({ text: z.string().min(1).max(4096) }).strict();
export type StreamTokenFrame = z.infer<typeof streamTokenFrameSchema>;

export const streamFallbackReasonSchema = z.enum([
  "not_configured",
  "timeout",
  "invalid_candidate",
  "synthesis_failed",
  "append_conflict",
]);
export type StreamFallbackReason = z.infer<typeof streamFallbackReasonSchema>;

export const streamEndPayloadSchema = z
  .object({
    messageId: z.string().min(1).nullable(),
    replayed: z.boolean(),
    fallback: z.boolean(),
    reason: streamFallbackReasonSchema.nullable(),
    draft: answerDraftSchema,
    correlationId: z.string().uuid(),
  })
  .strict();
export type StreamEndPayload = z.infer<typeof streamEndPayloadSchema>;

// ---------------------------------------------------------------------------
// Stream source seam (model call; tests inject, production uses the tier seam)
// ---------------------------------------------------------------------------

export type AgentStreamSourceArgs = {
  system: string;
  prompt: string;
  /** Allowed citation ids — the only ids the candidate may cite. */
  sourceIds: string[];
  mode: ThreadMode;
  correlationId: string;
  signal: AbortSignal;
};

export type AgentStreamSourceResult = {
  /** Body chunks forwarded live, in order. */
  tokens: Iterable<string> | AsyncIterable<string>;
  /** Full model candidate, validated at stream end. Unknown until then. */
  candidate: unknown;
};

export type AgentStreamSource = (
  args: AgentStreamSourceArgs,
) => Promise<AgentStreamSourceResult>;

type StreamRouteTestSeams = {
  /** Injected model call; the tier-selected synthesizer when absent. */
  source?: AgentStreamSource;
  /** Synthesis budget override (tests use milliseconds, never 15 s). */
  timeoutMs?: number;
};

let testSeams: StreamRouteTestSeams | null = null;

/** Test-only seam injection. Production always passes no seams. */
export function setStreamRouteTestSeams(seams: StreamRouteTestSeams): void {
  testSeams = seams;
}

/** Test-only seam reset. */
export function clearStreamRouteTestSeams(): void {
  testSeams = null;
}

class StreamTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new StreamTimeoutError(`Stream synthesis timed out after ${ms}ms.`));
    }, ms);
  });
  const guarded = Promise.race([promise, timeout]);
  return guarded.finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Deterministic body chunking: fixed-width slices so joining every frame's
 * `text` with `""` reproduces the body byte-for-byte.
 */
export function chunkBodyText(body: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < body.length; index += STREAM_TOKEN_WIDTH) {
    chunks.push(body.slice(index, index + STREAM_TOKEN_WIDTH));
  }
  return chunks;
}

/** Bounds an injected token iterable: skips junk, caps count and width. */
async function collectStreamTokens(
  tokens: Iterable<string> | AsyncIterable<string>,
): Promise<string[]> {
  const collected: string[] = [];
  for await (const token of tokens) {
    if (typeof token !== "string" || token.length === 0) continue;
    collected.push(token.slice(0, 4096));
    if (collected.length >= STREAM_MAX_TOKENS) break;
  }
  return collected;
}

const STREAM_FALLBACK_TEXT = {
  not_configured: "Answer synthesis is not configured; using stored context only.",
  timeout: "Answer synthesis timed out; using stored context only.",
  invalid_candidate: "The drafted answer failed validation; using stored context only.",
  synthesis_failed: "Answer synthesis failed; using stored context only.",
} as const;

/**
 * End-of-stream disposal (writeAnswer parity, streaming-shaped). The strict
 * candidate schema stays the gate — realized-result fields are still
 * unrepresentable — citations filter to pack sources with the
 * writer-stamped digest, and any failure returns null so the caller falls
 * back honestly instead of inventing.
 */
function disposeStreamCandidate(
  raw: unknown,
  pack: ContextPack | null,
): AnswerDraft | null {
  const candidate = synthesisCandidateSchema.safeParse(raw);
  if (!candidate.success) return null;
  try {
    const allowed = new Set(pack?.sources ?? []);
    const citations: AnswerDraft["citations"] = [];
    const dropped: string[] = [];
    for (const citation of candidate.data.citations) {
      if (allowed.has(citation.sourceId)) {
        citations.push({ ...citation, digest: pack?.digest ?? "unbound-context" });
      } else {
        dropped.push(citation.sourceId);
      }
    }
    const limitations = [...candidate.data.limitations];
    if (pack?.refused) {
      limitations.push(
        "Organization context was refused as oversized; cited facts are withheld.",
      );
    }
    if (dropped.length > 0) {
      limitations.push(
        `Dropped ${dropped.length} citation(s) outside the context pack (${dropped.slice(0, 5).join(", ")}); the claims stay ungrounded.`,
      );
    }
    if (citations.length === 0 && allowed.size > 0) {
      limitations.push(
        "No pack-grounded citations survived validation; treat claims as ungrounded.",
      );
    }
    limitations.push(
      "No new research ran for this answer; it uses stored organization context only.",
    );
    return answerDraftSchema.parse({
      body: candidate.data.body,
      citations,
      limitations: limitations.slice(0, 60),
      estimates: candidate.data.estimates,
    });
  } catch {
    return null;
  }
}

type StreamSynthesis = {
  /** Tokens to forward live, in order. */
  forwardedTokens: string[];
  /** Validated model draft or honest fallback — persisted and sent in `end`. */
  draft: AnswerDraft;
  fallback: boolean;
  reason: StreamFallbackReason | null;
};

/**
 * Tier-selected synthesis for one stream. Reuses the Task 1 seam — never
 * reimplements tier selection: `createAnswerSynthesizer({ mode })` returns
 * null without config for that tier, and the route takes the fallback with
 * zero provider calls. The injected source (tests) replaces the model call
 * only; end-of-stream validation stays in this module either way.
 */
async function runStreamSynthesis(input: {
  pack: ContextPack | null;
  routingNote: string;
  mode: ThreadMode;
  correlationId: string;
  timeoutMs: number;
}): Promise<StreamSynthesis> {
  const override = testSeams?.source ?? null;
  const synthesize = override ? null : createAnswerSynthesizer({ mode: input.mode });
  if (!override && synthesize === null) {
    const draft = buildFallbackAnswer(
      input.pack,
      STREAM_FALLBACK_TEXT.not_configured,
    );
    return {
      forwardedTokens: chunkBodyText(draft.body),
      draft,
      fallback: true,
      reason: "not_configured",
    };
  }
  if (!override && input.pack === null) {
    const draft = buildFallbackAnswer(null, "No context pack was bound to this answer.");
    return {
      forwardedTokens: chunkBodyText(draft.body),
      draft,
      fallback: true,
      reason: "not_configured",
    };
  }
  const built = input.pack
    ? buildSynthesisPrompt(input.pack, input.routingNote, input.mode)
    : { system: "unbound-context", prompt: input.routingNote };
  const sourceIds = input.pack?.sources ?? [];
  const timeoutMs = input.timeoutMs;
  try {
    const result = override
      ? await withTimeout(
          override({
            system: built.system,
            prompt: built.prompt,
            sourceIds,
            mode: input.mode,
            correlationId: input.correlationId,
            signal: AbortSignal.timeout(timeoutMs),
          }),
          timeoutMs,
        )
      : await withTimeout(
          synthesize!({
            system: built.system,
            prompt: built.prompt,
            sourceIds,
            mode: input.mode,
            correlationId: input.correlationId,
          }),
          timeoutMs,
        ).then((candidate) => ({ tokens: [], candidate }));
    const forwardedTokens = override ? await collectStreamTokens(result.tokens) : [];
    const draft = disposeStreamCandidate(result.candidate, input.pack);
    if (!draft) {
      const fallback = buildFallbackAnswer(
        input.pack,
        STREAM_FALLBACK_TEXT.invalid_candidate,
      );
      return {
        forwardedTokens,
        draft: fallback,
        fallback: true,
        reason: "invalid_candidate",
      };
    }
    return {
      forwardedTokens: override ? forwardedTokens : chunkBodyText(draft.body),
      draft,
      fallback: false,
      reason: null,
    };
  } catch (error) {
    const reason: StreamFallbackReason =
      error instanceof StreamTimeoutError ? "timeout" : "synthesis_failed";
    const fallback = buildFallbackAnswer(
      input.pack,
      STREAM_FALLBACK_TEXT[reason],
    );
    return {
      // A discarded model call streams nothing; a failed default call still
      // streams its honest fallback body.
      forwardedTokens: override ? [] : chunkBodyText(fallback.body),
      draft: fallback,
      fallback: true,
      reason,
    };
  }
}

function sseFrame(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

export async function GET(
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

    const query = streamQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const page = query.page;

    const threads = createThreadRepository(agentPersistenceFor(context.supabase));
    const thread = await threads.getThread({
      organizationId,
      threadId: rawParams.threadId,
    });
    if (!thread) {
      throw new DomainError(
        "TENANT_SCOPE_ERROR",
        "This chat was not found in your organization.",
      );
    }
    const candidateMessage = query.messageId
      ? await threads.getMessage({ organizationId, messageId: query.messageId })
      : await threads.latestUserMessage({ organizationId, threadId: thread.id });
    if (
      !candidateMessage ||
      candidateMessage.threadId !== thread.id ||
      candidateMessage.role !== "user" ||
      !candidateMessage.body
    ) {
      throw new DomainError("DOMAIN_ERROR", "This chat has no readable message to answer.");
    }
    const userMessageId = candidateMessage.id;
    const userMessageBody: string = candidateMessage.body;

    // HEAVY pack when the readers resolve; null honestly (same fallback the
    // classify-only path takes without readers) when they refuse or throw.
    let pack: ContextPack | null = null;
    let contextDigest: string;
    try {
      const resolved = await resolvePackContextDigest({
        organizationId,
        userId: context.user.id,
        windowDays: 30,
        page,
        readers: createAgentContextReaders(context.supabase),
      });
      pack = resolved.pack;
      contextDigest = resolved.digest;
    } catch {
      pack = null;
      contextDigest = routingContextDigest({
        organizationId,
        threadId: thread.id,
        messageId: userMessageId,
      });
    }

    // Deterministic routing note for the synthesis prompt: the live router
    // output with no model proposal (fail-closed answer_memory), so this
    // route spends exactly one model call — the answer itself.
    let routingNote: string;
    try {
      routingNote = routeAgentMessage({
        text: userMessageBody,
        page,
        role: context.membership.role,
        permissions: permissionsForRole(context.membership.role),
        contextDigest,
        activeWatches: [],
        threadMode: thread.mode,
        model: { kind: "live" },
      }).routingNote;
    } catch {
      routingNote = `stream answer (page=${page})`;
    }

    const timeoutMs = testSeams?.timeoutMs ?? STREAM_SYNTHESIS_TIMEOUT_MS;
    const synthesis = await runStreamSynthesis({
      pack,
      routingNote,
      mode: thread.mode,
      correlationId,
      timeoutMs,
    });
    logger.info("agent_stream.synthesized", {
      organizationId,
      threadId: thread.id,
      messageId: userMessageId,
      correlationId,
    });

    // Capture server-owned values for the stream closure.
    const orgId = organizationId;
    const actorId = context.user.id;
    const threadId = thread.id;
    const role = context.membership.role;
    const endCorrelationId = correlationId;
    const answerKey = buildAnswerIdempotencyKey({
      threadId,
      messageId: userMessageId,
      body: userMessageBody,
    });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!request.signal.aborted) {
            for (const token of synthesis.forwardedTokens) {
              if (request.signal.aborted) break;
              const frame = streamTokenFrameSchema.safeParse({ text: token });
              if (frame.success) {
                controller.enqueue(sseFrame(STREAM_EVENT_TOKEN, JSON.stringify(frame.data)));
              }
            }
          }
          if (!request.signal.aborted) {
            controller.enqueue(sseFrame(STREAM_EVENT_DONE, STREAM_DONE_DATA));
          }
          // Durable end-persist under the existing thread-linked answer key:
          // retries replay the kept row. Viewers stream read-only (ADR 0072:
          // viewer routes synthesize without persisting), and a conflicting
          // or failed append degrades to draft-only — never a failed stream.
          let messageId: string | null = null;
          let replayed = false;
          let reason = synthesis.reason;
          if (!request.signal.aborted && role !== "viewer") {
            try {
              const appended = await threads.appendMessageKeyed({
                organizationId: orgId,
                actorId,
                threadId,
                role: "assistant",
                body: encodeAnswerBody(synthesis.draft),
                idempotencyKey: answerKey,
              });
              const kept = await threads.getMessage({
                organizationId: orgId,
                messageId: appended.messageId,
              });
              messageId = kept?.id ?? appended.messageId;
              replayed = appended.replayed;
            } catch (error) {
              logger.warn("agent_stream.answer_append_failed", {
                organizationId: orgId,
                threadId,
                messageId: userMessageId,
                correlationId: endCorrelationId,
                errorCode: error instanceof Error ? error.name : "unknown",
              });
              messageId = null;
              replayed = false;
              if (reason === null) reason = "append_conflict";
            }
          }
          const endPayload = streamEndPayloadSchema.parse({
            messageId,
            replayed,
            fallback: synthesis.fallback,
            reason,
            draft: synthesis.draft,
            correlationId: endCorrelationId,
          });
          if (!request.signal.aborted) {
            controller.enqueue(
              sseFrame(STREAM_EVENT_END, JSON.stringify(endPayload)),
            );
          }
        } catch {
          // Last resort: never leave the drawer hanging on a half-open
          // stream — close with an honest fallback end payload.
          try {
            const fallback = buildFallbackAnswer(
              pack,
              STREAM_FALLBACK_TEXT.synthesis_failed,
            );
            const endPayload = streamEndPayloadSchema.parse({
              messageId: null,
              replayed: false,
              fallback: true,
              reason: "synthesis_failed" as const,
              draft: fallback,
              correlationId: endCorrelationId,
            });
            controller.enqueue(sseFrame(STREAM_EVENT_END, JSON.stringify(endPayload)));
          } catch {
            // The controller closes below regardless.
          }
        }
        controller.close();
      },
    });
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "x-correlation-id": correlationId,
    });
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    logger.warn("agent_stream.failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
