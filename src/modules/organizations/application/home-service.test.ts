import { describe, expect, it } from "vitest";
import { campaignListPhase } from "@/domain/campaigns/phase";

import type { CampaignListItem } from "@/modules/campaigns/application/studio-view";
import type {
  AssetHomeRecord,
  CampaignHomeReads,
  CampaignHomeRecord,
  HomeSourceResult,
  PrivatePreviewImage,
} from "@/modules/campaigns/application/home-preview-types";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import type { OrganizationRole } from "@/domain/organizations/types";
import {
  buildOrganizationHomeView,
  formatGoalTarget,
} from "@/modules/organizations/application/home-service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_1 = "22222222-2222-4222-8222-222222222221";
const BRANCH_2 = "22222222-2222-4222-8222-222222222222";
const BRANCH_INACTIVE = "22222222-2222-4222-8222-222222222223";
const GOAL_ORG = "33333333-3333-4333-8333-333333333331";
const GOAL_BRANCH = "33333333-3333-4333-8333-333333333332";
const CAMPAIGN_1 = "44444444-4444-4444-8444-444444444441";
const CAMPAIGN_2 = "44444444-4444-4444-8444-444444444442";
const CAMPAIGN_3 = "44444444-4444-4444-8444-444444444443";
const NOW = "2026-09-11T08:00:00.000Z";

function previewImage(overrides: Partial<PrivatePreviewImage> = {}): PrivatePreviewImage {
  return {
    url: "https://signed.example/preview-1",
    alt: "Campaign preview",
    width: 1200,
    height: 800,
    expiresAt: "2026-09-11T08:10:00.000Z",
    ...overrides,
  };
}

function ready<T>(data: T): HomeSourceResult<T> {
  return { status: "ready", data, fetchedAt: NOW };
}

function failed<T>(): HomeSourceResult<T> {
  return { status: "failed", code: "HOME_READ_FAILED" };
}

function disabled<T>(): HomeSourceResult<T> {
  return { status: "disabled" };
}

function listItem(overrides: Partial<CampaignListItem> = {}): CampaignListItem {
  return {
    id: CAMPAIGN_1,
    title: "Ramadan Push",
    state: "ready_for_review",
    sourceKind: "manual_brief",
    sourceLabel: "Manual brief",
    updatedAt: "2026-09-10T10:00:00.000Z",
    awaitingFirstVersion: false,
    openable: true,
    generation: {
      status: "settled",
      detail: null,
      nextAction: null,
      retryable: false,
      blocker: null,
      missingDetails: [],
    },
    version: 2,
    objective: "Drive iftar orders",
    channels: ["direct"],
    spendCeiling: null,
    bundleVersionId: "d1000000-0000-4000-8000-000000000001",
    phase: campaignListPhase({
      state: "ready_for_review",
      hasVersion: true,
      approvalStatus: "none",
      settledAt: null,
    }),
    ...overrides,
  };
}

function campaignRecord(
  itemOverrides: Partial<CampaignListItem> = {},
  cover: PrivatePreviewImage | null = null,
  coverLabel: CampaignHomeRecord["coverLabel"] = null,
): CampaignHomeRecord {
  return { item: listItem(itemOverrides), cover, coverLabel };
}

function assetRecord(overrides: Partial<AssetHomeRecord> = {}): AssetHomeRecord {
  return {
    id: "poster:55555555-5555-4555-8555-555555555551",
    sourceKind: "poster_render",
    label: "Ramadan Push · ramadan-hero · iftar spread",
    sourceLabel: "Finished poster render",
    reviewLabel: "Review not recorded",
    reviewState: "unreviewed",
    recordedAt: "2026-09-09T10:00:00.000Z",
    image: previewImage(),
    sourceHref: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}?version=66666666-6666-4666-8666-666666666661`,
    ...overrides,
  };
}

function snapshot(overrides: Partial<DigitalTwinSnapshot> = {}): DigitalTwinSnapshot {
  return {
    organization: {
      id: ORG_ID,
      name: "Al Noor Kitchen",
      slug: "al-noor-kitchen",
      industry: "restaurant",
      country_code: "AE",
      base_currency: "AED",
      default_timezone: "Asia/Dubai",
      industry_pack_slug: "restaurant",
      branchless_confirmed: false,
      status: "active",
      account_id: "77777777-7777-4777-8777-777777777777",
      created_by: "88888888-8888-4888-8888-888888888888",
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
    auditEvents: [],
    ...overrides,
  };
}

function branchRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG_ID,
    name: `Branch ${id.slice(-2)}`,
    slug: `branch-${id.slice(-2)}`,
    kind: "physical" as const,
    timezone: "Asia/Dubai",
    currency: "AED",
    service_area: {},
    operating_hours: {},
    contact_details: {},
    capacity_metadata: {},
    is_active: true,
    created_at: "2026-08-02T08:00:00.000Z",
    updated_at: "2026-08-02T08:00:00.000Z",
    ...overrides,
  };
}

function goalRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG_ID,
    name: `Goal ${id.slice(-2)}`,
    metric: "orders",
    metric_key: null,
    baseline_status: "unknown" as const,
    baseline_value: null,
    target_value: 500,
    unit: "count",
    currency: null,
    deadline: null,
    scope_kind: "organization" as const,
    scope_branch_id: null,
    owner_id: null,
    priority: 3,
    created_at: "2026-08-03T08:00:00.000Z",
    updated_at: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

function sources(overrides: Partial<CampaignHomeReads> = {}): CampaignHomeReads {
  return {
    campaigns: ready([]),
    posters: ready([]),
    references: ready([]),
    logo: null,
    ...overrides,
  };
}

function gates(
  overrides: Partial<{ campaigns: boolean; growth: boolean; integrations: boolean }> = {},
) {
  return { campaigns: true, growth: true, integrations: true, ...overrides };
}

function viewInput(
  role: OrganizationRole = "admin",
  overrides: {
    snap?: DigitalTwinSnapshot;
    src?: CampaignHomeReads;
    gateValues?: { campaigns: boolean; growth: boolean; integrations: boolean };
  } = {},
) {
  return {
    snapshot: overrides.snap ?? snapshot(),
    role,
    organizationId: ORG_ID,
    now: NOW,
    sources: overrides.src ?? sources(),
    gates: overrides.gateValues ?? gates(),
  };
}

describe("Org A composition", () => {
  it("composes 3 campaigns, 4 labeled assets, 2 active locations, org goal target, org-scoped links, no storage path", () => {
    const snap = snapshot({
      branches: [
        branchRow(BRANCH_1, { name: "Deira", kind: "physical", is_active: true }),
        branchRow(BRANCH_2, { name: "Online", kind: "virtual", is_active: true }),
        branchRow(BRANCH_INACTIVE, { name: "Closed", kind: "physical", is_active: false }),
      ],
      profile: {
        organization_id: ORG_ID,
        business_model: "dine-in",
        value_proposition: "  Family meals  ",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      goals: [
        goalRow(GOAL_ORG, { name: "Grow orders", target_value: 500, unit: "count", priority: 2 }),
      ],
    });
    const src = sources({
      campaigns: ready([
        campaignRecord({ id: CAMPAIGN_1, title: "One", updatedAt: "2026-09-10T10:00:00.000Z" }),
        campaignRecord({ id: CAMPAIGN_2, title: "Two", updatedAt: "2026-09-09T10:00:00.000Z" }),
        campaignRecord({ id: CAMPAIGN_3, title: "Three", updatedAt: "2026-09-08T10:00:00.000Z" }),
      ]),
      posters: ready([
        assetRecord({
          id: "poster:55555555-5555-4555-8555-555555555551",
          recordedAt: "2026-09-09T10:00:00.000Z",
        }),
        assetRecord({
          id: "poster:55555555-5555-4555-8555-555555555552",
          recordedAt: "2026-09-07T10:00:00.000Z",
        }),
      ]),
      references: ready([
        assetRecord({
          id: "reference:55555555-5555-4555-8555-555555555553",
          sourceKind: "brand_reference",
          sourceLabel: "Brand reference",
          recordedAt: "2026-09-08T10:00:00.000Z",
          sourceHref: `/organizations/${ORG_ID}/assets`,
        }),
        assetRecord({
          id: "reference:55555555-5555-4555-8555-555555555554",
          sourceKind: "brand_reference",
          sourceLabel: "Brand reference",
          recordedAt: "2026-09-06T10:00:00.000Z",
          sourceHref: `/organizations/${ORG_ID}/assets`,
        }),
      ]),
    });
    const view = buildOrganizationHomeView(viewInput("admin", { snap, src }));

    expect(view.organizationId).toBe(ORG_ID);
    expect(view.name).toBe("Al Noor Kitchen");
    expect(view.description).toBe("Family meals");
    expect(view.timeZone).toBe("Asia/Dubai");
    expect(view.currency).toBe("AED");
    expect(view.campaigns.status).toBe("ready");
    if (view.campaigns.status === "ready") expect(view.campaigns.data).toHaveLength(3);
    expect(view.assets.status).toBe("ready");
    if (view.assets.status === "ready") {
      expect(view.assets.data).toHaveLength(4);
      for (const asset of view.assets.data) {
        expect(asset.label.length).toBeGreaterThan(0);
        expect(asset.sourceHref).toContain(ORG_ID);
      }
    }
    expect(view.assetsPartial).toBe(false);
    expect(view.locations).toHaveLength(2);
    expect(view.locations.map((l) => l.name)).toEqual(["Deira", "Online"]);
    expect(view.goals).toHaveLength(1);
    expect(view.goals[0]?.target).toBe("500 count");
    expect(view.focusGoalId).toBe(GOAL_ORG);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("storage_path");
    expect(serialized).not.toContain("storagepath");
    expect(serialized).not.toContain("bucket");
    expect(serialized).not.toContain("brand-assets");
    expect(serialized).not.toContain("campaign-assets");
  });
});

describe("source failures", () => {
  const baseSnap = () =>
    snapshot({
      profile: {
        organization_id: ORG_ID,
        business_model: "dine-in",
        value_proposition: "Family meals",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      goals: [goalRow(GOAL_ORG)],
    });

  it("campaigns fail while assets ready marks attention incomplete", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: baseSnap(),
        src: sources({
          campaigns: failed(),
          posters: ready([assetRecord()]),
          references: ready([]),
        }),
      }),
    );
    expect(view.campaigns.status).toBe("failed");
    expect(view.assets.status).toBe("ready");
    expect(view.assetsPartial).toBe(false);
    expect(view.attentionIncomplete).toBe(true);
  });

  it("posters fail while refs ready stays ready and partial", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: baseSnap(),
        src: sources({
          campaigns: ready([]),
          posters: failed(),
          references: ready([
            assetRecord({ id: "reference:55555555-5555-4555-8555-555555555553" }),
          ]),
        }),
      }),
    );
    expect(view.assets.status).toBe("ready");
    expect(view.assetsPartial).toBe(true);
    if (view.assets.status === "ready") expect(view.assets.data).toHaveLength(1);
  });

  it("refs fail while posters ready stays ready and partial", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: baseSnap(),
        src: sources({
          campaigns: ready([]),
          posters: ready([assetRecord()]),
          references: failed(),
        }),
      }),
    );
    expect(view.assets.status).toBe("ready");
    expect(view.assetsPartial).toBe(true);
  });

  it("both asset sources failing marks assets failed", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: baseSnap(),
        src: sources({ campaigns: ready([]), posters: failed(), references: failed() }),
      }),
    );
    expect(view.assets.status).toBe("failed");
  });

  it("all optional sources disabled yields disabled sections and clean flags", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: baseSnap(),
        src: sources({ campaigns: disabled(), posters: disabled(), references: disabled() }),
      }),
    );
    expect(view.campaigns.status).toBe("disabled");
    expect(view.assets.status).toBe("disabled");
    expect(view.assetsPartial).toBe(false);
    expect(view.attentionIncomplete).toBe(false);
  });
});

describe("permissions", () => {
  const permSnap = () =>
    snapshot({
      profile: {
        organization_id: ORG_ID,
        business_model: "x",
        value_proposition: "Family meals",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      goals: [goalRow(GOAL_ORG)],
    });
  const draftSrc = () =>
    sources({
      campaigns: ready([
        campaignRecord({
          id: CAMPAIGN_1,
          state: "draft",
          generation: {
            status: "settled",
            detail: null,
            nextAction: null,
            retryable: false,
            blocker: null,
            missingDetails: [],
          },
        }),
      ]),
      posters: ready([]),
      references: ready([]),
    });

  it("viewer gets read destinations only and no create/edit/review authority", () => {
    const view = buildOrganizationHomeView(
      viewInput("viewer", { snap: permSnap(), src: draftSrc() }),
    );
    expect(view.permissions.canCreateCampaign).toBe(false);
    expect(view.permissions.canEditCampaign).toBe(false);
    expect(view.permissions.canReviewCampaign).toBe(false);
    expect(view.permissions.canManageCore).toBe(false);
    expect(view.destinations.length).toBeGreaterThan(0);
    if (view.campaigns.status === "ready") {
      expect(view.campaigns.data[0]?.actionLabel).toBe("View campaign");
    }
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("Continue draft");
    expect(serialized).not.toContain("Review campaign");
  });

  it("operator gets creation and edit navigation but no approval wording", () => {
    const view = buildOrganizationHomeView(
      viewInput("operator", { snap: permSnap(), src: draftSrc() }),
    );
    expect(view.permissions.canCreateCampaign).toBe(true);
    expect(view.permissions.canEditCampaign).toBe(true);
    expect(view.permissions.canReviewCampaign).toBe(false);
    if (view.campaigns.status === "ready") {
      expect(view.campaigns.data[0]?.actionLabel).toBe("Continue draft");
    }
    const reviewSrc = sources({
      campaigns: ready([campaignRecord({ id: CAMPAIGN_1, state: "ready_for_review" })]),
      posters: ready([]),
      references: ready([]),
    });
    const reviewView = buildOrganizationHomeView(
      viewInput("operator", { snap: permSnap(), src: reviewSrc }),
    );
    if (reviewView.campaigns.status === "ready") {
      expect(reviewView.campaigns.data[0]?.actionLabel).toBe("View campaign");
    }
    expect(JSON.stringify(reviewView)).not.toContain("Review campaign");
  });

  it("owner and admin hold review authority", () => {
    const reviewSrc = () =>
      sources({
        campaigns: ready([campaignRecord({ id: CAMPAIGN_1, state: "ready_for_review" })]),
        posters: ready([]),
        references: ready([]),
      });
    for (const role of ["owner", "admin"] as const) {
      const view = buildOrganizationHomeView(
        viewInput(role, { snap: permSnap(), src: reviewSrc() }),
      );
      expect(view.permissions.canReviewCampaign).toBe(true);
      if (view.campaigns.status === "ready") {
        expect(view.campaigns.data[0]?.actionLabel).toBe("Review campaign");
      }
    }
  });
});

describe("gates", () => {
  const gateSnap = () =>
    snapshot({
      profile: {
        organization_id: ORG_ID,
        business_model: "x",
        value_proposition: "Family meals",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      goals: [goalRow(GOAL_ORG)],
    });

  it("campaigns disabled forces disabled campaign and asset sections with no campaign links", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: gateSnap(),
        src: sources({
          campaigns: ready([campaignRecord({ id: CAMPAIGN_1 })]),
          posters: ready([assetRecord()]),
          references: ready([]),
        }),
        gateValues: gates({ campaigns: false }),
      }),
    );
    expect(view.campaigns.status).toBe("disabled");
    expect(view.assets.status).toBe("disabled");
    expect(view.logo).toBeNull();
    expect(view.permissions.canCreateCampaign).toBe(false);
    expect(JSON.stringify(view)).not.toContain(CAMPAIGN_1);
  });

  it("growth market disabled omits the growth destination", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", { snap: gateSnap(), gateValues: gates({ growth: false }) }),
    );
    expect(view.destinations.find((d) => d.key === "growth")).toBeUndefined();
    expect(view.destinations.find((d) => d.key === "channels")).toBeDefined();
  });

  it("integrations disabled omits the integrations destination", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", { snap: gateSnap(), gateValues: gates({ integrations: false }) }),
    );
    expect(view.destinations.find((d) => d.key === "integrations")).toBeUndefined();
    expect(view.destinations.find((d) => d.key === "memory")).toBeDefined();
  });

  it("channels destination needs channel.read and memory needs memory.read", () => {
    // viewer holds both reads, so both appear; this guards the positive path.
    const viewerView = buildOrganizationHomeView(viewInput("viewer", { snap: gateSnap() }));
    expect(viewerView.destinations.find((d) => d.key === "channels")).toBeDefined();
    expect(viewerView.destinations.find((d) => d.key === "memory")).toBeDefined();
    // All destinations stay org-scoped.
    for (const destination of viewerView.destinations) {
      expect(destination.href).toContain(ORG_ID);
    }
  });
});

describe("attention ranking", () => {
  const attentionSnap = () =>
    snapshot({
      profile: {
        organization_id: ORG_ID,
        business_model: "x",
        value_proposition: "Family meals",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      goals: [goalRow(GOAL_ORG)],
    });

  it("stalled generation outranks a newer ready-for-review campaign", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: attentionSnap(),
        src: sources({
          campaigns: ready([
            campaignRecord({
              id: CAMPAIGN_1,
              title: "Stalled old",
              state: "draft",
              updatedAt: "2026-09-01T10:00:00.000Z",
              generation: {
                status: "stalled",
                detail: "Generation stopped responding.",
                nextAction: "Start it again.",
                retryable: true,
                blocker: null,
                missingDetails: [],
              },
            }),
            campaignRecord({
              id: CAMPAIGN_2,
              title: "Fresh review",
              state: "ready_for_review",
              updatedAt: "2026-09-10T10:00:00.000Z",
              generation: {
                status: "settled",
                detail: null,
                nextAction: null,
                retryable: false,
                blocker: null,
                missingDetails: [],
              },
            }),
          ]),
          posters: ready([]),
          references: ready([]),
        }),
      }),
    );
    expect(view.attention[0]?.title).toBe("Stalled old");
    expect(view.attention[0]?.sourceLabel).toBe("Campaign");
  });

  it("blocked state outranks ready-for-review", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: attentionSnap(),
        src: sources({
          campaigns: ready([
            campaignRecord({
              id: CAMPAIGN_1,
              title: "Blocked",
              state: "blocked",
              generation: {
                status: "settled",
                detail: null,
                nextAction: null,
                retryable: false,
                blocker: null,
                missingDetails: [],
              },
            }),
            campaignRecord({
              id: CAMPAIGN_2,
              title: "Review",
              state: "ready_for_review",
              generation: {
                status: "settled",
                detail: null,
                nextAction: null,
                retryable: false,
                blocker: null,
                missingDetails: [],
              },
            }),
          ]),
          posters: ready([]),
          references: ready([]),
        }),
      }),
    );
    expect(view.attention[0]?.title).toBe("Blocked");
  });

  it("one campaign appears once even when state and generation both qualify", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: attentionSnap(),
        src: sources({
          campaigns: ready([
            campaignRecord({
              id: CAMPAIGN_1,
              title: "Both",
              state: "blocked",
              generation: {
                status: "failed",
                detail: "Generation failed.",
                nextAction: "Start it again.",
                retryable: true,
                blocker: null,
                missingDetails: [],
              },
            }),
          ]),
          posters: ready([]),
          references: ready([]),
        }),
      }),
    );
    const matches = view.attention.filter((item) => item.title === "Both");
    expect(matches).toHaveLength(1);
  });

  it("zero campaigns with a failed source never claims a healthy page", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: attentionSnap(),
        src: sources({ campaigns: failed(), posters: ready([]), references: ready([]) }),
      }),
    );
    expect(view.attentionIncomplete).toBe(true);
    const serialized = JSON.stringify(view).toLowerCase();
    expect(serialized).not.toContain("nothing needs attention");
    expect(serialized).not.toContain("healthy");
    expect(serialized).not.toContain("caught up");
    expect(serialized).not.toContain("all clear");
  });
});

describe("campaign CTAs", () => {
  const ctaSnap = () =>
    snapshot({
      profile: {
        organization_id: ORG_ID,
        business_model: "x",
        value_proposition: "Family meals",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      goals: [goalRow(GOAL_ORG)],
    });

  it("no-version campaigns link to the portfolio with a portfolio label", () => {
    const view = buildOrganizationHomeView(
      viewInput("admin", {
        snap: ctaSnap(),
        src: sources({
          campaigns: ready([
            campaignRecord({
              id: CAMPAIGN_1,
              awaitingFirstVersion: true,
              openable: false,
              version: null,
              objective: null,
            }),
          ]),
          posters: ready([]),
          references: ready([]),
        }),
      }),
    );
    if (view.campaigns.status !== "ready") throw new Error("expected ready campaigns");
    expect(view.campaigns.data[0]?.href).toBe(`/organizations/${ORG_ID}/campaigns`);
    expect(view.campaigns.data[0]?.actionLabel).toBe("View in Campaigns");
  });

  it("editable draft offers continuation while other openable states offer viewing", () => {
    const draftView = buildOrganizationHomeView(
      viewInput("admin", {
        snap: ctaSnap(),
        src: sources({
          campaigns: ready([
            campaignRecord({
              id: CAMPAIGN_1,
              state: "draft",
              generation: {
                status: "settled",
                detail: null,
                nextAction: null,
                retryable: false,
                blocker: null,
                missingDetails: [],
              },
            }),
          ]),
          posters: ready([]),
          references: ready([]),
        }),
      }),
    );
    if (draftView.campaigns.status !== "ready") throw new Error("expected ready campaigns");
    expect(draftView.campaigns.data[0]?.actionLabel).toBe("Continue draft");

    const scheduledView = buildOrganizationHomeView(
      viewInput("admin", {
        snap: ctaSnap(),
        src: sources({
          campaigns: ready([
            campaignRecord({
              id: CAMPAIGN_1,
              state: "scheduled",
              generation: {
                status: "settled",
                detail: null,
                nextAction: null,
                retryable: false,
                blocker: null,
                missingDetails: [],
              },
            }),
          ]),
          posters: ready([]),
          references: ready([]),
        }),
      }),
    );
    if (scheduledView.campaigns.status !== "ready") throw new Error("expected ready campaigns");
    expect(scheduledView.campaigns.data[0]?.actionLabel).toBe("View campaign");
  });
});

describe("goals", () => {
  it("org focus ignores a higher-priority branch goal while the list keeps branch scope", () => {
    const snap = snapshot({
      profile: {
        organization_id: ORG_ID,
        business_model: "x",
        value_proposition: "Family meals",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      branches: [branchRow(BRANCH_1, { name: "Deira" })],
      goals: [
        goalRow(GOAL_BRANCH, {
          name: "Branch sprint",
          priority: 1,
          scope_kind: "branch",
          scope_branch_id: BRANCH_1,
        }),
        goalRow(GOAL_ORG, { name: "Org steady", priority: 3, scope_kind: "organization" }),
      ],
    });
    const view = buildOrganizationHomeView(viewInput("admin", { snap, src: sources() }));
    expect(view.focusGoalId).toBe(GOAL_ORG);
    expect(view.goals[0]?.id).toBe(GOAL_BRANCH);
    expect(view.goals[1]?.id).toBe(GOAL_ORG);
    expect(view.goals[0]?.scopeLabel).toBe("Deira");
    expect(view.goals[1]?.scopeLabel).toBe("Organization");
  });

  it("keeps unknown units verbatim without percentages or division", () => {
    const snap = snapshot({
      goals: [goalRow(GOAL_ORG, { target_value: 500, unit: "count" })],
    });
    const view = buildOrganizationHomeView(viewInput("admin", { snap, src: sources() }));
    expect(view.goals[0]?.target).toBe("500 count");
    expect(JSON.stringify(view)).not.toContain("%");
  });

  it("missing org goal yields a neutral prompt for managers only", () => {
    const emptySnap = snapshot({ goals: [] });
    const managerView = buildOrganizationHomeView(
      viewInput("admin", { snap: emptySnap, src: sources() }),
    );
    expect(managerView.focusGoalId).toBeNull();
    expect(managerView.attention.some((item) => item.sourceLabel === "Organization")).toBe(true);

    const viewerView = buildOrganizationHomeView(
      viewInput("viewer", { snap: emptySnap, src: sources() }),
    );
    expect(viewerView.attention.some((item) => item.sourceLabel === "Organization")).toBe(false);
  });
});

describe("activity", () => {
  it("orders by timestamp then key, prefixes colliding UUIDs, caps at five, and excludes unknowns and payloads", () => {
    const sharedUuid = "99999999-9999-4999-8999-999999999999";
    const snap = snapshot({
      profile: {
        organization_id: ORG_ID,
        business_model: "x",
        value_proposition: "Family meals",
        customer_segments: [],
        brand_context: {},
        languages: [],
        operating_model: {},
        source: "user",
        updated_by: null,
        created_at: "2026-08-02T08:00:00.000Z",
        updated_at: "2026-08-02T08:00:00.000Z",
      },
      goals: [goalRow(GOAL_ORG, { name: "Grow orders" })],
      branches: [branchRow(BRANCH_1, { name: "Deira" })],
      auditEvents: [
        {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1",
          organization_id: ORG_ID,
          account_id: null,
          event_name: "goal.created",
          actor_type: "user",
          actor_id: "actor-sentinel-1",
          entity_type: "goal",
          entity_id: GOAL_ORG,
          correlation_id: "corr-1",
          payload: {
            secret: "payload-sentinel-goal",
            nested: { token: "payload-sentinel-nested" },
          },
          occurred_at: "2026-09-05T10:00:00.000Z",
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa2",
          organization_id: ORG_ID,
          account_id: null,
          event_name: "custom.unknown_event",
          actor_type: "user",
          actor_id: "actor-sentinel-2",
          entity_type: "thing",
          entity_id: sharedUuid,
          correlation_id: "corr-2",
          payload: { secret: "payload-sentinel-unknown" },
          occurred_at: "2026-09-09T12:00:00.000Z",
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa3",
          organization_id: ORG_ID,
          account_id: null,
          event_name: "branch.created",
          actor_type: "user",
          actor_id: "actor-sentinel-3",
          entity_type: "branch",
          entity_id: BRANCH_1,
          correlation_id: "corr-3",
          payload: { secret: "payload-sentinel-branch" },
          occurred_at: "2026-09-04T10:00:00.000Z",
        },
      ],
    });
    const src = sources({
      campaigns: ready([
        campaignRecord({
          id: sharedUuid,
          title: "Shared campaign",
          updatedAt: "2026-09-10T10:00:00.000Z",
        }),
        campaignRecord({ id: CAMPAIGN_2, title: "Second", updatedAt: "2026-09-09T10:00:00.000Z" }),
        campaignRecord({ id: CAMPAIGN_3, title: "Third", updatedAt: "2026-09-08T10:00:00.000Z" }),
      ]),
      posters: ready([
        assetRecord({
          id: `poster:${sharedUuid}`,
          recordedAt: "2026-09-10T10:00:00.000Z",
          sourceHref: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}?version=66666666-6666-4666-8666-666666666661`,
        }),
      ]),
      references: ready([
        assetRecord({
          id: `reference:${sharedUuid}`,
          sourceKind: "brand_reference",
          recordedAt: "2026-09-10T10:00:00.000Z",
          sourceHref: `/organizations/${ORG_ID}/assets`,
        }),
      ]),
    });
    const view = buildOrganizationHomeView(viewInput("admin", { snap, src }));
    expect(view.activity.length).toBeLessThanOrEqual(5);
    const ids = view.activity.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Same UUID across three sources stays three distinct rows.
    expect(ids).toContain(`campaign:${sharedUuid}`);
    expect(ids).toContain(`poster:${sharedUuid}`);
    expect(ids).toContain(`reference:${sharedUuid}`);
    // Stable sort: same timestamp orders by key ascending.
    const sharedRows = view.activity.filter(
      (item) => item.occurredAt === "2026-09-10T10:00:00.000Z",
    );
    const sharedKeys = sharedRows.map((item) => item.id);
    expect([...sharedKeys].sort()).toEqual(sharedKeys);
    // Campaign rows use the update label, never publish wording.
    const campaignRow = view.activity.find((item) => item.id === `campaign:${sharedUuid}`);
    expect(campaignRow?.label).toBe("Campaign updated");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("payload-sentinel");
    expect(serialized).not.toContain("actor-sentinel");
    expect(serialized).not.toContain("custom.unknown_event");
    expect(serialized.toLowerCase()).not.toContain("published");
  });

  describe("destinations copy", () => {
    it("uses the reference descriptions verbatim with the Integration Hub label", () => {
      const view = buildOrganizationHomeView(
        viewInput("admin", { snap: snapshot(), src: sources() }),
      );
      expect(view.destinations.map((d) => [d.label, d.description])).toEqual([
        ["Channels", "See channel performance and explore your reports."],
        ["Growth Intelligence", "Explore findings, recommendations and your actions."],
        ["Business Memory", "Keep your business knowledge and decisions together."],
        ["Integration Hub", "Manage sources and bring in your latest reports."],
      ]);
      for (const destination of view.destinations) {
        expect(destination.href).toContain(ORG_ID);
      }
    });
  });

  describe("activity labels", () => {
    it("renders poster timestamps as Poster rendered alongside Reference added", () => {
      const view = buildOrganizationHomeView(
        viewInput("admin", {
          snap: snapshot(),
          src: sources({
            campaigns: ready([]),
            posters: ready([assetRecord()]),
            references: ready([
              assetRecord({
                id: "reference:55555555-5555-4555-8555-555555555553",
                sourceKind: "brand_reference",
                sourceLabel: "Brand reference",
                recordedAt: "2026-09-08T10:00:00.000Z",
                sourceHref: `/organizations/${ORG_ID}/assets`,
              }),
            ]),
          }),
        }),
      );
      const labels = new Map(view.activity.map((item) => [item.id, item.label]));
      expect(labels.get("poster:55555555-5555-4555-8555-555555555551")).toBe("Poster rendered");
      expect(labels.get("reference:55555555-5555-4555-8555-555555555553")).toBe("Reference added");
    });

    it("maps every allowlisted organization event to its exact design label", () => {
      const snap = snapshot({
        branches: [branchRow(BRANCH_1, { name: "Deira" })],
        goals: [goalRow(GOAL_ORG, { name: "Grow orders" })],
        auditEvents: [
          {
            id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab1",
            organization_id: ORG_ID,
            account_id: null,
            event_name: "organization.created",
            actor_type: "system",
            actor_id: null,
            entity_type: "organization",
            entity_id: ORG_ID,
            correlation_id: "corr-b1",
            payload: {},
            occurred_at: "2026-09-04T10:00:00.000Z",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab2",
            organization_id: ORG_ID,
            account_id: null,
            event_name: "branch.created",
            actor_type: "user",
            actor_id: null,
            entity_type: "branch",
            entity_id: BRANCH_1,
            correlation_id: "corr-b2",
            payload: {},
            occurred_at: "2026-09-03T10:00:00.000Z",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab3",
            organization_id: ORG_ID,
            account_id: null,
            event_name: "business_profile.updated",
            actor_type: "user",
            actor_id: null,
            entity_type: "business_profile",
            entity_id: null,
            correlation_id: "corr-b3",
            payload: {},
            occurred_at: "2026-09-02T10:00:00.000Z",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab4",
            organization_id: ORG_ID,
            account_id: null,
            event_name: "goal.created",
            actor_type: "user",
            actor_id: null,
            entity_type: "goal",
            entity_id: GOAL_ORG,
            correlation_id: "corr-b4",
            payload: {},
            occurred_at: "2026-09-01T10:00:00.000Z",
          },
        ],
      });
      const view = buildOrganizationHomeView(viewInput("admin", { snap, src: sources() }));
      const labels = new Map(view.activity.map((item) => [item.id, item.label]));
      expect(labels.get("audit:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab1")).toBe("Organization created");
      expect(labels.get("audit:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab2")).toBe("Location added");
      expect(labels.get("audit:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab3")).toBe(
        "Business profile updated",
      );
      expect(labels.get("audit:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaab4")).toBe("Goal added");
    });
  });
  it("viewers get null hrefs for organization events", () => {
    const snap = snapshot({
      auditEvents: [
        {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa4",
          organization_id: ORG_ID,
          account_id: null,
          event_name: "organization.created",
          actor_type: "system",
          actor_id: null,
          entity_type: "organization",
          entity_id: ORG_ID,
          correlation_id: "corr-4",
          payload: {},
          occurred_at: "2026-09-03T10:00:00.000Z",
        },
      ],
    });
    const viewerView = buildOrganizationHomeView(viewInput("viewer", { snap, src: sources() }));
    const orgRow = viewerView.activity.find((item) => item.label === "Organization created");
    expect(orgRow).toBeDefined();
    expect(orgRow?.href).toBeNull();

    const adminView = buildOrganizationHomeView(viewInput("admin", { snap, src: sources() }));
    const adminRow = adminView.activity.find((item) => item.label === "Organization created");
    expect(adminRow?.href).not.toBeNull();
  });
});

describe("a money goal's target", () => {
  it("says the currency once, not twice", () => {
    // A goal whose unit *is* its currency — which is every money-valued metric
    // — rendered as "60,000 AED AED". The unit and the currency columns are
    // both right; saying both out loud is not.
    expect(formatGoalTarget({ targetValue: 60_000, unit: "AED", currency: "AED" })).toBe(
      "60,000 AED",
    );
  });

  it("still names a currency that differs from the unit", () => {
    expect(formatGoalTarget({ targetValue: 500, unit: "orders", currency: "AED" })).toBe(
      "500 orders AED",
    );
  });

  it("leaves a goal with no currency alone", () => {
    expect(formatGoalTarget({ targetValue: 500, unit: "count", currency: null })).toBe("500 count");
  });
});

describe("revenue section", () => {
  const FINDING_A = "22222222-2222-4222-8222-222222222221";
  function revenueInput(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: ORG_ID,
      grain: "week" as const,
      history: [
        { label: "2026-08-04", minorUnits: 800_00, currency: "AED" },
        { label: "2026-08-11", minorUnits: 700_00, currency: "AED" },
      ],
      losses: [{ findingId: FINDING_A, minorUnits: 200_00, currency: "AED" }],
      actions: [],
      lastObservationDate: "2026-08-17",
      today: "2026-08-20",
      cutoffNote: "Reports through 2026-08-17.",
      coverageNote: "2 reporting channels · weekly buckets.",
      ...overrides,
    };
  }

  it("stays disabled until the loader settles the slice", () => {
    const view = buildOrganizationHomeView(viewInput());
    expect(view.revenue).toEqual({ status: "disabled" });
  });

  it("composes a ready scenario without touching other sections", () => {
    const view = buildOrganizationHomeView({
      ...viewInput(),
      revenue: { status: "ready", input: revenueInput(), fetchedAt: NOW, extraNotes: [] },
    });
    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready") return;
    expect(view.revenue.data.state).toBe("ready");
    if (view.revenue.data.state !== "ready") return;
    expect(view.revenue.data.baselineMinorUnits).toBe(700_00);
    expect(view.revenue.data.horizonLabel).toBe("Next month (≈30 days)");
    expect(view.campaigns.status).toBe("ready");
  });

  it("carries a refused scenario as ready-with-a-reason", () => {
    const view = buildOrganizationHomeView({
      ...viewInput(),
      revenue: {
        status: "ready",
        input: revenueInput({ history: [] }),
        fetchedAt: NOW,
        extraNotes: [],
      },
    });
    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready") return;
    expect(view.revenue.data.state).toBe("refused");
  });

  it("degrades a failed revenue read alone", () => {
    const view = buildOrganizationHomeView({
      ...viewInput(),
      revenue: { status: "failed" },
    });
    expect(view.revenue).toEqual({ status: "failed", code: "HOME_READ_FAILED" });
    expect(view.campaigns.status).toBe("ready");
  });
});

describe("revenue extra notes", () => {
  it("appends loader annotations to a stated scenario only", () => {
    const stated = buildOrganizationHomeView({
      ...viewInput(),
      revenue: {
        status: "ready",
        input: {
          organizationId: ORG_ID,
          grain: "week",
          history: [{ label: "2026-08-04", minorUnits: 800_00, currency: "AED" }],
          losses: [],
          actions: [],
          lastObservationDate: "2026-08-04",
          today: "2026-08-20",
          cutoffNote: "Reports through 2026-08-04.",
          coverageNote: "1 reporting channel.",
        },
        fetchedAt: NOW,
        extraNotes: ["Snapshot from 2026-08-19; the nightly refresh has not landed yet."],
      },
    });
    expect(stated.revenue.status).toBe("ready");
    if (stated.revenue.status !== "ready" || stated.revenue.data.state !== "ready") return;
    expect(stated.revenue.data.notes).toContain(
      "Snapshot from 2026-08-19; the nightly refresh has not landed yet.",
    );

    const refused = buildOrganizationHomeView({
      ...viewInput(),
      revenue: {
        status: "ready",
        input: {
          organizationId: ORG_ID,
          grain: "week",
          history: [],
          losses: [],
          actions: [],
          lastObservationDate: "2026-08-20",
          today: "2026-08-20",
          cutoffNote: "Reports through 2026-08-20.",
          coverageNote: "No reporting channels.",
        },
        fetchedAt: NOW,
        extraNotes: ["Snapshot from 2026-08-19."],
      },
    });
    expect(refused.revenue.status).toBe("ready");
    if (refused.revenue.status !== "ready") return;
    expect(refused.revenue.data.state).toBe("refused");
  });
});
