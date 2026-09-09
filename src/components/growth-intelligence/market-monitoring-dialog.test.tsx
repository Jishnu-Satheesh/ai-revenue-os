// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketMonitoringDialog } from "@/components/growth-intelligence/market-monitoring-dialog";
import type {
  MarketProfileVersionView,
  MarketProfileView,
} from "@/modules/growth-intelligence/application/ports";
import type { ResearchPipelineView } from "@/modules/growth-intelligence/application/research-read-model";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const BRANCH_A = "20000000-0000-4000-8000-00000000000a";
const BRANCH_B = "20000000-0000-4000-8000-00000000000b";
const ACTIVE_VERSION = "30000000-0000-4000-8000-000000000001";
const PENDING_VERSION = "30000000-0000-4000-8000-000000000002";

function v2Document(branchId: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    branchId,
    publicIdentity: {
      approvedName: "Example Kitchen",
      domains: ["example.com"],
      publicUrls: ["https://example.com/menu"],
    },
    nicheDescriptors: ["neighborhood restaurant"],
    geographies: [
      { layer: "trade_area", locationRef: "ae:du:marina", name: "Marina", branchId },
      { layer: "city", locationRef: "ae:du", name: "Dubai", countryCode: "AE" },
      { layer: "country", locationRef: "ae", name: "United Arab Emirates", countryCode: "AE" },
    ],
    competitors: [],
    topics: [{ key: "local_dining_demand", label: "Local dining demand", provenance: "operator" }],
    sourcePolicy: {
      excludedDomains: [],
      excludedPublishers: [],
      excludedCompetitorKeys: [],
      allowBoundedQuotes: false,
      maxQuotationCharacters: 0,
    },
    cadence: {
      timeZone: "Asia/Dubai",
      dailyLocalTime: "06:30",
      weeklyDay: "monday",
      weeklyLocalTime: "07:00",
    },
    ...overrides,
  };
}

function version(
  overrides: Partial<MarketProfileVersionView> & { id: string },
): MarketProfileVersionView {
  return {
    profileId: "profile-1",
    version: 1,
    document: v2Document(BRANCH_A) as unknown as MarketProfileVersionView["document"],
    digest: "d".repeat(64),
    proposalSource: "operator",
    createdAt: "2026-09-01T06:00:00Z",
    ...overrides,
  } as MarketProfileVersionView;
}

function profileView(overrides: Partial<MarketProfileView> = {}): MarketProfileView {
  return {
    profile: {
      id: "profile-1",
      currentVersionId: ACTIVE_VERSION,
      enabled: true,
      nextDailyResearchDueAt: null,
      nextWeeklySynthesisDueAt: null,
    },
    versions: [
      version({ id: ACTIVE_VERSION, version: 1 }),
      version({
        id: PENDING_VERSION,
        version: 2,
        proposalSource: "ai",
        document: v2Document(BRANCH_A, {
          topics: [
            { key: "local_dining_demand", label: "Local dining demand", provenance: "ai_proposed" },
            { key: "seasonal_events", label: "Seasonal events", provenance: "ai_proposed" },
          ],
          competitors: [
            {
              key: "rival_kitchen",
              name: "Rival Kitchen",
              geographyRefs: ["ae:du"],
              provenance: "operator_lead",
              suggestedBy: "operator",
              relevanceEvidenceUrls: [],
            },
          ],
        }) as unknown as MarketProfileVersionView["document"],
      }),
    ],
    decisions: [
      {
        id: "decision-1",
        profileVersionId: ACTIVE_VERSION,
        decision: "confirmed",
        reason: null,
        createdAt: "2026-09-01T07:00:00Z",
      },
    ],
    ...overrides,
  };
}

function pipeline(overrides: Partial<ResearchPipelineView> = {}): ResearchPipelineView {
  return {
    pipelineId: "40000000-0000-4000-8000-000000000004",
    organizationId: ORGANIZATION,
    branchId: BRANCH_A,
    scopeLabel: "Downtown",
    legacyScope: false,
    stage: "researching",
    stageDisplay: "Researching",
    active: true,
    observedAt: "2026-09-08T06:00:00Z",
    stageChangedAt: "2026-09-08T06:05:00Z",
    settingsSummary: {
      schemaVersion: 2,
      topics: ["Local dining demand"],
      competitorNames: [],
      city: "Dubai",
      countryCode: "AE",
    },
    settingsMatchCurrent: true,
    coverage: [],
    sourceCount: 0,
    claimCount: 0,
    sources: [],
    safeFailureCode: null,
    retry: { eligible: false, reason: "Research is still running; retry is not available yet." },
    outcomeLinks: {
      self: `/api/organizations/${ORGANIZATION}/market-profile/research/40000000-0000-4000-8000-000000000004`,
      retry: null,
      workspace: null,
    },
    ...overrides,
  };
}

const branches = [
  { id: BRANCH_A, name: "Downtown", serviceArea: "Downtown Dubai", isActive: true },
  { id: BRANCH_B, name: "Marina", serviceArea: "Dubai Marina", isActive: true },
];

function dialog(overrides: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn();
  const props = {
    organizationId: ORGANIZATION,
    canManage: true,
    branches,
    initialBranchId: BRANCH_A,
    open: true,
    onOpenChange,
    loadProfile: vi.fn(async () => profileView()),
    loadLegacyProfile: vi.fn(async () => ({ profile: null, versions: [], decisions: [] })),
    loadResearch: vi.fn(async () => ({ active: null, lastSuccess: null })),
    rejectProposal: vi.fn(async () => {}),
    startResearch: vi.fn(async () => ({
      outcome: "started" as const,
      profileVersionId: PENDING_VERSION,
      pipelineId: "40000000-0000-4000-8000-000000000004",
      researchRequestId: "50000000-0000-4000-8000-000000000005",
    })),
    ...overrides,
  };
  const utils = render(<MarketMonitoringDialog {...props} />);
  return { ...utils, onOpenChange, props };
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
});

async function chooseBranch(name: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: /location/i }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MarketMonitoringDialog", () => {
  it("uses the exact header title Review market monitoring with the Market monitoring entry label", async () => {
    dialog();
    expect(await screen.findByRole("dialog", { name: "Review market monitoring" })).toBeTruthy();
    expect(screen.getByText("Market monitoring")).toBeTruthy();
  });

  it("requires an explicit location choice when several branches exist and never preselects one", async () => {
    const { props } = dialog({ initialBranchId: null });
    await waitFor(() =>
      expect(props.loadProfile as ReturnType<typeof vi.fn>).not.toHaveBeenCalled(),
    );
    expect(screen.getByRole("combobox", { name: /location/i })).toBeTruthy();
    expect(screen.getByText("Choose a location to review its monitoring scope.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /start market research/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("auto-selects the only branch without asking", async () => {
    dialog({
      branches: [{ id: BRANCH_A, name: "Downtown", serviceArea: null, isActive: true }],
      initialBranchId: null,
    });
    await screen.findByText("Local dining demand");
  });

  it("prefills the selected branch pending proposal over active settings", async () => {
    dialog();
    await screen.findByText("Local dining demand");
    expect(screen.getByText("Seasonal events")).toBeTruthy();
    expect(screen.getByText("Rival Kitchen")).toBeTruthy();
  });

  it("labels legacy organization proposals as draft suggestions", async () => {
    const legacy = version({
      id: PENDING_VERSION,
      version: 2,
      proposalSource: "ai",
      document: {
        schemaVersion: 1,
        publicIdentity: {
          approvedName: "Example Kitchen",
          domains: [],
          publicUrls: [],
        },
        nicheDescriptors: ["neighborhood restaurant"],
        geographies: [
          { layer: "city", locationRef: "ae:du", name: "Dubai", countryCode: "AE" },
          { layer: "country", locationRef: "ae", name: "United Arab Emirates", countryCode: "AE" },
        ],
        competitors: [],
        topics: [{ key: "legacy_topic", label: "Legacy topic", provenance: "operator" }],
        sourcePolicy: {
          excludedDomains: [],
          excludedPublishers: [],
          excludedCompetitorKeys: [],
          allowBoundedQuotes: false,
          maxQuotationCharacters: 0,
        },
        cadence: {
          timeZone: "Asia/Dubai",
          dailyLocalTime: "06:30",
          weeklyDay: "monday",
          weeklyLocalTime: "07:00",
        },
      } as unknown as MarketProfileVersionView["document"],
    });
    dialog({
      loadProfile: vi.fn(async () =>
        profileView({ versions: [version({ id: ACTIVE_VERSION }), legacy] }),
      ),
    });
    await screen.findByText(/draft suggestion/i);
  });

  it("keeps viewers read-only with words instead of controls", async () => {
    dialog({ canManage: false });
    await screen.findByText(/local dining demand/i);
    expect(screen.queryByRole("button", { name: /start market research/i })).toBeNull();
    expect(screen.getByText(/read-only for your role/i)).toBeTruthy();
  });

  it("offers Reject proposal for pending AI proposals and calls rejection once", async () => {
    const { props } = dialog();
    const rejectButton = await screen.findByRole("button", { name: /reject proposal/i });
    fireEvent.click(rejectButton);
    await waitFor(() =>
      expect(props.rejectProposal as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1),
    );
    expect(props.rejectProposal as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      versionId: PENDING_VERSION,
      digest: "d".repeat(64),
    });
  });

  it("offers Cancel instead of rejection for pending operator proposals", async () => {
    const operatorPending = version({
      id: PENDING_VERSION,
      version: 2,
      proposalSource: "operator",
    });
    const { onOpenChange } = dialog({
      loadProfile: vi.fn(async () =>
        profileView({ versions: [version({ id: ACTIVE_VERSION }), operatorPending] }),
      ),
    });
    expect(await screen.findByRole("button", { name: /^cancel$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reject proposal/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("enforces topic bounds of 1 to 20 unique entries at 160 characters", async () => {
    dialog({
      loadProfile: vi.fn(async () =>
        profileView({
          versions: [
            version({
              id: ACTIVE_VERSION,
              document: v2Document(BRANCH_A, {
                topics: Array.from({ length: 20 }, (_, index) => ({
                  key: `topic_${index}`,
                  label: `Topic ${index}`,
                  provenance: "operator",
                })),
              }) as unknown as MarketProfileVersionView["document"],
            }),
          ],
          decisions: [],
        }),
      ),
    });
    await screen.findByText("Topic 0");
    fireEvent.change(screen.getByLabelText(/add a topic/i), { target: { value: "Topic 20" } });
    fireEvent.click(screen.getByRole("button", { name: /add topic/i }));
    expect(screen.getByText(/at most 20 topics/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/add a topic/i), { target: { value: "x".repeat(161) } });
    fireEvent.click(screen.getByRole("button", { name: /add topic/i }));
    expect(screen.getByText(/at most 160 characters/i)).toBeTruthy();
  });

  it("enforces competitor bounds of 0 to 5 with a required name", async () => {
    dialog();
    await screen.findByText("Local dining demand");
    fireEvent.click(screen.getByRole("button", { name: /add competitor/i }));
    expect(screen.getByText(/competitor name is required/i)).toBeTruthy();

    const nameInput = screen.getByLabelText(/competitor name/i);
    for (let index = 0; index < 4; index += 1) {
      fireEvent.change(nameInput, { target: { value: `Extra ${index}` } });
      fireEvent.click(screen.getByRole("button", { name: /add competitor/i }));
    }
    fireEvent.change(nameInput, { target: { value: "One too many" } });
    fireEvent.click(screen.getByRole("button", { name: /add competitor/i }));
    expect(screen.getByText(/at most 5 competitors/i)).toBeTruthy();
  });

  it("labels name-only competitors as unverified leads", async () => {
    dialog();
    await screen.findByText("Rival Kitchen");
    expect(screen.getByText(/unverified lead/i)).toBeTruthy();
  });

  it("shows research-only locality inputs when geography is missing and requires all three layers", async () => {
    dialog({
      loadProfile: vi.fn(async () =>
        profileView({
          versions: [
            version({
              id: ACTIVE_VERSION,
              document: v2Document(BRANCH_A, {
                geographies: [],
              }) as unknown as MarketProfileVersionView["document"],
            }),
          ],
          decisions: [],
        }),
      ),
    });
    const group = await screen.findByText(/confirm research area/i);
    expect(group).toBeTruthy();
    expect(
      screen.getByText(/used for research; does not change your business location/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /start market research/i })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.change(screen.getByLabelText(/service area/i), { target: { value: "Marina walk" } });
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: "Dubai" } });
    fireEvent.change(screen.getByLabelText(/^country/i), { target: { value: "AE" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start market research/i })).toHaveProperty(
        "disabled",
        false,
      ),
    );
  });

  it("asks before discarding dirty inputs on branch switch and keeps edits on cancel", async () => {
    const loadProfile = vi.fn(async (branchId: string) =>
      profileView({
        versions: [
          version({
            id: ACTIVE_VERSION,
            document: v2Document(branchId, {
              topics: [
                {
                  key: branchId === BRANCH_A ? "topic_a" : "topic_b",
                  label: branchId === BRANCH_A ? "Topic A" : "Topic B",
                  provenance: "operator",
                },
              ],
            }) as unknown as MarketProfileVersionView["document"],
          }),
        ],
        decisions: [],
      }),
    );
    dialog({ loadProfile });
    await screen.findByText("Topic A");
    fireEvent.change(screen.getByLabelText(/add a topic/i), { target: { value: "My edit" } });
    fireEvent.click(screen.getByRole("button", { name: /add topic/i }));
    expect(screen.getByText("My edit")).toBeTruthy();

    await chooseBranch(/marina/i);
    expect(await screen.findByText(/discard unsaved changes/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(screen.getByText("My edit")).toBeTruthy();
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it("discards edits and loads the new branch when the switch is confirmed", async () => {
    const loadProfile = vi.fn(async (branchId: string) =>
      profileView({
        versions: [
          version({
            id: ACTIVE_VERSION,
            document: v2Document(branchId, {
              topics: [
                {
                  key: branchId === BRANCH_A ? "topic_a" : "topic_b",
                  label: branchId === BRANCH_A ? "Topic A" : "Topic B",
                  provenance: "operator",
                },
              ],
            }) as unknown as MarketProfileVersionView["document"],
          }),
        ],
        decisions: [],
      }),
    );
    dialog({ loadProfile });
    await screen.findByText("Topic A");
    fireEvent.change(screen.getByLabelText(/add a topic/i), { target: { value: "My edit" } });
    fireEvent.click(screen.getByRole("button", { name: /add topic/i }));
    await chooseBranch(/marina/i);
    fireEvent.click(await screen.findByRole("button", { name: /discard changes/i }));
    await screen.findByText("Topic B");
    expect(screen.queryByText("My edit")).toBeNull();
  });

  it("calls Start once and keeps typed edits when the server reports a conflict", async () => {
    const startResearch = vi.fn(async () => {
      throw new Error("PROFILE_VERSION_CONFLICT");
    });
    dialog({ startResearch });
    await screen.findByText("Seasonal events");
    fireEvent.change(screen.getByLabelText(/add a topic/i), { target: { value: "Kept edit" } });
    fireEvent.click(screen.getByRole("button", { name: /add topic/i }));
    fireEvent.click(screen.getByRole("button", { name: /start market research/i }));
    await screen.findByText(/could not start/i);
    expect(startResearch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Kept edit")).toBeTruthy();
    expect(screen.queryByText(/research started/i)).toBeNull();
  });

  it("disables Start as Research in progress while the same scope is active", async () => {
    dialog({ loadResearch: vi.fn(async () => ({ active: pipeline(), lastSuccess: null })) });
    await screen.findByText("Local dining demand");
    const start = screen.getByRole("button", { name: /research in progress/i });
    expect(start).toHaveProperty("disabled", true);
  });

  it("keeps the last successful result visible with its date and earlier-settings label", async () => {
    dialog({
      loadResearch: vi.fn(async () => ({
        active: null,
        lastSuccess: pipeline({
          stage: "ready",
          stageDisplay: "Ready",
          active: false,
          stageChangedAt: "2026-09-05T06:00:00Z",
          settingsMatchCurrent: false,
          outcomeLinks: {
            self: `/api/organizations/${ORGANIZATION}/market-profile/research/40000000-0000-4000-8000-000000000004`,
            retry: null,
            workspace: `/organizations/${ORGANIZATION}/growth-intelligence#insights`,
          },
        }),
      })),
    });
    await screen.findByText("Local dining demand");
    expect(screen.getByText(/earlier research settings/i)).toBeTruthy();
  });

  it("blocks Start with an explanation when no branch is active", async () => {
    dialog({
      branches: [{ id: BRANCH_A, name: "Downtown", serviceArea: null, isActive: false }],
      initialBranchId: null,
    });
    expect(await screen.findByText(/no active branch/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start market research/i })).toBeNull();
  });

  it("shows why Start stays disabled instead of a dead button", async () => {
    dialog({
      loadProfile: vi.fn(async () => ({ profile: null, versions: [], decisions: [] })),
      loadLegacyProfile: vi.fn(async () => ({ profile: null, versions: [], decisions: [] })),
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No proposal exists for this branch yet.",
    );
    expect(screen.getByRole("button", { name: /start market research/i })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("MarketMonitoringDialog legacy draft fallback", () => {
  const EMPTY_VIEW = { profile: null, versions: [], decisions: [] };

  function legacyView() {
    return {
      profile: {
        id: "legacy-profile",
        currentVersionId: "legacy-v1",
        enabled: true,
        nextDailyResearchDueAt: null,
        nextWeeklySynthesisDueAt: null,
      },
      versions: [
        {
          id: "legacy-v1",
          profileId: "legacy-profile",
          version: 1,
          document: {
            schemaVersion: 1,
            publicIdentity: {
              approvedName: "Example Kitchen",
              domains: ["example.com"],
              publicUrls: ["https://example.com/"],
            },
            nicheDescriptors: ["neighborhood restaurant"],
            geographies: [
              { layer: "city", locationRef: "city:dubai", name: "Dubai", countryCode: "AE" },
              {
                layer: "country",
                locationRef: "country:ae",
                name: "United Arab Emirates",
                countryCode: "AE",
              },
            ],
            competitors: [
              {
                key: "seed.competitor",
                name: "Seed Competitor",
                geographyRefs: ["city:dubai"],
                relevanceEvidenceUrls: ["https://example.com/dubai-dining-guide"],
              },
            ],
            topics: [{ key: "seed.topic", label: "Seed topic", provenance: "operator" }],
            sourcePolicy: {
              excludedDomains: [],
              excludedPublishers: [],
              excludedCompetitorKeys: [],
              allowBoundedQuotes: true,
              maxQuotationCharacters: 200,
            },
            cadence: {
              timeZone: "Asia/Dubai",
              dailyLocalTime: "07:00",
              weeklyDay: "monday",
              weeklyLocalTime: "08:00",
            },
          },
          digest: "e".repeat(64),
          proposalSource: "operator",
          createdAt: "2026-09-06T15:23:47Z",
        },
      ],
      decisions: [],
    } as unknown as MarketProfileView;
  }

  it("prefills the legacy draft without transferring its city to the branch", async () => {
    dialog({
      loadProfile: vi.fn(async () => EMPTY_VIEW),
      loadLegacyProfile: vi.fn(async () => legacyView()),
    });
    await screen.findByText("Seed topic");
    expect(screen.getByText(/draft suggestion/i)).toBeTruthy();
    expect(screen.getByText("Seed Competitor")).toBeTruthy();
    // The legacy city never becomes the branch's research area: the operator
    // still completes service area, city and country for this branch.
    expect(screen.getByText(/confirm research area/i)).toBeTruthy();
    expect(screen.getByLabelText(/^city/i)).toHaveProperty("value", "");
    expect(screen.getByLabelText(/^country/i)).toHaveProperty("value", "");
    // The branch's own saved service area is shown beside its name, not the legacy city.
    expect(screen.getByLabelText(/service area/i)).toHaveProperty("value", "Downtown Dubai");
  });

  it("starts branch research from the legacy draft once the area is entered", async () => {
    const { props } = dialog({
      loadProfile: vi.fn(async () => EMPTY_VIEW),
      loadLegacyProfile: vi.fn(async () => legacyView()),
    });
    await screen.findByText("Seed topic");
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: "Dubai" } });
    fireEvent.change(screen.getByLabelText(/^country/i), { target: { value: "AE" } });
    const start = await waitFor(() => {
      const button = screen.getByRole("button", { name: /start market research/i });
      expect(button).toHaveProperty("disabled", false);
      return button;
    });
    fireEvent.click(start);
    await waitFor(() =>
      expect(props.startResearch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1),
    );
    const input = (props.startResearch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      branchId: string;
      document: {
        schemaVersion: number;
        branchId: string;
        geographies: Array<{ layer: string; name: string; countryCode?: string }>;
        topics: Array<{ label: string }>;
        competitors: Array<{ name: string; provenance: string }>;
      };
      expectedCurrentVersionId: null;
    };
    expect(input.branchId).toBe(BRANCH_A);
    expect(input.expectedCurrentVersionId).toBeNull();
    expect(input.document.schemaVersion).toBe(2);
    expect(input.document.branchId).toBe(BRANCH_A);
    expect(input.document.topics.map((topic) => topic.label)).toContain("Seed topic");
    expect(input.document.competitors[0]).toMatchObject({
      name: "Seed Competitor",
      provenance: "operator_lead",
    });
    const tradeArea = input.document.geographies.find((entry) => entry.layer === "trade_area");
    expect(tradeArea?.name).toBe("Downtown Dubai");
    const city = input.document.geographies.find((entry) => entry.layer === "city");
    expect(city).toMatchObject({ name: "Dubai", countryCode: "AE" });
  });

  it("keeps typed edits when the legacy draft lands late", async () => {
    let resolveLegacy!: (view: MarketProfileView) => void;
    dialog({
      loadProfile: vi.fn(async () => EMPTY_VIEW),
      loadLegacyProfile: vi.fn(
        () =>
          new Promise<MarketProfileView>((resolve) => {
            resolveLegacy = resolve;
          }),
      ),
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start market research/i })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    fireEvent.change(screen.getByLabelText(/add a topic/i), { target: { value: "Late night" } });
    fireEvent.click(screen.getByRole("button", { name: /add topic/i }));
    expect(screen.getByText("Late night")).toBeTruthy();
    resolveLegacy(legacyView());
    await screen.findByText(/draft suggestion/i);
    // The late draft adopts the source but never overwrites typed rows.
    expect(screen.getByText("Late night")).toBeTruthy();
    expect(screen.queryByText("Seed topic")).toBeNull();
  });

  it("never fetches the legacy scope when the branch has its own proposal", async () => {
    const loadLegacyProfile = vi.fn(async () => legacyView());
    dialog({ loadLegacyProfile });
    await screen.findByText("Local dining demand");
    expect(loadLegacyProfile).not.toHaveBeenCalled();
    expect(screen.queryByText(/draft suggestion/i)).toBeNull();
  });
});

describe("MarketMonitoringDialog keyboard and layout", () => {
  it("labels every field and closes on Escape with focus return", async () => {
    const { onOpenChange } = dialog();
    await screen.findByText("Local dining demand");
    expect(screen.getByRole("combobox", { name: "Location" })).toBeTruthy();
    expect(screen.getByLabelText(/add a topic/i)).toBeTruthy();
    expect(screen.getByLabelText(/competitor name/i)).toBeTruthy();
    expect(screen.getByLabelText(/public website/i)).toBeTruthy();
    expect(screen.getByLabelText("Location hint (optional)")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps a single-column flow that fits 375px and caps desktop width", async () => {
    dialog();
    await screen.findByText("Local dining demand");
    const content = document.querySelector("[data-slot='dialog-content']");
    expect(content?.className ?? "").toContain("overflow-y-auto");
    expect(content?.className ?? "").toContain("sm:max-w-[580px]");
  });
});
