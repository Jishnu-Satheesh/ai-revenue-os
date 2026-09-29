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
  ANSWER_MODEL_MAX_OUTPUT_TOKENS,
  ANSWER_MODEL_TEMPERATURE,
  answerDraftSchema,
  buildAnswerIdempotencyKey,
  buildFallbackAnswer,
  buildSynthesisPrompt,
  encodeAnswerBody,
  resolveAnswerModelId,
  synthesisCandidateSchema,
  synthesisFailureIds,
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
 * GET opens one server-sent-events connection per thread. Headers flush as
 * soon as the local work (auth, thread lookup, context pack, routing note)
 * is done; the first `token` frame flushes with the first model delta, so
 * time-to-first-token tracks synthesis rather than waiting for it. The
 * server picks the model by the thread's tier (Quick → `AI_ANSWER_MODEL`,
 * DeepThink → `AI_ANSWER_STRONG_MODEL`, resolved through the Task 1
 * `resolveAnswerModelId` seam — null without config stays the honest
 * fallback), streams the answer body with `streamObject` against the Task 1
 * `synthesisCandidateSchema`, validates the full candidate through the
 * existing strict synthesis disposal at stream end, and persists the
 * encoded durable assistant row under the existing nonce-derived
 * idempotency key, so retries replay instead of double-posting.
 *
 * Task 1's `answer-writer` contract is fixed (buffered `generateObject`);
 * the streaming provider call lives in this module and reuses Task 1's
 * prompt assembly, temperature, and strict end-validation. One model call
 * per stream. The client abort signal plus the 15 s synthesis budget feed
 * the provider call, so a disconnect stops paying for generation.
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
//   streamed body preview. Production slices streamed body text into
//   fixed-width frames; injected test sources forward verbatim.
// - When `end` carries `fallback: false`, the joined preview equals the
//   `end` draft body (trim-tolerant — both schemas trim bodies). This
//   holds by contract: the route discards the preview and falls back when
//   the streamed text diverges from the validated draft, so a mismatch can
//   never ride a model-draft `end`.
// - `done` carries the literal `[DONE]` (no JSON). It means the token
//   stream is complete; the `end` frame follows immediately.
// - `end` carries the validated end payload (schema below). `draft` is
//   the same content the server persisted (when `messageId` is non-null)
//   and always validates through `answerDraftSchema`.
// - `messageId` is the durable assistant row id (uuid), or null for viewers and
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
    messageId: z.string().uuid().nullable(),
    replayed: z.boolean(),
    fallback: z.boolean(),
    reason: streamFallbackReasonSchema.nullable(),
    draft: answerDraftSchema,
    correlationId: z.string().uuid(),
  })
  .strict();
export type StreamEndPayload = z.infer<typeof streamEndPayloadSchema>;

// ---------------------------------------------------------------------------
// Stream source seam (model call; tests inject, production streams below)
// ---------------------------------------------------------------------------

export type AgentStreamSourceArgs = {
  system: string;
  prompt: string;
  /** Allowed citation ids — the only ids the candidate may cite. */
  sourceIds: string[];
  mode: ThreadMode;
  correlationId: string;
  /**
   * Combined client-abort + synthesis-budget signal. Aborts on disconnect
   * or when the budget expires; sources that ignore it are still bounded
   * by the route's timeout race.
   */
  signal: AbortSignal;
};

export type AgentStreamSourceResult = {
  /**
   * Body-text deltas forwarded live, in order. Consumed incrementally —
   * each delta enqueues as it arrives, before `candidate` resolves.
   */
  deltas: Iterable<string> | AsyncIterable<string>;
  /**
   * Full model candidate, validated at stream end. May defer past the
   * first flush: the route forwards deltas first and awaits this after.
   */
  candidate: unknown | Promise<unknown>;
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

/** The client went away mid-stream: close quietly, never a fallback `end`. */
class StreamDisconnectedError extends Error {
  constructor() {
    super("Stream client disconnected.");
    this.name = "StreamDisconnectedError";
  }
}

/** A provider rejection shaped like end-validation failure, not transport. */
class StreamInvalidCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamInvalidCandidateError";
  }
}

/** The tier has no model (or no credential): honest fallback, zero provider calls. */
class StreamNotConfiguredError extends Error {
  constructor() {
    super("Answer synthesis is not configured; using stored context only.");
    this.name = "StreamNotConfiguredError";
  }
}

/** Provider validation-shaped failures (AI SDK type-validation errors). */
function isValidationShaped(error: unknown): boolean {
  return error instanceof Error && /valid/i.test(error.name);
}

/**
 * Bounds one model phase by the synthesis budget and the client
 * connection: rejects with `StreamTimeoutError` on budget expiry and
 * `StreamDisconnectedError` on disconnect, whichever happens first. A
 * source that ignores its abort signal is still bounded here.
 */
function raceStreamPhase<T>(
  promise: Promise<T>,
  timeoutMs: number,
  requestSignal: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new StreamTimeoutError(`Stream synthesis timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  const disconnect = new Promise<never>((_, reject) => {
    if (requestSignal.aborted) {
      reject(new StreamDisconnectedError());
    } else {
      requestSignal.addEventListener(
        "abort",
        () => reject(new StreamDisconnectedError()),
        { once: true },
      );
    }
  });
  return Promise.race([promise, timeout, disconnect]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Client-disconnect + synthesis-budget signal for one stream. The provider
 * call aborts on either, so a disconnect stops paying for generation;
 * `didTimeout` tells the disposal whether an abort was the budget.
 */
function armStreamBudget(
  requestSignal: AbortSignal,
  ms: number,
): { signal: AbortSignal; didTimeout: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onDisconnect = () => controller.abort();
  if (requestSignal.aborted) {
    controller.abort();
  } else {
    requestSignal.addEventListener("abort", onDisconnect, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeout: () => expired,
    dispose: () => {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", onDisconnect);
    },
  };
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

/**
 * Body-text suffixes of successive `streamObject` partials. Partials are
 * cumulative prefixes, so each suffix is new preview text; joining every
 * suffix reproduces the model's body exactly — the same text the
 * validated end object carries, which is what makes the preview/draft
 * join contract hold structurally on the production path.
 */
async function* bodyTextDeltas(
  partials: AsyncIterable<{ body?: string | null | undefined } | null | undefined>,
): AsyncGenerator<string> {
  let forwarded = 0;
  for await (const partial of partials) {
    const body = typeof partial?.body === "string" ? partial.body : "";
    if (body.length > forwarded) {
      yield body.slice(forwarded);
      forwarded = body.length;
    }
  }
}

type ForwardedPreview = {
  /** Preview text actually put on the wire, in order. */
  text: string;
  /** True when the frame cap stopped forwarding (the preview is a prefix). */
  truncated: boolean;
};

/**
 * Forwards one delta stream as `token` frames, incrementally — each frame
 * enqueues as its delta arrives, so time-to-first-token tracks the first
 * model delta rather than the full synthesis. Junk is skipped, every frame
 * validates through `streamTokenFrameSchema`, and forwarding stops at
 * `STREAM_MAX_TOKENS` frames on every path while the stream keeps
 * draining underneath.
 *
 * `sliceWidth` controls granularity: the production provider path slices
 * streamed body text into fixed-width frames; injected sources forward
 * verbatim (one frame per delta) so tests observe exactly what they sent.
 */
async function forwardStreamDeltas(input: {
  deltas: Iterable<string> | AsyncIterable<string>;
  sliceWidth: number | null;
  controller: ReadableStreamDefaultController<Uint8Array>;
  isAborted: () => boolean;
}): Promise<ForwardedPreview> {
  let text = "";
  let frames = 0;
  let truncated = false;
  for await (const delta of input.deltas) {
    if (input.isAborted()) break;
    if (typeof delta !== "string" || delta.length === 0) continue;
    const pieces =
      input.sliceWidth === null
        ? [delta.slice(0, 4096)]
        : chunkBodyText(delta);
    for (const piece of pieces) {
      if (input.isAborted()) break;
      if (frames >= STREAM_MAX_TOKENS) {
        truncated = true;
        break;
      }
      const frame = streamTokenFrameSchema.safeParse({ text: piece });
      if (!frame.success) continue;
      input.controller.enqueue(sseFrame(STREAM_EVENT_TOKEN, JSON.stringify(frame.data)));
      text += piece;
      frames += 1;
    }
  }
  return { text, truncated };
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

/** Resolved synthesis for one stream: persisted and sent in `end`. */
type StreamOutcome = {
  /** Validated model draft or honest fallback — persisted and sent in `end`. */
  draft: AnswerDraft;
  fallback: boolean;
  reason: StreamFallbackReason | null;
};

type StreamSynthesis = StreamOutcome;

/**
 * Output-token budget for the streaming answer call — aliased to Task 1's
 * `ANSWER_MODEL_MAX_OUTPUT_TOKENS` (see its comment for the 8192
 * accounting), so the buffered and streaming paths stay in step by
 * construction instead of by matching magic numbers.
 */
const STREAM_MAX_OUTPUT_TOKENS = ANSWER_MODEL_MAX_OUTPUT_TOKENS;

function readAnswerApiKey(): string | undefined {
  // Same rule as Task 1 (light-model-provider precedent): reads
  // `process.env` directly to stay path-limited; empty counts as
  // unconfigured.
  const raw = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";
  return raw.length > 0 ? raw : undefined;
}

/**
 * One streaming model call for the stream route, built here — Task 1's
 * `answer-writer` contract (buffered `generateObject`) stays fixed.
 * Reuses Task 1's tier resolution (`resolveAnswerModelId`: Quick →
 * `AI_ANSWER_MODEL`, DeepThink/ideas → `AI_ANSWER_STRONG_MODEL`), prompt
 * assembly (`buildSynthesisPrompt`), temperature, output budget, and the
 * strict candidate schema (`streamObject`, then `disposeStreamCandidate`
 * for digest stamping at stream end). Returns null without a credential
 * or without a model id for the tier, so the caller takes the honest
 * fallback with zero provider calls — null-without-config preserved.
 */
async function streamModelAnswer(input: {
  pack: ContextPack;
  system: string;
  prompt: string;
  mode: ThreadMode;
  signal: AbortSignal;
}): Promise<{ deltas: AsyncIterable<string>; candidate: Promise<unknown> } | null> {
  const apiKey = readAnswerApiKey();
  const modelId = resolveAnswerModelId(input.mode);
  if (!apiKey || !modelId) return null;
  // Lazy: the provider SDKs load only on the server path that actually
  // synthesizes (answer-writer precedent keeps assistants client-safe).
  const { streamObject } = await import("ai");
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const google = createGoogleGenerativeAI({ apiKey });
  const result = streamObject({
    model: google(modelId),
    schema: synthesisCandidateSchema,
    system: input.system,
    prompt: input.prompt,
    temperature: ANSWER_MODEL_TEMPERATURE,
    maxOutputTokens: STREAM_MAX_OUTPUT_TOKENS,
    abortSignal: input.signal,
  });
  return {
    deltas: bodyTextDeltas(result.partialObjectStream),
    candidate: result.object.then(
      (value) => value,
      (error: unknown) => {
        if (isValidationShaped(error)) {
          throw new StreamInvalidCandidateError(
            "The streamed answer failed end validation; using stored context only.",
          );
        }
        throw error;
      },
    ),
  };
}

type StreamLogContext = {
  organizationId: string;
  threadId: string;
  /** The answered user message — the only message id known at log time. */
  messageId: string;
  correlationId: string;
};

/** Reason-carrying fallback log: operators can tell model vs fallback drafts. */
function logStreamFallback(
  logContext: StreamLogContext,
  reason: StreamFallbackReason,
): void {
  // `refusalCode` is the allowlisted stable-reason-code field: every
  // stream reason is platform-minted, never tenant or model text.
  logger.info("agent_stream.fallback", { ...logContext, refusalCode: reason });
}

/** Validation failures are operator-visible, not silent. */
function logInvalidCandidate(logContext: StreamLogContext): void {
  logger.warn("agent_stream.candidate_invalid", {
    ...logContext,
    refusalCode: "invalid_candidate",
  });
}

/**
 * Tier-selected synthesis for one stream. Fallback bodies forward their
 * chunked tokens immediately inside the open stream; model paths forward
 * deltas incrementally while the candidate stays deferred. The whole model
 * phase runs under one budget/disconnect race: the first delta sets
 * time-to-first-token, and end-validation plus the durable append still
 * gate only `end`.
 *
 * The preview/draft join contract is enforced here, not by source
 * convention: a validated draft whose body diverges from the forwarded
 * preview (trim-tolerant — both schemas trim bodies) degrades to the
 * named `invalid_candidate` fallback, so a mismatch can never ride a
 * model-draft `end`. A truncated preview (frame cap hit) skips the check:
 * the cap only binds pathological sources, and the `end` draft stays
 * authoritative. Disconnects throw `StreamDisconnectedError` so the
 * caller closes quietly instead of ending for nobody.
 */
async function runStreamingSynthesis(input: {
  pack: ContextPack | null;
  routingNote: string;
  mode: ThreadMode;
  correlationId: string;
  timeoutMs: number;
  requestSignal: AbortSignal;
  budgetSignal: AbortSignal;
  didTimeout: () => boolean;
  controller: ReadableStreamDefaultController<Uint8Array>;
  logContext: StreamLogContext;
}): Promise<StreamSynthesis> {
  const override = testSeams?.source ?? null;
  const readyFallback = (
    draft: AnswerDraft,
    reason: StreamFallbackReason,
  ): StreamSynthesis => {
    const forwardedTokens = chunkBodyText(draft.body);
    if (!input.requestSignal.aborted) {
      for (const token of forwardedTokens) {
        if (input.requestSignal.aborted) break;
        const frame = streamTokenFrameSchema.safeParse({ text: token });
        if (frame.success) {
          input.controller.enqueue(sseFrame(STREAM_EVENT_TOKEN, JSON.stringify(frame.data)));
        }
      }
    }
    logStreamFallback(input.logContext, reason);
    return { draft, fallback: true, reason };
  };

  if (!override && input.pack === null) {
    const draft = buildFallbackAnswer(null, "No context pack was bound to this answer.");
    return readyFallback(draft, "not_configured");
  }
  const built = input.pack
    ? buildSynthesisPrompt(input.pack, input.routingNote, input.mode)
    : { system: "unbound-context", prompt: input.routingNote };
  const sourceIds = input.pack?.sources ?? [];

  try {
    const live = override
      ? await raceStreamPhase(
          override({
            system: built.system,
            prompt: built.prompt,
            sourceIds,
            mode: input.mode,
            correlationId: input.correlationId,
            signal: input.budgetSignal,
          }).then((result) => ({
            deltas: result.deltas,
            candidate: Promise.resolve(result.candidate),
            sliceWidth: null as number | null,
          })),
          input.timeoutMs,
          input.requestSignal,
        )
      : await (async (): Promise<{
          deltas: Iterable<string> | AsyncIterable<string>;
          candidate: Promise<unknown>;
          sliceWidth: number | null;
        }> => {
          const streamed = await streamModelAnswer({
            pack: input.pack as ContextPack,
            system: built.system,
            prompt: built.prompt,
            mode: input.mode,
            signal: input.budgetSignal,
          });
          if (streamed === null) {
            throw new StreamNotConfiguredError();
          }
          return { ...streamed, sliceWidth: STREAM_TOKEN_WIDTH };
        })();
    const consumed = await raceStreamPhase(
      (async () => {
        const forwarded = await forwardStreamDeltas({
          deltas: live.deltas,
          sliceWidth: live.sliceWidth,
          controller: input.controller,
          isAborted: () => input.requestSignal.aborted,
        });
        const raw = await live.candidate;
        return { ...forwarded, raw };
      })(),
      input.timeoutMs,
      input.requestSignal,
    );
    const draft = disposeStreamCandidate(consumed.raw, input.pack);
    if (!draft) {
      logInvalidCandidate(input.logContext);
      const fallback = buildFallbackAnswer(
        input.pack,
        STREAM_FALLBACK_TEXT.invalid_candidate,
      );
      logStreamFallback(input.logContext, "invalid_candidate");
      return {
        draft: fallback,
        fallback: true,
        reason: "invalid_candidate",
      };
    }
    if (!consumed.truncated && consumed.text.trim() !== draft.body) {
      logInvalidCandidate(input.logContext);
      const fallback = buildFallbackAnswer(
        input.pack,
        STREAM_FALLBACK_TEXT.invalid_candidate,
      );
      logStreamFallback(input.logContext, "invalid_candidate");
      return {
        draft: fallback,
        fallback: true,
        reason: "invalid_candidate",
      };
    }
    logger.info("agent_stream.synthesized", input.logContext);
    return {
      draft,
      fallback: false,
      reason: null,
    };
  } catch (error) {
    if (error instanceof StreamDisconnectedError || input.requestSignal.aborted) {
      throw new StreamDisconnectedError();
    }
    if (error instanceof StreamNotConfiguredError) {
      const draft = buildFallbackAnswer(
        input.pack,
        STREAM_FALLBACK_TEXT.not_configured,
      );
      return readyFallback(draft, "not_configured");
    }
    const reason: StreamFallbackReason =
      error instanceof StreamInvalidCandidateError || isValidationShaped(error)
        ? "invalid_candidate"
        : error instanceof StreamTimeoutError || input.didTimeout()
          ? "timeout"
          : "synthesis_failed";
    if (reason === "invalid_candidate") logInvalidCandidate(input.logContext);
    if (reason === "synthesis_failed") {
      // G4: the provider error name + finishReason distinguish a failed
      // call from an unconfigured tier (`not_configured` stays info-only
      // with no error name). Identifiers only — never bodies or secrets.
      const failure = synthesisFailureIds(error);
      logger.warn("agent_stream.synthesis_failed", {
        ...input.logContext,
        errorName: failure.errorName,
        ...(failure.finishReason ? { errorCode: failure.finishReason } : {}),
      });
    }
    const fallback = buildFallbackAnswer(input.pack, STREAM_FALLBACK_TEXT[reason]);
    logStreamFallback(input.logContext, reason);
    return {
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
    const logContext: StreamLogContext = {
      organizationId,
      threadId: thread.id,
      messageId: userMessageId,
      correlationId,
    };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Headers flush on return below; the first token frame flushes
        // with the first model delta — synthesis runs here, inside the
        // open stream, never before it.
        const budget = armStreamBudget(request.signal, timeoutMs);
        let outcome: StreamSynthesis | null = null;
        try {
          outcome = await runStreamingSynthesis({
            pack,
            routingNote,
            mode: thread.mode,
            correlationId: endCorrelationId,
            timeoutMs,
            requestSignal: request.signal,
            budgetSignal: budget.signal,
            didTimeout: budget.didTimeout,
            controller,
            logContext,
          });
        } catch (error) {
          if (error instanceof StreamDisconnectedError || request.signal.aborted) {
            // Client gone mid-synthesis: close quietly, no `end` for nobody.
            // `outcome` stays null and the tail below closes the stream.
          } else {
            // Defensive: `runStreamingSynthesis` maps every known failure to
            // a fallback outcome, so anything escaping here is unexpected —
            // still end honestly rather than hanging the drawer.
            logger.warn("agent_stream.failed", {
              organizationId: orgId,
              correlationId: endCorrelationId,
              errorCode: toPublicError(error).code,
            });
            outcome = {
              draft: buildFallbackAnswer(pack, STREAM_FALLBACK_TEXT.synthesis_failed),
              fallback: true,
              reason: "synthesis_failed",
            };
            logStreamFallback(logContext, "synthesis_failed");
          }
        }
        try {
          if (!outcome || request.signal.aborted) {
            budget.dispose();
            controller.close();
            return;
          }
          controller.enqueue(sseFrame(STREAM_EVENT_DONE, STREAM_DONE_DATA));
          // Durable end-persist under the existing thread-linked answer key:
          // retries replay the kept row. Viewers stream read-only (ADR 0072:
          // viewer routes synthesize without persisting), and a conflicting
          // or failed append degrades to draft-only — never a failed stream.
          let messageId: string | null = null;
          let replayed = false;
          let reason = outcome.reason;
          if (!request.signal.aborted && role !== "viewer") {
            try {
              const appended = await threads.appendMessageKeyed({
                organizationId: orgId,
                actorId,
                threadId,
                role: "assistant",
                body: encodeAnswerBody(outcome.draft),
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
              if (reason === null) {
                reason = "append_conflict";
                logStreamFallback(logContext, "append_conflict");
              }
            }
          }
          const endPayload = streamEndPayloadSchema.parse({
            messageId,
            replayed,
            fallback: outcome.fallback,
            reason,
            draft: outcome.draft,
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
        budget.dispose();
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
