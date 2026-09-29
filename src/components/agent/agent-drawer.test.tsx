// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import {
  AgentDrawer,
  buildDrawerRequestKeys,
  resolveLiveThread,
  type AgentDrawerProps,
  type AgentDrawerView,
  type PendingPrompt,
} from "@/components/agent/agent-drawer";
import { AgentQuestionnaireCard } from "@/components/agent/agent-questionnaire-card";
import { AgentResponseMessage } from "@/components/agent/agent-response-message";
import { encodeAnswerBody } from "@/modules/agent-chat/application/answer-writer";
import type { QuestionnaireSpec } from "@/domain/agent-router/contracts";
import type {
  ThreadMessageView,
  ThreadSummary,
} from "@/modules/agent-chat/infrastructure/thread-repository";

const ORGANIZATION = "00000000-0000-4000-8000-000000000000";

const THREAD: ThreadSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: ORGANIZATION,
  title: "New chat",
  mode: "quick",
  status: "open",
  linkedResearchProjectId: null,
  linkedRequestId: null,
  linkedDraftRequestId: null,
  linkedCampaignId: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
};

const USER_MESSAGE: ThreadMessageView = {
  id: "22222222-2222-4222-8222-222222222222",
  threadId: THREAD.id,
  role: "user",
  body: "What do we know?",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:00:01.000Z",
};

const ANSWERS_MESSAGE: ThreadMessageView = {
  id: "44444444-4444-4444-8444-444444444444",
  threadId: THREAD.id,
  role: "user",
  body: "[answers deepthink_upgrade]\nconfirm_upgrade: true",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:00:02.000Z",
};

type FetchPlan = {
  route?: unknown | "hang" | { status: number; message: string };
  answers?: unknown | "hang" | { status: number; message: string };
  threads?: ThreadSummary[];
  /** Single-thread GET row (Slice C M9 poll endpoint). */
  thread?: ThreadSummary | null;
  messages?: ThreadMessageView[];
  /** Echo body for the POSTed user message (defaults to the fixed fixture). */
  userMessageBody?: string;
  /** Leave the GET messages read hanging (reopen skeleton coverage). */
  messagesHang?: boolean;
  /** Fail the GET messages read (G1: messages-refresh 404 coverage). */
  messagesError?: { status: number; message: string };
  /** Fail the single-thread checkpoint poll (G1: thread-poll coverage). */
  threadError?: { status: number; message: string };
  /**
   * Task 3 SSE frames for the GET stream endpoint, delivered one chunk at
   * a time with a macrotask between chunks so token joins are exercised
   * incrementally; the stream closes after the last frame. `"fetch-hang"`
   * leaves the stream fetch pending (connecting-skeleton coverage).
   * Absent → the stream URL is unmocked and the drawer falls back to the
   * durable read, like the pre-streaming pipeline.
   */
  stream?: string[] | "fetch-hang";
  /** Fail the stream open with an HTTP error (G1: stream-open coverage). */
  streamFailure?: { status: number; message: string };
};

function asRouteFailure(value: unknown): { status: number; message: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== "number" || typeof record.message !== "string") return null;
  return { status: record.status, message: record.message };
}

function mockAgentFetch(plan: FetchPlan = {}) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? "GET";
    if (target.endsWith("/agent/threads") && method === "POST") {
      return Response.json({ thread: THREAD, replayed: false, correlationId: "c1" });
    }
    if (target.includes("/messages") && method === "POST") {
      const message =
        plan.userMessageBody !== undefined
          ? { ...USER_MESSAGE, body: plan.userMessageBody }
          : USER_MESSAGE;
      return Response.json({ message, replayed: false, correlationId: "c2" });
    }
    if (target.includes("/answers") && method === "POST") {
      if (plan.answers === "hang") return new Promise<Response>(() => {});
      const failure = asRouteFailure(plan.answers);
      if (failure) {
        return Response.json(
          { error: { message: failure.message, correlationId: "cerr" } },
          { status: failure.status },
        );
      }
      return Response.json(
        (plan.answers as unknown) ?? {
          message: ANSWERS_MESSAGE,
          replayed: false,
          answers: { confirm_upgrade: "true" },
          resumeKey: "router:research_once:overview:abc123",
          intent: "answer_memory",
          confidence: "high",
          reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
          questionnaire: null,
          correlationId: "c6",
        },
      );
    }
    if (target.includes("/route") && method === "POST") {
      if (plan.route === "hang") return new Promise<Response>(() => {});
      const failure = asRouteFailure(plan.route);
      if (failure) {
        return Response.json(
          { error: { message: failure.message, correlationId: "cerr" } },
          { status: failure.status },
        );
      }
      return Response.json(
        (plan.route as unknown) ?? {
          intent: "answer_memory",
          confidence: "high",
          reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
          questionnaire: null,
          thread: THREAD,
          correlationId: "c3",
        },
      );
    }
    if (target.includes("/messages") && method === "GET") {
      if (plan.messagesHang) return new Promise(() => {});
      if (plan.messagesError) {
        return Response.json(
          { error: { message: plan.messagesError.message, correlationId: "cerr" } },
          { status: plan.messagesError.status },
        );
      }
      return Response.json({
        messages: plan.messages ?? [USER_MESSAGE],
        nextCursor: null,
        correlationId: "c5",
      });
    }
    // Streaming synthesis (Task 4): the drawer opens one GET stream per
    // send and reads token/done/end frames incrementally.
    if (target.includes("/stream") && method === "GET") {
      if (plan.stream === "fetch-hang") return new Promise<Response>(() => {});
      if (plan.streamFailure) {
        return Response.json(
          { error: { message: plan.streamFailure.message, correlationId: "cerr" } },
          { status: plan.streamFailure.status },
        );
      }
      if (!plan.stream) throw new Error(`unmocked fetch ${method} ${target}`);
      const frames = plan.stream;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          for (const frame of frames) {
            controller.enqueue(encoder.encode(frame));
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "text/event-stream", "x-correlation-id": "cs" },
      });
    }
    // Slice C M9: the checkpoint poll reads the single thread row, never
    // the collection. Matched before the list branch below.
    if (method === "GET" && /\/agent\/threads\/[^/?]+(\?.*)?$/.test(target)) {
      if (plan.threadError) {
        return Response.json(
          { error: { message: plan.threadError.message, correlationId: "cerr" } },
          { status: plan.threadError.status },
        );
      }
      return Response.json({
        thread: plan.thread ?? THREAD,
        correlationId: "c7",
      });
    }
    if (target.includes("/agent/threads") && method === "GET") {
      return Response.json({
        threads: plan.threads ?? [THREAD],
        nextCursor: null,
        correlationId: "c4",
      });
    }
    throw new Error(`unmocked fetch ${method} ${target}`);
  });
}

/**
 * G1: one valid end-only stream — the turn settles through the durable swap
 * with no tokens. Tests that are not about stream failure use this so only
 * their intended call site can fail.
 */
const END_ONLY_STREAM =
  'event: end\ndata: {"messageId":"88888888-8888-4888-8888-888888888888","replayed":true,"fallback":false,"reason":null,"draft":{},"correlationId":"99999999-9999-4999-8999-999999999999"}\n\n';

function Harness({
  view: initialView = "thread",
  pendingPrompt = null,
  ...props
}: Partial<AgentDrawerProps> & { view?: AgentDrawerView }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );
  const [view, setView] = useState<AgentDrawerView>(initialView);
  const [collapsed, setCollapsed] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  // Mirrors the shell: a consumed prompt clears so it never re-fires and
  // never leaks into the next thread title.
  const [prompt, setPrompt] = useState(pendingPrompt);
  return (
    <SidebarProvider>
      <QueryClientProvider client={client}>
        <AgentDrawer
          organizationId={ORGANIZATION}
          page="overview"
          mode="quick"
          role="operator"
          permissions={[]}
          pendingPrompt={prompt}
          threadId={threadId}
          view={view}
          onViewChange={setView}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((previous) => !previous)}
          onClose={() => {}}
          onThreadChange={setThreadId}
          onPromptConsumed={() => setPrompt(null)}
          {...props}
        />
      </QueryClientProvider>
    </SidebarProvider>
  );
}

function sendPrompt(text = "What do we know?"): PendingPrompt {
  return { text, nonce: 1 };
}

beforeEach(() => {
  globalThis.fetch = mockAgentFetch() as never;
  vi.stubGlobal("crypto", {
    ...(globalThis.crypto as object | undefined),
    randomUUID: () => "33333333-3333-4333-8333-333333333333",
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("drawer chrome", () => {
  it("renders the thread view with no tabs", () => {
    render(<Harness />);
    expect(screen.getByRole("log", { name: "Conversation thread" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("button", { name: /back to thread history/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collapse conversation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close conversation/i })).toBeInTheDocument();
  });

  it("shows the sparkle empty state for a blank thread", () => {
    render(<Harness />);
    expect(screen.getByText("New chat")).toBeInTheDocument();
    expect(screen.getByText(/ask anything to initiate the conversation/i)).toBeInTheDocument();
  });

  it("floats the dark fixed-height panel detached above the shell with vertical-only scroll", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    // Detached offset plus the dark scope that flips every token surface.
    expect(section.className).toMatch(/bottom-22/);
    expect(section.className).toMatch(/(^|\s)dark(\s|$)/);
    // Sidebar-aware centering: full sidebar width while expanded.
    expect(section.className).toMatch(/left-\(--sidebar-width\)/);
    const panel = section.firstElementChild as HTMLElement;
    expect(panel.className).toMatch(/h-\[34rem\]/);
    const thread = section.querySelector('[role="log"]') as HTMLElement;
    expect(thread.className).toMatch(/overflow-y-auto/);
    expect(thread.className).toMatch(/overflow-x-hidden/);
    expect(thread.className).not.toMatch(/overflow-x-auto/);
  });

  it("clears the first message bubble below the header", async () => {
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();
    // Top clearance inside the scrollport: the first bubble starts below
    // the container edge, never tucked under the header row.
    expect(thread.className).toMatch(/(^|\s)pt-2(\s|$)/);
  });

  it("collapses to a status strip on Escape and expands on click", async () => {
    globalThis.fetch = mockAgentFetch({ route: "hang" }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);

    expect(await screen.findByText(/thinking/i)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("AI agent conversation"), { key: "Escape" });

    const strip = await screen.findByRole("button", { name: /expand conversation/i });
    expect(strip).toBeInTheDocument();
    // The strip carries a spinner while the run is in flight.
    expect(within(strip).getByLabelText("Loading")).toBeInTheDocument();

    await user.click(strip);
    expect(await screen.findByText(/thinking/i)).toBeInTheDocument();
  });

  it("attaches the collapsed strip in-flow with no fixed positioning", async () => {
    globalThis.fetch = mockAgentFetch({ route: "hang" }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);

    expect(await screen.findByText(/thinking/i)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("AI agent conversation"), { key: "Escape" });

    const strip = await screen.findByRole("button", { name: /expand conversation/i });
    expect(strip.closest(".fixed")).toBeNull();
  });

  it("honors an explicit taller bottom offset", () => {
    render(<Harness bottomOffset="bottom-32" />);
    expect(screen.getByLabelText("AI agent conversation").className).toMatch(/bottom-32/);
  });
});

describe("send pipeline", () => {
  it("shows one narrating Marker with status role, spinner, and shimmer while sending", async () => {
    globalThis.fetch = mockAgentFetch({ route: "hang" }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);

    const marker = await screen.findByText(/thinking/i);
    expect(marker.closest('[role="status"]')).not.toBeNull();
    expect(marker.className).toMatch(/animate-pulse/);
    // One thing at a time: the single in-progress row owns role="status" +
    // Spinner, so no second exploring row ever renders beside it.
    const steps = screen.getByLabelText("Agent run steps");
    expect(
      steps.querySelectorAll('[data-slot="marker"][role="status"]'),
    ).toHaveLength(1);
    expect(within(steps).queryByText(/exploring/i)).toBeNull();
    expect(screen.queryByText(/this run/i)).toBeNull();
    // The send pipeline posts thread + message + route; the
    // thread-checkpoint poll adds a no-store GET alongside, so only the
    // posts are counted here.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(posts).toHaveLength(3);
    });
  });

  it("lands in the thread view with the user message and routed intent", async () => {
    // G1: the stream succeeds (end-only), so the turn settles through the
    // durable swap instead of the stream-open error state.
    globalThis.fetch = mockAgentFetch({ stream: [END_ONLY_STREAM] }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    const userMessage = within(thread).getByText("What do we know?");
    expect(userMessage).toBeInTheDocument();
    // Steps stay always visible inline: the narrated intent renders in the
    // icon-led Marker list with no Steps collapse trigger anywhere.
    expect(within(thread).getByText("Understood: Memory answer")).toBeInTheDocument();
    expect(within(thread).getByText("Checked organization memory")).toBeInTheDocument();
    expect(within(thread).queryByRole("button", { name: /^steps$/i })).toBeNull();
    expect(within(thread).queryByText(/this run/i)).toBeNull();
    // The narrated intent shows only inside the icon-led Marker list — the
    // Understood row sits in the steps region under an icon-led Marker.
    const routed = within(thread).getByText(/^understood: memory answer$/i);
    expect(routed.closest('[aria-label="Agent run steps"]')).not.toBeNull();
    expect(
      routed.closest('[data-slot="marker"]')?.querySelector('[data-slot="marker-icon"]'),
    ).not.toBeNull();
    // The user bubble follows the dark-grey scheme, never the green primary.
    const bubble = userMessage.closest("[data-slot='card']") as HTMLElement;
    expect(bubble.className).toMatch(/bg-white\/10/);
    expect(bubble.className).not.toMatch(/bg-primary/);
  });

  it("titles a long first message with truncation", async () => {
    const long = "What does our business memory say about pricing decisions lately?";
    globalThis.fetch = mockAgentFetch({ userMessageBody: long }) as never;
    render(<Harness pendingPrompt={sendPrompt(long)} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText(long)).toBeInTheDocument();
    expect(
      screen.getByText("What does our business memory say about pricing…"),
    ).toBeInTheDocument();
  });

  it("surfaces send failures honestly without closing", async () => {
    globalThis.fetch = mockAgentFetch({
      route: { status: 403, message: "Viewers cannot change this chat." },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="viewer" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/viewers cannot change/i);
    expect(screen.getByLabelText("AI agent conversation")).toBeInTheDocument();
    // The failed turn keeps its steps inline (marker language, no trigger):
    // the refusal copy renders in the steps list beside the alert.
    const thread = screen.getByRole("log", { name: "Conversation thread" });
    expect(within(thread).getAllByText(/viewers cannot change/i).length).toBeGreaterThanOrEqual(2);
    expect(within(thread).queryByRole("button", { name: /^steps$/i })).toBeNull();
  });

  it("sends no-store plus one session correlation id on every fetch", async () => {
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    const ids = new Set<string>();
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as (RequestInit & { headers: Record<string, string> }) | undefined;
      expect(init?.cache).toBe("no-store");
      const id = init?.headers["x-correlation-id"];
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      if (id) ids.add(id);
    }
    // One drawer session, one trail.
    expect(ids.size).toBe(1);
  });
});

describe("history", () => {
  it("lists threads and opens the thread on arrow click", async () => {
    const savedMessage: ThreadMessageView = {
      ...USER_MESSAGE,
      id: "44444444-4444-4444-8444-444444444444",
      role: "assistant",
      body: null,
      questionnaireAnswers: { evidence_window: "60d" },
    };
    globalThis.fetch = mockAgentFetch({ messages: [USER_MESSAGE, savedMessage] }) as never;
    const user = userEvent.setup();
    render(<Harness view="history" />);
    expect(screen.getByText("Thread history")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /open new chat/i }));
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();
    expect(
      within(thread).getByText(/you clarified: evidence_window: 60d/i),
    ).toBeInTheDocument();
    // One Marker receipt, never the raw body or an empty-message card.
    expect(within(thread).queryByText(/\[answers/)).toBeNull();
    expect(within(thread).queryByText("(empty message)")).toBeNull();
  });

  it("shows chat-mimicking skeleton bubbles while a thread loads", async () => {
    globalThis.fetch = mockAgentFetch({ messagesHang: true }) as never;
    const user = userEvent.setup();
    render(<Harness view="history" />);

    await user.click(await screen.findByRole("button", { name: /open new chat/i }));
    const loading = await screen.findByRole("status", { name: "Loading conversation" });
    expect(loading).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Thread history" })).toBeNull();
  });

  it("starts a new chat from history", async () => {
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back to thread history/i }));
    await user.click(await screen.findByRole("button", { name: "New chat" }));
    expect(screen.getByText(/ask anything to initiate the conversation/i)).toBeInTheDocument();
    expect(screen.queryByText("What do we know?")).not.toBeInTheDocument();
  });
});

describe("draft advice gating", () => {
  const campaignRoute = {
    intent: "campaign_advice",
    questionnaire: null,
    thread: THREAD,
    correlationId: "c3",
  };

  it("keeps draft actions disabled for viewers with a permission tooltip", async () => {
    globalThis.fetch = mockAgentFetch({ route: campaignRoute }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="viewer" permissions={[]} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();
    // Ideas-first: no form — the card names the pick flow and viewers stay read-only.
    expect(screen.getByText(/pick an idea above/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Objective")).toBeNull();
    expect(screen.queryByRole("button", { name: /initiate campaign draft/i })).toBeNull();
    expect(screen.getByRole("button", { name: /save to recommendations/i })).toBeDisabled();
  });

  it("names the pick flow for permitted roles with no bound pick yet", async () => {
    globalThis.fetch = mockAgentFetch({ route: campaignRoute }) as never;
    render(
      <Harness pendingPrompt={sendPrompt()} role="operator" permissions={["campaign.create"]} />,
    );
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();
    // The handoff slice landed: the card asks for a pick instead of staying parked.
    expect(screen.getByText(/pick an idea above/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Objective")).toBeNull();
    expect(screen.queryByLabelText("Audience")).toBeNull();
  });
});

const CLARIFY: QuestionnaireSpec = {
  kind: "clarify",
  title: "Can you say a little more?",
  resumeKey: "router:answer_memory:overview:abc123",
  items: [
    {
      key: "clarify",
      label: "What would you like to do?",
      kind: "text",
      required: true,
      helpText: "One sentence is enough to route this correctly.",
    },
  ],
};

const UPGRADE: QuestionnaireSpec = {
  kind: "deepthink_upgrade",
  title: "Research needed — switch to DeepThink?",
  resumeKey: "router:research_once:overview:abc123",
  items: [
    {
      key: "confirm_upgrade",
      label: "Switch this thread to DeepThink?",
      kind: "confirm",
      required: true,
      helpText: "DeepThink may run one bounded research task. Quick never spends.",
    },
  ],
};

const DUPLICATE_WATCH: QuestionnaireSpec = {
  kind: "duplicate_watch",
  title: "Watch already running",
  resumeKey: "router:watch:overview:abc123",
  items: [
    {
      key: "choice",
      label: "A similar watch already exists. What should happen?",
      kind: "single_select",
      required: true,
      options: [
        { value: "view_existing", label: "View existing" },
        { value: "update_fields", label: "Update fields" },
        { value: "start_fresh", label: "Start fresh anyway" },
        { value: "cancel", label: "Cancel" },
      ],
    },
    {
      key: "frequency",
      label: "How often should this run?",
      kind: "single_select",
      required: true,
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
        { value: "monthly", label: "Monthly" },
      ],
    },
    {
      key: "branch",
      label: "Which branch is this for?",
      kind: "text",
      required: true,
    },
  ],
};

const EVIDENCE_WINDOW: QuestionnaireSpec = {
  kind: "evidence_window",
  title: "Evidence window needed",
  resumeKey: "router:campaign_advice:overview:abc123",
  items: [
    {
      key: "evidence_window",
      label: "Which evidence window should advice use?",
      kind: "single_select",
      required: true,
      options: [
        { value: "30d", label: "Last 30 days" },
        { value: "60d", label: "Last 60 days" },
      ],
    },
  ],
};

const CAMPAIGN_IDEAS: QuestionnaireSpec = {
  kind: "campaign_ideas",
  title: "Campaign ideas",
  resumeKey: "router:campaign_advice:overview:abc123",
  items: [
    {
      key: "idea",
      label: "Which idea should become a draft?",
      kind: "single_select",
      required: true,
      options: [
        {
          value: "idea-a",
          label: "Lunch rush bundle",
          description: "Noon combo for nearby offices.",
          recommended: false,
        },
        {
          value: "idea-b",
          label: "Weekend family table",
          description: "Saturday set menu for families.",
          recommended: true,
        },
        {
          value: "idea-c",
          label: "Late-night dessert",
          description: "After-9pm dessert counter.",
          recommended: false,
        },
      ],
    },
  ],
};

describe("questionnaire cards", () => {
  it("renders the inline upgrade card after routing and saves the confirm answer", async () => {
    globalThis.fetch = mockAgentFetch({
      route: {
        intent: "research_once",
        questionnaire: UPGRADE,
        thread: THREAD,
        correlationId: "c3",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    expect(screen.getByText(/quick answers use memory only/i)).toBeInTheDocument();

    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    // The persisted answers row plus the last-saved confirmation.
    expect(await screen.findAllByText(/you clarified: confirm_upgrade: true/i)).toHaveLength(2);
  });

  it("blocks an empty required answer with an error and no submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AgentQuestionnaireCard spec={EVIDENCE_WINDOW} onSubmit={onSubmit} />);
    // Single required item renders Submit immediately; answering nothing fails.
    await user.click(screen.getByRole("button", { name: /submit/i }));
    expect(await screen.findByText(/choose one option before continuing/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires the upgrade confirm before submitting", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AgentQuestionnaireCard spec={UPGRADE} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: /submit/i }));
    expect(await screen.findByText(/confirm to continue/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ confirm_upgrade: true });
  });

  it("keeps a checked confirm error-free when the card locks while saving (finding A)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<AgentQuestionnaireCard spec={UPGRADE} onSubmit={onSubmit} />);
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ confirm_upgrade: true });
    // The drawer disables the card while the answers POST is in flight.
    // Locking the step must not invalidate the checked confirm: the actions
    // hide with the locked step and no validation error appears.
    rerender(<AgentQuestionnaireCard spec={UPGRADE} onSubmit={onSubmit} disabled />);
    // No *enabled* submit may remain (the primitive hides fully-disabled
    // steps, so the button is usually gone rather than disabled — assert the
    // affordance, not the primitive's hide behavior), and no error shows.
    for (const button of screen.queryAllByRole("button", { name: /submit/i })) {
      expect(button).toBeDisabled();
    }
    expect(screen.queryByText(/confirm to continue/i)).not.toBeVisible();
  });

  it("submits a single-field clarify card with no retry item", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AgentQuestionnaireCard spec={CLARIFY} onSubmit={onSubmit} />);
    // One required text item renders Submit immediately; the dead
    // DeepThink-retry confirm is gone (B2 auto-escalates instead).
    expect(screen.queryByText(/retry as deepthink/i)).toBeNull();

    await user.type(screen.getByRole("textbox"), "track competitor prices");
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ clarify: "track competitor prices" });
  });

  it("waits without spinning only while a clarify card is on screen", async () => {
    const user = userEvent.setup();
    globalThis.fetch = mockAgentFetch({
      route: {
        intent: "answer_memory",
        confidence: "low",
        reasonCodes: ["MODEL_LOW_CONFIDENCE"],
        questionnaire: CLARIFY,
        thread: THREAD,
        correlationId: "c3",
      },
      stream: [END_ONLY_STREAM],
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    // Genuine clarify card visible: the settled steps wait with no spinner.
    expect(await screen.findByText("Can you say a little more?")).toBeInTheDocument();
    const steps = screen.getByLabelText("Agent run steps");
    expect(within(steps).getByText(/waiting for your answer/i)).toBeInTheDocument();
    expect(steps.querySelectorAll('[data-slot="marker"][role="status"]')).toHaveLength(0);
    expect(steps.querySelector('[data-slot="spinner"]')).toBeNull();

    // Dismissing the card ends the wait with it.
    await user.click(screen.getByRole("button", { name: /cancel this step/i }));
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("Agent run steps")).queryByText(/waiting for your answer/i),
      ).toBeNull(),
    );
    expect(screen.queryByText("Can you say a little more?")).toBeNull();

    // A visible non-clarify card never waits: card on screen, no awaiting row.
    cleanup();
    globalThis.fetch = mockAgentFetch({
      route: {
        intent: "campaign_advice",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: EVIDENCE_WINDOW,
        thread: THREAD,
        correlationId: "c3",
      },
      stream: [END_ONLY_STREAM],
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Evidence window needed")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Agent run steps")).queryByText(/waiting for your answer/i),
    ).toBeNull();
  });

  it("branches duplicate-watch fields only after update_fields is chosen", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AgentQuestionnaireCard spec={DUPLICATE_WATCH} onSubmit={onSubmit} />);

    // Field items stay hidden until the choice calls for them.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByText("Update fields"));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByText("Weekly"));
    await user.click(screen.getByRole("button", { name: /next/i }));

    await user.type(screen.getByRole("textbox"), "Marina");
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      choice: "update_fields",
      frequency: "weekly",
      branch: "Marina",
    });
  });

  it("submits view_existing without field answers", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AgentQuestionnaireCard spec={DUPLICATE_WATCH} onSubmit={onSubmit} />);
    await user.click(screen.getByText("View existing"));
    // Choosing view_existing collapses the card to the choice alone, so Submit appears.
    expect(await screen.findByRole("button", { name: /submit/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ choice: "view_existing" });
  });

  it("renders campaign ideas with titles, descriptions, and one Recommended marker", () => {
    const onSubmit = vi.fn();
    render(<AgentQuestionnaireCard spec={CAMPAIGN_IDEAS} onSubmit={onSubmit} />);
    expect(screen.getByText(/recommended pick is marked/i)).toBeInTheDocument();
    expect(screen.getByText("Lunch rush bundle")).toBeInTheDocument();
    expect(screen.getByText("Weekend family table")).toBeInTheDocument();
    expect(screen.getByText("Late-night dessert")).toBeInTheDocument();
    expect(screen.getByText("Noon combo for nearby offices.")).toBeInTheDocument();
    expect(screen.getByText("Saturday set menu for families.")).toBeInTheDocument();
    expect(screen.getByText("After-9pm dessert counter.")).toBeInTheDocument();
    // Exactly one idea carries the recommendation marker.
    expect(screen.getAllByText("Recommended")).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the picked campaign idea value", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AgentQuestionnaireCard spec={CAMPAIGN_IDEAS} onSubmit={onSubmit} />);
    // A single required item renders Submit immediately; picking the
    // recommended idea posts its value, not the marker.
    await user.click(screen.getByText("Weekend family table"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ idea: "idea-b" });
  });

  it("resumes on the first unanswered item with saved answers intact", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const twoField: QuestionnaireSpec = {
      kind: "missing_fields",
      title: "One more detail",
      resumeKey: "router:watch:overview:abc123",
      items: [
        {
          key: "frequency",
          label: "How often should this run?",
          kind: "single_select",
          required: true,
          options: [
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ],
        },
        { key: "branch", label: "Which branch is this for?", kind: "text", required: true },
      ],
    };
    render(
      <AgentQuestionnaireCard
        spec={twoField}
        savedAnswers={{ frequency: "weekly" }}
        onSubmit={onSubmit}
      />,
    );
    expect(await screen.findByText(/question 2 of 2/i)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "Marina");
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ frequency: "weekly", branch: "Marina" });
  });
});

describe("questionnaire submit wiring", () => {
  const upgradeRoute = {
    intent: "research_once",
    questionnaire: UPGRADE,
    thread: THREAD,
    correlationId: "c3",
  };

  async function answerUpgradeCard() {
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    return user;
  }

  it("posts answers to the answers route and swaps to the re-routed card", async () => {
    globalThis.fetch = mockAgentFetch({
      route: upgradeRoute,
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { confirm_upgrade: "true" },
        resumeKey: UPGRADE.resumeKey,
        intent: "campaign_advice",
        questionnaire: EVIDENCE_WINDOW,
        correlationId: "c6",
      },
    }) as never;
    await answerUpgradeCard();

    // The answers message joins the thread and the re-routed card replaces it.
    expect(await screen.findByText("Evidence window needed")).toBeInTheDocument();
    expect(screen.getAllByText(/you clarified: confirm_upgrade: true/i)).toHaveLength(2);
    // Raw `[answers …]` text appears nowhere in the DOM.
    expect(screen.queryByText(/\[answers/)).toBeNull();
    expect(document.body.innerHTML).not.toMatch("[answers");

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const answersCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/answers") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(answersCall).toBeDefined();
    const [, init] = answersCall as [unknown, RequestInit];
    expect(String(answersCall?.[0])).toContain(`/agent/threads/${THREAD.id}/answers`);
    expect(init.cache).toBe("no-store");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    // One drawer session, one trail across the send posts and the submit.
    const ids = new Set(
      fetchMock.mock.calls.map(
        ([, callInit]) =>
          ((callInit as RequestInit).headers as Record<string, string>)["x-correlation-id"],
      ),
    );
    expect(ids.size).toBe(1);
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      resumeKey: UPGRADE.resumeKey,
      answers: { confirm_upgrade: true },
    });
    expect(typeof payload.idempotencyKey).toBe("string");
    expect(payload.spec).toMatchObject({ kind: "deepthink_upgrade" });
  });

  it("keeps questionnaire cards read-only for viewers", async () => {
    globalThis.fetch = mockAgentFetch({ route: upgradeRoute }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="viewer" />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    // A locked step offers no submit affordance at all; the read-only copy
    // carries the explanation.
    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
    expect(screen.getByText(/viewers cannot change this chat/i)).toBeInTheDocument();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(posts).toHaveLength(3);
    });
    // Viewers may route (read-only answers), but no answers POST ever fires.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/answers"))).toBe(false);
  });

  it("surfaces an answers refusal as an alert and keeps the card", async () => {
    globalThis.fetch = mockAgentFetch({
      route: upgradeRoute,
      answers: { status: 403, message: "Viewers cannot change this chat." },
    }) as never;
    await answerUpgradeCard();

    expect(await screen.findByRole("alert")).toHaveTextContent(/viewers cannot change/i);
    // Nothing marked saved: the card stays so the operator can retry.
    expect(screen.getByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    expect(screen.queryByText(/answers saved:/i)).not.toBeInTheDocument();
  });

  it("shows no confirm error while the checked upgrade answer saves (finding A)", async () => {
    globalThis.fetch = mockAgentFetch({ route: upgradeRoute, answers: "hang" }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    // The POST hangs: the answered card hides behind the saving shimmer, so
    // no red error can appear beside the saving note.
    expect(await screen.findByText(/saving answers/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirm to continue/i)).toBeNull();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/answers") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(posts).toHaveLength(1);
    });
    const answersCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/answers") && (init as RequestInit | undefined)?.method === "POST",
    );
    const payload = JSON.parse(String((answersCall?.[1] as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({ answers: { confirm_upgrade: true } });
  });

  it("drops a second synchronous submit so one user submit posts once", async () => {
    globalThis.fetch = mockAgentFetch({ route: upgradeRoute, answers: "hang" }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    await user.click(screen.getByText("Yes"));
    // Two submits in the same tick, before any re-render can lock the card.
    const submit = screen.getByRole("button", { name: /submit/i });
    fireEvent.click(submit);
    fireEvent.click(submit);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const answersPosts = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/answers") && (init as RequestInit | undefined)?.method === "POST",
      );
    await waitFor(() => expect(answersPosts().length).toBeGreaterThanOrEqual(1));
    // A raced second POST would land inside this window; assert the count
    // stays 1 throughout instead of sleeping once and spot-checking.
    const startedAt = Date.now();
    while (Date.now() - startedAt < 500) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(answersPosts()).toHaveLength(1);
    }
  });

  it("renders the saved row and the confirmation as You-clarified Markers, never raw answers text", async () => {
    globalThis.fetch = mockAgentFetch({
      route: upgradeRoute,
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { confirm_upgrade: "true" },
        resumeKey: UPGRADE.resumeKey,
        intent: "campaign_advice",
        questionnaire: EVIDENCE_WINDOW,
        correlationId: "c6",
      },
    }) as never;
    await answerUpgradeCard();

    // Both the persisted answers row and the last-saved confirmation render
    // as Marker receipts with the same one-line summary.
    const clarified = await screen.findAllByText(/you clarified: confirm_upgrade: true/i);
    expect(clarified).toHaveLength(2);
    for (const row of clarified) {
      expect(row.closest('[data-slot="marker"]')).not.toBeNull();
    }
    // Raw `[answers …]` text appears nowhere in the DOM.
    expect(screen.queryByText(/\[answers/)).toBeNull();
    expect(document.body.innerHTML).not.toMatch("[answers");
  });

  it("hides the answered card during save behind a Marker shimmer with a skeleton", async () => {
    globalThis.fetch = mockAgentFetch({ route: upgradeRoute, answers: "hang" }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    // The answered card hides while the save is in flight...
    expect(await screen.findByText(/saving answers/i)).toBeInTheDocument();
    expect(screen.queryByText("Research needed — switch to DeepThink?")).toBeNull();
    // ...behind a Marker shimmer carrying a Skeleton.
    const shimmer = screen.getByText(/saving answers/i).closest('[data-slot="marker"]');
    expect(shimmer).not.toBeNull();
    expect(shimmer?.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});

describe("thread checkpoint polling", () => {
  it("picks up worker-written thread links without another send", async () => {
    const linked: ThreadSummary = {
      ...THREAD,
      linkedResearchProjectId: "55555555-5555-4555-8555-555555555555",
    };
    // Slice C M9: the poll reads the single thread row, not the list.
    globalThis.fetch = mockAgentFetch({ thread: linked }) as never;
    render(<Harness view="thread" threadId={THREAD.id} />);
    // The polled thread row carries the research link: steps stay always
    // visible inline, so the link renders with no new message sent and no
    // Steps trigger in the DOM.
    const link = await screen.findByRole("link", { name: /research complete/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toContain("/growth-intelligence");
    expect(screen.queryByRole("button", { name: /^steps$/i })).toBeNull();
    // A Quick thread never switched modes, so no mode-flip row appears.
    expect(screen.queryByText(/switched to deepthink/i)).toBeNull();
  });

  it("names the mode switch for a DeepThink thread", async () => {
    const deepthink: ThreadSummary = { ...THREAD, mode: "deepthink" };
    globalThis.fetch = mockAgentFetch({ thread: deepthink }) as never;
    render(<Harness view="thread" threadId={THREAD.id} />);
    expect(await screen.findByText(/switched to deepthink/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^steps$/i })).toBeNull();
  });

  it("keeps the DeepThink marker when the route escalates but the poll still reads Quick", async () => {
    // B2: the server-owned flip is in-memory (no mode-write RPC under
    // RLS-forced writes), so the poll keeps returning the persisted Quick
    // row. The drawer holds the escalated mode for the session instead of
    // letting the poll clobber the marker three seconds after the send.
    const escalated: ThreadSummary = { ...THREAD, mode: "deepthink" };
    globalThis.fetch = mockAgentFetch({
      route: {
        intent: "research_once",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED", "DEEPTHINK_AUTO_ESCALATED"],
        questionnaire: null,
        thread: escalated,
        correlationId: "c3",
      },
      thread: THREAD,
    }) as never;
    render(<Harness pendingPrompt={sendPrompt("research the downtown lunch crowd")} />);
    expect(await screen.findByText(/switched to deepthink/i)).toBeInTheDocument();
    // The marker must survive the poll landing, not just the send moment.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`/agent/threads/${THREAD.id}`) &&
            ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
        ),
      ).toBe(true);
    });
    expect(screen.getByText(/switched to deepthink/i)).toBeInTheDocument();
  });

  it("keeps one narrating row for a reopened running thread with no answer yet", async () => {
    const running: ThreadSummary = { ...THREAD, status: "running" };
    globalThis.fetch = mockAgentFetch({ thread: running, messages: [] }) as never;
    render(<Harness view="thread" threadId={THREAD.id} />);
    const steps = await screen.findByLabelText("Agent run steps");
    expect(steps.querySelectorAll('[data-slot="marker"][role="status"]')).toHaveLength(1);
    // Bare `running` with no lane signal stays honest: Thinking, never Researching.
    expect(within(steps).getByText("Thinking…")).toBeInTheDocument();
    expect(within(steps).queryByText("Researching…")).toBeNull();
    expect(screen.queryByRole("button", { name: /^steps$/i })).toBeNull();
  });

  it("polls one row per tick, never the thread collection", async () => {
    globalThis.fetch = mockAgentFetch() as never;
    render(<Harness view="thread" threadId={THREAD.id} />);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`/agent/threads/${THREAD.id}`) &&
            ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
        ),
      ).toBe(true);
    });
    expect(fetchMock.mock.calls.some(([url]) => /\/agent\/threads\?/.test(String(url)))).toBe(
      false,
    );
  });
});

describe("duplicate-watch gating", () => {
  const watchRoute = {
    intent: "watch",
    questionnaire: DUPLICATE_WATCH,
    thread: THREAD,
    correlationId: "c3",
  };

  it("disables Update fields when the flag is off, viewing stays free", async () => {
    globalThis.fetch = mockAgentFetch({ route: watchRoute }) as never;
    render(
      <Harness
        pendingPrompt={sendPrompt()}
        role="operator"
        permissions={["growth_intelligence.manage"]}
        watchUpdateAvailable={false}
      />,
    );
    expect(await screen.findByText("Watch already running")).toBeInTheDocument();
    // The grant is held but the flag is off: Update fields is
    // unavailable with honest copy, View existing stays enabled.
    expect(screen.getByRole("radio", { name: /update fields/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /view existing/i })).toBeEnabled();
    expect(screen.getAllByText(/unavailable for this chat/i).length).toBeGreaterThanOrEqual(1);
  });

  it("disables Update and Start-fresh without the manage grant", async () => {
    globalThis.fetch = mockAgentFetch({ route: watchRoute }) as never;
    render(
      <Harness
        pendingPrompt={sendPrompt()}
        role="operator"
        permissions={[]}
        watchUpdateAvailable
      />,
    );
    expect(await screen.findByText("Watch already running")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /update fields/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /start fresh anyway/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /view existing/i })).toBeEnabled();
    expect(screen.getAllByText(/growth_intelligence\.manage grant/i).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("enables Update fields once granted and migrated", async () => {
    globalThis.fetch = mockAgentFetch({ route: watchRoute }) as never;
    render(
      <Harness
        pendingPrompt={sendPrompt()}
        role="operator"
        permissions={["growth_intelligence.manage"]}
        watchUpdateAvailable
      />,
    );
    expect(await screen.findByText("Watch already running")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /update fields/i })).toBeEnabled();
    expect(screen.queryByText(/pending migration is applied/i)).not.toBeInTheDocument();
  });
});

describe("opportunity-bound handoff", () => {
  const ACTOR = "11111111-1111-4111-8111-111111111111";
  const OPPORTUNITY = { id: "33333333-3333-4333-8333-333333333333", version: 2 };
  const DRAFT_REQUEST = "44444444-4444-4444-8444-444444444444";
  const FINGERPRINT = "0123456789abcdef";
  const IDEAS_MESSAGE: ThreadMessageView = {
    id: "44444444-4444-4444-8444-444444444444",
    threadId: THREAD.id,
    role: "user",
    body: "[answers campaign_ideas]\nidea: idea-b",
    questionnaireAnswers: null,
    markerReceipts: null,
    citations: null,
    createdAt: "2026-09-25T10:00:02.000Z",
  };
  const ideasRoute = {
    intent: "campaign_advice",
    questionnaire: CAMPAIGN_IDEAS,
    thread: THREAD,
    correlationId: "c3",
  };
  const ideaDraft = {
    outcome: "draft_requested",
    draftRequestId: DRAFT_REQUEST,
    replayed: false,
    idempotencyKey: `agent_thread:${THREAD.id}:abc123abc123abc1`,
    opportunityId: OPPORTUNITY.id,
    idea: {
      value: "idea-b",
      title: "Weekend family table",
      description: "Saturday set menu for families.",
      recommended: true,
    },
    adviceFingerprint: FINGERPRINT,
    approveAction: {
      kind: "campaign_idea_approve",
      draftRequestId: DRAFT_REQUEST,
      adviceFingerprint: FINGERPRINT,
      // No reviewable version at pick time: pending until the thread
      // links the campaign.
      href: null,
    },
    studioLink: {
      href: `/organizations/${ORGANIZATION}/campaigns`,
      ref: { draftRequestId: DRAFT_REQUEST, campaignId: null },
    },
    markers: [
      { stage: "requested", state: "active", label: "Requested" },
      { stage: "claimed", state: "pending", label: "Claimed" },
      { stage: "draft-ready", state: "pending", label: "Draft ready" },
    ],
    reasonCodes: [],
    evidenceWindow: {
      windowDays: 30,
      assumption:
        "Advice uses the last 30 days of evidence (default — the ideas card asks for no window).",
    },
  };

  async function pickRecommendedIdea() {
    const user = userEvent.setup();
    // The ideas card renders above the advice card; picking the
    // recommended idea posts its value, not the marker.
    expect(await screen.findByText("Weekend family table")).toBeInTheDocument();
    await user.click(screen.getByText("Weekend family table"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    return user;
  }

  function answersCall() {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const found = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/answers") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(found).toBeDefined();
    const [, init] = found as [unknown, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it("sends the pick without steering and renders the pending receipt", async () => {
    globalThis.fetch = mockAgentFetch({
      route: ideasRoute,
      answers: {
        message: IDEAS_MESSAGE,
        replayed: false,
        answers: { idea: "idea-b" },
        resumeKey: CAMPAIGN_IDEAS.resumeKey,
        intent: "answer_memory",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        ideaDraft,
        correlationId: "c6",
      },
    }) as never;
    render(
      <Harness
        pendingPrompt={sendPrompt()}
        role="operator"
        permissions={["campaign.create"]}
        actorId={ACTOR}
        opportunity={OPPORTUNITY}
      />,
    );
    await pickRecommendedIdea();

    // The re-route moves on, but the draft receipt stays mounted. No
    // reviewable version yet: the approve action is pending (never a dead
    // link) while the Studio tracking link stays available.
    expect(await screen.findByText(/draft in progress/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /review and approve this version/i }),
    ).toBeDisabled();
    expect(screen.getByRole("link", { name: /open in studio/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns`,
    );
    expect(screen.getByText(/approval binds this exact version/i)).toBeInTheDocument();
    // The pick travels with no opportunity block: binding resolves
    // server-side, so no caller steers execution toward a proposal.
    expect(answersCall()).toMatchObject({ answers: { idea: "idea-b" } });
    expect(answersCall()).not.toHaveProperty("opportunity");
  });

  it("pins the approve action to the version once the thread links the campaign", async () => {
    const campaignId = "55555555-5555-4555-8555-555555555555";
    globalThis.fetch = mockAgentFetch({
      route: ideasRoute,
      thread: { ...THREAD, linkedDraftRequestId: DRAFT_REQUEST, linkedCampaignId: campaignId },
      answers: {
        message: IDEAS_MESSAGE,
        replayed: false,
        answers: { idea: "idea-b" },
        resumeKey: CAMPAIGN_IDEAS.resumeKey,
        intent: "answer_memory",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        ideaDraft,
        correlationId: "c6",
      },
    }) as never;
    render(
      <Harness
        pendingPrompt={sendPrompt()}
        role="operator"
        permissions={["campaign.create"]}
        actorId={ACTOR}
        opportunity={OPPORTUNITY}
      />,
    );
    await pickRecommendedIdea();

    // The worker linked the campaign: the inline action lands directly on
    // the version-pinned review carrying the fingerprint, distinct from
    // the plain Studio link.
    const approve = await screen.findByRole("link", {
      name: /review and approve this version/i,
    });
    expect(approve.getAttribute("href")).toBe(
      `/organizations/${ORGANIZATION}/campaigns/${campaignId}?adviceFingerprint=${FINGERPRINT}`,
    );
    expect(screen.getByRole("link", { name: /open in studio/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns/${campaignId}`,
    );
  });

  it("renders the retained brief fallback when the pick resolves ineligible", async () => {
    globalThis.fetch = mockAgentFetch({
      route: ideasRoute,
      answers: {
        message: IDEAS_MESSAGE,
        replayed: false,
        answers: { idea: "idea-b" },
        resumeKey: CAMPAIGN_IDEAS.resumeKey,
        intent: "answer_memory",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        ideaDraft: {
          outcome: "brief_prefilled",
          idea: {
            value: "idea-b",
            title: "Weekend family table",
            description: "Saturday set menu for families.",
            recommended: true,
          },
          briefUrl: `/organizations/${ORGANIZATION}/campaigns/new?reason=ADVICE_NO_OPPORTUNITY`,
          prefill: {
            objective: "Weekend family table",
            audience: "Saturday set menu for families.",
          },
          reasonCodes: ["ADVICE_NO_OPPORTUNITY"],
          evidenceWindow: {
            windowDays: 30,
            assumption:
              "Advice uses the last 30 days of evidence (default — the ideas card asks for no window).",
          },
        },
        correlationId: "c6",
      },
    }) as never;
    render(
      <Harness
        pendingPrompt={sendPrompt()}
        role="operator"
        permissions={["campaign.create"]}
        actorId={ACTOR}
      />,
    );
    await pickRecommendedIdea();

    // No opportunity is bound to this chat, so the pick resolves to the
    // pre-filled brief with the reason named — never a silent upgrade.
    expect(await screen.findByText(/ADVICE_NO_OPPORTUNITY/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open prefilled brief/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/campaigns/new"),
    );
    expect(
      screen.queryByRole("link", { name: /review and approve this version/i }),
    ).toBeNull();
    // No binding invented: the pick travels without an opportunity block.
    expect(answersCall()).not.toHaveProperty("opportunity");
  });
});
describe("nonce idempotency keys (M8)", () => {
  const SESSION = "33333333-3333-4333-8333-333333333333";

  it("derives stable per-send keys from the session id and nonce", () => {
    expect(buildDrawerRequestKeys(SESSION, 1)).toEqual({
      threadKey: `${SESSION}:1:thread`,
      messageKey: `${SESSION}:1:message`,
      routeKey: `${SESSION}:1:route`,
    });
    // A new nonce mints a new triple; the same nonce replays the same one.
    expect(buildDrawerRequestKeys(SESSION, 2).threadKey).not.toBe(
      buildDrawerRequestKeys(SESSION, 1).threadKey,
    );
    expect(buildDrawerRequestKeys("other-session", 1).threadKey).not.toBe(
      buildDrawerRequestKeys(SESSION, 1).threadKey,
    );
  });

  it("sends thread, message, and route under the nonce triple", async () => {
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const keys: Record<string, string> = {};
    for (const [url, init] of fetchMock.mock.calls) {
      const target = String(url);
      if ((init as RequestInit | undefined)?.method !== "POST") continue;
      const payload = JSON.parse(String((init as RequestInit).body)) as { idempotencyKey: string };
      if (target.endsWith("/agent/threads")) keys.thread = payload.idempotencyKey;
      else if (target.includes("/messages")) keys.message = payload.idempotencyKey;
      else if (target.includes("/route")) keys.route = payload.idempotencyKey;
    }
    expect(keys).toEqual({
      thread: `${SESSION}:1:thread`,
      message: `${SESSION}:1:message`,
      route: `${SESSION}:1:route`,
    });
  });

  it("mints the answers key once per submit and passes it through", async () => {
    globalThis.fetch = mockAgentFetch({
      route: {
        intent: "research_once",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: UPGRADE,
        thread: THREAD,
        correlationId: "c3",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    expect(await screen.findAllByText(/you clarified: confirm_upgrade: true/i)).toHaveLength(2);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const answersCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/answers"));
    const payload = JSON.parse(String((answersCall?.[1] as RequestInit).body)) as {
      idempotencyKey: string;
    };
    // Handler-minted (one per submit), long enough for the route floor,
    // and distinct from the send triple so submits never collide.
    expect(payload.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.idempotencyKey).not.toContain(":thread");
  });
});

describe("fresh routing codes (F2)", () => {
  it("renders the re-route codes instead of the previous turn", async () => {
    globalThis.fetch = mockAgentFetch({
      route: {
        intent: "research_once",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: UPGRADE,
        thread: THREAD,
        correlationId: "c3",
      },
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { confirm_upgrade: "true" },
        resumeKey: UPGRADE.resumeKey,
        intent: "answer_memory",
        confidence: "low",
        reasonCodes: ["LOW_CONFIDENCE_FALLBACK"],
        questionnaire: null,
        correlationId: "c6",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    expect(await screen.findAllByText(/you clarified: confirm_upgrade: true/i)).toHaveLength(2);

    // Steps stay always visible inline: the re-route codes render with no
    // Steps trigger to open first.
    expect(screen.queryByRole("button", { name: /^steps$/i })).toBeNull();
    expect(await screen.findByText(/LOW_CONFIDENCE_FALLBACK/)).toBeInTheDocument();
    expect(screen.queryByText(/MODEL_PROPOSAL_ACCEPTED/)).not.toBeInTheDocument();
  });
});

describe("watch one-tap (B4)", () => {
  const PROJECT = "77777777-7777-4777-8777-777777777777";
  const DUPLICATE_CARD: QuestionnaireSpec = {
    kind: "duplicate_watch",
    title: "Watch already running",
    resumeKey: "router:watch:overview:abcdef1234567890",
    items: [
      {
        key: "choice",
        label: "A similar watch already exists. What should happen?",
        kind: "single_select",
        required: true,
        options: [
          { value: "view_existing", label: "View existing" },
          { value: "update_fields", label: "Update fields" },
          { value: "start_fresh", label: "Start fresh anyway" },
          { value: "cancel", label: "Cancel" },
        ],
      },
      {
        key: "frequency",
        label: "How often should this run?",
        kind: "single_select",
        required: false,
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
      },
      { key: "branch", label: "Which branch is this for?", kind: "text", required: false },
      {
        key: "research_area",
        label: "Which research area should change?",
        kind: "text",
        required: false,
      },
      {
        key: "competitors",
        label: "Which competitor should be added?",
        kind: "text",
        required: false,
      },
      { key: "end_date", label: "When should monitoring stop?", kind: "date", required: false },
      {
        key: "confirm_start_fresh",
        label: "Start a second watch anyway?",
        kind: "confirm",
        required: false,
      },
    ],
  };
  const watchRoute = {
    intent: "watch",
    confidence: "high",
    reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
    questionnaire: DUPLICATE_CARD,
    thread: THREAD,
    correlationId: "c3",
  };
  const MANAGE = ["growth_intelligence.manage"];

  function answersPosts() {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/answers") && (init as RequestInit | undefined)?.method === "POST",
    );
  }

  it("has no manual watch forms: the card submit is the tap, the receipt renders the envelope", async () => {
    globalThis.fetch = mockAgentFetch({
      route: watchRoute,
      stream: [END_ONLY_STREAM],
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { choice: "view_existing" },
        resumeKey: DUPLICATE_CARD.resumeKey,
        intent: "watch",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        watchChoice: {
          outcome: "view_existing",
          projectId: PROJECT,
          link: {
            href: `/organizations/${ORGANIZATION}/growth-intelligence`,
            ref: { requestId: null, projectId: PROJECT, reportId: null },
          },
        },
        correlationId: "c6",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />);
    expect(await screen.findByText("Watch already running")).toBeInTheDocument();

    // The multi-field manual forms are gone: no question/branch inputs, no
    // Start/Update buttons anywhere.
    expect(screen.queryByLabelText("Watch question")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Branch id")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start watch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update watch/i })).not.toBeInTheDocument();

    // One tap on the duplicate choice submits the answers; the drawer never
    // posts to dispatch itself.
    await user.click(screen.getByText("View existing"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(answersPosts().length).toBe(1));
    const payload = JSON.parse(String((answersPosts()[0]?.[1] as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({ answers: { choice: "view_existing" } });
    expect(typeof payload.idempotencyKey).toBe("string");

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/dispatch"))).toBe(false);
    const receipt = await screen.findByText("Open Market Intelligence");
    expect(receipt).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/growth-intelligence`,
    );
  });

  it("renders the created receipt with the stated assumptions", async () => {
    const cadenceCard: QuestionnaireSpec = {
      kind: "missing_fields",
      title: "One more detail",
      resumeKey: "router:watch:overview:abcdef1234567890",
      items: [
        {
          key: "frequency",
          label: "How often should this run?",
          kind: "single_select",
          required: true,
          options: [
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ],
        },
      ],
    };
    globalThis.fetch = mockAgentFetch({
      route: { ...watchRoute, questionnaire: cadenceCard },
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { frequency: "weekly" },
        resumeKey: cadenceCard.resumeKey,
        intent: "watch",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        watchChoice: {
          outcome: "created",
          projectId: PROJECT,
          replayed: false,
          scopeFingerprint: "0".repeat(64),
          assumptions: [
            "Weekly cadence (default).",
            "Evidence window: last 30 days (default).",
          ],
          evidenceWindowDays: 30,
          link: {
            href: `/organizations/${ORGANIZATION}/growth-intelligence`,
            ref: { requestId: null, projectId: PROJECT, reportId: null },
          },
        },
        correlationId: "c6",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />);
    expect(await screen.findByText("One more detail")).toBeInTheDocument();

    // One tap on the single-item card submits; the receipt renders the
    // returned assumptions verbatim.
    await user.click(screen.getByText("Weekly"));
    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/Watch created\./)).toBeInTheDocument();
    expect(screen.getByText("Weekly cadence (default).")).toBeInTheDocument();
    expect(screen.getByText("Evidence window: last 30 days (default).")).toBeInTheDocument();
    expect(screen.getByText("Open Market Intelligence")).toBeInTheDocument();
  });

  it("renders the duplicate card returned behind the tap", async () => {
    const returned: QuestionnaireSpec = {
      ...DUPLICATE_CARD,
      resumeKey: "router:watch:overview:fedcba9876543210",
    };
    globalThis.fetch = mockAgentFetch({
      route: watchRoute,
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { choice: "start_fresh" },
        resumeKey: DUPLICATE_CARD.resumeKey,
        intent: "watch",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        watchChoice: {
          outcome: "duplicate",
          candidates: [{ projectId: PROJECT }],
          card: returned,
          scopeFingerprint: "0".repeat(64),
        },
        correlationId: "c6",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />);
    expect(await screen.findByText("Watch already running")).toBeInTheDocument();

    await user.click(screen.getByText("View existing"));
    await user.click(screen.getByRole("button", { name: /submit/i }));

    // The converged duplicate card replaces the answered one (fresh resume
    // key, so it is not hidden as already answered).
    expect(await screen.findByText(/similar watch is still running/i)).toBeInTheDocument();
    expect(screen.getAllByText("Watch already running").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the grant note without the manage grant", async () => {
    globalThis.fetch = mockAgentFetch({ route: watchRoute }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={[]} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /start watch/i })).not.toBeInTheDocument();
    // The one-tap region's own note (the card above carries its own gate
    // reason for the Update/Second choices).
    expect(
      screen.getByText("Needs the growth_intelligence.manage grant — enforcement stays server-side."),
    ).toBeInTheDocument();
  });

  it("points at the next card when a watch routes with no questionnaire", async () => {
    globalThis.fetch = mockAgentFetch({
      route: { ...watchRoute, questionnaire: null },
    }) as never;
    render(
      <Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />,
    );
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();

    expect(await screen.findByText(/next card creates the watch in one tap/i)).toBeInTheDocument();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/dispatch"))).toBe(false);
  });
});

describe("live answer stream", () => {
  const ASSISTANT: ThreadMessageView = {
    id: "88888888-8888-4888-8888-888888888888",
    threadId: THREAD.id,
    role: "assistant",
    body: "Durable answer with citations.",
    questionnaireAnswers: null,
    markerReceipts: null,
    citations: null,
    createdAt: "2026-09-25T10:00:03.000Z",
  };
  const END_CORRELATION = "99999999-9999-4999-8999-999999999999";

  function tokenFrame(text: string): string {
    return `event: token\ndata: ${JSON.stringify({ text })}\n\n`;
  }
  const DONE_FRAME = "event: done\ndata: [DONE]\n\n";
  function endFrame(payload: Record<string, unknown>): string {
    return `event: end\ndata: ${JSON.stringify(payload)}\n\n`;
  }
  function endPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      messageId: ASSISTANT.id,
      replayed: true,
      fallback: false,
      reason: null,
      draft: { body: "Hello, world.", citations: [], limitations: [], estimates: [] },
      correlationId: END_CORRELATION,
      ...overrides,
    };
  }
  function streamCalls(): Array<{
    url: string;
    init: RequestInit & { headers: Record<string, string> };
  }> {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls
      .filter(
        ([url, init]) =>
          String(url).includes("/stream") &&
          ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
      )
      .map(([url, init]) => ({
        url: String(url),
        init: init as RequestInit & { headers: Record<string, string> },
      }));
  }
  function fullStream(): string[] {
    return [tokenFrame("Hello, "), tokenFrame("world."), DONE_FRAME, endFrame(endPayload())];
  }

  it("opens one stream per send with messageId, page, and the session trail", async () => {
    globalThis.fetch = mockAgentFetch({
      stream: fullStream(),
      messages: [USER_MESSAGE, ASSISTANT],
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    // Live tokens join into the thread bubble before the swap.
    expect(await within(thread).findByText("Hello, world.")).toBeInTheDocument();

    const calls = streamCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain(
      `/agent/threads/${THREAD.id}/stream?messageId=${USER_MESSAGE.id}&page=overview`,
    );
    expect(calls[0]?.init.headers["accept"]).toBe("text/event-stream");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(calls[0]?.init.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("swaps the live preview for the durable row on end", async () => {
    globalThis.fetch = mockAgentFetch({
      stream: fullStream(),
      messages: [USER_MESSAGE, ASSISTANT],
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Hello, world.")).toBeInTheDocument();

    // The end marker discards the preview and renders the durable row.
    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
    await waitFor(() => expect(within(thread).queryByText("Hello, world.")).toBeNull());
    expect(within(thread).queryByText(/stopped here/i)).toBeNull();
  });

  it("swaps a conflict-reused kept row to durable with terminal steps, never a second bubble", async () => {
    // H2: the route already persisted the turn's row, so the stream's end
    // reuses the kept row (`replayed: true`) with its own live-only draft —
    // the drawer must discard both the preview and the stream draft and
    // render the durable row exactly once, with steps terminal.
    const running: ThreadSummary = { ...THREAD, status: "running" };
    globalThis.fetch = mockAgentFetch({
      stream: [
        tokenFrame("Live preview words."),
        DONE_FRAME,
        endFrame(
          endPayload({
            messageId: ASSISTANT.id,
            replayed: true,
            fallback: false,
            reason: null,
            draft: { body: "Stream-only draft words.", citations: [], limitations: [], estimates: [] },
          }),
        ),
      ],
      messages: [USER_MESSAGE, ASSISTANT],
      thread: running,
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Live preview words.")).toBeInTheDocument();

    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
    await waitFor(() => expect(within(thread).queryByText("Live preview words.")).toBeNull());
    // The stream's live-only draft never renders as a second bubble.
    expect(within(thread).queryByText("Stream-only draft words.")).toBeNull();
    expect(within(thread).queryByText(/stopped here/i)).toBeNull();
    const steps = within(thread).getByLabelText("Agent run steps");
    await waitFor(() => {
      expect(steps.querySelectorAll('[data-slot="marker"][role="status"]')).toHaveLength(0);
    });
    expect(steps.querySelector('[data-slot="spinner"]')).toBeNull();
  });

  it("flips every step terminal on the durable swap, even while the poll still reads running", async () => {
    const running: ThreadSummary = { ...THREAD, status: "running" };
    globalThis.fetch = mockAgentFetch({
      stream: fullStream(),
      messages: [USER_MESSAGE, ASSISTANT],
      thread: running,
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
    const steps = within(thread).getByLabelText("Agent run steps");
    await waitFor(() => {
      expect(steps.querySelectorAll('[data-slot="marker"][role="status"]')).toHaveLength(0);
    });
    expect(steps.querySelector('[data-slot="spinner"]')).toBeNull();
    const stepQueries = within(steps);
    expect(stepQueries.queryByText("Thinking…")).toBeNull();
    expect(stepQueries.queryByText(/exploring/i)).toBeNull();
    expect(stepQueries.getByText("Understood: Memory answer")).toBeInTheDocument();
  });

  it("shows a skeleton while the stream connects", async () => {
    globalThis.fetch = mockAgentFetch({ stream: "fetch-hang" }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByRole("status", { name: "Loading live answer" })).toBeInTheDocument();
  });

  it("keeps partial text with a note on drop and never resumes the stream", async () => {
    globalThis.fetch = mockAgentFetch({ stream: [tokenFrame("Half.")] }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Half.")).toBeInTheDocument();
    expect(await within(thread).findByText(/the live answer stopped here/i)).toBeInTheDocument();
    // Partial text rendered, so the stop is announced to screen readers too.
    expect(
      screen.getByText("The live answer stopped. Showing what arrived so far."),
    ).toBeInTheDocument();

    // The drawer reads the durable row instead of reopening the stream.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/messages") &&
            ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
        ),
      ).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streamCalls()).toHaveLength(1);
  });

  it("stays silent everywhere when the stream drops before any token", async () => {
    globalThis.fetch = mockAgentFetch({ stream: [], messages: [USER_MESSAGE, ASSISTANT] }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    // The durable row still renders, but nothing announces a stop: the
    // visual fallback is silent, so the live region stays silent too.
    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
    expect(screen.queryByText(/live answer stopped/i)).toBeNull();
    expect(screen.getByText(/understood: memory answer/i)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streamCalls()).toHaveLength(1);
  });

  it("treats an invalid end payload as a drop", async () => {
    globalThis.fetch = mockAgentFetch({
      stream: [tokenFrame("Almost."), DONE_FRAME, "event: end\ndata: {\"nope\":true}\n\n"],
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Almost.")).toBeInTheDocument();
    expect(await within(thread).findByText(/the live answer stopped here/i)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streamCalls()).toHaveLength(1);
  });

  it("renders the end draft body with the single sources line when messageId is null, never sections (F3)", async () => {
    const draft = {
      body: "Viewer answer.",
      citations: [{ claim: "Confirmed trading name.", sourceId: "ledger", digest: "abc123" }],
      limitations: ["Coverage is partial."],
      estimates: [],
    };
    globalThis.fetch = mockAgentFetch({
      stream: [tokenFrame("View"), DONE_FRAME, endFrame(endPayload({ messageId: null, draft }))],
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="viewer" />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Viewer answer.")).toBeInTheDocument();
    // F3: one compact sources line below the bubble replaces per-number
    // markers; Sources/Limitations sections never render.
    expect(
      within(thread).getByRole("button", { name: /sources: 1 cited source/i }),
    ).toHaveTextContent("Sources: [1]");
    expect(within(thread).queryByRole("button", { name: /source 1:/i })).toBeNull();
    expect(within(thread).queryByRole("list", { name: "Answer sources" })).toBeNull();
    expect(within(thread).queryByRole("list", { name: "Answer limitations" })).toBeNull();
    expect(within(thread).queryByText("Limitations")).toBeNull();
    expect(within(thread).queryByText(/coverage is partial/i)).toBeNull();
    expect(within(thread).queryByText(/stopped here/i)).toBeNull();
  });

  it("falls back to the durable read when the stream never opens", async () => {
    globalThis.fetch = mockAgentFetch({ messages: [USER_MESSAGE, ASSISTANT] }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
    expect(within(thread).queryByText(/stopped here/i)).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading live answer" })).toBeNull();
  });

  it("skips malformed token frames without failing the stream", async () => {
    globalThis.fetch = mockAgentFetch({
      stream: ["event: token\ndata: not-json\n\n", ...fullStream()],
      messages: [USER_MESSAGE, ASSISTANT],
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
  });

  it("reopens read the durable row without resuming the stream", async () => {
    globalThis.fetch = mockAgentFetch({
      stream: fullStream(),
      messages: [USER_MESSAGE, ASSISTANT],
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
    expect(streamCalls()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /back to thread history/i }));
    await user.click(await screen.findByRole("button", { name: /open new chat/i }));
    const reopened = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(reopened).getByText("Durable answer with citations.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streamCalls()).toHaveLength(1);
  });
});

describe("answer rendering (finding D)", () => {
  const DIGEST = "abc123abc123";

  function assistantMessage(body: string): ThreadMessageView {
    return {
      id: "99999999-9999-4999-8999-999999999999",
      threadId: THREAD.id,
      role: "assistant",
      body,
      questionnaireAnswers: null,
      markerReceipts: null,
      citations: null,
      createdAt: "2026-09-25T10:00:03.000Z",
    };
  }

  function naturalEncoded(): string {
    return encodeAnswerBody({
      body: "First paragraph names weekday demand.\n\nSecond paragraph carries the detail.",
      citations: [
        { claim: "Confirmed trading name.", sourceId: "f1", digest: DIGEST },
        { claim: "Weekday covers held steady.", sourceId: "ledger", digest: DIGEST },
      ],
      limitations: ["Economics data not ready."],
      estimates: [],
    });
  }

  function legacyEncoded(): string {
    return encodeAnswerBody({
      body: [
        "Answer from stored organization context — no new research ran.",
        "",
        "What the stored context supports:",
        "- Confirmed trading name.",
        "",
        "Check Limitations for gaps; any Estimates are labeled where shown.",
      ].join("\n"),
      citations: [{ claim: "Confirmed trading name.", sourceId: "f1", digest: DIGEST }],
      limitations: ["Economics data not ready."],
      estimates: [],
    });
  }

  it("renders a legacy fallback row once, with no header block", () => {
    const { container } = render(
      <AgentResponseMessage message={assistantMessage(legacyEncoded())} />,
    );
    // No stored-context fallback header block, no scaffold, no repeated fact.
    expect(screen.queryByText(/answer from stored organization context/i)).toBeNull();
    expect(screen.queryByText(/what the stored context supports/i)).toBeNull();
    // F3: the fact lives in the single sources-line tooltip, never as
    // visible duplicate text and never as a Sources section list.
    expect(screen.queryByText("Confirmed trading name.")).toBeNull();
    expect(screen.queryByRole("button", { name: /source 1:/i })).toBeNull();
    expect(screen.getByRole("button", { name: /sources: 1 cited source/i })).toHaveTextContent(
      "Sources: [1]",
    );
    expect(screen.queryByRole("list", { name: "Answer sources" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Answer limitations" })).toBeNull();
    // One natural paragraph in the synthesis card — the body is not doubled.
    const card = container.querySelector('[data-slot="card"]') as HTMLElement;
    expect(card.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders the body as natural paragraphs", () => {
    const { container } = render(
      <AgentResponseMessage message={assistantMessage(naturalEncoded())} />,
    );
    const card = container.querySelector('[data-slot="card"]') as HTMLElement;
    const paragraphs = card.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("First paragraph names weekday demand.");
    expect(paragraphs[1]).toHaveTextContent("Second paragraph carries the detail.");
  });

  it("renders Sources: [1] for one citation with no per-number markers", () => {
    render(<AgentResponseMessage message={assistantMessage(legacyEncoded())} />);
    expect(screen.getByRole("button", { name: /sources: 1 cited source/i })).toHaveTextContent(
      "Sources: [1]",
    );
    expect(screen.queryByRole("button", { name: /source 1:/i })).toBeNull();
  });

  it("renders Sources: [1+] for many citations with no per-number markers", () => {
    render(<AgentResponseMessage message={assistantMessage(naturalEncoded())} />);
    expect(screen.getByRole("button", { name: /sources: 2 cited sources/i })).toHaveTextContent(
      "Sources: [1+]",
    );
    expect(screen.queryByRole("button", { name: /source 1:/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /source 2:/i })).toBeNull();
  });

  it("lists claims + sources in citation order inside the one tooltip on hover", async () => {
    const user = userEvent.setup();
    render(<AgentResponseMessage message={assistantMessage(naturalEncoded())} />);
    await user.hover(screen.getByRole("button", { name: /sources: 2 cited sources/i }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("[1] Confirmed trading name.");
    expect(tooltip).toHaveTextContent("f1");
    expect(tooltip).toHaveTextContent("[2] Weekday covers held steady.");
    expect(tooltip).toHaveTextContent("ledger");
    // Ordered: the first claim sits before the second in the tooltip.
    const text = tooltip.textContent ?? "";
    expect(text.indexOf("Confirmed trading name.")).toBeLessThan(
      text.indexOf("Weekday covers held steady."),
    );
  });

  it("opens the single sources tooltip by keyboard focus", async () => {
    render(<AgentResponseMessage message={assistantMessage(naturalEncoded())} />);
    fireEvent.focus(screen.getByRole("button", { name: /sources: 2 cited sources/i }));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("[1] Confirmed trading name.");
    expect(tooltip).toHaveTextContent("f1");
    expect(tooltip).toHaveTextContent("[2] Weekday covers held steady.");
    expect(tooltip).toHaveTextContent("ledger");
  });

  it("sits outside and below the synthesis bubble (F3 DOM order)", () => {
    const { container } = render(
      <AgentResponseMessage message={assistantMessage(naturalEncoded())} />,
    );
    const card = container.querySelector('[data-slot="card"]') as HTMLElement;
    const trigger = screen.getByRole("button", { name: /sources: 2 cited sources/i });
    expect(card).toBeInTheDocument();
    // The bubble precedes the sources line in the DOM: outside + below.
    expect(card.compareDocumentPosition(trigger)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(trigger.closest('[data-slot="card"]')).toBeNull();
  });

  it("omits Sources and Limitations section lists (F3 owns the single sources line)", () => {
    render(<AgentResponseMessage message={assistantMessage(naturalEncoded())} />);
    // Sections stay deleted; structured data stays encoded in the row (see
    // the F2 block below). F3 renders one compact line + one tooltip.
    expect(screen.queryByRole("list", { name: "Answer sources" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Answer limitations" })).toBeNull();
    expect(screen.queryByText("Limitations")).toBeNull();
    // No per-number markers remain; the single line owns the tooltip.
    expect(screen.queryByRole("button", { name: /source 1:/i })).toBeNull();
    expect(screen.getByRole("button", { name: /sources: 2 cited sources/i })).toHaveTextContent(
      "Sources: [1+]",
    );
  });

  describe("chatbot voice, no internal leakage (F2)", () => {
    function voicedEncoded(): string {
      return encodeAnswerBody({
        body: "Weekday demand looks soft, though economics data isn't ready yet so cost claims stay out.",
        citations: [{ claim: "Confirmed trading name.", sourceId: "f1", digest: DIGEST }],
        limitations: ["Economics data not ready; cost claims stay withheld."],
        estimates: [],
      });
    }

    function estimatedEncoded(): string {
      return encodeAnswerBody({
        body: "Visits may lift next week.",
        citations: [{ claim: "Confirmed trading name.", sourceId: "f1", digest: DIGEST }],
        limitations: ["Economics data not ready."],
        estimates: [
          {
            label: "Estimate",
            value: "+5% visits / week",
            inputs: ["weekday covers, last 30 days"],
            assumptions: ["no price change during the window"],
          },
        ],
      });
    }

    it("renders no Sources or Limitations section lists, no scaffold, with the gap voiced inline", () => {
      render(<AgentResponseMessage message={assistantMessage(voicedEncoded())} />);
      // Body voices the gap inline as a sentence.
      expect(screen.getByText(/economics data isn't ready yet/i)).toBeInTheDocument();
      // Section lists are absent from the DOM; the single F3 sources line
      // below the bubble is the only Sources surface.
      expect(screen.queryByRole("list", { name: "Answer sources" })).toBeNull();
      expect(screen.queryByRole("list", { name: "Answer limitations" })).toBeNull();
      expect(screen.queryByText("Limitations")).toBeNull();
      expect(screen.getByRole("button", { name: /sources: 1 cited source/i })).toHaveTextContent(
        "Sources: [1]",
      );
      // No scaffold or header strings leak into the render.
      expect(screen.queryByText(/answer from stored organization context/i)).toBeNull();
      expect(screen.queryByText(/what the stored context supports/i)).toBeNull();
      expect(screen.queryByText(/check limitations for gaps/i)).toBeNull();
    });

    it("keeps the row's structured data encoded while the section lists stay unrendered", () => {
      const encoded = voicedEncoded();
      // The durable row still carries both sections for history.
      expect(encoded).toMatch(/Sources/);
      expect(encoded).toMatch(/Limitations/);
      render(<AgentResponseMessage message={assistantMessage(encoded)} />);
      expect(screen.queryByRole("list", { name: "Answer sources" })).toBeNull();
      expect(screen.queryByRole("list", { name: "Answer limitations" })).toBeNull();
      // F3: no per-number markers; the single line owns the tooltip.
      expect(screen.queryByRole("button", { name: /source 1:/i })).toBeNull();
      expect(screen.getByRole("button", { name: /sources: 1 cited source/i })).toHaveTextContent(
        "Sources: [1]",
      );
    });

    it("keeps Estimates with inputs + assumptions on the surface while section lists stay gone", () => {
      render(<AgentResponseMessage message={assistantMessage(estimatedEncoded())} />);
      expect(screen.getByText("Estimate")).toBeInTheDocument();
      expect(screen.getByText(/\+5% visits \/ week/)).toBeInTheDocument();
      expect(screen.getByText(/weekday covers, last 30 days/)).toBeInTheDocument();
      expect(screen.getByText(/no price change during the window/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /source 1:/i })).toBeNull();
      expect(screen.getByRole("button", { name: /sources: 1 cited source/i })).toHaveTextContent(
        "Sources: [1]",
      );
      expect(screen.queryByRole("list", { name: "Answer sources" })).toBeNull();
      expect(screen.queryByText("Limitations")).toBeNull();
    });
  });
});

describe("resolveLiveThread (B2 escalation hold)", () => {
  const escalated: ThreadSummary = { ...THREAD, mode: "deepthink" };
  const other: ThreadSummary = {
    ...THREAD,
    id: "99999999-9999-4999-8999-999999999999",
    mode: "deepthink",
  };

  it("holds the escalated mode when the same-thread poll still reads Quick", () => {
    const live = resolveLiveThread(THREAD, escalated);
    expect(live?.mode).toBe("deepthink");
    expect(live?.id).toBe(THREAD.id);
  });

  it("lets the poll win for links and status on the merged row", () => {
    const running: ThreadSummary = {
      ...THREAD,
      status: "running",
      linkedResearchProjectId: "55555555-5555-4555-8555-555555555555",
    };
    const live = resolveLiveThread(running, escalated);
    expect(live?.mode).toBe("deepthink");
    expect(live?.status).toBe("running");
    expect(live?.linkedResearchProjectId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("ignores a stale optimistic row from another thread", () => {
    expect(resolveLiveThread(THREAD, other)?.mode).toBe("quick");
  });

  it("falls back to whichever row exists", () => {
    expect(resolveLiveThread(null, escalated)?.mode).toBe("deepthink");
    expect(resolveLiveThread(THREAD, null)?.mode).toBe("quick");
    expect(resolveLiveThread(null, null)).toBeNull();
  });
});

describe("research auto-run (B3)", () => {
  it("offers no Run button on research turns: the run fires server-side, zero-click", async () => {
    const escalated: ThreadSummary = { ...THREAD, mode: "deepthink" };
    const fetchMock = mockAgentFetch({
      route: {
        intent: "research_once",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED", "DEEPTHINK_AUTO_ESCALATED"],
        questionnaire: null,
        thread: escalated,
        correlationId: "c3",
      },
      thread: THREAD,
    });
    globalThis.fetch = fetchMock as never;
    render(<Harness pendingPrompt={sendPrompt("research the downtown lunch crowd")} />);
    // The escalated turn renders (marker proves the route landed)…
    expect(await screen.findByText(/switched to deepthink/i)).toBeInTheDocument();
    // …with no manual Run control and no client dispatch POST: research
    // auto-enqueues from the route response on the server.
    expect(screen.queryByRole("button", { name: /run research once/i })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/dispatch"))).toBe(false);
  });
});

describe("watch manual fallback (FINAL fix for I-1)", () => {
  const MANAGE = ["growth_intelligence.manage"];
  const PROJECT = "77777777-7777-4777-8777-777777777777";
  const BRANCH = "55555555-5555-4555-8555-555555555555";
  const cadenceCard: QuestionnaireSpec = {
    kind: "missing_fields",
    title: "One more detail",
    resumeKey: "router:watch:overview:abcdef1234567890",
    items: [
      {
        key: "frequency",
        label: "How often should this run?",
        kind: "single_select",
        required: true,
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
        ],
      },
    ],
  };
  const watchRoute = {
    intent: "watch",
    confidence: "high",
    reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
    questionnaire: cadenceCard,
    thread: THREAD,
    correlationId: "c3",
  };
  const DISPATCH_RECEIPT = {
    outcome: "dispatched",
    eventId: "evt-1",
    replayed: false,
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    runId: null,
    requestId: "66666666-6666-4666-8666-666666666666",
    projectId: PROJECT,
    draftRequestId: null,
    briefUrl: null,
    reasonCodes: [],
    link: {
      href: `/organizations/${ORGANIZATION}/growth-intelligence`,
      ref: { requestId: "66666666-6666-4666-8666-666666666666", projectId: PROJECT, reportId: null },
    },
  };

  function mockAgentFetchWithDispatch(
    plan: Parameters<typeof mockAgentFetch>[0],
    dispatchBody: unknown = DISPATCH_RECEIPT,
  ) {
    const base = mockAgentFetch(plan);
    return vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("/dispatch") && (init?.method ?? "GET") === "POST") {
        return Response.json(dispatchBody);
      }
      return base(url, init);
    });
  }

  function dispatchPosts() {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/dispatch") && (init as RequestInit | undefined)?.method === "POST",
    );
  }

  it("renders the fallback and dispatches when the one-tap answers submit fails", async () => {
    globalThis.fetch = mockAgentFetchWithDispatch({
      route: watchRoute,
      stream: [END_ONLY_STREAM],
      answers: { status: 500, message: "tap broke" },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />);
    expect(await screen.findByText("One more detail")).toBeInTheDocument();
    // A fresh tappable card suppresses the fallback: one-tap stays primary.
    expect(screen.queryByText("Manual watch fallback")).not.toBeInTheDocument();

    await user.click(screen.getByText("Weekly"));
    await user.click(screen.getByRole("button", { name: /submit/i }));

    // The errored tap arms the fallback; the card and its alert stay.
    expect(await screen.findByText("Manual watch fallback")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("tap broke");
    expect(screen.getByLabelText("Watch question")).toBeInTheDocument();

    // The restored forms post to dispatch and render the queued receipt.
    fireEvent.change(screen.getByLabelText("Watch question"), {
      target: { value: "Track lunch demand" },
    });
    fireEvent.change(screen.getByLabelText("Research area"), {
      target: { value: "downtown lunch demand" },
    });
    fireEvent.change(screen.getByLabelText("Branch id"), { target: { value: BRANCH } });
    await user.click(screen.getByRole("button", { name: /start watch/i }));

    const receiptLink = await screen.findByRole("link", { name: "Open Market Intelligence" });
    expect(receiptLink).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/growth-intelligence`,
    );
    expect(receiptLink.parentElement).toHaveTextContent(/Watch queued\./);
    expect(dispatchPosts()).toHaveLength(1);
    const payload = JSON.parse(String((dispatchPosts()[0]?.[1] as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      action: "watch_create",
      watchCreate: { branchId: BRANCH, question: "Track lunch demand" },
    });
  });

  it("renders the fallback when the tap re-routes away from watch", async () => {
    globalThis.fetch = mockAgentFetch({
      route: watchRoute,
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { frequency: "weekly" },
        resumeKey: cadenceCard.resumeKey,
        intent: "answer_memory",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        correlationId: "c6",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />);
    expect(await screen.findByText("One more detail")).toBeInTheDocument();

    await user.click(screen.getByText("Weekly"));
    await user.click(screen.getByRole("button", { name: /submit/i }));

    // The B5 live failure: the tap lands on answer_memory and the one-tap
    // region unmounts — the latched fallback is the remaining watch path.
    expect(await screen.findByText("Manual watch fallback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start watch/i })).toBeInTheDocument();
    expect(screen.queryByText(/next card creates the watch in one tap/i)).not.toBeInTheDocument();
  });

  it("keeps the one-tap receipt primary with no fallback when one-tap works", async () => {
    globalThis.fetch = mockAgentFetch({
      route: watchRoute,
      stream: [END_ONLY_STREAM],
      answers: {
        message: ANSWERS_MESSAGE,
        replayed: false,
        answers: { frequency: "weekly" },
        resumeKey: cadenceCard.resumeKey,
        intent: "watch",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: null,
        watchChoice: {
          outcome: "created",
          projectId: PROJECT,
          replayed: false,
          scopeFingerprint: "0".repeat(64),
          assumptions: ["Weekly cadence (default)."],
          evidenceWindowDays: 30,
          link: {
            href: `/organizations/${ORGANIZATION}/growth-intelligence`,
            ref: { requestId: null, projectId: PROJECT, reportId: null },
          },
        },
        correlationId: "c6",
      },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />);
    expect(await screen.findByText("One more detail")).toBeInTheDocument();
    expect(screen.queryByText("Manual watch fallback")).not.toBeInTheDocument();

    await user.click(screen.getByText("Weekly"));
    await user.click(screen.getByRole("button", { name: /submit/i }));

    // The receipt renders and the fallback never displaces it.
    expect(await screen.findByText(/Watch created\./)).toBeInTheDocument();
    expect(screen.queryByText("Manual watch fallback")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Watch question")).not.toBeInTheDocument();
  });

  it("renders the fallback beside the hint on a card-less watch turn", async () => {
    globalThis.fetch = mockAgentFetchWithDispatch({
      route: { ...watchRoute, questionnaire: null },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={MANAGE} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();

    // One-tap is unavailable (no card), so both the hint and the fallback
    // show — and the fallback posts nothing by itself.
    expect(await screen.findByText(/next card creates the watch in one tap/i)).toBeInTheDocument();
    expect(screen.getByText("Manual watch fallback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start watch/i })).toBeInTheDocument();
    expect(dispatchPosts()).toHaveLength(0);
  });

  it("stays gated on growth_intelligence.manage", async () => {
    globalThis.fetch = mockAgentFetch({
      route: { ...watchRoute, questionnaire: null },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="operator" permissions={[]} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();

    // The fallback condition holds (card-less watch turn) but the grant
    // does not: the grant note stays the only surface.
    expect(
      await screen.findByText(
        "Needs the growth_intelligence.manage grant — enforcement stays server-side.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Manual watch fallback")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start watch/i })).not.toBeInTheDocument();
  });
});

describe("movable drawer (F5)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  function stubMobile(matches: boolean) {
    window.matchMedia = ((query: string) => ({
      media: query,
      matches,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  function setViewport(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  function panelOf(section: HTMLElement): HTMLElement {
    return section.firstElementChild as HTMLElement;
  }

  it("drags the drawer and bar as one unit, clamped to the viewport", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    expect(section.style.transform).toBe("");

    const handle = screen.getByTestId("agent-drawer-drag-handle");
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 400 });
    fireEvent.pointerUp(window);

    // Right 100, up 100 — one shared offset for the whole unit.
    expect(section.style.transform).toBe("translate3d(100px, -100px, 0)");

    // Roaming far off-screen parks at the guard rails (1024x768 jsdom).
    fireEvent.pointerDown(handle, { button: 0, clientX: 600, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 5000, clientY: -5000 });
    fireEvent.pointerUp(window);
    expect(section.style.transform).toBe("translate3d(824px, -568px, 0)");
  });

  it("nudges the unit with arrow keys on the drag handle", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    const handle = screen.getByTestId("agent-drawer-drag-handle");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(section.style.transform).toBe("translate3d(16px, -16px, 0)");
  });

  it("resizes width from the east edge with a 300px floor and viewport ceiling", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    const edge = screen.getByTestId("agent-drawer-resize-e");

    fireEvent.pointerDown(edge, { button: 0, clientX: 800, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 900, clientY: 400 });
    fireEvent.pointerUp(window);
    // From the 704px CSS default: +100.
    expect(panelOf(section).style.width).toBe("804px");

    // Shrinking past the floor parks at 300px — width never collapses.
    fireEvent.pointerDown(edge, { button: 0, clientX: 900, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: -1000, clientY: 400 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("300px");
    expect(screen.queryByRole("button", { name: /expand conversation/i })).toBeNull();
    expect(screen.getByLabelText("AI agent conversation")).toBeInTheDocument();

    // Growing past the viewport parks at viewport minus margins (992px).
    fireEvent.pointerDown(edge, { button: 0, clientX: 0, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 5000, clientY: 400 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("992px");
  });

  it("resizes width from the west edge with x + width moving together", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    const edge = screen.getByTestId("agent-drawer-resize-w");

    // Drag the left edge left 100: the panel grows while the right edge
    // stays put — width +100, unit offset -100 on x.
    fireEvent.pointerDown(edge, { button: 0, clientX: 800, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 400 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("804px");
    expect(section.style.transform).toBe("translate3d(-100px, 0px, 0)");

    // Shrinking past the floor parks at 300px — width never collapses.
    fireEvent.pointerDown(edge, { button: 0, clientX: 700, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 5000, clientY: 400 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("300px");
    expect(section.style.transform).toBe("translate3d(404px, 0px, 0)");
    expect(screen.queryByRole("button", { name: /expand conversation/i })).toBeNull();
    expect(screen.getByLabelText("AI agent conversation")).toBeInTheDocument();

    // Growing past the viewport parks at viewport minus margins (992px).
    fireEvent.pointerDown(edge, { button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: -5000, clientY: 400 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("992px");
    expect(section.style.transform).toBe("translate3d(-288px, 0px, 0)");
  });

  it("nudges west-edge width with arrow keys, ArrowLeft growing the panel", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    const edge = screen.getByTestId("agent-drawer-resize-w");

    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(panelOf(section).style.width).toBe("720px");
    expect(section.style.transform).toBe("translate3d(-16px, 0px, 0)");

    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(panelOf(section).style.width).toBe("704px");
    // Back at rest the unit transform is unset, never a zero translate.
    expect(section.style.transform).toBe("");
  });

  it("resizes height from the south edge and the corner resizes both dims", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");

    const south = screen.getByTestId("agent-drawer-resize-s");
    fireEvent.pointerDown(south, { button: 0, clientX: 400, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 520 });
    fireEvent.pointerUp(window);
    // From the 544px CSS default: +20 (the 768px viewport caps at 576px).
    expect(panelOf(section).style.height).toBe("564px");

    const corner = screen.getByTestId("agent-drawer-resize-se");
    fireEvent.pointerDown(corner, { button: 0, clientX: 400, clientY: 520 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 530 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("754px");
    expect(panelOf(section).style.height).toBe("574px");
  });

  it("resizes width and height together from the southwest corner", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    const corner = screen.getByTestId("agent-drawer-resize-sw");

    // Left edge left 50 grows width to 754 (x tracks -50); down 10 grows
    // height to 554 — the same dims the southeast corner reaches mirrored.
    fireEvent.pointerDown(corner, { button: 0, clientX: 400, clientY: 520 });
    fireEvent.pointerMove(window, { clientX: 350, clientY: 530 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("754px");
    expect(panelOf(section).style.height).toBe("554px");
    expect(section.style.transform).toBe("translate3d(-50px, 0px, 0)");
  });

  it("collapses to the strip when a southwest resize would drop height below 12rem", () => {
    render(<Harness />);
    expect(screen.getByLabelText("AI agent conversation")).toBeInTheDocument();

    const corner = screen.getByTestId("agent-drawer-resize-sw");
    fireEvent.pointerDown(corner, { button: 0, clientX: 400, clientY: 500 });
    // 544 - 400 = 144 < 192: no shrink, the strip docks instead.
    fireEvent.pointerMove(window, { clientX: 350, clientY: 100 });
    fireEvent.pointerUp(window);

    expect(screen.queryByLabelText("AI agent conversation")).toBeNull();
    expect(screen.getByRole("button", { name: /expand conversation/i })).toBeInTheDocument();
  });

  it("never lets the section flex container squeeze a resized panel", () => {
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    const edge = screen.getByTestId("agent-drawer-resize-e");
    fireEvent.pointerDown(edge, { button: 0, clientX: 800, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 900, clientY: 400 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("804px");
    // G5: the panel is a flex item of the centering section. Without
    // shrink-0 a real browser squeezes an explicitly widened panel back
    // toward the section content width (live: +120px stalled at +32px on a
    // 1024px viewport), so the east handle reads dead.
    expect(panelOf(section).className).toMatch(/(^|\s)shrink-0(\s|$)/);
  });

  it("collapses to the strip when a resize would drop height below 12rem", () => {
    render(<Harness />);
    expect(screen.getByLabelText("AI agent conversation")).toBeInTheDocument();

    const south = screen.getByTestId("agent-drawer-resize-s");
    fireEvent.pointerDown(south, { button: 0, clientX: 400, clientY: 500 });
    // 544 - 400 = 144 < 192: no shrink, the strip docks instead.
    fireEvent.pointerMove(window, { clientX: 400, clientY: 100 });
    fireEvent.pointerUp(window);

    expect(screen.queryByLabelText("AI agent conversation")).toBeNull();
    expect(screen.getByRole("button", { name: /expand conversation/i })).toBeInTheDocument();
  });

  it("honors shell-owned geometry and reports drags back", () => {
    const onGeometryChange = vi.fn();
    render(
      <Harness
        geometry={{ x: 10, y: -20, width: 500, height: 400 }}
        onGeometryChange={onGeometryChange}
      />,
    );
    const section = screen.getByLabelText("AI agent conversation");
    expect(section.style.transform).toBe("translate3d(10px, -20px, 0)");
    const panel = panelOf(section);
    expect(panel.style.width).toBe("500px");
    expect(panel.style.height).toBe("400px");

    const handle = screen.getByTestId("agent-drawer-drag-handle");
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: -10 });
    fireEvent.pointerUp(window);
    expect(onGeometryChange).toHaveBeenCalledWith({ x: 40, y: -30, width: 500, height: 400 });
  });

  it("keeps the mobile sheet native with no drag or resize handles", () => {
    stubMobile(true);
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    expect(section.className).toMatch(/(^|\s)left-0(\s|$)/);
    expect(screen.queryByTestId("agent-drawer-drag-handle")).toBeNull();
    expect(screen.queryByTestId("agent-drawer-resize-e")).toBeNull();
    expect(screen.queryByTestId("agent-drawer-resize-w")).toBeNull();
    expect(screen.queryByTestId("agent-drawer-resize-s")).toBeNull();
    expect(screen.queryByTestId("agent-drawer-resize-se")).toBeNull();
    expect(screen.queryByTestId("agent-drawer-resize-sw")).toBeNull();
  });

  it("ignores desktop geometry on mobile — no unit transform, no panel size", () => {
    stubMobile(true);
    render(
      <Harness geometry={{ x: 100, y: -80, width: 600, height: 500 }} onGeometryChange={() => {}} />,
    );
    const section = screen.getByLabelText("AI agent conversation");
    expect(section.style.transform).toBe("");
    const panel = panelOf(section);
    expect(panel.style.width).toBe("");
    expect(panel.style.height).toBe("");
  });

  it("applies size but no unit transform when the shell owns the offset", () => {
    render(
      <Harness
        geometry={{ x: 50, y: -30, width: 804, height: 400 }}
        onGeometryChange={() => {}}
        disableUnitTransform
      />,
    );
    const section = screen.getByLabelText("AI agent conversation");
    // The shell container carries the translate3d; the inner section must
    // stay untransformed so the offset never stacks 2x.
    expect(section.style.transform).toBe("");
    const panel = panelOf(section);
    expect(panel.style.width).toBe("804px");
    expect(panel.style.height).toBe("400px");
  });

  it("collapses exactly once on repeated sub-threshold keyboard shrinks", () => {
    const onToggleCollapsed = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // Fixed collapsed={false}: the parent never flips, so both presses land
    // on the handle — without the once-guard the toggle would fire twice
    // (collapse then expand).
    render(
      <SidebarProvider>
        <QueryClientProvider client={client}>
          <AgentDrawer
            organizationId={ORGANIZATION}
            page="overview"
            mode="quick"
            role="operator"
            permissions={[]}
            pendingPrompt={null}
            threadId={null}
            view="thread"
            onViewChange={() => {}}
            collapsed={false}
            onToggleCollapsed={onToggleCollapsed}
            onClose={() => {}}
            onThreadChange={() => {}}
            onPromptConsumed={() => {}}
            geometry={{ x: 0, y: 0, width: 500, height: 200 }}
            onGeometryChange={() => {}}
          />
        </QueryClientProvider>
      </SidebarProvider>,
    );
    const south = screen.getByTestId("agent-drawer-resize-s");
    // 200 - 16 = 184 < 192: sub-threshold, docks the strip.
    fireEvent.keyDown(south, { key: "ArrowUp" });
    fireEvent.keyDown(south, { key: "ArrowUp" });
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("clamps width to narrow viewports", () => {
    setViewport(500, 768);
    render(<Harness />);
    const section = screen.getByLabelText("AI agent conversation");
    const edge = screen.getByTestId("agent-drawer-resize-e");
    fireEvent.pointerDown(edge, { button: 0, clientX: 0, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 5000, clientY: 400 });
    fireEvent.pointerUp(window);
    expect(panelOf(section).style.width).toBe("468px");
  });
});

describe("optimistic send (G1)", () => {
  it("shows the user bubble while the route POST still hangs", async () => {
    globalThis.fetch = mockAgentFetch({ route: "hang" }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    // The bubble renders on mutate, before the server round-trip lands.
    expect(await within(thread).findByText("What do we know?")).toBeInTheDocument();
    expect(within(thread).getAllByText("What do we know?")).toHaveLength(1);
    expect(await screen.findByText(/thinking/i)).toBeInTheDocument();
  });

  it("replaces the optimistic bubble on confirm, never duplicating it", async () => {
    globalThis.fetch = mockAgentFetch({ stream: [END_ONLY_STREAM] }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("What do we know?")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(thread).getByText("Understood: Memory answer")).toBeInTheDocument();
    });
    expect(within(thread).getAllByText("What do we know?")).toHaveLength(1);
  });

  it("keeps the typed bubble when the send fails", async () => {
    globalThis.fetch = mockAgentFetch({
      route: { status: 500, message: "Router exploded." },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/router exploded/i);
    const thread = screen.getByRole("log", { name: "Conversation thread" });
    expect(within(thread).getByText("What do we know?")).toBeInTheDocument();
  });
});

describe("honest send failures (G1)", () => {
  function tokenFrame(text: string): string {
    return `event: token\ndata: ${JSON.stringify({ text })}\n\n`;
  }
  const DONE_FRAME = "event: done\ndata: [DONE]\n\n";
  function endFrame(payload: Record<string, unknown>): string {
    return `event: end\ndata: ${JSON.stringify(payload)}\n\n`;
  }
  const ASSISTANT: ThreadMessageView = {
    id: "88888888-8888-4888-8888-888888888888",
    threadId: THREAD.id,
    role: "assistant",
    body: "Durable answer with citations.",
    questionnaireAnswers: null,
    markerReceipts: null,
    citations: null,
    createdAt: "2026-09-25T10:00:03.000Z",
  };

  async function expectTerminalError(thread: HTMLElement) {
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const steps = thread.querySelector('[aria-label="Agent run steps"]') as HTMLElement;
    expect(steps).not.toBeNull();
    const stepQueries = within(steps);
    expect(stepQueries.queryByText(/thinking/i)).toBeNull();
    expect(stepQueries.queryByText(/exploring/i)).toBeNull();
    expect(steps.querySelector('[data-slot="spinner"]')).toBeNull();
  }

  it("routes a stream-open failure into the error state with terminal steps", async () => {
    globalThis.fetch = mockAgentFetch({
      streamFailure: { status: 500, message: "Stream exploded." },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("What do we know?")).toBeInTheDocument();
    await expectTerminalError(thread);
    expect(screen.getByRole("alert")).toHaveTextContent(/live answer could not start/i);
  });

  it("routes a messages-refresh 404 into the error state without duplicating the bubble", async () => {
    globalThis.fetch = mockAgentFetch({
      stream: [
        tokenFrame("Hello, "),
        DONE_FRAME,
        endFrame({
          messageId: ASSISTANT.id,
          replayed: true,
          fallback: false,
          reason: null,
          draft: { body: "Hello, world.", citations: [], limitations: [], estimates: [] },
          correlationId: "99999999-9999-4999-8999-999999999999",
        }),
      ],
      messagesError: { status: 404, message: "Thread messages not found." },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("What do we know?")).toBeInTheDocument();
    await expectTerminalError(thread);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not refresh the conversation/i);
    expect(within(thread).getAllByText("What do we know?")).toHaveLength(1);
  });

  it("routes a thread-poll failure into the error state while keeping durable rows", async () => {
    globalThis.fetch = mockAgentFetch({
      stream: [
        tokenFrame("Hello, "),
        DONE_FRAME,
        endFrame({
          messageId: ASSISTANT.id,
          replayed: true,
          fallback: false,
          reason: null,
          draft: { body: "Hello, world.", citations: [], limitations: [], estimates: [] },
          correlationId: "99999999-9999-4999-8999-999999999999",
        }),
      ],
      messages: [USER_MESSAGE, ASSISTANT],
      threadError: { status: 500, message: "Poll exploded." },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);
    const thread = await screen.findByRole("log", { name: "Conversation thread" });
    expect(await within(thread).findByText("Durable answer with citations.")).toBeInTheDocument();
    await expectTerminalError(thread);
  });

  it("routes an answers failure into the error state and keeps the card retryable", async () => {
    globalThis.fetch = mockAgentFetch({
      route: {
        intent: "research_once",
        confidence: "high",
        reasonCodes: ["MODEL_PROPOSAL_ACCEPTED"],
        questionnaire: UPGRADE,
        thread: THREAD,
        correlationId: "c3",
      },
      stream: [
        tokenFrame("Hello, "),
        DONE_FRAME,
        endFrame({
          messageId: ASSISTANT.id,
          replayed: true,
          fallback: false,
          reason: null,
          draft: { body: "Hello, world.", citations: [], limitations: [], estimates: [] },
          correlationId: "99999999-9999-4999-8999-999999999999",
        }),
      ],
      messages: [USER_MESSAGE, ASSISTANT],
      answers: { status: 403, message: "Viewers cannot change this chat." },
    }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/viewers cannot change/i);
    const thread = screen.getByRole("log", { name: "Conversation thread" });
    await expectTerminalError(thread);
    expect(screen.getByText("Research needed — switch to DeepThink?")).toBeInTheDocument();
    expect(screen.queryByText(/answers saved:/i)).not.toBeInTheDocument();
  });
});
