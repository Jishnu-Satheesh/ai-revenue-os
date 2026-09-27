"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HistoryIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAgentSidebarOffset } from "@/components/agent/agent-placement";
import type { AgentIntent } from "@/domain/agent-router/intents";
import type { RouterRole, QuestionnaireSpec } from "@/domain/agent-router/contracts";
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
 *   correlationId}` — `messageId` is the durable assistant row id (null
 *   for viewers and conflicting/failed appends: draft-only). `draft` is
 *   the content persisted when `messageId` is non-null.
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
 * Watch one-tap result (Task B4, L3). The manual dispatch forms are gone:
 * the questionnaire card submit is the single tap, and the answers route
 * executes behind it with the auto-prepared payload. This card renders
 * the returned envelope — created receipt plus assumptions, the viewed
 * link, the applied update, the scope proposal, or the honest blocked
 * copy. It posts nothing itself; the drawer never touches dispatch.
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
}: AgentDrawerProps) {
  const queryClient = useQueryClient();
  const sidebarOffset = useAgentSidebarOffset();
  const base = `/api/organizations/${organizationId}/agent/threads`;

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
   * echoes and never a token stream. Merges by id so locally appended rows
   * (user prompt, answers receipt) survive the refresh.
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
      // The send already succeeded; a failed refresh keeps the local rows
      // and the next reopen replays the durable read.
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
            // renders, so reconnects always agree with history.
            setLiveStream(null);
            void refreshMessages(args.threadId);
          } else {
            // Draft-only (viewers, conflicting/failed appends): no durable
            // row exists, so the validated `end` draft renders with its
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
      // The stream never opened (auth, tenancy, validation, transport):
      // partial text keeps its honest note, otherwise fall back to the
      // durable read — the routed turn's row still renders.
      streamAbortRef.current = null;
      setLiveStream((previous) => {
        if (!previous || previous.key !== key) return previous;
        if (previous.text === "") return null;
        return { ...previous, phase: "dropped" };
      });
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
    onSuccess: ({ thread: row, userMessage, result }) => {
      setThread(row);
      setMessages((previous) => [...previous, userMessage]);
      setRouteResult(result);
      setSendError(null);
      setIdeaDraft(null);
      setWatchChoice(null);
      onViewChange("thread");
      setAnnouncement(`Routed to ${result.intent}.`);
      // The answer streams live from here: tokens render into the thread
      // bubble and the `end` marker swaps to the durable row. The stream
      // opens once per send — never on reconnect or reopen.
      void openAnswerStream({ threadId: row.id, userMessageId: userMessage.id });
      void queryClient.invalidateQueries({ queryKey: ["agent-threads", organizationId] });
    },
    onError: (error) => {
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
    onSuccess: (result) => {
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
  // Task B4 removed the drawer dispatch mutation with the manual
  // watch forms: the answers route executes the tap server-side, and the
  // one-tap card below renders the returned envelope. The dispatch route
  // itself stays for manual and API use.
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
      // Reopens never resume a stream — any live one dies here.
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
    onViewChange("thread");
    setAnnouncement("Started a new conversation.");
  }

  // A connecting or live stream keeps the run in-flight: steps stay
  // in-progress until the `end` swap or the drop note settles the turn.
  const streamActive = liveStream !== null && liveStream.phase !== "dropped";
  const phase: AgentStepPhase =
    send.isPending || streamActive
      ? "routing"
      : sendError
        ? "error"
        : routeResult || liveThread
          ? "done"
          : "idle";

  // A converged duplicate envelope carries the live card: it replaces the
  // re-route's questionnaire (fresh resume key, so it is not hidden as
  // already answered) and stays the tap surface for view/update/fresh.
  const questionnaire =
    watchChoice?.outcome === "duplicate" ? watchChoice.card : (routeResult?.questionnaire ?? null);
  const cardKey = questionnaire?.resumeKey ?? null;
  const cardVisible = Boolean(
    questionnaire && cardKey && !submittedAnswers[cardKey] && !dismissedCards.includes(cardKey),
  );

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
            {send.isPending || streamActive ? <Spinner aria-hidden="true" /> : null}
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
        className={cn("dark fixed right-0 flex justify-center px-4", bottomOffset, sidebarOffset)}
      >
        <div className="flex h-[34rem] max-h-[calc(100dvh-12rem)] w-[min(44rem,100%)] flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lg">
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            AI agent conversation
          </h2>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>

          <div className="flex items-center gap-2">
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
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto"
            >
              {sendError ? (
                <p role="alert" className="text-sm text-destructive">
                  {sendError}
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
                message.role === "assistant" ? (
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
              (send.isPending || streamActive || routeResult || liveThread || sendError) ? (
                <AgentThreadSteps
                  phase={phase}
                  intent={routeResult?.intent ?? null}
                  reasonCodes={routeResult?.reasonCodes ?? []}
                  thread={liveThread}
                  error={sendError}
                  growthIntelligenceHref={`/organizations/${organizationId}/growth-intelligence`}
                />
              ) : null}
              {messages
                .filter((message) => message.questionnaireAnswers)
                .map((message) => (
                  <p key={`saved-${message.id}`} className="text-sm text-muted-foreground">
                    Saved answers:{" "}
                    {formatAnswers(message.questionnaireAnswers as Record<string, unknown>)}
                  </p>
                ))}
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
                <p role="status" className="text-sm text-muted-foreground">
                  Saving answers…
                </p>
              ) : null}
              {lastSaved ? (
                <p className="text-sm text-muted-foreground">
                  Answers saved: {formatAnswers(lastSaved.answers)}
                </p>
              ) : null}
              {(routeResult?.intent === "watch" || watchChoice) && threadId ? (
                <WatchOneTapCard
                  watchChoice={watchChoice}
                  intentIsWatch={routeResult?.intent === "watch"}
                  hasQuestionnaire={questionnaire !== null}
                  canManageWatch={canManageWatch}
                />
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
        </div>
      </section>
    </TooltipProvider>
  );
}
