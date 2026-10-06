// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ReviewableDeliverable } from "@/components/campaigns/campaign-creative-review";
import { CampaignPublishing } from "@/components/campaigns/campaign-publishing";
import type { StudioView } from "@/modules/campaigns/application/studio-view";

afterEach(cleanup);

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function view(): StudioView {
  // The authorization list does not read the plan table; the plan stays empty.
  return { actions: [], directions: [], readiness: [] } as unknown as StudioView;
}

function deliverable(overrides: Partial<ReviewableDeliverable> = {}): ReviewableDeliverable {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    channel: "instagram",
    placement: "feed",
    language: "en",
    format: "feed_image",
    ordinal: 1,
    state: "ready_for_review",
    currentVersion: { id: "22222222-2222-4222-8222-222222222222", version: 1, contentHash: HASH_A, createdAt: "2026-09-13T10:00:00.000Z" },
    eligibility: { publishable: true },
    ...overrides,
  };
}

function props(overrides: Partial<Parameters<typeof CampaignPublishing>[0]> = {}) {
  return {
    view: view(),
    organizationId: "33333333-3333-4333-8333-333333333333",
    timeZone: "Asia/Dubai",
    launchAuthorized: false as boolean | null,
    canPublish: true,
    allOutputsReviewed: true,
    deliverables: [] as readonly ReviewableDeliverable[],
    deliverablesReadFailed: false,
    ...overrides,
  };
}

describe("the exact set under authorization", () => {
  it("lists every produced output with its version and bytes, so a batch approval names the whole set", () => {
    const second = deliverable({
      id: "44444444-4444-4444-8444-444444444444",
      placement: "story",
      format: "image_story",
      currentVersion: { id: "55555555-5555-4555-8555-555555555555", version: 2, contentHash: HASH_B, createdAt: "2026-09-14T10:00:00.000Z" },
      eligibility: { publishable: true },
    });

    render(<CampaignPublishing {...props({ deliverables: [deliverable(), second] })} />);

    const section = screen.getByRole("heading", { name: "The exact set under authorization" }).parentElement!;
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("version 1")).toBeDefined();
    expect(within(items[0]!).getByTitle(HASH_A).textContent).toContain(HASH_A.slice(0, 16));
    expect(within(items[1]!).getByText("version 2")).toBeDefined();
    expect(within(items[1]!).getByTitle(HASH_B).textContent).toContain(HASH_B.slice(0, 16));
  });

  it("names the blocking output and why, rather than refusing the set blankly", () => {
    render(
      <CampaignPublishing
        {...props({
          allOutputsReviewed: false,
          deliverables: [deliverable({ eligibility: { publishable: false, reasonCode: "never_reviewed" } })],
        })}
      />,
    );

    expect(screen.getByText(/Blocking: nobody has reviewed this yet/)).toBeDefined();
  });

  it("leaves a planned output with no finished bytes out of the set", () => {
    render(
      <CampaignPublishing
        {...props({ deliverables: [deliverable({ currentVersion: null })] })}
      />,
    );

    expect(screen.getByText(/nothing to authorize/)).toBeDefined();
  });

  it("reports a failed read as a failed read, never as an empty set", () => {
    render(<CampaignPublishing {...props({ deliverablesReadFailed: true })} />);

    expect(screen.getByText(/could not be read/)).toBeDefined();
    expect(screen.queryByText(/nothing to authorize/)).toBeNull();
  });
});
