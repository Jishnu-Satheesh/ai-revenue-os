"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  AudioWaveformIcon,
  BrainIcon,
  ChevronDownIcon,
  HistoryIcon,
  PlusIcon,
  SendIcon,
  FileSpreadsheetIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import {
  AgentDrawer,
  type AgentDrawerView,
  type PendingPrompt,
} from "@/components/agent/agent-drawer";
import {
  AGENT_DRAWER_DEFAULT_GEOMETRY,
  useAgentSidebarOffset,
  type AgentDrawerGeometry,
} from "@/components/agent/agent-placement";
import type {
  CampaignAdviceContext,
  CampaignAdviceOpportunity,
} from "@/components/agent/agent-campaign-advice";
import type { AdviseCampaignSeams } from "@/modules/agent-chat/application/campaign-advise";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import {
  AGENT_REPORT_ACCEPT,
  agentReportMediaType,
} from "@/components/agent/agent-attachment-upload";
import { hasReportPermission } from "@/domain/reports/permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
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

const MODE_META: Record<ThreadMode, { label: string }> = {
  quick: { label: "Quick answer" },
  deepthink: { label: "DeepThink" },
};

/**
 * Floating universal agent shell (spec section 5.1). A chatbot.png robo
 * button rests in the bottom-right corner; clicking it opens a dark
 * bottom-centered panel with a glow ring (static glow under
 * prefers-reduced-motion), Ask anything input, a mode menu with exactly two
 * modes (Quick answer default, DeepThink), inert + / Voice buttons with
 * tooltips, and a gradient send button. The open panel always shows the
 * full control row plus suggestion chips when empty. Clicking outside with
 * no drawer open, or closing the drawer, collapses everything back to the
 * robo button. Enter sends, Shift+Enter adds a newline. Renders only on the
 * 5 allowed pages — otherwise null.
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
  const sidebarOffset = useAgentSidebarOffset();
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<ThreadMode>("quick");
  const [panelOpen, setPanelOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<AgentDrawerView>("thread");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const [nonce, setNonce] = useState(0);
  // F5 movable-drawer unit: position + size live here (session memory only)
  // so a drag or resize survives drawer close/reopen while the shell stays
  // mounted. Full reload resets to defaults — no localStorage, no DB write.
  const [drawerGeometry, setDrawerGeometry] = useState<AgentDrawerGeometry>(
    AGENT_DRAWER_DEFAULT_GEOMETRY,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // Focus the input when the panel opens; return focus to the robo button
  // when it closes so keyboard users never lose their place.
  useEffect(() => {
    if (panelOpen && !drawerOpen) {
      textareaRef.current?.focus();
    }
  }, [panelOpen, drawerOpen]);

  // Click-outside + Escape close the panel back to the robo button, but
  // only when no drawer is open — the drawer owns its own dismissal.
  // Portaled overlays (mode menu, tooltips) live outside the panel DOM node,
  // so clicks/keys inside them must not count as outside.
  useEffect(() => {
    if (!panelOpen || drawerOpen) return;
    function inOverlay(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        target.closest(
          '[data-radix-portal], [data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]',
        ) !== null
      );
    }
    function onPointerDown(event: PointerEvent) {
      if (inOverlay(event.target)) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || inOverlay(event.target)) return;
      setPanelOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen, drawerOpen]);

  if (!isAgentShellPage(page)) return null;

  const canManage = permissions.includes("growth_intelligence.manage");
  const isViewer = role === "viewer";
  const canAttach = hasReportPermission(role, "report.upload");
  const canSend = input.trim().length > 0;
  const chipsVisible = panelOpen && !drawerOpen && input.trim() === "";
  const panelVisible = panelOpen || drawerOpen;
  const motionMs = reduceMotion ? 0 : 220;
  const panelMotionMs = reduceMotion ? 0 : 240;

  function handleSend() {
    const body = input.trim();
    if (!body) return;
    const next = nonce + 1;
    setNonce(next);
    setPendingPrompt({ text: body, nonce: next, ...(file ? { file } : {}) });
    setInput("");
    setFile(null);
    setFileError(null);
    setCollapsed(false);
    setView("thread");
    setPanelOpen(true);
    setDrawerOpen(true);
  }

  function openHistory() {
    setCollapsed(false);
    setView("history");
    setPanelOpen(true);
    setDrawerOpen(true);
  }

  function closeAll() {
    setDrawerOpen(false);
    setPanelOpen(false);
    setCollapsed(false);
    // Return focus on the next tick so the unmount does not swallow it.
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  return (
    <TooltipProvider>
      <AnimatePresence initial={false}>
        {panelVisible ? null : (
          <motion.div
            key="agent-launcher"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: motionMs / 1000, ease: "easeOut" }}
            className="fixed right-6 bottom-6 z-50"
          >
            <motion.div
              animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
            >
              <div
                className={cn(
                  "agent-glow-ring rounded-full p-[2px]",
                  reduceMotion ? null : "agent-glow-ring-animated",
                )}
              >
                <Button
                  ref={launcherRef}
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPanelOpen(true)}
                  aria-label="Open AI assistant"
                  title="Ask AI assistant"
                  className="size-16 rounded-full border-0 bg-zinc-950 p-1.5 shadow-2xl hover:bg-zinc-900"
                >
                  <Image
                    src="/chatbot.png"
                    alt=""
                    aria-hidden="true"
                    width={64}
                    height={64}
                    className="size-full object-contain"
                    priority={false}
                  />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {panelVisible ? (
          <motion.div
            key="agent-panel"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: panelMotionMs / 1000, ease: "easeOut" }}
            className={cn("fixed right-0 bottom-4 flex justify-center px-4", sidebarOffset)}
          >
            <div
              data-testid="agent-shell-unit"
              style={
                drawerGeometry.x !== 0 || drawerGeometry.y !== 0
                  ? {
                      transform: `translate3d(${drawerGeometry.x}px, ${drawerGeometry.y}px, 0)`,
                    }
                  : undefined
              }
              className="flex w-full justify-center"
            >
              <div ref={panelRef} className="w-[min(44rem,100%)]">
                <AnimatePresence initial={false}>
                  {chipsVisible ? (
                    <motion.div
                      key="agent-suggestions"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: motionMs / 1000 }}
                      className="mb-2 flex flex-wrap justify-center gap-2"
                    >
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
                          className={cn(
                            "border-white/10 bg-zinc-950 text-zinc-300 hover:bg-white/10 hover:text-white",
                          )}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                {drawerOpen ? (
                  <AgentDrawer
                    organizationId={organizationId}
                    page={page}
                    threadId={threadId}
                    pendingPrompt={pendingPrompt}
                    mode={isViewer ? "quick" : mode}
                    role={role}
                    permissions={permissions}
                    actorId={actorId}
                    opportunity={opportunity}
                    advice={advice}
                    campaignSeams={campaignSeams}
                    watchUpdateAvailable={watchUpdateAvailable}
                    view={view}
                    onViewChange={setView}
                    collapsed={collapsed}
                    onToggleCollapsed={() => setCollapsed((previous) => !previous)}
                    onClose={closeAll}
                    onThreadChange={setThreadId}
                    onPromptConsumed={() => setPendingPrompt(null)}
                    bottomOffset="bottom-32"
                    geometry={drawerGeometry}
                    onGeometryChange={setDrawerGeometry}
                    // The container above owns the unit translate3d (bar + drawer
                    // move as one); the drawer applies size styles only, so the
                    // offset never stacks 2x on a transformed-ancestor block.
                    disableUnitTransform
                  />
                ) : null}
                <div
                  className={cn(
                    "agent-glow-ring rounded-[1.75rem] p-[2px]",
                    reduceMotion ? null : "agent-glow-ring-animated",
                  )}
                >
                  <div className="rounded-[calc(1.75rem-2px)] bg-zinc-950 text-zinc-50 shadow-2xl">
                    <div className="flex flex-col gap-1 p-2">
                      <Input
                        ref={fileInputRef}
                        type="file"
                        className="sr-only"
                        accept={AGENT_REPORT_ACCEPT}
                        aria-label="Choose report attachment"
                        disabled={!canAttach}
                        onChange={(event) => {
                          const selected = event.target.files?.[0];
                          event.target.value = "";
                          if (!selected) return;
                          try {
                            agentReportMediaType(selected);
                            setFile(selected);
                            setFileError(null);
                          } catch (error) {
                            setFileError(
                              error instanceof Error
                                ? error.message
                                : "Choose a CSV or XLSX report.",
                            );
                          }
                        }}
                      />
                      {file ? (
                        <Attachment state="idle" size="sm">
                          <AttachmentMedia>
                            <FileSpreadsheetIcon aria-hidden="true" />
                          </AttachmentMedia>
                          <AttachmentContent>
                            <AttachmentTitle>{file.name}</AttachmentTitle>
                            <AttachmentDescription>
                              CSV/XLSX report · ready to attach
                            </AttachmentDescription>
                          </AttachmentContent>
                          <AttachmentActions>
                            <AttachmentAction
                              aria-label="Remove report attachment"
                              onClick={() => {
                                setFile(null);
                                setFileError(null);
                              }}
                            >
                              <XIcon aria-hidden="true" />
                            </AttachmentAction>
                          </AttachmentActions>
                        </Attachment>
                      ) : null}
                      {fileError ? (
                        <Alert variant="destructive">
                          <AlertDescription>{fileError}</AlertDescription>
                        </Alert>
                      ) : null}
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
                        className="min-h-10 cursor-text resize-none border-0 bg-transparent text-zinc-50 caret-zinc-50 placeholder:text-zinc-500 focus-visible:ring-0"
                      />
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                disabled={!canAttach}
                                aria-label={
                                  canAttach
                                    ? "Add report attachment"
                                    : "Report attachments require upload permission"
                                }
                                title={
                                  canAttach
                                    ? "Attach one CSV or XLSX report"
                                    : "Report upload requires an operator"
                                }
                                onClick={() => fileInputRef.current?.click()}
                                className="rounded-full border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                              >
                                <PlusIcon aria-hidden="true" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {canAttach
                              ? "Attach one CSV or XLSX report"
                              : "Report upload requires an operator"}
                          </TooltipContent>
                        </Tooltip>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Answer mode: ${MODE_META[mode].label}`}
                              className="rounded-full border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white"
                            >
                              {mode === "quick" ? (
                                <ZapIcon data-icon="inline-start" aria-hidden="true" />
                              ) : (
                                <BrainIcon data-icon="inline-start" aria-hidden="true" />
                              )}
                              {MODE_META[mode].label}
                              <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            className="w-auto rounded-2xl border-white/10 bg-zinc-900 p-2 text-zinc-100 ring-white/10"
                          >
                            <DropdownMenuRadioGroup
                              value={mode}
                              onValueChange={(value) => {
                                if (value === "quick" || value === "deepthink") setMode(value);
                              }}
                            >
                              <DropdownMenuRadioItem
                                value="quick"
                                aria-label="Quick answer mode"
                                className="rounded-xl whitespace-nowrap focus:bg-white/10 focus:text-zinc-50"
                              >
                                <ZapIcon data-icon="inline-start" aria-hidden="true" />
                                Quick answer
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem
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
                                className="rounded-xl whitespace-nowrap focus:bg-white/10 focus:text-zinc-50"
                              >
                                <BrainIcon data-icon="inline-start" aria-hidden="true" />
                                DeepThink
                              </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled
                                aria-label="Voice input (coming soon)"
                                title="Voice coming soon"
                                className="rounded-full border-white/10 bg-white/5 text-zinc-300"
                              >
                                <AudioWaveformIcon data-icon="inline-start" aria-hidden="true" />
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
                          className="text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                        >
                          <HistoryIcon aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          onClick={handleSend}
                          disabled={!canSend}
                          aria-label="Send message"
                          title={"Send"}
                          className="size-10 rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-orange-400 text-white hover:opacity-90"
                        >
                          <SendIcon aria-hidden="true" />
                        </Button>
                      </div>
                      {isViewer ? (
                        <p className="px-1 text-sm text-zinc-400">
                          Ask for advice. Reports and business actions require an operator.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
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
