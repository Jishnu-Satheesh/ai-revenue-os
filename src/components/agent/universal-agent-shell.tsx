"use client";

import { useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { HistoryIcon, MicIcon, PlusIcon, SendIcon } from "lucide-react";

import {
  AgentDrawer,
  type AgentDrawerTab,
  type PendingPrompt,
} from "@/components/agent/agent-drawer";
import type {
  CampaignAdviceContext,
  CampaignAdviceOpportunity,
} from "@/components/agent/agent-campaign-advice";
import type { AdviseCampaignSeams } from "@/modules/agent-chat/application/campaign-advise";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RouterRole } from "@/domain/agent-router/contracts";
import type { ThreadMode } from "@/modules/agent-chat/infrastructure/thread-repository";

export const AGENT_SHELL_PAGES = [
  "overview",
  "growth-intelligence",
  "campaigns",
  "channels",
  "memory",
] as const;

export type AgentShellPage = (typeof AGENT_SHELL_PAGES)[number];

export function isAgentShellPage(page: string | null | undefined): page is AgentShellPage {
  return typeof page === "string" && (AGENT_SHELL_PAGES as readonly string[]).includes(page);
}

/**
 * Derives the shell page key from the organization pathname. Returns the
 * first segment after /organizations/[organizationId] (so
 * /channels/[channelId] maps to "channels" and /campaigns/new maps to
 * "campaigns"), or null when the path is not an organization page.
 */
export function pageKeyForPathname(
  pathname: string | null | undefined,
  organizationId: string,
): string | null {
  if (!pathname) return null;
  const segments = pathname.split("/").filter(Boolean);
  const orgIndex = segments.indexOf("organizations");
  if (orgIndex < 0 || segments[orgIndex + 1] !== organizationId) return null;
  return segments[orgIndex + 2] ?? null;
}

export type UniversalAgentShellProps = {
  organizationId: string;
  /** Explicit page key (tests and callers that already know the page). */
  page?: string;
  /**
   * Loader-provided caller role and grants. The layout resolves these
   * server-side from the membership — never client claims — and the shell
   * gates DeepThink, watch, and draft controls on them (server rechecks
   * every route). Defaults stay viewer-safe for tests and bare mounts.
   */
  role?: RouterRole;
  permissions?: string[];
  /** Actor id for the eligible campaign-draft path. Absent → brief path. */
  actorId?: string;
  /** Opportunity binding the draft request. Absent → brief path. */
  opportunity?: CampaignAdviceOpportunity | null;
  /** Full advice context. Absent → brief path, nothing invented. */
  advice?: CampaignAdviceContext | null;
  /** Injected campaign seams for tests; defaults post to live routes. */
  campaignSeams?: AdviseCampaignSeams;
  /**
   * Whether the watch schedule-update path is available. True: the
   * schedule RPC is live and proven on staging. Forwarded to the
   * drawer; pass false explicitly to force the honest unavailable copy.
   */
  watchUpdateAvailable?: boolean;
};

/** Memory-only example prompts. Never fake data, never fabricated metrics. */
const SUGGESTIONS = [
  "What do we know about this business?",
  "Which recent decisions matter most?",
  "What evidence is still missing?",
] as const;

/**
 * Floating universal agent shell (spec section 5.1). Dark bottom-centered
 * panel with a glowing animated border (static glow under
 * prefers-reduced-motion), Ask anything input, inert + / Voice buttons with
 * tooltips, a Quick/DeepThink mode pill, and a send button. Enter sends,
 * Shift+Enter adds a newline. Sending opens the drawer and focuses it.
 * Renders only on the 5 allowed pages — otherwise null.
 */
export function UniversalAgentShell({
  organizationId,
  page,
  role = "viewer",
  permissions = [],
  actorId,
  opportunity = null,
  advice = null,
  campaignSeams,
  watchUpdateAvailable = true,
}: UniversalAgentShellProps) {
  const reduceMotion = useReducedMotion();
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ThreadMode>("quick");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentDrawerTab>("response");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const [nonce, setNonce] = useState(0);

  if (!isAgentShellPage(page)) return null;

  const canManage = permissions.includes("growth_intelligence.manage");
  const isViewer = role === "viewer";
  const canSend = input.trim().length > 0 && !isViewer;

  function handleSend() {
    if (isViewer) return;
    const body = input.trim();
    if (!body) return;
    const next = nonce + 1;
    setNonce(next);
    setPendingPrompt({ text: body, nonce: next });
    setInput("");
    setCollapsed(false);
    setActiveTab("steps");
    setDrawerOpen(true);
  }

  function openHistory() {
    setCollapsed(false);
    setActiveTab("history");
    setDrawerOpen(true);
  }

  return (
    <TooltipProvider>
      <div className="fixed inset-x-0 bottom-4 flex justify-center px-4">
        <motion.div
          initial={false}
          animate={
            reduceMotion
              ? { boxShadow: "0 0 24px rgba(139, 92, 246, 0.25)" }
              : {
                  boxShadow: [
                    "0 0 12px rgba(139, 92, 246, 0.20)",
                    "0 0 28px rgba(139, 92, 246, 0.45)",
                    "0 0 12px rgba(139, 92, 246, 0.20)",
                  ],
                }
          }
          transition={
            reduceMotion ? undefined : { duration: 4, repeat: Infinity, ease: "easeInOut" }
          }
          className="w-[min(44rem,100%)] rounded-2xl border border-white/10 bg-zinc-950 text-zinc-50 shadow-2xl"
        >
          <div className="flex flex-col gap-1 p-2">
            <label htmlFor={inputId} className="sr-only">
              Ask anything
            </label>
            <Textarea
              ref={textareaRef}
              id={inputId}
              rows={1}
              value={input}
              placeholder="Ask anything…"
              aria-label="Ask anything"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              className="min-h-10 resize-none border-0 bg-transparent text-zinc-50 placeholder:text-zinc-500 focus-visible:ring-0"
            />
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled
                      aria-label="Add attachments (coming soon)"
                      title="Attachments coming soon"
                      className="text-zinc-400"
                    >
                      <PlusIcon aria-hidden="true" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Attachments coming soon</TooltipContent>
              </Tooltip>

              <ToggleGroup
                type="single"
                size="sm"
                value={mode}
                aria-label="Answer mode"
                onValueChange={(value) => {
                  if (value === "quick" || value === "deepthink") setMode(value);
                }}
              >
                <ToggleGroupItem value="quick" aria-label="Quick mode">
                  Quick
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="deepthink"
                  aria-label={
                    canManage
                      ? "DeepThink mode"
                      : "DeepThink mode (needs the growth_intelligence.manage grant)"
                  }
                  title={
                    canManage
                      ? undefined
                      : "DeepThink needs the growth_intelligence.manage grant — enforcement stays server-side."
                  }
                  disabled={!canManage}
                >
                  DeepThink
                </ToggleGroupItem>
              </ToggleGroup>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled
                      aria-label="Voice input (coming soon)"
                      title="Voice coming soon"
                      className="text-zinc-400"
                    >
                      <MicIcon data-icon="inline-start" aria-hidden="true" />
                      Voice
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Voice coming soon</TooltipContent>
              </Tooltip>

              <span className="flex-1" />

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={openHistory}
                aria-label="Open conversation history"
                title="Conversation history"
                className="text-zinc-400 hover:text-zinc-100"
              >
                <HistoryIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                title={
                  isViewer
                    ? "Viewers cannot change this chat — ask an operator to send."
                    : "Send"
                }
              >
                <SendIcon aria-hidden="true" />
              </Button>
            </div>
            {isViewer ? (
              <p className="px-1 text-sm text-zinc-400">
                Viewers cannot change this chat — ask an operator to send.
              </p>
            ) : null}
            {!drawerOpen && input.trim() === "" ? (
              <div className="flex flex-wrap gap-2 px-1 pt-1 pb-1">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setInput(suggestion);
                      textareaRef.current?.focus();
                    }}
                    className={cn("border-white/10 bg-transparent text-zinc-300")}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>

      {drawerOpen ? (
        <AgentDrawer
          organizationId={organizationId}
          page={page}
          threadId={threadId}
          pendingPrompt={pendingPrompt}
          mode={mode}
          role={role}
          permissions={permissions}
          actorId={actorId}
          opportunity={opportunity}
          advice={advice}
          campaignSeams={campaignSeams}
          watchUpdateAvailable={watchUpdateAvailable}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((previous) => !previous)}
          onClose={() => setDrawerOpen(false)}
          onThreadChange={setThreadId}
          onPromptConsumed={() => setPendingPrompt(null)}
        />
      ) : null}
    </TooltipProvider>
  );
}

/**
 * Layout mount point: derives the page key from the pathname and renders
 * the shell only on the 5 allowed pages. Mounted once in the organization
 * layout; no auth change, no data fetching here. The layout passes the
 * loader-resolved role, grants, and actor id — this host only forwards.
 */
export function UniversalAgentShellHost({
  organizationId,
  role,
  permissions,
  actorId,
  opportunity,
  advice,
  campaignSeams,
  watchUpdateAvailable,
}: {
  organizationId: string;
  role?: RouterRole;
  permissions?: string[];
  actorId?: string;
  opportunity?: CampaignAdviceOpportunity | null;
  advice?: CampaignAdviceContext | null;
  campaignSeams?: AdviseCampaignSeams;
  watchUpdateAvailable?: boolean;
}) {
  const pathname = usePathname();
  const page = pageKeyForPathname(pathname, organizationId);
  if (!isAgentShellPage(page)) return null;
  return (
    <UniversalAgentShell
      organizationId={organizationId}
      page={page}
      role={role}
      permissions={permissions}
      actorId={actorId}
      opportunity={opportunity}
      advice={advice}
      campaignSeams={campaignSeams}
      watchUpdateAvailable={watchUpdateAvailable}
    />
  );
}
