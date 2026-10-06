// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import { RequestCampaignResearch } from "@/components/campaigns/request-campaign-research";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = `/api/organizations/${ORGANIZATION}/campaign-research/runs`;

function bodyOf(call: unknown): Record<string, unknown> {
  const init = (call as [string, RequestInit])[1];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    Response.json({ started: true }, { status: 202 }),
  ) as never;
});

afterEach(() => {
  cleanup();
  mocks.refresh.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  vi.unstubAllGlobals();
});

describe("RequestCampaignResearch toast contract", () => {
  it("renders only the primary Ask button — allowance and outcome copy never inline", () => {
    render(<RequestCampaignResearch organizationId={ORGANIZATION} />);

    const button = screen.getByRole("button", { name: /ask for a campaign/i });
    expect(button).toBeEnabled();
    expect(button.className).toContain("bg-primary");
    expect(
      screen.queryByText(/spends part of the research allowance/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces the allowance via toast on press, then success with the proposal line", async () => {
    render(<RequestCampaignResearch organizationId={ORGANIZATION} />);

    fireEvent.click(screen.getByRole("button", { name: /ask for a campaign/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith("Uses research allowance", {
      description: "This spends part of the research allowance set in Research settings.",
    });
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Research has started", {
      description: "A proposal will appear here when there is something worth deciding on.",
    });
    // A successful start resets to idle: only the button renders, still usable.
    expect(screen.getByRole("button", { name: /ask for a campaign/i })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("names the queued wait when the run is admitted but no worker has it yet", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ started: false }, { status: 202 }),
    ) as never;
    render(<RequestCampaignResearch organizationId={ORGANIZATION} />);

    fireEvent.click(screen.getByRole("button", { name: /ask for a campaign/i }));

    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Research has started", {
      description:
        "The request is recorded and waiting for a worker to pick it up. Nothing has been written yet.",
    });
    expect(screen.getByRole("button", { name: /ask for a campaign/i })).toBeEnabled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("toasts the refusal sentence and keeps the button usable without refreshing", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: { message: "The allowance is spent." } }, { status: 429 }),
    ) as never;
    render(<RequestCampaignResearch organizationId={ORGANIZATION} />);

    fireEvent.click(screen.getByRole("button", { name: /ask for a campaign/i }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Research could not be started", {
      description: "The allowance is spent.",
    });
    expect(screen.getByRole("button", { name: /ask for a campaign/i })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("toasts the never-sent line when the request itself throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as never;
    render(<RequestCampaignResearch organizationId={ORGANIZATION} />);

    fireEvent.click(screen.getByRole("button", { name: /ask for a campaign/i }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Research could not be started", {
      description: "That could not be sent. Nothing was started and nothing was spent.",
    });
    expect(screen.getByRole("button", { name: /ask for a campaign/i })).toBeEnabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reuses the idempotency key across a refused retry and mints a fresh one after a start", async () => {
    const refused = vi.fn(async () =>
      Response.json({ error: { message: "The allowance is spent." } }, { status: 429 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = refused;
    render(<RequestCampaignResearch organizationId={ORGANIZATION} />);

    const button = () => screen.getByRole("button", { name: /ask for a campaign/i });
    fireEvent.click(button());
    await waitFor(() => expect(refused).toHaveBeenCalledTimes(1));
    fireEvent.click(button());
    await waitFor(() => expect(refused).toHaveBeenCalledTimes(2));
    expect(bodyOf(vi.mocked(refused).mock.calls[0])["idempotencyKey"]).toBe(
      bodyOf(vi.mocked(refused).mock.calls[1])["idempotencyKey"],
    );

    const started = vi.fn(async () =>
      Response.json({ started: true }, { status: 202 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = started;
    fireEvent.click(button());
    await waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    // The successful POST replays the held key (that is the idempotency
    // guarantee); the press after the start mints the fresh one.
    expect(bodyOf(vi.mocked(started).mock.calls[0])["idempotencyKey"]).toBe(
      bodyOf(vi.mocked(refused).mock.calls[0])["idempotencyKey"],
    );
    fireEvent.click(button());
    await waitFor(() => expect(started).toHaveBeenCalledTimes(2));
    expect(bodyOf(vi.mocked(started).mock.calls[1])["idempotencyKey"]).not.toBe(
      bodyOf(vi.mocked(started).mock.calls[0])["idempotencyKey"],
    );
    expect(ENDPOINT).toContain("/campaign-research/runs");
  });
});
