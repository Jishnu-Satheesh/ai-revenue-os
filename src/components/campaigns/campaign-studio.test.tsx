// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CampaignStudio } from "@/components/campaigns/campaign-studio";
import type { AllocationLedgerEvent } from "@/components/campaigns/allocation-ledger";
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

  it("does not present channel actions as ready when readiness is unknown", () => {
    renderStudio();

    // The fixture supplies no readiness, which is "not known" rather than
    // "nothing blocking". A tick here would be a promise nobody checked.
    expect(screen.getByText(/blockers & readiness/i)).toBeInTheDocument();
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
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

describe("editing opens a workspace at its own address", () => {
  it("offers both edit entries as real links rather than disabled buttons", () => {
    renderStudio();

    expect(screen.getByRole("link", { name: /edit content/i })).toBeEnabled();
    expect(screen.getByRole("link", { name: /revise prompt/i })).toBeEnabled();
  });

  it("carries the exact version and direction on screen into the workspace", () => {
    renderStudio();
    const href = screen.getByRole("link", { name: /edit content/i }).getAttribute("href") ?? "";

    // Without these the workspace would edit whatever is newest, which is not
    // necessarily what the operator was reading.
    expect(href).toContain("/revise?");
    expect(href).toContain(`version=${VERSION_ID}`);
    expect(href).toContain("direction=");
  });

  it("distinguishes the two entry points so each opens on its own section", () => {
    renderStudio();

    expect(screen.getByRole("link", { name: /edit content/i }).getAttribute("href")).toContain(
      "intent=edit",
    );
    expect(screen.getByRole("link", { name: /revise prompt/i }).getAttribute("href")).toContain(
      "intent=revise",
    );
  });
});

describe("the approval window is an explicit choice", () => {
  it("shows the window the approval will be bound to", () => {
    // The fixture's policy runs to 30 September, which no preset reaches, so
    // the only offer is the window the policy actually needs. A "24 hours"
    // option here would be a choice the database refuses.
    renderStudio();

    expect(screen.getByLabelText(/approval valid for/i)).toBeInTheDocument();
    expect(screen.getByText(/until the creative window closes/i)).toBeInTheDocument();
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

  it("states how much creative the approval authorizes, and until when", () => {
    renderStudio();

    // Approving authorizes creative that does not exist yet. The bound has to
    // be legible before the button is pressed, not discoverable afterwards.
    const rail = within(screen.getByRole("complementary", { name: /review rail/i }));
    expect(rail.getByText("Creative variants")).toBeInTheDocument();
    expect(rail.getByText(/up to 4 per direction \(12 total\)/i)).toBeInTheDocument();
    expect(rail.getByText("Generation window")).toBeInTheDocument();
  });

  it("names what a variant may never change, so the promise reads as fixed", () => {
    renderStudio();

    const rail = within(screen.getByRole("complementary", { name: /review rail/i }));
    expect(
      rail.getByText(/none may change the offer, the claims, the audience/i),
    ).toBeInTheDocument();
  });

  it("counts the organic volume rather than describing it vaguely", () => {
    renderStudio();

    // The fixture's actions are all organic feed images.
    expect(screen.getByText(/\d+ posts?/i)).toBeInTheDocument();
  });

  it("keeps internal tags visibly apart from publishable hashtags", () => {
    renderStudio();

    expect(screen.getByText(/internal tags \(never published\)/i)).toBeInTheDocument();
    // Pinned to the direction panel's own field label: the rail's envelope copy
    // now mentions hashtags too, and this assertion is about the two lists
    // sitting visibly apart inside a direction.
    expect(screen.getByText("Hashtags")).toBeInTheDocument();
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

describe("the approval window has to cover the creative it licenses", () => {
  it("does not offer a window that lapses before the policy does", () => {
    // The database refuses such an approval, so offering it would spend the
    // operator's attestation before telling them the choice was unavailable.
    const view = studioView();
    view.generationPolicy.policyExpiresAt = "2026-08-20T12:00:00.000Z";
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    renderStudio(view);

    // Five days out: 24 hours and 3 days both fall short, 7 days covers it.
    expect(screen.queryByText("24 hours")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /approval valid for/i })).toHaveTextContent(
      /7 days/i,
    );
    vi.useRealTimers();
  });

  it("offers exactly the window the policy needs when no preset reaches it", () => {
    const view = studioView();
    view.generationPolicy.policyExpiresAt = "2026-10-01T12:00:00.000Z";
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    renderStudio(view);

    expect(screen.getByRole("combobox", { name: /approval valid for/i })).toHaveTextContent(
      /until the creative window closes/i,
    );
    vi.useRealTimers();
  });
});

describe("the fast loop's reasoning is shown to the operator", () => {
  function renderLive(allocationEvents: readonly AllocationLedgerEvent[] = []) {
    return render(
      <CampaignStudio
        view={studioView(approvalFor())}
        organizationId={ORGANIZATION_ID}
        organizationName="Al Noor Kitchen"
        timeZone="Asia/Dubai"
        allocationEvents={allocationEvents}
      />,
    );
  }

  it("shows, per pause, the rule, the observed value, the threshold and the time", () => {
    renderLive([
      {
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
      },
    ]);

    expect(screen.getByRole("heading", { name: /allocation decisions/i })).toBeInTheDocument();
    expect(screen.getByText(/diagnostic\.spend_ceiling/i)).toBeInTheDocument();
    expect(screen.getByText("12000")).toBeInTheDocument();
    expect(screen.getByText("10000")).toBeInTheDocument();
    expect(screen.getByText(/spend_ceiling_exceeded/i)).toBeInTheDocument();
  });

  it("shows the resolved margin and its grade when a margin rule fired", () => {
    renderLive([
      {
        id: "e0000000-0000-4000-8000-000000000002",
        variantId: "f0000000-0000-4000-8000-000000000001",
        ruleKey: "margin.contribution_floor",
        ruleVersion: "v1",
        observedValue: 4_200,
        threshold: 5_000,
        resolvedMarginMinor: 4_200,
        resolvedMarginGrade: "measured",
        action: "pause",
        reasonCode: "margin_below_floor",
        actor: "agent",
        occurredAt: "2026-08-19T12:00:00.000Z",
      },
    ]);

    expect(screen.getByText(/margin\.contribution_floor/i)).toBeInTheDocument();
    expect(screen.getByText(/4200 \(measured\)/i)).toBeInTheDocument();
  });

  it("hides the section until the loop has recorded something worth reading", () => {
    renderLive();
    expect(
      screen.queryByRole("heading", { name: /allocation decisions/i }),
    ).not.toBeInTheDocument();
  });
});
