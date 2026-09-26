// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UniversalAgentShell,
  isAgentShellPage,
  pageKeyForPathname,
} from "@/components/agent/universal-agent-shell";

const ORGANIZATION = "00000000-0000-4000-8000-000000000000";

function renderShell(props?: {
  page?: string;
  role?: "viewer" | "operator" | "admin" | "owner";
  permissions?: string[];
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UniversalAgentShell
        organizationId={ORGANIZATION}
        page={props?.page ?? "overview"}
        role={props?.role}
        permissions={props?.permissions}
      />
    </QueryClientProvider>,
  );
}

const THREAD = {
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

const USER_MESSAGE = {
  id: "22222222-2222-4222-8222-222222222222",
  threadId: THREAD.id,
  role: "user",
  body: "What do we know?",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:00:01.000Z",
};

function mockAgentFetch(
  routeResult: unknown = {
    intent: "answer_memory",
    questionnaire: null,
    thread: THREAD,
    correlationId: "c3",
  },
) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? "GET";
    if (target.endsWith("/agent/threads") && method === "POST") {
      return Response.json({ thread: THREAD, replayed: false, correlationId: "c1" });
    }
    if (target.includes("/messages") && method === "POST") {
      return Response.json({ message: USER_MESSAGE, replayed: false, correlationId: "c2" });
    }
    if (target.includes("/route") && method === "POST") {
      // Deferred so the routing step commits to the DOM before success.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json(routeResult);
    }
    if (target.includes("/messages") && method === "GET") {
      return Response.json({ messages: [USER_MESSAGE], nextCursor: null, correlationId: "c5" });
    }
    if (target.includes("/agent/threads") && method === "GET") {
      return Response.json({ threads: [THREAD], nextCursor: null, correlationId: "c4" });
    }
    throw new Error(`unmocked fetch ${method} ${target}`);
  });
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

describe("shell", () => {
  it("shows Quick default with inert voice and attach", () => {
    render(
      <UniversalAgentShell organizationId="00000000-0000-4000-8000-000000000000" page="overview" />,
    );
    expect(screen.getByPlaceholderText(/ask anything/i)).toBeDefined();
  });

  it("renders nothing outside the 5 allowed pages", () => {
    const { container } = render(
      <UniversalAgentShell organizationId={ORGANIZATION} page="onboarding" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("defaults to Quick pressed with voice and attach inert", () => {
    renderShell();
    expect(screen.getByRole("radio", { name: /quick/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /attachments.*coming soon/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /voice.*coming soon/i })).toBeDisabled();
  });

  it("keeps DeepThink disabled without the manage grant and enables it with the grant", () => {
    const { unmount } = renderShell({ role: "viewer", permissions: [] });
    expect(screen.getByRole("radio", { name: /deepthink/i })).toBeDisabled();
    unmount();
    cleanup();
    renderShell({ role: "operator", permissions: ["growth_intelligence.manage"] });
    expect(screen.getByRole("radio", { name: /deepthink/i })).toBeEnabled();
  });

  it("fills the input from a suggestion chip without sending", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: /what do we know/i }));
    expect(screen.getByPlaceholderText(/ask anything/i)).toHaveValue(
      "What do we know about this business?",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends on Enter, opens the drawer, and routes through the three Task 3 calls", async () => {
    const user = userEvent.setup();
    renderShell({ role: "operator", permissions: [] });
    await user.type(screen.getByPlaceholderText(/ask anything/i), "What do we know?{enter}");

    // The drawer opens on send (the transient routing Marker is covered
    // deterministically in the drawer suite with a never-resolving route).
    expect(await screen.findByLabelText("AI agent conversation")).toBeInTheDocument();
    // The send pipeline posts thread + message + route; the
    // thread-checkpoint poll adds a no-store GET alongside.
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(posts).toHaveLength(3);
    });
    const calls = fetchMock.mock.calls.map(
      ([url, init]) => `${(init as RequestInit)?.method} ${url}`,
    );
    expect(calls[0]).toMatch(/\/agent\/threads$/);
    expect(calls[1]).toMatch(/\/messages$/);
    expect(calls[2]).toMatch(/\/route\?page=overview$/);
    expect(await screen.findByText("What do we know?")).toBeInTheDocument();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText(/answer_memory/)).toBeInTheDocument();
  });

  it("opens the History tab from the shell history button", async () => {
    const user = userEvent.setup();
    renderShell({ role: "operator", permissions: [] });
    await user.click(screen.getByRole("button", { name: /open conversation history/i }));
    expect(await screen.findByRole("tab", { name: /history/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByRole("button", { name: /reopen new chat/i })).toBeInTheDocument();
  });
});

describe("shell page gating", () => {
  it.each([
    ["overview", true],
    ["growth-intelligence", true],
    ["campaigns", true],
    ["channels", true],
    ["memory", true],
    ["onboarding", false],
    ["invitation", false],
    [undefined, false],
  ])("page %s allowed: %s", (page, allowed) => {
    expect(isAgentShellPage(page)).toBe(allowed);
  });

  it("maps channel detail and campaign sub-routes to their shell page", () => {
    expect(pageKeyForPathname(`/organizations/${ORGANIZATION}/channels/abc`, ORGANIZATION)).toBe(
      "channels",
    );
    expect(pageKeyForPathname(`/organizations/${ORGANIZATION}/campaigns/new`, ORGANIZATION)).toBe(
      "campaigns",
    );
    expect(pageKeyForPathname(`/organizations/${ORGANIZATION}/onboarding`, ORGANIZATION)).toBe(
      "onboarding",
    );
    expect(pageKeyForPathname("/organizations/other-org/overview", ORGANIZATION)).toBeNull();
    expect(pageKeyForPathname(null, ORGANIZATION)).toBeNull();
  });
});
