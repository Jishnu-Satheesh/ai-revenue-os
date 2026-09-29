"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  HistoryIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";

import {
  AgentQuestionnaireCard,
  type QuestionnaireAnswers,
} from "@/components/agent/agent-questionnaire-card";
import { AgentResponseMessage } from "@/components/agent/agent-response-message";
import {
  answerDraftSchema,
  encodeAnswerBody,
} from "@/modules/agent-chat/application/answer-writer";
import {
  AgentCampaignAdvice,
  type CampaignAdviceContext,
  type CampaignAdviceOpportunity,
} from "@/components/agent/agent-campaign-advice";
import type {
  AdviseCampaignSeams,
  IdeaDraftOutcome,
} from "@/modules/agent-chat/application/campaign-advise";
import type { WatchTapOutcome } from "@/modules/agent-chat/application/executors";
import { AgentThreadSteps, type AgentStepPhase } from "@/components/agent/agent-thread-steps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import {
  AGENT_DRAWER_DEFAULT_GEOMETRY,
  AGENT_DRAWER_DEFAULT_HEIGHT_PX,
  AGENT_DRAWER_DEFAULT_WIDTH_PX,
  clampDrawerHeight,
  clampDrawerOffset,
  clampDrawerWidth,
  shouldCollapseDrawerHeight,
  useAgentSidebarOffset,
  type AgentDrawerGeometry,
} from "@/components/agent/agent-placement";
import type { AgentIntent } from "@/domain/agent-router/intents";
import type { RouterRole, QuestionnaireSpec } from "@/domain/agent-router/contracts";
import {
  buildDispatchPayload,
  type DispatchAction,
} from "@/modules/agent-chat/application/api-schemas";
import type {
  ThreadMessageView,
  ThreadMode,
  ThreadSummary,
} from "@/modules/agent-chat/infrastructure/thread-repository";

export type AgentDrawerView = "history" | "thread";

export type PendingPrompt = { text: string; nonce: number };

export type AgentRouteResult = {
  intent: AgentIntent;
  confidence: "high" | "medium" | "low";
  reasonCodes: string[];
  questionnaire: QuestionnaireSpec | null;
};

export type AgentWatchChoice = WatchTapOutcome;

export type AgentDispatchOutcome = {
  outcome: "dispatched" | "replayed" | "draft_requested" | "brief_prefilled";
  eventId: string | null;
  replayed: boolean;
  idempotencyKey: string;
  runId: string | null;
  requestId: string | null;
  projectId: string | null;
  draftRequestId: string | null;
  briefUrl: string | null;
  reasonCodes: string[];
  link: { href: string; ref: Record<string, string | null> } | null;
};

export type AgentDrawerProps = {
  organizationId: string;
  page: string;
  threadId: string | null;
  pendingPrompt: PendingPrompt | null;
  mode: ThreadMode;
  role: RouterRole;
  permissions: string[];
  /** Retained for the shell contract; the pick path resolves the opportunity server-side. */
  actorId?: string;
  /** Retained for the shell contract; the pick path resolves the opportunity server-side. */
  opportunity?: CampaignAdviceOpportunity | null;
  /** Retained for the shell contract; the form-first flow is removed. */
  advice?: CampaignAdviceContext | null;
  /** Retained for the shell contract; drafts are requested server-side on pick. */
  campaignSeams?: AdviseCampaignSeams;
  /**
   * Whether the watch schedule-update path is available. True: the
   * schedule RPC is live and proven on staging, so Update-fields is
   * offered to grant-holders (the server rechecks the grant on submit).
   * Pass false explicitly to force the honest unavailable copy.
   */
  watchUpdateAvailable?: boolean;
  view: AgentDrawerView;
  onViewChange: (view: AgentDrawerView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onThreadChange: (threadId: string | null) => void;
  onPromptConsumed: () => void;
  /**
   * Distance above the viewport bottom. The shell picks it from the bar
   * state: short single-line bar → closer offset, expanded bar → taller
   * offset, so the drawer stays close but never overlaps. Defaults to the
   * closer offset (the common post-send state).
   */
  bottomOffset?: "bottom-22" | "bottom-32";
  /**
   * Movable-drawer geometry (F5, spec section 5.2). Owned by the shell in
   * session memory — passed down so the bar and the drawer move as one
   * unit. Absent → the drawer keeps its own fallback (direct mounts, tests).
   */
  geometry?: AgentDrawerGeometry;
  onGeometryChange?: (next: AgentDrawerGeometry) => void;
  /**
   * Shell-controlled single source of truth (F5 fix round 1): the shell
   * container owns the unit `translate3d`, so the drawer must not apply it
   * again on its inner section — a transformed ancestor becomes the
   * containing block for `fixed` descendants, stacking the offset 2x on the
   * drawer while the bar shifts 1x. Size styles still apply here.
   */
  disableUnitTransform?: boolean;
};

type ThreadsResponse = { threads: ThreadSummary[]; nextCursor: string | null };
type MessagesResponse = { messages: ThreadMessageView[]; nextCursor: string | null };

/**
 * Client-side thread title until lightweight-model titles land (deferred
 * follow-up): the in-flight prompt first, else the first user message,
 * truncated to eight words. Falls back to a real server title when one
 * exists, else "New chat".
 */
export function threadTitleFor(
  messages: ThreadMessageView[],
  serverTitle: string | null | undefined,
  pendingBody?: string | null,
): string {
  const first =
    pendingBody?.trim() || messages.find((message) => message.role === "user")?.body?.trim();
  if (first) {
    const words = first.split(/\s+/);
    return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : first;
  }
  if (serverTitle && serverTitle !== "New chat") return serverTitle;
  return "New chat";
}

/** Durable-checkpoint poll cadence (performance-build-watcher pattern). */
export const AGENT_THREAD_POLL_MS = 3000;

/**
 * Nonce-derived idempotency keys (Slice C M8).
 *
 * Every POST in one send derives its key from the drawer-session id plus
 * the prompt nonce: `<session>:<nonce>:thread|:message|:route`. The same
 * nonce always yields the same three keys, so a transport retry replays
 * instead of double-posting (the keyed RPCs converge on same-key +
 * same-body and refuse same-key + other-body). The session id keeps two
 * drawer sessions from sharing keys when the shell nonce restarts at
 * zero, and its 36 chars keep every key above the 16-char route floor.
 */
export function buildDrawerRequestKeys(
  sessionId: string,
  nonce: number,
): { threadKey: string; messageKey: string; routeKey: string } {
  const stem = `${sessionId}:${nonce}`;
  return {
    threadKey: `${stem}:thread`,
    messageKey: `${stem}:message`,
    routeKey: `${stem}:route`,
  };
}

/**
 * Session view of the active thread (Task B2 zero-click escalation).
 *
 * The polled row wins when it arrives — worker link updates land there —
 * except the server-owned auto-escalation flips the route-response thread
 * to DeepThink in-memory (RLS carries no thread-mode write policy and no
 * mode RPC exists), so a same-thread poll still reading Quick must not
 * clobber the marker mid-session. Links and status always come from the
 * poll; only the escalated mode is held from the route response.
 */
export function resolveLiveThread(
  polled: ThreadSummary | null,
  optimistic: ThreadSummary | null,
): ThreadSummary | null {
  if (
    polled &&
    optimistic &&
    polled.id === optimistic.id &&
    polled.mode === "quick" &&
    optimistic.mode === "deepthink"
  ) {
    return { ...polled, mode: "deepthink" };
  }
  return polled ?? optimistic;
}

/**
 * Task 3 frame protocol, consumed verbatim (task-3 report, wire unchanged
 * after the fix round: token/done/end in order, then the server closes).
 *
 * - `event: token` / `data: {"text":"<body chunk>"}` — chunks join with
 *   `""` into the streamed body preview. Malformed frames are skipped,
 *   never fatal.
 * - `event: done` / `data: [DONE]` — literal, never JSON. Tokens complete.
 * - `event: end` / `data: {messageId, replayed, fallback, reason, draft,
 *   correlationId}` — `messageId` is the durable assistant row id (a
 *   conflicted stream reuses the route's kept row, `replayed: true`); null
 *   only for viewers and failed appends with no reusable row (draft-only).
 *   `draft` is the content persisted when `messageId` is non-null.
 *
 * Client rules honored here: a transport drop before a valid `end` keeps
 * the partial text with a note and reads the durable row — the drawer
 * never resumes a dead stream, and reconnects/reopens only ever read the
 * durable GET rows. Errors before the first frame fall back to the same
 * durable read, so the routed turn's row still renders.
 */
const AGENT_STREAM_EVENT_TOKEN = "token";
const AGENT_STREAM_EVENT_DONE = "done";
const AGENT_STREAM_EVENT_END = "end";
const AGENT_STREAM_DONE_DATA = "[DONE]";

const agentStreamEndSchema = z.object({
  messageId: z.string().uuid().nullable(),
  replayed: z.boolean(),
  fallback: z.boolean(),
  reason: z
    .enum(["not_configured", "timeout", "invalid_candidate", "synthesis_failed", "append_conflict"])
    .nullable(),
  draft: z.unknown(),
  correlationId: z.string().uuid(),
});

/** Honest note kept beside a dropped stream's partial text. */
export const AGENT_STREAM_DROP_NOTE =
  "The live answer stopped here — showing what arrived so far.";

/** Honest copy when the live answer stream never opens (G1). */
export const AGENT_STREAM_OPEN_ERROR =
  "The live answer could not start. Your message was stored — the reply will appear when the conversation reloads.";

/**
 * Honest copy when a post-send durable read fails (G1: messages refresh or
 * thread poll). Call-agnostic — whichever turn call fails lands here.
 */
export const AGENT_REFRESH_ERROR =
  "Could not refresh the conversation. Your messages are stored — try reopening the thread.";

type AgentStreamPhase = "connecting" | "live" | "dropped";
type AgentLiveStream = { key: number; phase: AgentStreamPhase; text: string };

type AgentStreamEvents = {
  onToken: (text: string) => void;
  onEnd: (payload: z.infer<typeof agentStreamEndSchema>) => void;
  /** Transport closed before a valid `end` (never fires after `onEnd`). */
  onDrop: () => void;
};

/**
 * Incremental SSE reader for one answer stream. Frames split on blank
 * lines; `token` data parses as `{"text": <non-empty string>}` (anything
 * else is skipped); `done` needs no handling (`end` follows immediately);
 * `end` validates through `agentStreamEndSchema` (an invalid `end` degrades
 * to a drop, never a render). Resolves quietly on abort — the opener owns
 * the UI in that case.
 */
async function readAgentStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  events: AgentStreamEvents,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  const dispatch = (rawEvent: string, data: string): void => {
    if (rawEvent === AGENT_STREAM_EVENT_TOKEN) {
      try {
        const text = (JSON.parse(data) as { text?: unknown }).text;
        if (typeof text === "string" && text.length > 0) events.onToken(text);
      } catch {
        // Malformed token frame: skip it, keep the stream honest.
      }
    } else if (rawEvent === AGENT_STREAM_EVENT_DONE) {
      if (data !== AGENT_STREAM_DONE_DATA) return;
      // Token stream complete; `end` follows immediately. No UI change.
    } else if (rawEvent === AGENT_STREAM_EVENT_END) {
      try {
        const end = agentStreamEndSchema.safeParse(JSON.parse(data) as unknown);
        if (end.success) {
          ended = true;
          events.onEnd(end.data);
        }
      } catch {
        // Invalid `end` payload: treated as a drop below, never rendered.
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let rawEvent = "";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
          if (clean.startsWith(":")) continue;
          if (clean.startsWith("event:")) rawEvent = clean.slice(6).trim();
          else if (clean.startsWith("data:")) dataLines.push(clean.slice(5).replace(/^ /, ""));
        }
        dispatch(rawEvent, dataLines.join("\n"));
        if (ended) break;
        boundary = buffer.indexOf("\n\n");
      }
      if (ended) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!ended && !signal.aborted) events.onDrop();
}

/**
 * Every drawer fetch sends `cache: "no-store"` plus one drawer-session
 * `x-correlation-id`, and every route answers with the same id plus
 * `Cache-Control: no-store`. Fresh reads, one trail per conversation.
 */
async function agentGetJson(path: string, correlationId: string): Promise<unknown> {
  const response = await fetch(path, {
    method: "GET",
    headers: { accept: "application/json", "x-correlation-id": correlationId },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
  }
  return body as unknown;
}

async function agentPostJson(
  path: string,
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-correlation-id": correlationId,
    },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
  }
  return body as unknown;
}

function formatAnswers(answers: Record<string, unknown>): string {
  return Object.entries(answers)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

/**
 * Saved-answer rows (G3): any message carrying structured
 * `questionnaireAnswers`, plus any `user` message with an `[answers …]`
 * body. Both render as `You clarified: …` Marker receipts — the raw
 * `[answers …]` body text never reaches the DOM.
 */
function isAnswersRowMessage(message: ThreadMessageView): boolean {
  if (message.questionnaireAnswers !== null && message.questionnaireAnswers !== undefined) {
    return true;
  }
  return (message.body ?? "").startsWith("[answers ");
}

/**
 * One-line summary for a saved-answer row: the structured record when one
 * is attached, otherwise the `key: value` lines under the `[answers …]`
 * header joined the same way. Always body-derived copy, never the raw
 * header text.
 */
function summarizeAnswersBody(message: ThreadMessageView): string {
  if (
    typeof message.questionnaireAnswers === "object" &&
    message.questionnaireAnswers !== null
  ) {
    return formatAnswers(message.questionnaireAnswers as Record<string, unknown>);
  }
  const lines = (message.body ?? "").split("\n");
  const [, ...rest] = lines;
  return (rest ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" · ");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Watch lane forms (Slice C, task-2 report s9.2), restored as the clearly-
 * labeled manual fallback (FINAL fix for I-1: B4 deleted them while the
 * one-tap replacement proved live-unreachable, so watch creation regressed
 * working→broken). One-tap stays primary; these mount only when it cannot
 * finish the turn (see showWatchFallback).
 *
 * Task B3 removed the research confirm button (research auto-runs
 * zero-click from the route response); these forms remain the manual
 * dispatch surface. Every submit IS the explicit confirmation the route
 * requires; the route rechecks the grant and Zod-disposes every field,
 * so client checks stay courtesy-only. The update form prefills the
 * project from the polled thread links; scope-widening edits (new
 * competitors, moved research area) stay refusal-side: the worker
 * routes them to `profile_scope_change` instead of applying them.
 */
function WatchDispatchForms({
  defaultProjectId,
  watchUpdateAvailable,
  pending,
  outcome,
  error,
  onDispatch,
}: {
  defaultProjectId: string | null;
  watchUpdateAvailable: boolean;
  pending: boolean;
  outcome: AgentDispatchOutcome | null;
  error: string | null;
  onDispatch: (vars: {
    action: DispatchAction;
    idempotencyKey: string;
    watchCreate?: {
      branchId: string;
      title?: string;
      question: string;
      mode: "one-time" | "recurring";
      researchArea: string;
    };
    watchUpdate?: { projectId: string; edits: Record<string, unknown> };
  }) => void;
}) {
  const [question, setQuestion] = useState("");
  const [researchArea, setResearchArea] = useState("");
  const [mode, setMode] = useState<"one-time" | "recurring">("one-time");
  const [branchId, setBranchId] = useState("");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [frequency, setFrequency] = useState("none");
  const [endDate, setEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function submitWatchCreate() {
    if (question.trim().length < 1 || researchArea.trim().length < 1) {
      setFormError("A question and a research area are required.");
      return;
    }
    if (!UUID_PATTERN.test(branchId.trim())) {
      setFormError("The branch id must be a uuid.");
      return;
    }
    setFormError(null);
    onDispatch({
      action: "watch_create",
      idempotencyKey: crypto.randomUUID(),
      watchCreate: {
        branchId: branchId.trim(),
        ...(title.trim().length > 0 ? { title: title.trim() } : {}),
        question: question.trim(),
        mode,
        researchArea: researchArea.trim(),
      },
    });
  }

  function submitWatchUpdate() {
    const target = projectId.trim() || defaultProjectId || "";
    if (!UUID_PATTERN.test(target)) {
      setFormError("A watch project id (uuid) is required — pick it from the linked thread.");
      return;
    }
    const edits: Record<string, unknown> = {};
    if (frequency !== "none") edits.frequency = frequency;
    if (endDate.trim().length > 0) {
      if (!DATE_PATTERN.test(endDate.trim())) {
        setFormError("The end date must be YYYY-MM-DD.");
        return;
      }
      edits.endDate = endDate.trim();
    }
    if (Object.keys(edits).length === 0) {
      setFormError("Change a field first — frequency or end date.");
      return;
    }
    setFormError(null);
    onDispatch({
      action: "watch_update",
      idempotencyKey: crypto.randomUUID(),
      watchUpdate: { projectId: target, edits },
    });
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="watch-question">Watch question</FieldLabel>
          <Textarea
            id="watch-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What should this watch track?"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="watch-area">Research area</FieldLabel>
          <Input
            id="watch-area"
            value={researchArea}
            onChange={(event) => setResearchArea(event.target.value)}
            placeholder="e.g. downtown lunch demand"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="watch-branch">Branch id</FieldLabel>
          <Input
            id="watch-branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            placeholder="Branch uuid this watch belongs to"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="watch-title">Title (optional)</FieldLabel>
          <Input
            id="watch-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Short watch title"
          />
        </Field>
        <Field>
          <FieldLabel>Run mode</FieldLabel>
          <ToggleGroup
            type="single"
            value={mode}
            aria-label="Watch run mode"
            onValueChange={(next) => {
              if (next === "one-time" || next === "recurring") setMode(next);
            }}
          >
            <ToggleGroupItem value="one-time" aria-label="One-time watch">
              One-time
            </ToggleGroupItem>
            <ToggleGroupItem value="recurring" aria-label="Recurring watch">
              Recurring
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Button type="button" disabled={pending} onClick={submitWatchCreate}>
          {pending ? <Spinner aria-hidden="true" /> : null}
          Start watch
        </Button>
      </FieldGroup>

      {watchUpdateAvailable ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="watch-project">Watch project id</FieldLabel>
            <Input
              id="watch-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder={defaultProjectId ?? "Watch project uuid"}
            />
          </Field>
          <Field>
            <FieldLabel>Frequency</FieldLabel>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger aria-label="Watch frequency">
                <SelectValue placeholder="No change" />
              </SelectTrigger>
              <SelectContent className="dark border-white/10 bg-zinc-900 text-zinc-100">
                <SelectItem value="none">No change</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="watch-end">End date (optional)</FieldLabel>
            <Input
              id="watch-end"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </Field>
          <Button type="button" variant="outline" disabled={pending} onClick={submitWatchUpdate}>
            {pending ? <Spinner aria-hidden="true" /> : null}
            Update watch
          </Button>
        </FieldGroup>
      ) : (
        <p className="text-xs text-muted-foreground">
          Watch field updates are unavailable for this chat — viewing the existing watch stays free.
        </p>
      )}

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {outcome ? (
        <p className="text-sm text-muted-foreground">
          {outcome.replayed ? "Already queued — showing the kept run." : "Watch queued."}{" "}
          {outcome.link ? (
            <a
              className="font-medium text-primary underline-offset-4 hover:underline"
              href={outcome.link.href}
            >
              Open Market Intelligence
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Watch one-tap result (Task B4, L3). The questionnaire card submit is the
 * single tap, and the answers route executes behind it with the
 * auto-prepared payload. This card renders the returned envelope — created
 * receipt plus assumptions, the viewed link, the applied update, the scope
 * proposal, or the honest blocked copy. It posts nothing itself; the manual
 * fallback forms below post to dispatch only when one-tap cannot finish
 * the turn (FINAL fix for I-1).
 */
function WatchOneTapCard({
  watchChoice,
  intentIsWatch,
  hasQuestionnaire,
  canManageWatch,
}: {
  watchChoice: AgentWatchChoice | null;
  intentIsWatch: boolean;
  hasQuestionnaire: boolean;
  canManageWatch: boolean;
}) {
  if (watchChoice) {
    return <div className="flex flex-col gap-2 pt-2">{watchReceipt(watchChoice)}</div>;
  }
  if (!canManageWatch) {
    return (
      <p className="text-xs text-muted-foreground">
        Needs the growth_intelligence.manage grant — enforcement stays server-side.
      </p>
    );
  }
  if (hasQuestionnaire) {
    return (
      <p className="text-xs text-muted-foreground">
        Answer the card above — one tap creates or updates the watch.
      </p>
    );
  }
  if (intentIsWatch) {
    return (
      <p className="text-xs text-muted-foreground">
        No card yet — describe the branch and rhythm in a message and the next card creates the
        watch in one tap.
      </p>
    );
  }
  return null;
}

function watchMarketLink(href: string) {
  return (
    <a
      className="font-medium text-primary underline-offset-4 hover:underline"
      href={href}
    >
      Open Market Intelligence
    </a>
  );
}

function watchReceipt(choice: AgentWatchChoice) {
  switch (choice.outcome) {
    case "blocked":
    case "update_blocked":
    case "needs_input":
      return <p className="text-sm text-muted-foreground">{choice.copy}</p>;
    case "cancelled":
      return <p className="text-sm text-muted-foreground">Cancelled — nothing was created.</p>;
    case "view_existing":
      return choice.projectId ? (
        <p className="text-sm text-muted-foreground">
          Existing watch. {watchMarketLink(choice.link.href)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">The existing watch was not found.</p>
      );
    case "created":
    case "replayed":
      return (
        <>
          <p className="text-sm text-muted-foreground">
            {choice.replayed ? "Already queued — showing the kept watch." : "Watch created."}{" "}
            {watchMarketLink(choice.link.href)}
          </p>
          {choice.assumptions.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {choice.assumptions.map((assumption) => (
                <li key={assumption} className="text-xs text-muted-foreground">
                  {assumption}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      );
    case "duplicate":
      return (
        <p className="text-sm text-muted-foreground">
          A similar watch is still running — choose what to do on the card above.
        </p>
      );
    case "updated":
      return (
        <p className="text-sm text-muted-foreground">
          {choice.replayed && choice.appliedFields.length === 0
            ? "Already up to date — nothing was changed."
            : `Watch updated${choice.appliedFields.length > 0 ? ` (${choice.appliedFields.join(", ")})` : ""}.`}{" "}
          {watchMarketLink(choice.link.href)}
        </p>
      );
    case "profile_scope_change": {
      const additions = [
        ...choice.proposal.addedCompetitors,
        ...choice.proposal.addedTopics,
        ...(choice.proposal.researchArea ? [choice.proposal.researchArea] : []),
      ];
      return (
        <>
          <p className="text-sm text-muted-foreground">
            This change widens the watch scope, so it needs a Market Profile proposal first.
            Nothing was changed.
          </p>
          {additions.length > 0 ? (
            <p className="text-xs text-muted-foreground">Proposed additions: {additions.join(", ")}.</p>
          ) : null}
        </>
      );
    }
  }
}

/**
 * Bottom sheet over the floating shell (spec section 5.2). Opens on send,
 * persists across the 5 pages within the session (thread state lives in the
 * shell above page switches; background progress resumes via the
 * thread-checkpoint poll), and collapses to a single-line status strip
 * docked on top of the shell. Two views, no tabs: the history view lists
 * threads with a New chat entry point, and the thread view reads one
 * conversation top to bottom — user messages, inline steps, answers with
 * citations, Questionnaire cards, executor confirmations, and draft advice.
 * History reopens through the Task 3 GET messages route, restoring
 * messages plus saved answers.
 */
export function AgentDrawer({
  organizationId,
  page,
  threadId,
  pendingPrompt,
  mode,
  role,
  permissions,
  watchUpdateAvailable = true,
  view,
  onViewChange,
  collapsed,
  onToggleCollapsed,
  onClose,
  onThreadChange,
  onPromptConsumed,
  bottomOffset = "bottom-22",
  geometry: geometryProp,
  onGeometryChange,
  disableUnitTransform = false,
}: AgentDrawerProps) {
  const queryClient = useQueryClient();
  const sidebarOffset = useAgentSidebarOffset();
  const { isMobile } = useSidebar();
  const base = `/api/organizations/${organizationId}/agent/threads`;

  /**
   * Movable-drawer unit (F5). The shell owns this state while mounted so a
   * drag or resize survives drawer close/reopen within the session; a full
   * reload resets to the CSS defaults. Controlled when the shell passes
   * geometry + onGeometryChange, uncontrolled fallback otherwise.
   */
  const [fallbackGeometry, setFallbackGeometry] =
    useState<AgentDrawerGeometry>(AGENT_DRAWER_DEFAULT_GEOMETRY);
  const geometry = geometryProp ?? fallbackGeometry;
  // Pointer handlers resolve geometry through this mirror so a drag
  // spanning several moves never acts on a stale closure. Synced in an
  // effect — refs stay out of the render path.
  const geometryRef = useRef(geometry);
  useEffect(() => {
    geometryRef.current = geometry;
  }, [geometry]);
  const setGeometry = onGeometryChange ?? setFallbackGeometry;

  /**
   * Pointer-drag plumbing (no new library): each handle records its start
   * on pointerdown and listens on window until pointerup/cancel, so fast
   * drags that leave the handle still track. Deltas clamp to the viewport;
   * a south resize ending below 12rem docks the strip instead of shrinking.
   */
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const collapsedOnceRef = useRef(false);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  function trackPointer(
    onMove: (event: PointerEvent) => void,
    onUp?: () => void,
  ): void {
    dragCleanupRef.current?.();
    const handleMove = (event: PointerEvent): void => onMove(event);
    const handleUp = (): void => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      dragCleanupRef.current = null;
      onUp?.();
    };
    dragCleanupRef.current = handleUp;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  function beginUnitDrag(event: ReactPointerEvent): void {
    if (isMobile || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = geometryRef.current.x;
    const baseY = geometryRef.current.y;
    trackPointer((move) => {
      const next = clampDrawerOffset(
        baseX + (move.clientX - startX),
        baseY + (move.clientY - startY),
        window.innerWidth,
        window.innerHeight,
      );
      setGeometry({ ...geometryRef.current, ...next });
    });
  }

  function nudgeUnit(dx: number, dy: number): void {
    if (isMobile) return;
    const next = clampDrawerOffset(
      geometryRef.current.x + dx,
      geometryRef.current.y + dy,
      window.innerWidth,
      window.innerHeight,
    );
    setGeometry({ ...geometryRef.current, ...next });
  }

  type ResizeAxis = "e" | "s" | "se" | "w" | "sw";

  /**
   * West-edge shared math: the left edge moves with the pointer while the
   * right edge stays put, so x + width move together. Width clamps first
   * (300px floor, viewport ceiling — width never collapses), then the offset
   * clamps like the drag unit, then width re-derives from the kept x so the
   * two never disagree at a rail.
   */
  function westResize(
    current: AgentDrawerGeometry,
    baseX: number,
    startWidth: number,
    edgeDx: number,
  ): { x: number; width: number } {
    const viewportWidth = window.innerWidth;
    const widthLimited = clampDrawerWidth(startWidth - edgeDx, viewportWidth);
    const widthDx = startWidth - widthLimited;
    const offset = clampDrawerOffset(
      baseX + widthDx,
      current.y,
      viewportWidth,
      window.innerHeight,
    );
    const appliedDx = offset.x - baseX;
    return { x: offset.x, width: clampDrawerWidth(startWidth - appliedDx, viewportWidth) };
  }

  function beginResize(axis: ResizeAxis, event: ReactPointerEvent): void {
    if (isMobile || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = geometryRef.current.width ?? AGENT_DRAWER_DEFAULT_WIDTH_PX;
    const startHeight = geometryRef.current.height ?? AGENT_DRAWER_DEFAULT_HEIGHT_PX;
    const baseX = geometryRef.current.x;
    collapsedOnceRef.current = false;
    trackPointer((move) => {
      // One merged write per move: separate width/height writes would race
      // on the corner axis, the second clobbering the first.
      const next: AgentDrawerGeometry = { ...geometryRef.current };
      if (axis === "e" || axis === "se") {
        next.width = clampDrawerWidth(startWidth + (move.clientX - startX), window.innerWidth);
      }
      if (axis === "w" || axis === "sw") {
        const west = westResize(next, baseX, startWidth, move.clientX - startX);
        next.x = west.x;
        next.width = west.width;
      }
      if (axis === "s" || axis === "se" || axis === "sw") {
        const rawHeight = startHeight + (move.clientY - startY);
        if (shouldCollapseDrawerHeight(rawHeight)) {
          // Sub-threshold: dock the existing strip instead of shrinking.
          // Width is untouched — width never collapses.
          if (!collapsedOnceRef.current) {
            collapsedOnceRef.current = true;
            onToggleCollapsed();
          }
          return;
        }
        next.height = clampDrawerHeight(rawHeight, window.innerHeight);
      }
      setGeometry(next);
    });
  }

  function nudgeSize(axis: ResizeAxis, dx: number, dy: number): void {
    if (isMobile) return;
    const current = geometryRef.current;
    const next: AgentDrawerGeometry = { ...current };
    if (axis === "e" || axis === "se") {
      next.width = clampDrawerWidth(
        (current.width ?? AGENT_DRAWER_DEFAULT_WIDTH_PX) + dx,
        window.innerWidth,
      );
    }
    if (axis === "w" || axis === "sw") {
      // Keyboard dx is edge travel like the pointer path (ArrowLeft moves
      // the left edge left, growing the panel), so width takes -dx.
      const west = westResize(
        current,
        current.x,
        current.width ?? AGENT_DRAWER_DEFAULT_WIDTH_PX,
        dx,
      );
      next.x = west.x;
      next.width = west.width;
    }
    if (axis === "s" || axis === "se" || axis === "sw") {
      const rawHeight = (current.height ?? AGENT_DRAWER_DEFAULT_HEIGHT_PX) + dy;
      if (shouldCollapseDrawerHeight(rawHeight)) {
        // Same once-guard as the pointer path: each sub-threshold press
        // must not toggle an already-collapsed strip back open.
        if (!collapsedOnceRef.current) {
          collapsedOnceRef.current = true;
          onToggleCollapsed();
        }
        return;
      }
      collapsedOnceRef.current = false;
      next.height = clampDrawerHeight(rawHeight, window.innerHeight);
    }
    setGeometry(next);
  }

  // Mobile is native: geometry never applies, so a desktop-set offset or
  // size cannot persist across a viewport shrink without a reload. The
  // shell-controlled mount likewise owns the unit transform itself (see
  // disableUnitTransform) — size styles still come from here.
  const unitStyle: CSSProperties | undefined =
    isMobile || disableUnitTransform || (geometry.x === 0 && geometry.y === 0)
      ? undefined
      : { transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)` };
  const panelStyle: CSSProperties | undefined =
    isMobile || (geometry.width == null && geometry.height == null)
      ? undefined
      : {
          ...(geometry.width != null
            ? { width: `${geometry.width}px`, maxWidth: "calc(100dvw - 2rem)" }
            : {}),
          ...(geometry.height != null ? { height: `${geometry.height}px` } : {}),
        };

  // One correlation id per drawer session: every send, poll, reopen, and
  // downstream handoff fetch carries it, so one conversation is one trail.
  const sessionCorrelation = useRef<string | null>(null);
  if (sessionCorrelation.current === null) {
    sessionCorrelation.current = crypto.randomUUID();
  }
  const correlationId = sessionCorrelation.current;

  const [messages, setMessages] = useState<ThreadMessageView[]>([]);
  const [thread, setThread] = useState<ThreadSummary | null>(null);
  const [routeResult, setRouteResult] = useState<AgentRouteResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, QuestionnaireAnswers>>(
    {},
  );
  // The latest server-confirmed submission, shown under the Response tab.
  // Tracked apart from submittedAnswers (which hides answered cards by
  // resume key) because a re-route swaps the visible card — keying the
  // confirmation off the new card would hide the proof of what was saved.
  const [lastSaved, setLastSaved] = useState<{
    resumeKey: string;
    answers: Record<string, unknown>;
  } | null>(null);
  const [dismissedCards, setDismissedCards] = useState<string[]>([]);
  // Pick-to-draft envelope from the answers route (Task 6 inversion): draft
  // id plus inline approve action plus Studio hyperlink in one payload — or
  // the retained pre-filled brief. Set on answers submit, cleared whenever
  // the conversation turns over.
  const [ideaDraft, setIdeaDraft] = useState<IdeaDraftOutcome | null>(null);
  // Watch one-tap envelope from the answers route (Task B4): the created
  // receipt plus assumptions, the viewed link, the applied update, the
  // scope proposal, or the honest blocked copy. Same lifecycle as the
  // draft envelope — set on answers submit, cleared on turnover.
  const [watchChoice, setWatchChoice] = useState<AgentWatchChoice | null>(null);
  // Manual fallback dispatch (FINAL fix for I-1): same turnover lifecycle
  // as the one-tap envelope.
  const [dispatchOutcome, setDispatchOutcome] = useState<AgentDispatchOutcome | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  // Whether the current turn involved a watch card. Latched on a watch
  // route (recomputed per send) and on watch-kind answers submits
  // (latch-only), so the fallback survives a re-route that drifts away
  // from watch — the B5 live failure mode. Cleared on turnover.
  const [watchTurn, setWatchTurn] = useState(false);
  const [announcement, setAnnouncement] = useState("Conversation opened.");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Sequential send queue in refs, not state: effects may drain refs and
  // fire mutations, but must never call setState directly. State only
  // changes in event handlers and mutation callbacks.
  const queueRef = useRef<PendingPrompt[]>([]);
  const consumedNonceRef = useRef<number | null>(null);

  const canDraft = permissions.includes("campaign.create");
  const canManageWatch = role !== "viewer" && permissions.includes("growth_intelligence.manage");
  const isViewer = role === "viewer";

  /**
   * Durable-read refresh (Slice A): the route/answers re-route persists the
   * assistant row server-side, but the POST responses carry no message
   * bodies back — rendering always reads durable GET rows, never POST
   * echoes and never a token stream. Merges by id, first-seen wins: locally
   * appended rows (optimistic prompt, answers receipt) survive the refresh,
   * and same-id rows can never diverge in production (fenced keyed RPCs
   * return the identical body per id — idempotency), so keeping the local
   * copy is safe and prevents receipt loss on a stale echo.
   */
  async function refreshMessages(refreshThreadId: string): Promise<void> {
    try {
      const body = (await agentGetJson(
        `${base}/${refreshThreadId}/messages?limit=50`,
        correlationId,
      )) as MessagesResponse;
      const fetched = body.messages ?? [];
      setMessages((previous) => {
        const seen = new Map(previous.map((message) => [message.id, message]));
        for (const message of fetched) {
          if (!seen.has(message.id)) seen.set(message.id, message);
        }
        return [...seen.values()].sort((left, right) =>
          left.createdAt < right.createdAt
            ? -1
            : left.createdAt > right.createdAt
              ? 1
              : left.id < right.id
                ? -1
                : 1,
        );
      });
    } catch {
      // G1: a failed refresh is a visible failure, never a silent keep of
      // the local rows — the steps below turn terminal through sendError
      // instead of sticking on Thinking. Local rows stay mounted.
      setSendError(AGENT_REFRESH_ERROR);
      setAnnouncement("Could not refresh the conversation.");
    }
  }

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Live answer stream (Task 4): one stream per send, opened after the
  // route POST succeeds. Reconnect-never: drops, reconnects, and reopens
  // read the durable row — a dead stream is never resumed. Only the
  // current key may touch state, so an aborted stream's late frames land
  // nowhere. Unmount, reopen, new chat, and a newer send all abort.
  const streamKeyRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const [liveStream, setLiveStream] = useState<AgentLiveStream | null>(null);
  // Settle guarantee: state (not a ref) so the flag flip itself renders.
  const [endReceived, setEndReceived] = useState(false);

  function abortLiveStream(): void {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, []);

  async function openAnswerStream(args: { threadId: string; userMessageId: string }): Promise<void> {
    abortLiveStream();
    const key = streamKeyRef.current + 1;
    streamKeyRef.current = key;
    const controller = new AbortController();
    streamAbortRef.current = controller;
    const alive = (): boolean => streamKeyRef.current === key && !controller.signal.aborted;
    setLiveStream({ key, phase: "connecting", text: "" });
    try {
      const response = await fetch(
        `${base}/${args.threadId}/stream?messageId=${args.userMessageId}&page=${page}`,
        {
          method: "GET",
          headers: { accept: "text/event-stream", "x-correlation-id": correlationId },
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) {
        throw new Error(`Stream failed (${response.status}).`);
      }
      await readAgentStream(response.body, controller.signal, {
        onToken: (text) => {
          if (!alive()) return;
          setLiveStream((previous) =>
            previous && previous.key === key
              ? { key, phase: "live", text: `${previous.text}${text}` }
              : previous,
          );
        },
        onEnd: (end) => {
          if (!alive()) return;
          streamAbortRef.current = null;
          if (end.messageId) {
            // Durable swap: the routed turn's row is source of truth — the
            // preview is discarded (even intact) and the durable read
            // renders, so reconnects always agree with history. This branch
            // also owns the kept-row end (a conflicted stream reuses the
            // route's row, `replayed: true`): any stale `stream-draft` for
            // the turn is dropped before the re-read, so exactly one
            // assistant row lands per streamed turn and steps flip terminal
            // when the durable row arrives. The validated end marks the
            // turn received: steps go terminal on this flag even if the
            // refresh lags, so the stuck Checking state is unreachable.
            setEndReceived(true);
            const draftId = `stream-draft:${args.userMessageId}`;
            setLiveStream(null);
            setMessages((previous) =>
              previous.some((message) => message.id === draftId)
                ? previous.filter((message) => message.id !== draftId)
                : previous,
            );
            void refreshMessages(args.threadId);
          } else {
            // Draft-only (viewers and failed appends with no reusable row):
            // no durable row exists, so the validated `end` draft renders with its
            // full sections under a stable per-turn id. An `end` draft
            // that fails writer validation keeps nothing (drop path).
            try {
              const parsed = answerDraftSchema.safeParse(end.draft);
              if (!parsed.success) throw new Error("Invalid end draft.");
              const draftMessage: ThreadMessageView = {
                id: `stream-draft:${args.userMessageId}`,
                threadId: args.threadId,
                role: "assistant",
                body: encodeAnswerBody(parsed.data),
                questionnaireAnswers: null,
                markerReceipts: null,
                citations: null,
                createdAt: new Date().toISOString(),
              };
              // Draft-only end with a validated draft is still a validated
              // answer: the draft renders AND the turn counts received, so
              // steps go terminal with the draft on screen.
              setEndReceived(true);
              setLiveStream(null);
              setMessages((previous) =>
                previous.some((message) => message.id === draftMessage.id)
                  ? previous
                  : [...previous, draftMessage],
              );
            } catch {
              // The `end` draft itself is unencodable: keep nothing, read
              // the durable row like any other drop.
              setLiveStream(null);
              void refreshMessages(args.threadId);
            }
          }
        },
        onDrop: () => {
          if (!alive()) return;
          // Announce the stop only when partial text actually rendered —
          // an empty drop stays silent everywhere, like the visual.
          let hadText = false;
          setLiveStream((previous) => {
            if (!previous || previous.key !== key) return previous;
            // Nothing arrived: fall back to the durable read silently —
            // the routed turn's row renders when it lands.
            if (previous.text === "") return null;
            hadText = true;
            return { ...previous, phase: "dropped" };
          });
          if (hadText) {
            setAnnouncement("The live answer stopped. Showing what arrived so far.");
          }
          void refreshMessages(args.threadId);
        },
      });
    } catch {
      if (controller.signal.aborted || streamKeyRef.current !== key) return;
      // G1: the stream never opened (auth, tenancy, validation, transport).
      // Partial text keeps its honest note, but the turn still lands in the
      // error state — the routed turn must never stick on Thinking.
      streamAbortRef.current = null;
      setLiveStream((previous) => {
        if (!previous || previous.key !== key) return previous;
        if (previous.text === "") return null;
        return { ...previous, phase: "dropped" };
      });
      setSendError(AGENT_STREAM_OPEN_ERROR);
      setAnnouncement("The live answer could not start. Your message was stored.");
      void refreshMessages(args.threadId);
    }
  }

  const send = useMutation({
    mutationFn: async (vars: {
      text: string;
      threadMode: ThreadMode;
      threadId: string | null;
      nonce: number;
    }) => {
      // Slice C M8: keys derive from the prompt nonce, not from a fresh
      // uuid per attempt — a retried send replays instead of minting a
      // second thread, message, and route.
      const keys = buildDrawerRequestKeys(correlationId, vars.nonce);
      let tid = vars.threadId;
      if (!tid) {
        const created = (await agentPostJson(
          base,
          {
            idempotencyKey: keys.threadKey,
            mode: vars.threadMode,
          },
          correlationId,
        )) as { thread: ThreadSummary };
        tid = created.thread.id;
        onThreadChange(tid);
      }
      const appended = (await agentPostJson(
        `${base}/${tid}/messages`,
        {
          idempotencyKey: keys.messageKey,
          body: vars.text,
        },
        correlationId,
      )) as { message: ThreadMessageView };
      const routed = (await agentPostJson(
        `${base}/${tid}/route?page=${page}`,
        {
          idempotencyKey: keys.routeKey,
        },
        correlationId,
      )) as {
        intent: AgentIntent;
        confidence: "high" | "medium" | "low";
        reasonCodes: string[];
        questionnaire: QuestionnaireSpec | null;
        thread: ThreadSummary;
      };
      return {
        thread: routed.thread,
        userMessage: appended.message,
        result: {
          intent: routed.intent,
          confidence: routed.confidence,
          reasonCodes: routed.reasonCodes ?? [],
          questionnaire: routed.questionnaire,
        },
      };
    },
    onMutate: (vars) => {
      // Settle guarantee: a new send starts a clean turn — the previous
      // turn's end-received flag must not stick the next turn done.
      setEndReceived(false);
      // G1 honest send: the user's bubble renders on mutate, before the
      // server round-trip lands. The optimistic row carries the nonce client
      // key, so the confirm below replaces exactly one row, never doubling.
      const optimisticId = `optimistic:${vars.nonce}`;
      const optimisticMessage: ThreadMessageView = {
        id: optimisticId,
        threadId: vars.threadId ?? `pending-thread:${vars.nonce}`,
        role: "user",
        body: vars.text,
        questionnaireAnswers: null,
        markerReceipts: null,
        citations: null,
        createdAt: new Date().toISOString(),
      };
      setSendError(null);
      setMessages((previous) =>
        previous.some((message) => message.id === optimisticId)
          ? previous
          : [...previous, optimisticMessage],
      );
      onViewChange("thread");
      return { optimisticId };
    },
    onSuccess: ({ thread: row, userMessage, result }, vars, context) => {
      setThread(row);
      // Reconcile by the nonce client key: the optimistic row is replaced
      // by the durable row, and a durable row already present (e.g. landed
      // via a refresh first) is never appended twice.
      const optimisticId =
        (context as { optimisticId?: string } | undefined)?.optimisticId ??
        `optimistic:${vars.nonce}`;
      setMessages((previous) => {
        const withoutOptimistic = previous.filter((message) => message.id !== optimisticId);
        return withoutOptimistic.some((message) => message.id === userMessage.id)
          ? withoutOptimistic
          : [...withoutOptimistic, userMessage];
      });
      setRouteResult(result);
      setSendError(null);
      setIdeaDraft(null);
      setWatchChoice(null);
      setDispatchOutcome(null);
      setDispatchError(null);
      setWatchTurn(result.intent === "watch");
      onViewChange("thread");
      setAnnouncement(`Routed to ${result.intent}.`);
      // The answer streams live from here: tokens render into the thread
      // bubble and the `end` marker swaps to the durable row. The stream
      // opens once per send — never on reconnect or reopen.
      void openAnswerStream({ threadId: row.id, userMessageId: userMessage.id });
      void queryClient.invalidateQueries({ queryKey: ["agent-threads", organizationId] });
    },
    onError: (error) => {
      // The optimistic bubble stays mounted: the typed text remains visible
      // beside the failure instead of vanishing with the failed send.
      setSendError(error instanceof Error ? error.message : "Sending failed. Nothing was stored.");
      onViewChange("thread");
      setAnnouncement("Sending failed.");
    },
  });

  // Questionnaire submit (Task 6 ruling F2, drawer half): answers post
  // to the fenced answers route with the echoed spec — validated,
  // persisted through the keyed RPC, and re-routed in the same call —
  // never local-only. Slice C F2/M6: the response carries the re-route's
  // fresh confidence + reason codes, which replace the card's turn — the
  // previous classification is never carried forward. The idempotency key
  // is minted in the submit handler (one per user submit) and travels in
  // the mutation vars, so a transport retry replays the same submit.
  // Double-submit guard for the answers card below. The card locks via
  // `disabled` on the next render, but two submits in the same tick both see
  // `isPending` false — the ref drops the second synchronously, so one user
  // submit posts exactly once. Cleared when the mutation settles, so a failed
  // save stays retryable.
  const answersSubmitOpenRef = useRef(false);
  const submitAnswers = useMutation({
    mutationFn: async (vars: {
      spec: QuestionnaireSpec;
      answers: QuestionnaireAnswers;
      idempotencyKey: string;
    }) => {
      if (!threadId) throw new Error("No active conversation. Send a message first.");
      const submitted = (await agentPostJson(
        `${base}/${threadId}/answers?page=${page}`,
        {
          idempotencyKey: vars.idempotencyKey,
          resumeKey: vars.spec.resumeKey,
          spec: vars.spec,
          answers: vars.answers,
        },
        correlationId,
      )) as {
        message: ThreadMessageView;
        replayed: boolean;
        answers: Record<string, string>;
        intent: AgentIntent;
        confidence: "high" | "medium" | "low";
        reasonCodes: string[];
        questionnaire: QuestionnaireSpec | null;
        ideaDraft?: IdeaDraftOutcome | null;
        watchChoice?: AgentWatchChoice | null;
      };
      return { ...submitted, resumeKey: vars.spec.resumeKey };
    },
    onSuccess: (result, vars) => {
      // Latch-only: a duplicate submit or a watch envelope back keeps
      // the fallback armed even if the re-route drifts elsewhere.
      if (vars.spec.kind === "duplicate_watch" || result.watchChoice != null) {
        setWatchTurn(true);
      }
      setMessages((previous) =>
        previous.some((message) => message.id === result.message.id)
          ? previous
          : [...previous, result.message],
      );
      setRouteResult({
        intent: result.intent,
        confidence: result.confidence,
        reasonCodes: result.reasonCodes ?? [],
        questionnaire: result.questionnaire,
      });
      setSubmittedAnswers((previous) => ({ ...previous, [result.resumeKey]: result.answers }));
      setLastSaved({ resumeKey: result.resumeKey, answers: result.answers });
      // The pick-to-draft envelope arrives here (or stays null for other
      // cards); the advice card below renders it.
      setIdeaDraft(result.ideaDraft ?? null);
      // The watch one-tap envelope arrives here (or stays null); the
      // one-tap card below renders the receipt.
      setWatchChoice(result.watchChoice ?? null);
      setSendError(null);
      setAnnouncement(`Answers saved and re-routed to ${result.intent}.`);
      // The re-route synthesizes again server-side; re-read the durable
      // rows so the fresh answer renders beside the saved answers.
      if (threadId) void refreshMessages(threadId);
      void queryClient.invalidateQueries({ queryKey: ["agent-threads", organizationId] });
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : "Saving answers failed.");
      setAnnouncement("Saving answers failed.");
    },
  });
  // Governed fallback dispatch (FINAL fix for I-1): the restored manual
  // forms below take their parameters from the operator; the dispatch
  // route rechecks the grant and Zod-disposes every field. (Task B3
  // removed the research confirm click — research auto-runs zero-click
  // from the route response.) The idempotency key is minted at click time
  // (one per user confirm) and travels in the mutation vars, so a
  // transport retry replays the same dispatch.
  const dispatchLane = useMutation({
    mutationFn: async (vars: {
      action: DispatchAction;
      idempotencyKey: string;
      watchCreate?: {
        branchId: string;
        title?: string;
        question: string;
        mode: "one-time" | "recurring";
        researchArea: string;
      };
      watchUpdate?: { projectId: string; edits: Record<string, unknown> };
    }) => {
      if (!threadId) throw new Error("No active conversation. Send a message first.");
      const payload = buildDispatchPayload({
        action: vars.action,
        idempotencyKey: vars.idempotencyKey,
        ...(vars.watchCreate ? { watchCreate: vars.watchCreate } : {}),
        ...(vars.watchUpdate ? { watchUpdate: vars.watchUpdate } : {}),
      });
      return (await agentPostJson(
        `${base}/${threadId}/dispatch`,
        payload as unknown as Record<string, unknown>,
        correlationId,
      )) as AgentDispatchOutcome;
    },
    onSuccess: (result, vars) => {
      setDispatchOutcome(result);
      setDispatchError(null);
      setAnnouncement(
        result.replayed
          ? "Already queued — showing the kept run."
          : vars.action === "watch_create"
            ? "Watch queued. Track it in Market Intelligence."
            : vars.action === "watch_update"
              ? "Watch update queued."
              : "Research queued. Track it in Market Intelligence.",
      );
    },
    onError: (error) => {
      setDispatchError(
        error instanceof Error ? error.message : "Dispatch failed. Nothing was enqueued.",
      );
      setAnnouncement("Dispatch failed.");
    },
  });
  // Pump: adopt a fresh prompt into the queue, then run queued prompts one
  // at a time so rapid sends never mint two threads for one conversation.
  // Only ref writes, prop callbacks, and mutate calls here — no setState.
  const sendPending = send.isPending;
  const pendingNonce = pendingPrompt?.nonce;
  useEffect(() => {
    if (pendingPrompt && consumedNonceRef.current !== pendingPrompt.nonce) {
      consumedNonceRef.current = pendingPrompt.nonce;
      onPromptConsumed();
      queueRef.current.push(pendingPrompt);
      onViewChange("thread");
    }
    if (!sendPending) {
      const next = queueRef.current.shift();
      if (next) send.mutate({ text: next.text, threadMode: mode, threadId, nonce: next.nonce });
    }
    // The pump reads the latest render values through its deps; callbacks
    // are intentionally not deps (they are stable enough per render and the
    // nonce/pending guards make repeats idempotent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNonce, sendPending, threadId]);

  const historyQuery = useQuery({
    queryKey: ["agent-threads", organizationId],
    queryFn: () => agentGetJson(`${base}?limit=20`, correlationId) as Promise<ThreadsResponse>,
    enabled: view === "history",
  });

  /**
   * Durable-checkpoint poll (spec section 10, performance-build-watcher
   * pattern, Slice C M9): one GET against the single thread row, which
   * carries the worker-written links (research project, request, draft
   * request, campaign) — re-reading it is how the drawer learns a
   * background run finished. A dropped poll keeps the previous row and
   * retries — never mistaken for an answer. Terminal thread rows stop
   * the interval; fresh sends resume it via the thread state they set.
   * Never the collection list: one open drawer re-reads one row per
   * tick, not up to fifty.
   */
  const threadPoll = useQuery({
    queryKey: ["agent-thread", organizationId, threadId],
    queryFn: async () => {
      const body = (await agentGetJson(`${base}/${threadId}`, correlationId)) as {
        thread: ThreadSummary | null;
      };
      return body.thread ?? null;
    },
    enabled: threadId !== null,
    staleTime: AGENT_THREAD_POLL_MS,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const row = query.state.data;
      if (row && (row.status === "completed" || row.status === "cancelled")) return false;
      return AGENT_THREAD_POLL_MS;
    },
  });

  // The polled row wins when it arrives: worker link updates land here,
  // and the send/reopen paths below seed the same state optimistically.
  // resolveLiveThread holds a B2 in-memory escalation across poll ticks.
  const liveThread = resolveLiveThread(threadPoll.data ?? null, thread);

  const reopen = useMutation({
    mutationFn: async (target: ThreadSummary) => {
      const body = (await agentGetJson(
        `${base}/${target.id}/messages?limit=50`,
        correlationId,
      )) as MessagesResponse;
      return { target, messages: body.messages };
    },
    onMutate: () => {
      // Navigate first, load second: the thread view opens immediately with
      // chat-mimicking skeleton bubbles while the durable read lands.
      // Reopens never resume a stream — any live one dies here. The reloaded
      // turn starts clean: a leaked end flag must not stick it done.
      setEndReceived(false);
      abortLiveStream();
      setLiveStream(null);
      onViewChange("thread");
      setMessages([]);
      setThread(null);
      setRouteResult(null);
      setSendError(null);
    },
    onSuccess: ({ target, messages: reopened }) => {
      onThreadChange(target.id);
      setThread(target);
      setMessages(reopened);
      setRouteResult(null);
      setSendError(null);
      setSubmittedAnswers({});
      setDismissedCards([]);
      setLastSaved(null);
      setIdeaDraft(null);
      setWatchChoice(null);
      setDispatchOutcome(null);
      setDispatchError(null);
      setWatchTurn(false);
      onViewChange("thread");
      setAnnouncement(`Reopened ${target.title}.`);
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : "Reopen failed.");
      onViewChange("thread");
    },
  });

  function startNewThread() {
    onThreadChange(null);
    // A fresh conversation starts clean: no leaked end flag.
    setEndReceived(false);
    abortLiveStream();
    setLiveStream(null);
    setMessages([]);
    setThread(null);
    setRouteResult(null);
    setSendError(null);
    setSubmittedAnswers({});
    setDismissedCards([]);
    setLastSaved(null);
    setIdeaDraft(null);
    setWatchChoice(null);
    setDispatchOutcome(null);
    setDispatchError(null);
    setWatchTurn(false);
    onViewChange("thread");
    setAnnouncement("Started a new conversation.");
  }

  // A connecting or live stream keeps the run in-flight: steps stay
  // in-progress until the `end` swap or the drop note settles the turn.
  const streamActive = liveStream !== null && liveStream.phase !== "dropped";
  // G1 honest send: EVERY post-send failure lands in the error state —
  // send, stream open, and answers via sendError; messages refresh via
  // sendError; the checkpoint poll derived below (self-healing on the next
  // green tick). Failure outranks routing so no turn sticks on Thinking and
  // every spinner stops.
  const pollError = threadPoll.isError ? AGENT_REFRESH_ERROR : null;
  const turnFailure = sendError ?? pollError;
  // The durable swap stays the finish line: once an assistant row exists
  // the final bubble has landed, so steps go terminal even while the poll
  // still reads `running`; a `running` thread with no assistant row yet is
  // genuinely in flight and keeps the single narrating row.
  const turnSettled = messages.some((message) => message.role === "assistant");
  // Settle guarantee: a validated `end` (durable row or validated draft)
  // settles the turn even if the refresh lags or pending/stream flags wedge
  // — end-received with a routed turn present outranks them by construction.
  // Gated on routeResult/liveThread so a leaked flag can never prematurely
  // settle an unrouted turn; resets on send/reopen/new-chat keep next turns
  // clean. Failures still error first; pre-end streaming still routes.
  const endReceivedForTurn =
    endReceived && (routeResult !== null || liveThread !== null);
  const phase: AgentStepPhase =
    turnFailure
      ? "error"
      : endReceivedForTurn
        ? "done"
        : send.isPending || streamActive
          ? "routing"
          : routeResult || liveThread
            ? liveThread?.status === "running" && !turnSettled
              ? "routing"
            : "done"
          : "idle";

  // A converged duplicate envelope carries the live card: it replaces the
  // re-route's questionnaire (fresh resume key, so it is not hidden as
  // already answered) and stays the tap surface for view/update/fresh.
  const questionnaire =
    watchChoice?.outcome === "duplicate" ? watchChoice.card : (routeResult?.questionnaire ?? null);
  const cardKey = questionnaire?.resumeKey ?? null;
  // The answered card hides while its save is in flight — the Marker
  // shimmer below owns the turn until the re-routed card (or the error)
  // lands. A failed save clears `isPending`, so the card returns retryable.
  const cardVisible = Boolean(
    questionnaire &&
      cardKey &&
      !submittedAnswers[cardKey] &&
      !dismissedCards.includes(cardKey) &&
      !submitAnswers.isPending,
  );

  // Manual fallback trigger (FINAL fix for I-1): the restored forms mount
  // only when the turn involved a watch card, the grant holds, one-tap did
  // not already succeed, and no error-free card is still answerable. A
  // fresh tappable card suppresses the fallback (one-tap stays primary and
  // undisplaced); an errored tap, a needs_input/blocked envelope with no
  // follow-up card, a card-less watch turn, or a re-route that drifted
  // away from watch all arm it. Viewers and grant-less roles never see it
  // — the grant note above stays their only surface.
  const oneTapSucceeded =
    watchChoice?.outcome === "created" ||
    watchChoice?.outcome === "replayed" ||
    watchChoice?.outcome === "updated" ||
    watchChoice?.outcome === "view_existing";
  const cardAnswerable = cardVisible && !sendError;
  const showWatchFallback =
    watchTurn &&
    threadId !== null &&
    canManageWatch &&
    !oneTapSucceeded &&
    !cardAnswerable;

  // Duplicate-watch gating (spec section 12). Viewing the existing
  // watch and cancelling stay free for every member; Update-fields needs
  // the manage grant AND the watchUpdateAvailable flag, and Start-fresh
  // needs the grant (it mints a second watch). The server rechecks the
  // grant on submit; the flag only shapes what the card offers.
  const isDuplicateCard = questionnaire?.kind === "duplicate_watch";
  const gatedChoices: string[] = [];
  if (isDuplicateCard && !canManageWatch) gatedChoices.push("update_fields", "start_fresh");
  else if (isDuplicateCard && !watchUpdateAvailable) gatedChoices.push("update_fields");
  const gatedChoiceReason = !isDuplicateCard
    ? undefined
    : !canManageWatch
      ? "Watch updates and second watches need the growth_intelligence.manage grant — enforcement stays server-side. Viewing the existing watch stays free."
      : !watchUpdateAvailable
        ? "Watch field updates are unavailable for this chat — viewing the existing watch stays free."
        : undefined;

  if (collapsed) {
    // Attached strip: the shell mounts the drawer in-flow directly above
    // the bar, so this is a bare button with no fixed positioning — one
    // attached unit, never a floating overlap.
    return (
      <div className="dark">
        <Button
          type="button"
          variant="secondary"
          className="mb-2 w-full justify-between"
          onClick={onToggleCollapsed}
          aria-label={`Expand conversation${liveThread ? `: ${liveThread.title}` : ""}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                phase === "routing"
                  ? "bg-amber-500"
                  : phase === "error"
                    ? "bg-destructive"
                    : "bg-emerald-500",
              )}
            />
            <span className="truncate text-sm">{liveThread?.title ?? "New conversation"}</span>
          </span>
          <span className="flex items-center gap-2">
            {!turnFailure && (send.isPending || streamActive) ? (
              <Spinner aria-hidden="true" />
            ) : null}
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </span>
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <section
        aria-label="AI agent conversation"
        onKeyDown={(event) => {
          if (event.key === "Escape") onToggleCollapsed();
        }}
        style={unitStyle}
        className={
          disableUnitTransform
            ? // Shell-mounted (G5): in-flow directly above the bar in the
              // shared column, so the container's single translate3d moves
              // both with zero offset. A second `fixed` position here would
              // re-anchor to the transformed container (live: the doubled
              // sidebar offset shifted the drawer 128px off the bar and
              // stranded it half off-screen). mb-2 keeps the attached-but-
              // not gap; flow follows the bar height on its own.
              "dark mb-2 flex w-full justify-center"
            : cn(
                "dark fixed right-0 flex justify-center px-4",
                bottomOffset,
                sidebarOffset,
              )
        }
      >
        <div
          style={panelStyle}
          className="relative flex h-[34rem] max-h-[calc(100dvh-12rem)] w-[min(44rem,100%)] shrink-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lg"
        >
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            AI agent conversation
          </h2>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>

          <div className="flex items-center gap-2">
            {isMobile ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-testid="agent-drawer-drag-handle"
                onPointerDown={beginUnitDrag}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 64 : 16;
                  if (event.key === "ArrowLeft") nudgeUnit(-step, 0);
                  else if (event.key === "ArrowRight") nudgeUnit(step, 0);
                  else if (event.key === "ArrowUp") nudgeUnit(0, -step);
                  else if (event.key === "ArrowDown") nudgeUnit(0, step);
                  else return;
                  event.preventDefault();
                }}
                aria-label="Move conversation"
                title="Drag to move"
                className="shrink-0 cursor-grab touch-none text-zinc-400 select-none hover:text-zinc-100 active:cursor-grabbing"
              >
                <GripVerticalIcon aria-hidden="true" />
              </Button>
            )}
            {view === "thread" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onViewChange("history")}
                aria-label="Back to thread history"
                title="Thread history"
                className="shrink-0 text-zinc-400 hover:text-zinc-100"
              >
                <HistoryIcon aria-hidden="true" />
              </Button>
            ) : null}
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {view === "history"
                ? "Thread history"
                : threadTitleFor(messages, liveThread?.title, pendingPrompt?.text)}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label="Collapse conversation to status strip"
              >
                <ChevronDownIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close conversation"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          </div>

          {view === "thread" ? (
            <div
              role="log"
              aria-label="Conversation thread"
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pt-2"
            >
              {turnFailure ? (
                <p role="alert" className="text-sm text-destructive">
                  {turnFailure}
                </p>
              ) : null}
              {reopen.isPending ? (
                <div
                  role="status"
                  aria-label="Loading conversation"
                  className="flex flex-col gap-3"
                >
                  <div className="flex justify-end">
                    <Skeleton className="h-10 w-2/5 rounded-xl" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-4 w-3/5" />
                    <div className="flex gap-2">
                      <Skeleton className="h-6 w-24 rounded-full" />
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </div>
                  </div>
                </div>
              ) : null}
              {!reopen.isPending && messages.length === 0 && !send.isPending ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
                  <SparklesIcon className="size-8 text-zinc-400" aria-hidden="true" />
                  <p className="text-sm text-zinc-300">
                    Ask anything to initiate the conversation.
                  </p>
                </div>
              ) : null}
              {messages.map((message) =>
                isAnswersRowMessage(message) ? (
                  <Marker key={message.id}>
                    <MarkerIcon aria-label="Answers saved">
                      <CheckIcon aria-hidden="true" />
                    </MarkerIcon>
                    <MarkerContent>
                      {summarizeAnswersBody(message).length > 0 ? (
                        <>You clarified: {summarizeAnswersBody(message)}</>
                      ) : (
                        "You clarified."
                      )}
                    </MarkerContent>
                  </Marker>
                ) : message.role === "assistant" ? (
                  <AgentResponseMessage key={message.id} message={message} />
                ) : (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <Card
                      className={cn(
                        "max-w-[90%]",
                        message.role === "user" ? "border-white/10 bg-white/10 text-zinc-100" : "",
                      )}
                    >
                      <CardContent className="text-sm break-words whitespace-pre-wrap">
                        {message.body ?? "(empty message)"}
                      </CardContent>
                    </Card>
                  </div>
                ),
              )}
              {liveStream?.phase === "connecting" ? (
                <div
                  role="status"
                  aria-label="Loading live answer"
                  className="flex flex-col gap-2"
                >
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              ) : null}
              {liveStream && liveStream.phase !== "connecting" && liveStream.text !== "" ? (
                <AgentResponseMessage
                  key={`live-${liveStream.key}`}
                  message={null}
                  liveBody={liveStream.text}
                  liveNote={liveStream.phase === "dropped" ? AGENT_STREAM_DROP_NOTE : null}
                />
              ) : null}
              {!reopen.isPending &&
              (send.isPending || streamActive || routeResult || liveThread || turnFailure) ? (
                <AgentThreadSteps
                  phase={phase}
                  intent={routeResult?.intent ?? null}
                  reasonCodes={routeResult?.reasonCodes ?? []}
                  thread={liveThread}
                  error={turnFailure}
                  awaitingUser={cardVisible && questionnaire?.kind === "clarify"}
                  growthIntelligenceHref={`/organizations/${organizationId}/growth-intelligence`}
                />
              ) : null}
              {cardVisible && questionnaire ? (
                <AgentQuestionnaireCard
                  key={questionnaire.resumeKey}
                  spec={questionnaire}
                  disabled={isViewer || submitAnswers.isPending}
                  disabledReason={
                    isViewer
                      ? "Viewers cannot change this chat — answers stay read-only."
                      : undefined
                  }
                  disabledOptionValues={gatedChoices}
                  disabledOptionReason={gatedChoiceReason}
                  onSubmit={(answers) => {
                    if (answersSubmitOpenRef.current) return;
                    answersSubmitOpenRef.current = true;
                    submitAnswers.mutate(
                      {
                        spec: questionnaire,
                        answers,
                        idempotencyKey: crypto.randomUUID(),
                      },
                      {
                        onSettled: () => {
                          answersSubmitOpenRef.current = false;
                        },
                      },
                    );
                  }}
                  onCancel={() => {
                    if (cardKey) setDismissedCards((previous) => [...previous, cardKey]);
                  }}
                />
              ) : null}
              {submitAnswers.isPending ? (
                <Marker role="status">
                  <MarkerContent>Saving answers…</MarkerContent>
                  <Skeleton className="h-4 w-3/5" />
                </Marker>
              ) : null}
              {lastSaved ? (
                <Marker>
                  <MarkerIcon aria-label="Answers saved">
                    <CheckIcon aria-hidden="true" />
                  </MarkerIcon>
                  <MarkerContent>You clarified: {formatAnswers(lastSaved.answers)}</MarkerContent>
                </Marker>
              ) : null}
              {(routeResult?.intent === "watch" || watchChoice) && threadId ? (
                <WatchOneTapCard
                  watchChoice={watchChoice}
                  intentIsWatch={routeResult?.intent === "watch"}
                  hasQuestionnaire={questionnaire !== null}
                  canManageWatch={canManageWatch}
                />
              ) : null}
              {showWatchFallback ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Manual watch fallback
                  </p>
                  <p className="text-xs text-muted-foreground">
                    One-tap didn&apos;t finish this watch — the form below posts directly
                    to dispatch.
                  </p>
                  <WatchDispatchForms
                    defaultProjectId={liveThread?.linkedResearchProjectId ?? null}
                    watchUpdateAvailable={watchUpdateAvailable}
                    pending={dispatchLane.isPending}
                    outcome={dispatchOutcome}
                    error={dispatchError}
                    onDispatch={(vars) => dispatchLane.mutate(vars)}
                  />
                </div>
              ) : null}
              {routeResult?.intent === "campaign_advice" || ideaDraft ? (
                <>
                  {/*
                    Direct-path asymmetry (Slice C decision: DOCUMENTED, not
                    aligned). This inline block renders the ideas-first
                    advice card from the pick-to-draft envelope (the answers
                    route drafts server-side on pick), while the dispatch
                    route's campaign lane admits through `adviseCampaign`
                    from its seam — and only the dispatch seam emits
                    `agent_thread.draft_requested`. Both paths stay governed;
                    only the audit event differs. The card stays mounted
                    while the envelope is set so the draft receipt survives
                    the answers re-route.
                  */}
                  <AgentCampaignAdvice
                    organizationId={organizationId}
                    thread={liveThread}
                    canDraft={canDraft}
                    isViewer={isViewer}
                    ideaDraft={ideaDraft}
                  />
                </>
              ) : null}
            </div>
          ) : (
            <div
              role="list"
              aria-label="Thread history"
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto"
            >
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={startNewThread}>
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  New chat
                </Button>
              </div>
              {historyQuery.isPending ? (
                <div className="flex flex-col gap-2" role="status" aria-label="Loading history">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : null}
              {historyQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  History could not load. Your threads are still stored server-side.
                </p>
              ) : null}
              {(historyQuery.data?.threads ?? []).map((item) => (
                <div
                  key={item.id}
                  role="listitem"
                  className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium">{item.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={item.mode === "deepthink" ? "default" : "secondary"}>
                        {item.mode === "deepthink" ? "DeepThink" : "Quick"}
                      </Badge>
                      <span>{item.status}</span>
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => reopen.mutate(item)}
                    aria-label={`Open ${item.title}`}
                    title={`Open ${item.title}`}
                  >
                    <ChevronRightIcon aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {historyQuery.data && historyQuery.data.threads.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No threads yet. Each conversation is kept per organization.
                </p>
              ) : null}
            </div>
          )}
          {isMobile ? null : (
            <>
              <button
                type="button"
                data-testid="agent-drawer-resize-e"
                onPointerDown={(event) => beginResize("e", event)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 64 : 16;
                  if (event.key === "ArrowLeft") nudgeSize("e", -step, 0);
                  else if (event.key === "ArrowRight") nudgeSize("e", step, 0);
                  else return;
                  event.preventDefault();
                }}
                aria-label="Resize conversation width"
                title="Drag to resize width"
                className="absolute top-0 right-0 h-full w-2 cursor-ew-resize touch-none focus-visible:outline-2 focus-visible:outline-ring"
              />
              <button
                type="button"
                data-testid="agent-drawer-resize-w"
                onPointerDown={(event) => beginResize("w", event)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 64 : 16;
                  if (event.key === "ArrowLeft") nudgeSize("w", -step, 0);
                  else if (event.key === "ArrowRight") nudgeSize("w", step, 0);
                  else return;
                  event.preventDefault();
                }}
                aria-label="Resize conversation width from the left"
                title="Drag to resize width from the left"
                className="absolute top-0 left-0 h-full w-2 cursor-ew-resize touch-none focus-visible:outline-2 focus-visible:outline-ring"
              />
              <button
                type="button"
                data-testid="agent-drawer-resize-s"
                onPointerDown={(event) => beginResize("s", event)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 64 : 16;
                  if (event.key === "ArrowUp") nudgeSize("s", 0, -step);
                  else if (event.key === "ArrowDown") nudgeSize("s", 0, step);
                  else return;
                  event.preventDefault();
                }}
                aria-label="Resize conversation height"
                title="Drag to resize height"
                className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize touch-none focus-visible:outline-2 focus-visible:outline-ring"
              />
              <button
                type="button"
                data-testid="agent-drawer-resize-se"
                onPointerDown={(event) => beginResize("se", event)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 64 : 16;
                  if (event.key === "ArrowLeft") nudgeSize("se", -step, 0);
                  else if (event.key === "ArrowRight") nudgeSize("se", step, 0);
                  else if (event.key === "ArrowUp") nudgeSize("se", 0, -step);
                  else if (event.key === "ArrowDown") nudgeSize("se", 0, step);
                  else return;
                  event.preventDefault();
                }}
                aria-label="Resize conversation"
                title="Drag to resize"
                className="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none focus-visible:outline-2 focus-visible:outline-ring"
              />
              <button
                type="button"
                data-testid="agent-drawer-resize-sw"
                onPointerDown={(event) => beginResize("sw", event)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 64 : 16;
                  if (event.key === "ArrowLeft") nudgeSize("sw", -step, 0);
                  else if (event.key === "ArrowRight") nudgeSize("sw", step, 0);
                  else if (event.key === "ArrowUp") nudgeSize("sw", 0, -step);
                  else if (event.key === "ArrowDown") nudgeSize("sw", 0, step);
                  else return;
                  event.preventDefault();
                }}
                aria-label="Resize conversation from the left"
                title="Drag to resize from the left"
                className="absolute left-0 bottom-0 size-4 cursor-nesw-resize touch-none focus-visible:outline-2 focus-visible:outline-ring"
              />
            </>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
