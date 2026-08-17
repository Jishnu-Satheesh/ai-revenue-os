// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { OrganizationIntelligenceCockpit } from "@/components/organizations/organization-intelligence-cockpit";
import { demoCampaigns } from "@/modules/campaigns/demo/fixtures";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import {
  buildDigitalTwinReadiness,
  getOverviewPermissions,
  selectRecentCampaigns,
  type OverviewActionItem,
  type OverviewEconomics,
  type OverviewIntegration,
  type StrategicBriefingItem,
} from "@/modules/organizations/application/overview";

afterEach(() => cleanup());

let geometry: ReturnType<typeof vi.spyOn> | undefined;

beforeAll(() => {
  geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 640,
    height: 288,
    top: 0,
    right: 640,
    bottom: 288,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterAll(() => geometry?.mockRestore());

const organizationId = "11111111-1111-4111-8111-111111111111";

const snapshot: DigitalTwinSnapshot = {
  organization: {
    id: organizationId,
    name: "Al Noor Kitchen",
    slug: "al-noor-kitchen",
    industry: "restaurant",
    country_code: "AE",
    base_currency: "AED",
    default_timezone: "Asia/Dubai",
    industry_pack_slug: "restaurant",
    branchless_confirmed: false,
    status: "draft_onboarding",
    created_by: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
    archived_at: null,
  },
  branches: [],
  profile: null,
  facts: [],
  goals: [],
  constraints: [],
  policies: [],
  auditEvents: [
    {
      id: "event-1",
      organization_id: organizationId,
      event_name: "organization.created",
      actor_type: "user",
      actor_id: "22222222-2222-4222-8222-222222222222",
      entity_type: "organization",
      entity_id: organizationId,
      correlation_id: "44444444-4444-4444-8444-444444444444",
      payload: {},
      occurred_at: "2026-08-12T08:00:00.000Z",
    },
  ],
};

const economics: OverviewEconomics = {
  state: "ready",
  currency: "AED",
  window: {
    rangeStart: "2026-07-13T20:00:00.000Z",
    rangeEndExclusive: "2026-08-12T20:00:00.000Z",
    timeZone: "Asia/Dubai",
  },
  trend: [
    {
      periodStart: "2026-08-11T20:00:00.000Z",
      grossRevenueMinor: 20_000,
      contributionMarginMinor: 7_000,
      atMostMinor: null,
      grade: "complete",
    },
  ],
  channels: [
    {
      channel: "direct",
      grossRevenueMinor: 20_000,
      contributionMarginMinor: 7_000,
      atMostMinor: null,
      grade: "complete",
    },
  ],
  gradeCounts: { complete: 1, partial: 0, indicative: 0 },
  coverage: { measured: 4, priced: 4, applicable: 4 },
  catalogAvailable: true,
  gaps: [],
  takeaway:
    "Direct records the most gross revenue in this window; this is a comparison, not attributed lift.",
};

const integration: OverviewIntegration = {
  totalConnections: 2,
  healthyConnections: 1,
  actionRequiredConnections: 1,
  connections: [
    {
      id: "connection-1",
      providerKey: "google_business_profile",
      accountLabel: "JLT profile",
      state: "stale",
      explanation: "Successful synchronization is outside its freshness target.",
      lastSuccessfulSyncAt: "2026-08-11T08:00:00.000Z",
    },
  ],
};

const briefing: StrategicBriefingItem[] = [
  {
    kind: "foundation",
    conclusion: "Branches is the next Digital Twin gap to ground.",
    evidence: "1 of 6 readiness sections are grounded.",
    href: "#digital-twin-data",
  },
];

const actions: OverviewActionItem[] = [
  {
    kind: "foundation",
    title: "Add an access policy",
    impact: "Governed work cannot rely on a missing access boundary.",
  },
];

describe("OrganizationIntelligenceCockpit", () => {
  it("renders the approved intelligence hierarchy with exactly three preview campaigns", () => {
    render(
      <OrganizationIntelligenceCockpit
        snapshot={snapshot}
        readiness={buildDigitalTwinReadiness(snapshot)}
        permissions={getOverviewPermissions("viewer")}
        reportingWindow={economics.window}
        economics={{ status: "ready", data: economics }}
        integration={{ status: "ready", data: integration }}
        campaigns={selectRecentCampaigns(demoCampaigns)}
        briefing={briefing}
        actions={actions}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Al Noor Kitchen" })).toBeInTheDocument();
    // expect(screen.getByText("Digital Twin readiness")).toBeInTheDocument();
    expect(screen.getByText("Strategic Briefing")).toBeInTheDocument();
    expect(screen.getByText("Action Required")).toBeInTheDocument();
    expect(screen.getByText("Channel Economics")).toBeInTheDocument();
    expect(screen.getByText("Integration Health")).toBeInTheDocument();
    expect(screen.getByText("Current Digital Twin Data")).toBeInTheDocument();
    expect(screen.getByText("Strategic Campaign Ideas")).toBeInTheDocument();
    expect(screen.getAllByText("Preview data")).toHaveLength(1);
    expect(screen.getByText("Weekday evening demand lift")).toBeInTheDocument();
    expect(screen.getByText("New location announcement")).toBeInTheDocument();
    expect(screen.getByText("Early-week lunch trial")).toBeInTheDocument();
    expect(screen.queryByText("Family bundle re-run")).not.toBeInTheDocument();
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /New location announcement/ }));
    expect(screen.getByRole("link", { name: /Open campaigns/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/campaigns`,
    );
  });

  it("omits integration health when the rollout is disabled", () => {
    render(
      <OrganizationIntelligenceCockpit
        snapshot={snapshot}
        readiness={buildDigitalTwinReadiness(snapshot)}
        permissions={getOverviewPermissions("viewer")}
        reportingWindow={economics.window}
        economics={{ status: "ready", data: economics }}
        integration={{ status: "disabled" }}
        campaigns={selectRecentCampaigns(demoCampaigns)}
        briefing={briefing}
        actions={actions}
      />,
    );

    expect(screen.queryByText("Integration Health")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 of 0 healthy/i)).not.toBeInTheDocument();
  });
});
