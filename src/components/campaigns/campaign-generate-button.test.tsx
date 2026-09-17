// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignGenerateButton } from "@/components/campaigns/campaign-generate-button";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

beforeEach(() => {
  refresh.mockReset();
  globalThis.fetch = vi.fn(async () =>
    Response.json({ runId: "run-1", replayed: false }, { status: 202 }),
  ) as never;
});

describe("the Generate control", () => {
  it("never fires on render — approval authorizes, only the click spends", () => {
    render(<CampaignGenerateButton organizationId={ORGANIZATION} campaignId={CAMPAIGN} />);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("posts once on click and refreshes to show generation status", async () => {
    const user = userEvent.setup();
    render(<CampaignGenerateButton organizationId={ORGANIZATION} campaignId={CAMPAIGN} />);

    await user.click(screen.getByRole("button", { name: /generate/i }));

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain(`/api/organizations/${ORGANIZATION}/campaigns/${CAMPAIGN}/generate`);
    expect(init.method).toBe("POST");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("recovers the button when the request itself throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as never;
    const user = userEvent.setup();
    render(<CampaignGenerateButton organizationId={ORGANIZATION} campaignId={CAMPAIGN} />);

    await user.click(screen.getByRole("button", { name: /generate/i }));

    const button = screen.getByRole("button", { name: /generate/i });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent(/generate/i);
  });

  it("stays disabled after a successful start, so a second click cannot spend again", async () => {
    // Each click mints a fresh idempotency key, so a second POST would be a
    // second run against the same purse. The control unmounts once the fresh
    // run reads back as generating; until then it holds itself disabled.
    const user = userEvent.setup();
    render(<CampaignGenerateButton organizationId={ORGANIZATION} campaignId={CAMPAIGN} />);

    await user.click(screen.getByRole("button", { name: /generate/i }));

    const button = screen.getByRole("button", { name: /generation started/i });
    expect(button).toBeDisabled();
    // A real browser never dispatches click on a disabled button; fire one
    // anyway to prove the guard holds even if an event gets through.
    fireEvent.click(button);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stays disabled without the capability and says what is missing", () => {
    render(
      <CampaignGenerateButton
        organizationId={ORGANIZATION}
        campaignId={CAMPAIGN}
        disabled
        disabledReason="This needs the campaign.edit capability, which your role does not hold."
      />,
    );

    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
    expect(screen.getByText(/campaign\.edit/)).toBeInTheDocument();
  });
});
