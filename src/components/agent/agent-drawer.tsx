"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, HistoryIcon, PlusIcon, XIcon } from "lucide-react";

import {
  AgentQuestionnaireCard,
  type QuestionnaireAnswers,
} from "@/components/agent/agent-questionnaire-card";
import { AgentResponseMessage } from "@/components/agent/agent-response-message";
import {
  AgentCampaignAdvice,
  type CampaignAdviceContext,
  type CampaignAdviceOpportunity,
} from "@/components/agent/agent-campaign-advice";
import type { AdviseCampaignSeams } from "@/modules/agent-chat/application/campaign-advise";
import { AgentThreadSteps, type AgentStepPhase } from "@/components/agent/agent-thread-steps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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

export type AgentDrawerTab = "response" | "steps" | "draft" | "history";

export type PendingPrompt = { text: string; nonce: number };

export type AgentRouteResult = {
  intent: AgentIntent;
  confidence: "high" | "medium" | "low";
  reasonCodes: string[];
  questionnaire: QuestionnaireSpec | null;
};

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
  /** Actor id for the eligible campaign-draft path. Absent → brief path. */
  actorId?: string;
  /** Opportunity binding the draft request. Absent → brief path. */
  opportunity?: CampaignAdviceOpportunity | null;
  /** Full advice context. Absent → brief path, nothing invented. */
  advice?: CampaignAdviceContext | null;
  /** Injected campaign seams for tests; defaults post to the live routes. */
  campaignSeams?: AdviseCampaignSeams;
  /**
   * Whether the watch schedule-update path is available. True: the
   * schedule RPC is live and proven on staging, so Update-fields is
   * offered to grant-holders (the server rechecks the grant on submit).
   * Pass false explicitly to force the honest unavailable copy.
   */
  watchUpdateAvailable?: boolean;
  activeTab: AgentDrawerTab;
  onTabChange: (tab: AgentDrawerTab) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onThreadChange: (threadId: string | null) => void;
  onPromptConsumed: () => void;
};

type ThreadsResponse = { threads: ThreadSummary[]; nextCursor: string | null };
type MessagesResponse = { messages: ThreadMessageView[]; nextCursor: string | null };

/** Durable-checkpoint poll cadence (performance-build-watcher pattern). */
export const AGENT_THREAD_POLL_MS = 3000;

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
 * Bottom sheet over the floating shell (spec section 5.2). Opens on send,
 * persists across the 5 pages within the session (thread state lives in the
 * shell above page switches; background progress resumes via the
 * thread-checkpoint poll), and collapses to a single-line status strip
 * docked on top of the shell. Tabs: Response / Steps / Draft advice /
 * History. History reopens through the Task 3 GET messages route, restoring
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
  actorId,
  opportunity = null,
  advice = null,
  campaignSeams,
  watchUpdateAvailable = true,
  activeTab,
  onTabChange,
  collapsed,
  onToggleCollapsed,
  onClose,
  onThreadChange,
  onPromptConsumed,
}: AgentDrawerProps) {
  const queryClient = useQueryClient();
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
  const [dispatchOutcome, setDispatchOutcome] = useState<AgentDispatchOutcome | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
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

  const send = useMutation({
    mutationFn: async (vars: { text: string; threadMode: ThreadMode; threadId: string | null }) => {
      let tid = vars.threadId;
      if (!tid) {
        const created = (await agentPostJson(
          base,
          {
            idempotencyKey: crypto.randomUUID(),
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
          idempotencyKey: crypto.randomUUID(),
          body: vars.text,
        },
        correlationId,
      )) as { message: ThreadMessageView };
      const routed = (await agentPostJson(
        `${base}/${tid}/route?page=${page}`,
        {
          idempotencyKey: crypto.randomUUID(),
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
      setDispatchOutcome(null);
      setDispatchError(null);
      onTabChange("response");
      setAnnouncement(`Routed to ${result.intent}.`);
      // The assistant row lands server-side during routing; re-read the
      // durable rows so the answer renders with citations + limitations.
      void refreshMessages(row.id);
      void queryClient.invalidateQueries({ queryKey: ["agent-threads", organizationId] });
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : "Sending failed. Nothing was stored.");
      onTabChange("response");
      setAnnouncement("Sending failed.");
    },
  });

  // Questionnaire submit (Task 6 ruling F2, drawer half): answers post
  // to the fenced answers route with the echoed spec — validated,
  // persisted through the keyed RPC, and re-routed in the same call —
  // never local-only. The returned message joins the thread and the new
  // classification replaces the card's. Confidence/reason codes carry
  // forward from this turn's classification; the answers call returns
  // intent + questionnaire only, by route contract.
  const submitAnswers = useMutation({
    mutationFn: async (vars: { spec: QuestionnaireSpec; answers: QuestionnaireAnswers }) => {
      if (!threadId) throw new Error("No active conversation. Send a message first.");
      const submitted = (await agentPostJson(
        `${base}/${threadId}/answers?page=${page}`,
        {
          idempotencyKey: crypto.randomUUID(),
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
        questionnaire: QuestionnaireSpec | null;
      };
      return { ...submitted, resumeKey: vars.spec.resumeKey };
    },
    onSuccess: (result) => {
      setMessages((previous) =>
        previous.some((message) => message.id === result.message.id)
          ? previous
          : [...previous, result.message],
      );
      setRouteResult((previous) =>
        previous
          ? {
              intent: result.intent,
              confidence: previous.confidence,
              reasonCodes: previous.reasonCodes,
              questionnaire: result.questionnaire,
            }
          : previous,
      );
      setSubmittedAnswers((previous) => ({ ...previous, [result.resumeKey]: result.answers }));
      setLastSaved({ resumeKey: result.resumeKey, answers: result.answers });
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
  // Governed dispatch (Slice B): the research lane needs no parameters —
  // the route resolves the Market Profile pointer server-side — so the
  // Steps tab can offer the confirm click directly. The click IS the
  // explicit confirmation the route requires. Watch and draft lanes need
  // their forms first (Slice C); the dispatch route already serves them.
  const dispatchLane = useMutation({
    mutationFn: async (vars: { action: DispatchAction }) => {
      if (!threadId) throw new Error("No active conversation. Send a message first.");
      const payload = buildDispatchPayload({
        action: vars.action,
        idempotencyKey: crypto.randomUUID(),
      });
      return (await agentPostJson(
        `${base}/${threadId}/dispatch`,
        payload as unknown as Record<string, unknown>,
        correlationId,
      )) as AgentDispatchOutcome;
    },
    onSuccess: (result) => {
      setDispatchOutcome(result);
      setDispatchError(null);
      setAnnouncement(
        result.replayed
          ? "Already queued — showing the kept run."
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
      onTabChange("steps");
    }
    if (!sendPending) {
      const next = queueRef.current.shift();
      if (next) send.mutate({ text: next.text, threadMode: mode, threadId });
    }
    // The pump reads the latest render values through its deps; callbacks
    // are intentionally not deps (they are stable enough per render and the
    // nonce/pending guards make repeats idempotent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNonce, sendPending, threadId]);

  const historyQuery = useQuery({
    queryKey: ["agent-threads", organizationId],
    queryFn: () => agentGetJson(`${base}?limit=20`, correlationId) as Promise<ThreadsResponse>,
    enabled: activeTab === "history",
  });

  /**
   * Durable-checkpoint poll (spec section 10, performance-build-watcher
   * pattern): the thread row carries the worker-written links (research
   * project, request, draft request, campaign), so re-reading it is how
   * the drawer learns a background run finished. A dropped poll keeps the
   * previous row and retries — never mistaken for an answer. Terminal
   * thread rows stop the interval; fresh sends resume it via the thread
   * state they set.
   */
  const threadPoll = useQuery({
    queryKey: ["agent-thread", organizationId, threadId],
    queryFn: async () => {
      const body = (await agentGetJson(`${base}?limit=50`, correlationId)) as ThreadsResponse;
      return body.threads.find((row) => row.id === threadId) ?? null;
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
  const liveThread = threadPoll.data ?? thread;

  const reopen = useMutation({
    mutationFn: async (target: ThreadSummary) => {
      const body = (await agentGetJson(
        `${base}/${target.id}/messages?limit=50`,
        correlationId,
      )) as MessagesResponse;
      return { target, messages: body.messages };
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
      onTabChange("response");
      setAnnouncement(`Reopened ${target.title}.`);
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : "Reopen failed.");
      onTabChange("response");
    },
  });

  function startNewThread() {
    onThreadChange(null);
    setMessages([]);
    setThread(null);
    setRouteResult(null);
    setSendError(null);
    setDispatchOutcome(null);
    setDispatchError(null);
    setSubmittedAnswers({});
    setDismissedCards([]);
    setLastSaved(null);
    onTabChange("response");
    setAnnouncement("Started a new conversation.");
  }

  const phase: AgentStepPhase = send.isPending
    ? "routing"
    : sendError
      ? "error"
      : routeResult || liveThread
        ? "done"
        : "idle";

  const questionnaire = routeResult?.questionnaire ?? null;
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
    return (
      <div className="fixed inset-x-0 bottom-24 flex justify-center px-4">
        <Button
          type="button"
          variant="secondary"
          className="w-[min(44rem,100%)] justify-between"
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
            {send.isPending ? <Spinner aria-hidden="true" /> : null}
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
        className="fixed inset-x-0 bottom-24 flex justify-center px-4"
      >
        <div className="flex max-h-[60vh] w-[min(44rem,100%)] flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lg">
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            AI agent conversation
          </h2>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>

          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {liveThread?.title ?? "New conversation"}
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

          <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as AgentDrawerTab)}>
            <TabsList aria-label="Conversation sections">
              <TabsTrigger value="response">Response</TabsTrigger>
              <TabsTrigger value="steps">Steps</TabsTrigger>
              <TabsTrigger value="draft">Draft advice</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="response" className="flex flex-col gap-3 overflow-y-auto">
              {sendError ? (
                <p role="alert" className="text-sm text-destructive">
                  {sendError}
                </p>
              ) : null}
              {messages.length === 0 && !send.isPending ? (
                <p className="text-sm text-muted-foreground">
                  Ask anything. Answers render here with their sources and limitations.
                </p>
              ) : null}
              {send.isPending ? (
                <div className="flex items-center gap-2" role="status">
                  <Spinner aria-hidden="true" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : null}
              {messages.map((message) =>
                message.role === "assistant" ? (
                  <AgentResponseMessage key={message.id} message={message} />
                ) : (
                  <div
                    key={message.id}
                    className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
                  >
                    <Card
                      className={cn(
                        "max-w-[90%]",
                        message.role === "user" ? "bg-primary text-primary-foreground" : "",
                      )}
                    >
                      <CardContent className="text-sm whitespace-pre-wrap">
                        {message.body ?? "(empty message)"}
                      </CardContent>
                    </Card>
                  </div>
                ),
              )}
              {routeResult ? (
                <p className="text-sm text-muted-foreground">
                  Routed to <Badge variant="secondary">{routeResult.intent}</Badge>
                </p>
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
                    submitAnswers.mutate({ spec: questionnaire, answers });
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
            </TabsContent>

            <TabsContent value="steps" className="overflow-y-auto">
              <AgentThreadSteps
                phase={phase}
                intent={routeResult?.intent ?? null}
                reasonCodes={routeResult?.reasonCodes ?? []}
                thread={liveThread}
                error={sendError}
                growthIntelligenceHref={`/organizations/${organizationId}/growth-intelligence`}
              />
              {routeResult?.intent === "research_once" && threadId ? (
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    type="button"
                    disabled={!canManageWatch || dispatchLane.isPending}
                    onClick={() => dispatchLane.mutate({ action: "research_once" })}
                    title={
                      canManageWatch
                        ? "Queue one TinyFish research run for this chat. This click is the confirmation — the worker spends only inside its reserve-before-call budget."
                        : "Needs the growth_intelligence.manage grant — enforcement stays server-side."
                    }
                  >
                    {dispatchLane.isPending ? <Spinner aria-hidden="true" /> : null}
                    Run research once
                  </Button>
                  {!canManageWatch ? (
                    <p className="text-xs text-muted-foreground">
                      Needs the growth_intelligence.manage grant — enforcement stays server-side.
                    </p>
                  ) : null}
                  {dispatchError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {dispatchError}
                    </p>
                  ) : null}
                  {dispatchOutcome ? (
                    <p className="text-sm text-muted-foreground">
                      {dispatchOutcome.replayed
                        ? "Already queued — showing the kept run."
                        : "Research queued."}{" "}
                      {dispatchOutcome.link ? (
                        <a
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          href={dispatchOutcome.link.href}
                        >
                          Open Market Intelligence
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="draft" className="flex flex-col gap-3 overflow-y-auto">
              {routeResult?.intent === "campaign_advice" ? (
                <AgentCampaignAdvice
                  organizationId={organizationId}
                  actorId={actorId}
                  threadId={threadId}
                  thread={liveThread}
                  canDraft={canDraft}
                  isViewer={isViewer}
                  opportunity={opportunity}
                  advice={advice}
                  seams={campaignSeams}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No draft advice yet. Ask for campaign advice and the review card appears here.
                </p>
              )}
            </TabsContent>

            <TabsContent value="history" className="flex flex-col gap-2 overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                  Thread history
                </p>
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
                    size="sm"
                    disabled={reopen.isPending}
                    onClick={() => reopen.mutate(item)}
                    aria-label={`Reopen ${item.title}`}
                  >
                    {reopen.isPending ? <Spinner aria-hidden="true" /> : "Reopen"}
                  </Button>
                </div>
              ))}
              {historyQuery.data && historyQuery.data.threads.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No threads yet. Each conversation is kept per organization.
                </p>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </TooltipProvider>
  );
}
