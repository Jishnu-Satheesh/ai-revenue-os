"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, HistoryIcon, PlusIcon, XIcon } from "lucide-react";

import {
  AgentQuestionnaireCard,
  type QuestionnaireAnswers,
} from "@/components/agent/agent-questionnaire-card";
import { AgentCampaignAdvice } from "@/components/agent/agent-campaign-advice";
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
import type {
  ThreadMessageView,
  ThreadMode,
  ThreadSummary,
} from "@/modules/agent-chat/infrastructure/thread-repository";

export type AgentDrawerTab = "response" | "steps" | "draft" | "history";

export type PendingPrompt = { text: string; nonce: number };

export type AgentRouteResult = {
  intent: AgentIntent;
  questionnaire: QuestionnaireSpec | null;
};

export type AgentDrawerProps = {
  organizationId: string;
  page: string;
  threadId: string | null;
  pendingPrompt: PendingPrompt | null;
  mode: ThreadMode;
  role: RouterRole;
  permissions: string[];
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

async function agentGetJson(path: string): Promise<unknown> {
  const response = await fetch(path, { method: "GET", headers: { accept: "application/json" } });
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
  }
  return body as unknown;
}

async function agentPostJson(path: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
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
 * shell above page switches; progress resumes via polling in later slices),
 * and collapses to a single-line status strip docked on top of the shell.
 * Tabs: Response / Steps / Draft advice / History. History reopens through
 * the Task 3 GET messages route, restoring messages plus saved answers.
 */
export function AgentDrawer({
  organizationId,
  page,
  threadId,
  pendingPrompt,
  mode,
  role,
  permissions,
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

  const [messages, setMessages] = useState<ThreadMessageView[]>([]);
  const [thread, setThread] = useState<ThreadSummary | null>(null);
  const [routeResult, setRouteResult] = useState<AgentRouteResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, QuestionnaireAnswers>>(
    {},
  );
  const [dismissedCards, setDismissedCards] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("Conversation opened.");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Sequential send queue in refs, not state: effects may drain refs and
  // fire mutations, but must never call setState directly. State only
  // changes in event handlers and mutation callbacks.
  const queueRef = useRef<PendingPrompt[]>([]);
  const consumedNonceRef = useRef<number | null>(null);

  const canDraft = permissions.includes("campaign.create");
  const isViewer = role === "viewer";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const send = useMutation({
    mutationFn: async (vars: { text: string; threadMode: ThreadMode; threadId: string | null }) => {
      let tid = vars.threadId;
      if (!tid) {
        const created = (await agentPostJson(base, {
          idempotencyKey: crypto.randomUUID(),
          mode: vars.threadMode,
        })) as { thread: ThreadSummary };
        tid = created.thread.id;
        onThreadChange(tid);
      }
      const appended = (await agentPostJson(`${base}/${tid}/messages`, {
        idempotencyKey: crypto.randomUUID(),
        body: vars.text,
      })) as { message: ThreadMessageView };
      const routed = (await agentPostJson(`${base}/${tid}/route?page=${page}`, {
        idempotencyKey: crypto.randomUUID(),
      })) as {
        intent: AgentIntent;
        questionnaire: QuestionnaireSpec | null;
        thread: ThreadSummary;
      };
      return {
        thread: routed.thread,
        userMessage: appended.message,
        result: { intent: routed.intent, questionnaire: routed.questionnaire },
      };
    },
    onSuccess: ({ thread: row, userMessage, result }) => {
      setThread(row);
      setMessages((previous) => [...previous, userMessage]);
      setRouteResult(result);
      setSendError(null);
      onTabChange("response");
      setAnnouncement(`Routed to ${result.intent}.`);
      void queryClient.invalidateQueries({ queryKey: ["agent-threads", organizationId] });
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : "Sending failed. Nothing was stored.");
      onTabChange("response");
      setAnnouncement("Sending failed.");
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
    queryFn: () => agentGetJson(`${base}?limit=20`) as Promise<ThreadsResponse>,
    enabled: activeTab === "history",
  });

  const reopen = useMutation({
    mutationFn: async (target: ThreadSummary) => {
      const body = (await agentGetJson(
        `${base}/${target.id}/messages?limit=50`,
      )) as MessagesResponse;
      return { target, messages: body.messages };
    },
    onSuccess: ({ target, messages: reopened }) => {
      onThreadChange(target.id);
      setThread(target);
      setMessages(reopened);
      setRouteResult(null);
      setSendError(null);
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
    onTabChange("response");
    setAnnouncement("Started a new conversation.");
  }

  const phase: AgentStepPhase = send.isPending
    ? "routing"
    : sendError
      ? "error"
      : routeResult || thread
        ? "done"
        : "idle";

  const questionnaire = routeResult?.questionnaire ?? null;
  const cardKey = questionnaire?.resumeKey ?? null;
  const cardVisible = Boolean(
    questionnaire && cardKey && !submittedAnswers[cardKey] && !dismissedCards.includes(cardKey),
  );

  if (collapsed) {
    return (
      <div className="fixed inset-x-0 bottom-24 flex justify-center px-4">
        <Button
          type="button"
          variant="secondary"
          className="w-[min(44rem,100%)] justify-between"
          onClick={onToggleCollapsed}
          aria-label={`Expand conversation${thread ? `: ${thread.title}` : ""}`}
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
            <span className="truncate text-sm">{thread?.title ?? "New conversation"}</span>
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
            <p className="truncate text-sm font-medium">{thread?.title ?? "New conversation"}</p>
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
                  Ask anything. This slice routes your message and gathers context — full
                  synthesized answers arrive with the synthesis slice.
                </p>
              ) : null}
              {send.isPending ? (
                <div className="flex items-center gap-2" role="status">
                  <Spinner aria-hidden="true" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : null}
              {messages.map((message) => (
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
              ))}
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
                  onSubmit={(answers) => {
                    if (cardKey)
                      setSubmittedAnswers((previous) => ({ ...previous, [cardKey]: answers }));
                    setAnnouncement("Answers saved with this turn.");
                  }}
                  onCancel={() => {
                    if (cardKey) setDismissedCards((previous) => [...previous, cardKey]);
                  }}
                />
              ) : null}
              {cardKey && submittedAnswers[cardKey] ? (
                <p className="text-sm text-muted-foreground">
                  Answers saved: {formatAnswers(submittedAnswers[cardKey])} They travel with the
                  next routing call once the executor slice lands.
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="steps" className="overflow-y-auto">
              <AgentThreadSteps
                phase={phase}
                intent={routeResult?.intent ?? null}
                thread={thread}
                error={sendError}
                growthIntelligenceHref={`/organizations/${organizationId}/growth-intelligence`}
              />
            </TabsContent>

            <TabsContent value="draft" className="flex flex-col gap-3 overflow-y-auto">
              {routeResult?.intent === "campaign_advice" ? (
                <AgentCampaignAdvice
                  organizationId={organizationId}
                  threadId={threadId}
                  thread={thread}
                  canDraft={canDraft}
                  isViewer={isViewer}
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
