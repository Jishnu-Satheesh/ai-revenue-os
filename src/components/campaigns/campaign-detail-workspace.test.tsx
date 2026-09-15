// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/organizations/org/campaigns/campaign",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { AllocationLedgerEvent } from "@/components/campaigns/allocation-ledger";
import { CampaignDetailWorkspace } from "@/components/campaigns/campaign-detail-workspace";
import type { ReviewableDeliverable } from "@/components/campaigns/campaign-creative-review";
import { campaignPhase, type CampaignPhaseInput } from "@/domain/campaigns/phase";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";
import { toStudioView, type StudioView } from "@/modules/campaigns/application/studio-view";
import type {
  BundleVersionDetail,
  CampaignApproval,
  CampaignSummary,
} from "@/modules/campaigns/application/ports";

afterEach(cleanup);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const NOW = "2026-08-15T12:00:00.000Z";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "d1000000-0000-4000-8000-000000000001";

const campaign: CampaignSummary = {
  id: manifestIds.campaign,
  organizationId: ORGANIZATION_ID,
  title: "Weekday evening demand lift",
  sourceKind: "decision_opportunity",
  briefId: null,
  opportunityId: "e1000000-0000-4000-8000-000000000001",
  state: "ready_for_review",
  createdAt: "2026-08-14T09:00:00",
  updatedAt: "2026-08-15T09:30:00",
};

function detail(): BundleVersionDetail {
  const manifest = validManifest();
  return {
    id: VERSION_ID,
    campaignId: manifestIds.campaign,
    version: 3,
    parentVersionId: null,
    sourceSnapshotId: "a1000000-0000-4000-8000-000000000001",
    digest: "a".repeat(64),
    generationProfile: manifest.generationProfile,
    executionMode: manifest.executionMode,
    createdAt: "2026-08-15T09:30:00",
    manifest,
  };
}

function approvalFor(overrides: Partial<CampaignApproval> = {}): CampaignApproval {
  const version = detail();
  return {
    id: "b1000000-0000-4000-8000-000000000001",
    campaignId: manifestIds.campaign,
    bundleVersionId: version.id,
    bundleDigest: version.digest,
    approvedBy: "f1000000-0000-4000-8000-000000000001",
    approvedAt: "2026-08-15T10:00:00",
    expiresAt: "2026-08-16T10:00:00",
    actionKeys: version.manifest.actions.map((action) => action.id),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function studioView(approval: CampaignApproval | null = null): StudioView {
  const version = detail();
  const { manifest: _manifest, ...summary } = version;
  return toStudioView({ campaign, versions: [summary], version, approval, now: NOW });
}

function phaseFor(overrides: Partial<CampaignPhaseInput> = {}) {
  return campaignPhase({
    state: "approved",
    hasVersion: true,
    approvalStatus: "live",
    deliverables: { planned: 2, produced: 2, approved: 2, rejected: 0 },
    launchAuthorized: false,
    settledAt: null,
    ...overrides,
  });
}

function deliverable(overrides: Partial<ReviewableDeliverable> = {}): ReviewableDeliverable {
  return {
    id: "c1000000-0000-4000-8000-000000000001",
    channel: "instagram",
    placement: "feed",
    language: "en",
    format: "feed",
    ordinal: 1,
    state: "ready_for_review",
    currentVersion: {
      id: "c2000000-0000-4000-8000-000000000001",
      version: 1,
      contentHash: "b".repeat(64),
      createdAt: "2026-08-15T11:00:00.000Z",
    },
    eligibility: { publishable: false, reasonCode: "never_reviewed" },
    ...overrides,
  };
}

function renderWorkspace(
  overrides: Partial<React.ComponentProps<typeof CampaignDetailWorkspace>> = {},
) {
  return render(
    <CampaignDetailWorkspace
      view={studioView(approvalFor())}
      phase={phaseFor()}
      postPerformance={[]}
      organizationId={ORGANIZATION_ID}
      organizationName="Al Noor Kitchen"
      timeZone="Asia/Dubai"
      currency="AED"
      variants={[]}
      variantsRemaining={{}}
      deliverables={[]}
      deliverablesReadFailed={false}
      allocationEvents={[]}
      outcome={null}
      learningProposal={null}
      launchAuthorized={false}
      lastUpdatedLabel="15 Aug, 13:30"
      canReviewOutputs
      canPublish={false}
      canDecideLearning
      {...overrides}
    />,
  );
}

/**
 * Mounts the workspace with one tab already open.
 *
 * Radix only renders the active panel, and its trigger activation is unreliable
 * under jsdom's pointer events. Opening the tab directly is how the rest of this
 * repository tests tabbed surfaces, and it tests the thing that matters: what
 * that panel actually says.
 */
function renderTab(
  tab: React.ComponentProps<typeof CampaignDetailWorkspace>["initialTab"],
  overrides: Partial<React.ComponentProps<typeof CampaignDetailWorkspace>> = {},
) {
  return renderWorkspace({ ...overrides, initialTab: tab });
}

describe("the five questions get five places to be asked", () => {
  it("offers overview, creative, publishing, results and activity", () => {
    renderWorkspace();

    for (const name of [/overview/i, /creative/i, /publishing/i, /results/i, /activity/i]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("opens on the overview, which states where this stands", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: /why this campaign/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /overview/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("the strip separates the two gates", () => {
  it("names the phase in the words the client sees, not the database's", () => {
    renderWorkspace({ phase: phaseFor({ launchAuthorized: false }) });

    // The visual contract's five stages: Proposal, Creating, Review,
    // Scheduled / Live, Results & learning.
    expect(screen.getByText(/Phase:/)).toBeInTheDocument();
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    expect(screen.getByText("Scheduled / Live")).toBeInTheDocument();
  });

  it("marks exactly one stage as the current step", () => {
    const { container } = renderWorkspace({ phase: phaseFor({ launchAuthorized: false }) });

    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Review");
  });

  it("names the capability a viewer is missing rather than hiding the next step", () => {
    // Somebody who cannot publish still needs to know what the campaign waits on.
    renderWorkspace({ canPublish: false, phase: phaseFor({ launchAuthorized: false }) });

    expect(screen.getAllByText(/campaign\.publish/).length).toBeGreaterThan(0);
  });

  it("does not warn about missing capability when the viewer holds it", () => {
    renderWorkspace({ canPublish: true, phase: phaseFor({ launchAuthorized: false }) });

    expect(screen.queryByText(/which your role does not hold/i)).not.toBeInTheDocument();
  });

  it("says a count could not be read rather than showing it as zero", () => {
    renderWorkspace({ phase: phaseFor({ deliverables: null }) });

    expect(screen.getAllByText(/could not be read/i).length).toBeGreaterThan(0);
  });
});

describe("history outlives authority", () => {
  it("shows the allocation ledger even when the approval has expired", () => {
    // Previously these reads were gated on a live approval, so a campaign that
    // really ran showed an empty ledger once its approval lapsed.
    renderTab("activity", {
      view: studioView(approvalFor({ expiresAt: "2026-08-14T10:00:00" })),
      allocationEvents: [pauseEvent()],
    });

    expect(screen.getByText(/spend went above the approved ceiling/i)).toBeInTheDocument();
  });

  it("shows, per pause, the rule, the observed value, the threshold and the time", () => {
    renderTab("activity", { allocationEvents: [pauseEvent()] });

    expect(screen.getByRole("heading", { name: /allocation decisions/i })).toBeInTheDocument();
    expect(screen.getByText(/spend went above the approved ceiling/i)).toBeInTheDocument();
    // Rendered in the organization's currency and timezone, not raw backend data.
    expect(screen.getByText(/19 Aug 2026, 16:00/i)).toBeInTheDocument();
  });

  it("shows the resolved margin and its grade when a margin rule fired", () => {
    renderTab("activity", {
      allocationEvents: [
        {
          ...pauseEvent(),
          id: "e0000000-0000-4000-8000-000000000002",
          ruleKey: "margin.contribution_floor",
          observedValue: 4_200,
          threshold: 5_000,
          resolvedMarginMinor: 4_200,
          resolvedMarginGrade: "measured",
          reasonCode: "margin_below_floor",
        },
      ],
    });

    expect(screen.getByText(/contribution margin floor/i)).toBeInTheDocument();
    expect(screen.getByText(/contribution margin fell below the floor/i)).toBeInTheDocument();
    expect(screen.getByText("Measured")).toBeInTheDocument();
  });

  it("says an empty ledger is an empty record, not a decision to do nothing", () => {
    renderTab("activity", { allocationEvents: [] });

    expect(screen.getByText(/empty record, not a decision to do nothing/i)).toBeInTheDocument();
  });
});

describe("diagnostics move out of the way without leaving", () => {
  it("keeps the version digest reachable on the activity tab", () => {
    renderTab("activity");
    // Behind a disclosure by design: out of the way of the approval surface,
    // but still on the page, because an audit trail without its evidence is
    // not an audit trail.
    fireEvent.click(screen.getByRole("button", { name: /technical detail/i }));

    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });
});

describe("reviewing finished outputs lives on Creative, not Publishing", () => {
  it("distinguishes a failed read from an empty list", () => {
    renderTab("creative", { deliverablesReadFailed: true });

    expect(screen.getByText(/not the same as there being none/i)).toBeInTheDocument();
  });

  it("says there are no outputs yet when the list is genuinely empty", () => {
    renderTab("creative", { deliverables: [], deliverablesReadFailed: false });

    expect(screen.getByText(/no finished outputs yet/i)).toBeInTheDocument();
  });

  it("shows a planned output that was never produced rather than hiding it", () => {
    renderTab("creative", { deliverables: [deliverable({ currentVersion: null })] });

    expect(screen.getByText(/not produced yet/i)).toBeInTheDocument();
  });

  it("offers no review controls to somebody without the capability", () => {
    renderTab("creative", { deliverables: [deliverable()], canReviewOutputs: false });

    expect(screen.queryByRole("button", { name: /approve this output/i })).not.toBeInTheDocument();
  });

  it("says why an output cannot be published in words, not a code", () => {
    renderTab("creative", { deliverables: [deliverable()] });

    expect(screen.getByText(/nobody has reviewed this yet/i)).toBeInTheDocument();
  });

  it("refuses to record a rejection until it says why", () => {
    renderTab("creative", { deliverables: [deliverable()] });
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    expect(screen.getByRole("button", { name: /record rejection/i })).toBeDisabled();
    expect(screen.getByText(/pick at least one reason/i)).toBeInTheDocument();
  });

  it("states on Publishing that reviewing does not confer the right to publish", () => {
    renderTab("publishing", {
      deliverables: [deliverable()],
      canReviewOutputs: true,
      canPublish: false,
    });

    expect(screen.getByText(/reviewing outputs does not confer it/i)).toBeInTheDocument();
  });
});

describe("results never imply a measurement that has not happened", () => {
  it("says no result has been measured rather than showing a blank", () => {
    renderTab("results", { outcome: null });

    expect(screen.getByText(/no result has been measured yet/i)).toBeInTheDocument();
  });

  it("names the metric and window it is still waiting on", () => {
    renderTab("results", { outcome: null });

    expect(screen.getByText(/inconclusive, not a smaller number/i)).toBeInTheDocument();
  });
});

function pauseEvent(): AllocationLedgerEvent {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    variantId: "f0000000-0000-4000-8000-000000000001",
    ruleKey: "diagnostic.spend_ceiling",
    ruleVersion: "v1",
    observedValue: 12_000,
    threshold: 10_000,
    resolvedMarginMinor: null,
    resolvedMarginGrade: null,
    action: "pause",
    reasonCode: "spend_ceiling_exceeded",
    actor: "agent",
    occurredAt: "2026-08-19T12:00:00.000Z",
  };
}
