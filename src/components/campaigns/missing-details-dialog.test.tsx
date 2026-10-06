// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MissingDetailsDialog } from "@/components/campaigns/missing-details-dialog";

const organizationId = "11111111-1111-4111-8111-111111111111";
const campaignId = "33333333-3333-4333-8333-333333330001";

const metricOptions = [
  { key: "revenue.gross", label: "Gross revenue", valueKind: "money" as const },
  { key: "transactions.count", label: "Transactions", valueKind: "count" as const },
];

function renderDialog(missingDetails: readonly string[]) {
  return render(
    <MissingDetailsDialog
      organizationId={organizationId}
      campaignId={campaignId}
      missingDetails={missingDetails}
      metricOptions={metricOptions}
    />,
  );
}

async function open(missingDetails: readonly string[]) {
  const user = userEvent.setup();
  renderDialog(missingDetails);
  await user.click(screen.getByRole("button", { name: /add the missing details/i }));
  return user;
}

describe("MissingDetailsDialog", () => {
  beforeEach(() => {
    mocks.refresh.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          brandVoiceSaved: true,
          goalCreated: true,
          evidenceRefreshed: true,
          sourceSnapshotId: "snap-2",
        }),
      })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks only for what is actually missing", async () => {
    await open(["brand_voice"]);

    expect(screen.getByRole("group", { name: /brand voice/i })).toBeInTheDocument();
    // The measurement questions are not missing, so they are not asked. A
    // dialog that re-asks everything is the onboarding trip it replaces.
    expect(screen.queryByLabelText(/what counts as this working/i)).not.toBeInTheDocument();
  });

  it("explains the measurement questions in words, not field names", async () => {
    await open(["primary_metric", "baseline_source"]);

    // The operator's own complaint: `primary_metric` and `baseline_source`
    // mean nothing to the person being asked for them.
    expect(screen.getByText(/what counts as this working/i)).toBeInTheDocument();
    expect(screen.getByText(/what are we comparing against/i)).toBeInTheDocument();
  });

  it("treats the metric and the baseline as one question, because they are", async () => {
    // Both come from a single goal. Presenting them as two unrelated gaps is
    // what made the failure unreadable in the first place.
    await open(["primary_metric"]);

    expect(screen.getByText(/what are we comparing against/i)).toBeInTheDocument();
  });

  it("warns that an unknown baseline still leaves the campaign unbuildable", async () => {
    const user = await open(["primary_metric", "baseline_source"]);

    await user.click(screen.getByRole("radio", { name: /don't know it yet/i }));

    // Accepting this silently and then failing again is the loop this work
    // exists to break. It is allowed, and it is labelled.
    expect(screen.getByText(/will still be missing/i)).toBeInTheDocument();
  });

  it("sends exactly what was filled in and nothing else", async () => {
    const user = await open(["brand_voice"]);

    await user.click(screen.getByRole("button", { name: "Warm" }));
    await user.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(`/api/organizations/${organizationId}/campaigns/${campaignId}/evidence`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ brandVoice: ["warm"] });
  });

  it("refuses to submit a measurement question left half-answered", async () => {
    const user = await open(["primary_metric", "baseline_source"]);

    await user.click(screen.getByRole("button", { name: /save and continue/i }));

    // Posting an incomplete goal would be refused by the database with a
    // constraint name. Saying so here keeps the failure readable.
    expect(screen.getByText(/choose what counts as this working/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names the gaps it cannot collect rather than pretending it can", async () => {
    await open(["currency", "organization_profile"]);

    // Neither belongs to this dialog. Offering an input that writes nowhere
    // would be worse than saying where the fix actually lives.
    expect(screen.getByText(/Currency/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be fixed from here/i)).toBeInTheDocument();
  });
});
