// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CampaignStudio } from "@/components/campaigns/campaign-studio";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";
import { toStudioView, type StudioView } from "@/modules/campaigns/application/studio-view";
import type {
  BundleVersionDetail,
  CampaignApproval,
  CampaignSummary,
} from "@/modules/campaigns/application/ports";

afterEach(cleanup);

// Radix tabs need these in jsdom; without them the tab list throws on render.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const NOW = "2026-08-15T12:00:00.000Z";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

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
    id: "d1000000-0000-4000-8000-000000000001",
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

function studioView(approval: CampaignApproval | null = null): StudioView {
  const version = detail();
  const { manifest: _manifest, ...summary } = version;
  return toStudioView({ campaign, versions: [summary], version, approval, now: NOW });
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

function renderStudio(view: StudioView = studioView()) {
  return render(
    <CampaignStudio
      view={view}
      organizationId={ORGANIZATION_ID}
      organizationName="Al Noor Kitchen"
      timeZone="Asia/Dubai"
    />,
  );
}

describe("the studio makes all three directions comparable", () => {
  it("offers a control, an evidence-led and an experimental tab", () => {
    renderStudio();
    const tabs = within(screen.getByRole("tablist", { name: /creative direction/i }));

    expect(tabs.getByRole("tab", { name: /control/i })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: /evidence-led/i })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: /experimental/i })).toBeInTheDocument();
  });

  it("opens on the evidence-led direction rather than the control", () => {
    renderStudio();

    expect(screen.getByRole("tab", { name: /evidence-led/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("the studio never implies a result it has not measured", () => {
  it("shows the preregistered plan and an explicitly pending verdict", () => {
    renderStudio();

    expect(screen.getByText(/proof pending/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no result is shown because none has been measured/i),
    ).toBeInTheDocument();
  });

  it("does not present channel actions as ready before the gateway has checked them", () => {
    renderStudio();

    expect(screen.getByText(/blockers & readiness/i)).toBeInTheDocument();
    expect(screen.getByText(/decided by the Tool Gateway/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Ready$/)).not.toBeInTheDocument();
  });

  it("says the readiness panel is unavailable rather than showing an empty one", () => {
    renderStudio();

    expect(screen.getAllByText(/not yet available/i).length).toBeGreaterThan(0);
  });

  it("reports no paid spend rather than a ceiling of zero", () => {
    const view = studioView();
    const zeroSpend: StudioView = { ...view, totalSpendCeiling: null };
    renderStudio(zeroSpend);

    expect(screen.getAllByText("No paid spend").length).toBeGreaterThan(0);
  });
});

describe("approval is bound to the exact version on screen", () => {
  it("shows the digest an attestation would be bound to", () => {
    renderStudio();

    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });

  it("keeps approval unavailable until the operator attests", () => {
    renderStudio();

    expect(screen.getByRole("button", { name: /approve execution/i })).toBeDisabled();
    expect(screen.getByText(/attestation is required before approval/i)).toBeInTheDocument();
  });

  it("enables approval once the visual-truth attestation is given", () => {
    renderStudio();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("button", { name: /approve execution/i })).toBeEnabled();
  });

  it("explains a superseded approval in words rather than by colour alone", () => {
    const view = studioView(
      approvalFor({ bundleVersionId: "d1000000-0000-4000-8000-000000000099" }),
    );
    renderStudio(view);

    // The label appears in the header strip and again in the rail alert.
    expect(screen.getAllByText(/approval superseded/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/covers an earlier version/i)).toBeInTheDocument();
  });

  it("names capability loss as the reason when an approval was revoked for it", () => {
    const view = studioView(
      approvalFor({ revokedAt: "2026-08-15T11:00:00", revokedReason: "capability_lost" }),
    );
    renderStudio(view);

    expect(
      screen.getByText(/provider capability this campaign depends on was lost/i),
    ).toBeInTheDocument();
  });

  it("says nothing is approved when no approval exists at all", () => {
    renderStudio();

    expect(
      screen.getByText(/nothing has been approved for this campaign yet/i),
    ).toBeInTheDocument();
  });
});

describe("the studio states the version rules it enforces", () => {
  it("warns that any edit creates a new version and invalidates approval", () => {
    renderStudio();

    expect(
      screen.getByText(/creates a new immutable version and invalidates the current approval/i),
    ).toBeInTheDocument();
  });

  it("explains there is nothing to diff against while only one version exists", () => {
    renderStudio();

    expect(screen.getByText(/version change summary/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing to compare it against/i)).toBeInTheDocument();
  });
});

describe("editing goes through a revision, never an in-place change", () => {
  it("offers both edit entries as live actions rather than disabled buttons", () => {
    renderStudio();

    expect(screen.getByRole("button", { name: /edit content/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /revise prompt/i })).toBeEnabled();
  });

  it("says the current version is left untouched by a revision", () => {
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /revise prompt/i }));

    expect(screen.getByText(/this creates a new version/i)).toBeInTheDocument();
    expect(screen.getByText(/stays exactly as it is/i)).toBeInTheDocument();
  });

  it("makes the operator choose how much may change instead of inferring it", () => {
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /revise prompt/i }));

    expect(screen.getByRole("radio", { name: /caption and hook/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /this whole direction/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /the whole proposal/i })).toBeInTheDocument();
  });

  it("will not queue an empty revision", () => {
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /revise prompt/i }));

    expect(screen.getByRole("button", { name: /queue revision/i })).toBeDisabled();
  });
});

describe("the approval window is an explicit choice", () => {
  it("shows the window the approval will be bound to", () => {
    renderStudio();

    expect(screen.getByLabelText(/approval valid for/i)).toBeInTheDocument();
    expect(screen.getByText("24 hours")).toBeInTheDocument();
  });
});

describe("the cockpit shows what an operator is being asked to authorise", () => {
  it("makes all three directions comparable in one filmstrip", () => {
    renderStudio();
    const strip = within(screen.getByRole("tablist", { name: /creative direction/i }));

    // Each direction carries its own name and profile, so the alternative is
    // visible rather than something to click through and remember.
    expect(strip.getAllByRole("tab")).toHaveLength(3);
    // Each tab carries its own profile label, so the strip shows three.
    expect(strip.getAllByText(/brand guided|brand restricted|full visual freedom/i)).toHaveLength(
      3,
    );
  });

  it("gathers the envelope being approved into one place", () => {
    renderStudio();

    expect(screen.getByText(/approval envelope/i)).toBeInTheDocument();
    expect(screen.getByText(/organic volume/i)).toBeInTheDocument();
    expect(screen.getByText(/spend ceiling/i)).toBeInTheDocument();
    expect(screen.getByText(/generation profile/i)).toBeInTheDocument();
  });

  it("counts the organic volume rather than describing it vaguely", () => {
    renderStudio();

    // The fixture's actions are all organic feed images.
    expect(screen.getByText(/\d+ posts?/i)).toBeInTheDocument();
  });

  it("keeps internal tags visibly apart from publishable hashtags", () => {
    renderStudio();

    expect(screen.getByText(/internal tags \(never published\)/i)).toBeInTheDocument();
    expect(screen.getByText(/hashtags/i)).toBeInTheDocument();
  });

  it("shows the timing rationale, not just the schedule", () => {
    renderStudio();

    expect(screen.getByText(/timing rationale/i)).toBeInTheDocument();
    expect(screen.getByText(/schedule window/i)).toBeInTheDocument();
    expect(screen.getByText(/execution mode/i)).toBeInTheDocument();
  });

  it("names the channels this direction's artwork must adapt to", () => {
    renderStudio();

    expect(screen.getByText(/channel adaptation/i)).toBeInTheDocument();
  });

  it("keeps the digest beside the approval action it binds", () => {
    renderStudio();

    expect(screen.getByText(/version digest/i)).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });
});
