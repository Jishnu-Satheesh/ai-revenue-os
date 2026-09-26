// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import {
  AgentDrawer,
  type AgentDrawerProps,
  type AgentDrawerTab,
  type PendingPrompt,
} from "@/components/agent/agent-drawer";
import { AgentQuestionnaireCard } from "@/components/agent/agent-questionnaire-card";
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
  answers?: unknown | { status: number; message: string };
  threads?: ThreadSummary[];
  messages?: ThreadMessageView[];
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
      return Response.json({ message: USER_MESSAGE, replayed: false, correlationId: "c2" });
    }
    if (target.includes("/answers") && method === "POST") {
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
          questionnaire: null,
          thread: THREAD,
          correlationId: "c3",
        },
      );
    }
    if (target.includes("/messages") && method === "GET") {
      return Response.json({
        messages: plan.messages ?? [USER_MESSAGE],
        nextCursor: null,
        correlationId: "c5",
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

function Harness({
  tab = "response",
  pendingPrompt = null,
  ...props
}: Partial<AgentDrawerProps> & { tab?: AgentDrawerTab }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );
  const [activeTab, setActiveTab] = useState<AgentDrawerTab>(tab);
  const [collapsed, setCollapsed] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  return (
    <QueryClientProvider client={client}>
      <AgentDrawer
        organizationId={ORGANIZATION}
        page="overview"
        mode="quick"
        role="operator"
        permissions={[]}
        pendingPrompt={pendingPrompt}
        threadId={threadId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((previous) => !previous)}
        onClose={() => {}}
        onThreadChange={setThreadId}
        onPromptConsumed={() => {}}
        {...props}
      />
    </QueryClientProvider>
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
  it("renders the four tabs with Response first", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Response" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Steps" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Draft advice" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collapse conversation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close conversation/i })).toBeInTheDocument();
  });

  it("collapses to a status strip on Escape and expands on click", async () => {
    globalThis.fetch = mockAgentFetch({ route: "hang" }) as never;
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);

    expect(await screen.findByText(/routing your message/i)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("AI agent conversation"), { key: "Escape" });

    const strip = await screen.findByRole("button", { name: /expand conversation/i });
    expect(strip).toBeInTheDocument();
    // The strip carries a spinner while the run is in flight.
    expect(within(strip).getByLabelText("Loading")).toBeInTheDocument();

    await user.click(strip);
    expect(await screen.findByText(/routing your message/i)).toBeInTheDocument();
  });
});

describe("send pipeline", () => {
  it("shows the routing Marker with status role, spinner, and shimmer while sending", async () => {
    globalThis.fetch = mockAgentFetch({ route: "hang" }) as never;
    render(<Harness pendingPrompt={sendPrompt()} />);

    const marker = await screen.findByText(/routing your message/i);
    expect(marker.closest('[role="status"]')).not.toBeNull();
    expect(marker.className).toMatch(/animate-pulse/);
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

  it("lands on Response with the user message and routed intent", async () => {
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText(/answer_memory/)).toBeInTheDocument();
  });

  it("surfaces send failures honestly without closing", async () => {
    globalThis.fetch = mockAgentFetch({
      route: { status: 403, message: "Viewers cannot change this chat." },
    }) as never;
    render(<Harness pendingPrompt={sendPrompt()} role="viewer" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/viewers cannot change/i);
    expect(screen.getByLabelText("AI agent conversation")).toBeInTheDocument();
  });

  it("sends no-store plus one session correlation id on every fetch", async () => {
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
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
  it("lists threads and reopens messages with saved answers", async () => {
    const savedMessage: ThreadMessageView = {
      ...USER_MESSAGE,
      id: "44444444-4444-4444-8444-444444444444",
      role: "assistant",
      body: null,
      questionnaireAnswers: { evidence_window: "60d" },
    };
    globalThis.fetch = mockAgentFetch({ messages: [USER_MESSAGE, savedMessage] }) as never;
    const user = userEvent.setup();
    render(<Harness tab="history" />);

    await user.click(await screen.findByRole("button", { name: /reopen new chat/i }));
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
    expect(await screen.findByText(/saved answers: evidence_window: 60d/i)).toBeInTheDocument();
  });

  it("starts a new chat from history", async () => {
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} />);
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: "New chat" }));
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
    const user = userEvent.setup();
    render(<Harness pendingPrompt={sendPrompt()} role="viewer" permissions={[]} />);
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Draft advice" }));
    expect(screen.getByRole("button", { name: /initiate campaign draft/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /initiate campaign draft/i })).toHaveAttribute(
      "title",
      expect.stringMatching(/campaign\.create/),
    );
  });

  it("enables the handoff for permitted roles and resolves to a prefilled brief with no bound opportunity", async () => {
    globalThis.fetch = mockAgentFetch({ route: campaignRoute }) as never;
    const user = userEvent.setup();
    render(
      <Harness pendingPrompt={sendPrompt()} role="operator" permissions={["campaign.create"]} />,
    );
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Draft advice" }));
    const initiate = screen.getByRole("button", { name: /initiate campaign draft/i });
    // The handoff slice landed: the button asks for intent instead of staying parked.
    expect(initiate).toBeDisabled();
    expect(initiate).toHaveAttribute("title", expect.stringMatching(/objective and audience/));

    await user.type(screen.getByLabelText("Objective"), "Lift weekday demand");
    await user.type(screen.getByLabelText("Audience"), "Nearby families");
    expect(screen.getByRole("button", { name: /initiate campaign draft/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /initiate campaign draft/i }));
    // No opportunity is bound to this chat, so the advice resolves to the
    // pre-filled brief with the reason named — never a silent upgrade.
    expect(await screen.findByText(/ADVICE_NO_OPPORTUNITY/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open prefilled brief/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/campaigns/new"),
    );
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
    {
      key: "retry_deepthink",
      label: "Retry as DeepThink?",
      kind: "confirm",
      required: false,
      helpText: "Runs one bounded research task with honest progress.",
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
    expect(await screen.findByText(/answers saved: confirm_upgrade: true/i)).toBeInTheDocument();
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

  it("walks clarify text then optional confirm to a full payload", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AgentQuestionnaireCard spec={CLARIFY} onSubmit={onSubmit} />);
    expect(screen.getByText(/question 1 of 2/i)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "track competitor prices");
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText(/question 2 of 2/i)).toBeInTheDocument();

    // The optional confirm is explicitly skipped, which submits the card.
    await user.click(screen.getByRole("button", { name: /skip/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      clarify: "track competitor prices",
      retry_deepthink: false,
    });
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
    expect(screen.getByText(/\[answers deepthink_upgrade\]/)).toBeInTheDocument();
    expect(screen.getByText(/answers saved: confirm_upgrade: true/i)).toBeInTheDocument();

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
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
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
});

describe("thread checkpoint polling", () => {
  it("picks up worker-written thread links without another send", async () => {
    const linked: ThreadSummary = {
      ...THREAD,
      linkedResearchProjectId: "55555555-5555-4555-8555-555555555555",
    };
    globalThis.fetch = mockAgentFetch({ threads: [linked] }) as never;
    render(<Harness tab="steps" threadId={THREAD.id} />);
    // The polled thread row carries the research link: the Steps tab shows
    // the Growth Intelligence receipt with no new message sent.
    expect(await screen.findByText(/linked research/i)).toBeInTheDocument();
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
    expect(screen.getByText(/unavailable for this chat/i)).toBeInTheDocument();
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
    expect(screen.getByText(/growth_intelligence\.manage grant/i)).toBeInTheDocument();
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
  const ADVICE = {
    assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
    evidenceSnapshot: {
      windowDays: 30 as const,
      observedAt: "2026-09-20T10:00:00.000Z",
      digest: "0123456789abcdef",
      citations: ["ledger:2026-09-01:2026-09-20"],
    },
    evidenceSnapshotFreezable: true,
    marketProfile: { versionId: "mp-v3", digest: "fedcba9876543210" },
    policyPass: true,
    capabilityPass: true,
    schedulePass: true,
    audienceReady: true,
    estimate: {
      valueText: "+AED 4,000 gross profit / week",
      inputs: ["weekday-evening covers, last 30 days"],
      assumptions: ["no menu-price change during the window"],
    },
  };
  const campaignRoute = {
    intent: "campaign_advice",
    questionnaire: null,
    thread: THREAD,
    correlationId: "c3",
  };

  it("runs the eligible draft path when drawer props bind an opportunity", async () => {
    globalThis.fetch = mockAgentFetch({ route: campaignRoute }) as never;
    const requestDraft = vi.fn(async () => ({
      outcome: "created" as const,
      requestId: DRAFT_REQUEST,
      draftRequestStatus: "pending",
    }));
    const setThreadLinks = vi.fn(async () => ({ threadId: THREAD.id }));
    const user = userEvent.setup();
    render(
      <Harness
        pendingPrompt={sendPrompt()}
        role="operator"
        permissions={["campaign.create"]}
        actorId={ACTOR}
        opportunity={OPPORTUNITY}
        advice={ADVICE}
        campaignSeams={{ drafts: { requestDraft }, links: { setThreadLinks } }}
      />,
    );
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Draft advice" }));
    await user.type(screen.getByLabelText("Objective"), "Lift weekday demand");
    await user.type(screen.getByLabelText("Audience"), "Nearby families");
    await user.click(screen.getByRole("button", { name: /initiate campaign draft/i }));

    expect(await screen.findByText("Requested")).toBeInTheDocument();
    expect(requestDraft).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: OPPORTUNITY.id, opportunityVersion: 2 }),
    );
    // No siblings on this thread yet: the link carries the draft id alone.
    expect(setThreadLinks).toHaveBeenCalledWith({
      organizationId: "00000000-0000-4000-8000-000000000000",
      actorId: ACTOR,
      threadId: THREAD.id,
      draftRequestId: DRAFT_REQUEST,
    });
  });
});
