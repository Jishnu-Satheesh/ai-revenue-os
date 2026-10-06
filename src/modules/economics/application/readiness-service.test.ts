import { describe, expect, it, vi } from "vitest";

import type { ReadinessCostCoverage, ReadinessObservation } from "@/domain/economics/readiness";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";
import { createEvidenceReadinessService } from "@/modules/economics/application/readiness-service";
import type {
  EvidenceReadinessRepository,
  ReadinessEvidence,
} from "@/modules/economics/application/readiness-ports";

const ORGANIZATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORGANIZATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";

function observations(): ReadinessObservation[] {
  const base = {
    channelId: CHANNEL,
    branchId: BRANCH,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    periodTimezone: "Asia/Dubai",
    qualityState: "complete",
    completenessState: "complete",
    reconciliationState: "current",
    reportPackageId: "pkg-1",
    packageState: "usable",
  } as const;

  return [
    {
      ...base,
      observationId: "obs-revenue",
      metricDefinitionId: "metric-revenue",
      economicsRole: "gross_revenue",
      currency: "AED",
    },
    {
      ...base,
      observationId: "obs-count",
      metricDefinitionId: "metric-count",
      economicsRole: "transaction_count",
      currency: null,
    },
  ];
}

const coverage: ReadinessCostCoverage = {
  outcome: "checked",
  components: [
    {
      key: "commission",
      label: "Commission",
      covered: true,
      tier: "measured",
      operatorCanResolve: true,
    },
    { key: "food_cost", label: "Food cost", covered: false, tier: null, operatorCanResolve: true },
    {
      key: "promotion_funding",
      label: "Promotion funding",
      covered: false,
      tier: null,
      operatorCanResolve: false,
    },
  ],
};

function repository(overrides: Partial<EvidenceReadinessRepository> = {}) {
  const evidence: ReadinessEvidence = {
    observations: observations(),
    channels: [{ id: CHANNEL, displayName: "Talabat" }],
    branches: [{ id: BRANCH, name: "Jumeirah" }],
  };

  return {
    loadEvidence: vi.fn(async () => evidence),
    loadCostCoverage: vi.fn(async () => coverage),
    ...overrides,
  } satisfies EvidenceReadinessRepository;
}

function service(overrides?: Partial<EvidenceReadinessRepository>) {
  const store = repository(overrides);
  return { store, subject: createEvidenceReadinessService(store) };
}

describe("evidence readiness service", () => {
  describe("permissions", () => {
    it("lets a viewer read readiness", async () => {
      const { subject } = service();

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "viewer" });

      expect(view.tuples).toHaveLength(1);
    });

    for (const role of [
      "operator",
      "admin",
      "owner",
    ] as const satisfies readonly OrganizationRole[]) {
      it(`lets an ${role} read readiness`, async () => {
        const { subject } = service();

        await expect(
          subject.loadReadiness({ organizationId: ORGANIZATION, role }),
        ).resolves.toBeDefined();
      });
    }

    it("refuses a role holding neither report nor economics read", async () => {
      const { subject, store } = service();

      await expect(
        subject.loadReadiness({
          organizationId: ORGANIZATION,
          role: "no_such_role" as OrganizationRole,
        }),
      ).rejects.toBeInstanceOf(DomainError);
      expect(store.loadEvidence).not.toHaveBeenCalled();
    });

    it("does not read anything before the permission check passes", async () => {
      const { subject, store } = service();

      await subject
        .loadReadiness({ organizationId: ORGANIZATION, role: "nobody" as OrganizationRole })
        .catch(() => undefined);

      expect(store.loadEvidence).not.toHaveBeenCalled();
      expect(store.loadCostCoverage).not.toHaveBeenCalled();
    });
  });

  describe("tenancy", () => {
    it("reads only the organization it was asked about", async () => {
      const { subject, store } = service();

      await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(store.loadEvidence).toHaveBeenCalledWith({ organizationId: ORGANIZATION });
      expect(store.loadCostCoverage).toHaveBeenCalledWith({ organizationId: ORGANIZATION });
      expect(store.loadEvidence).not.toHaveBeenCalledWith({ organizationId: OTHER_ORGANIZATION });
    });

    it("returns nothing when the tenant boundary yields no evidence", async () => {
      // What a member of another organization sees through RLS: an empty read,
      // not a partial one. The view has to be honest about that rather than
      // rendering an all-clear.
      const { subject } = service({
        loadEvidence: vi.fn(async () => ({ observations: [], channels: [], branches: [] })),
      });

      const view = await subject.loadReadiness({
        organizationId: OTHER_ORGANIZATION,
        role: "owner",
      });

      expect(view.tuples).toEqual([]);
    });
  });

  describe("the view", () => {
    it("names the channel and outlet in the operator's words", async () => {
      const { subject } = service();

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(view.tuples[0]).toMatchObject({ channelName: "Talabat", branchName: "Jumeirah" });
    });

    it("produces the sentence about what blocks an honest margin", async () => {
      const { subject } = service();

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(view.costSummary).toBe(
        "Contribution margin is not calculated because food cost and promotion funding evidence is missing.",
      );
    });

    it("keeps a tuple visible when its channel has no label", async () => {
      const { subject } = service({
        loadEvidence: vi.fn(async () => ({
          observations: observations(),
          channels: [],
          branches: [],
        })),
      });

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(view.tuples).toHaveLength(1);
      expect(view.tuples[0]?.channelName).toBe("Unnamed channel");
    });

    it("gives every blocker a plain explanation", async () => {
      const { subject } = service();

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(view.tuples[0]?.state).toBe("partial_evidence");
      expect(view.tuples[0]?.blockers.map((blocker) => blocker.explanation)).toContain(
        "Some of your costs are recorded and some are still missing.",
      );
    });
  });

  describe("cost confidentiality", () => {
    it("reports availability and tier and never an amount", async () => {
      const { subject } = service();

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(view.costCoverage).toEqual({
        outcome: "checked",
        components: [
          {
            key: "commission",
            label: "Commission",
            covered: true,
            tier: "measured",
            operatorCanResolve: true,
          },
          {
            key: "food_cost",
            label: "Food cost",
            covered: false,
            tier: null,
            operatorCanResolve: true,
          },
          {
            key: "promotion_funding",
            label: "Promotion funding",
            covered: false,
            tier: null,
            operatorCanResolve: false,
          },
        ],
      });
    });

    it("withholds rate detail from an owner too, because this is not the rate surface", async () => {
      const { subject } = service();

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(JSON.stringify(view)).not.toMatch(
        /amountMinor|amount_minor|rateOfRevenue|rate_of_revenue|effective_from|supplier|contract/i,
      );
    });

    it("says nothing was checked when coverage is unavailable", async () => {
      const { subject } = service({
        loadCostCoverage: vi.fn(async () => ({ outcome: "unchecked" }) as ReadinessCostCoverage),
      });

      const view = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(view.costCoverage).toEqual({ outcome: "unchecked" });
      expect(view.costSummary).toMatch(/could not be read/i);
      expect(view.tuples[0]?.state).toBe("needs_data");
    });
  });

  describe("what never leaves the service", () => {
    it("returns no workbook value, filename, URL, or digest of one", async () => {
      const { subject } = service();

      const serialized = JSON.stringify(
        await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" }),
      );

      expect(serialized).not.toMatch(/value_numerator|value_denominator|storage_path|https?:\/\//i);
      expect(serialized).not.toMatch(/\.csv|\.xlsx/i);
    });

    it("carries a read model version and a stable digest", async () => {
      const { subject } = service();

      const first = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });
      const second = await subject.loadReadiness({ organizationId: ORGANIZATION, role: "owner" });

      expect(first.readModelVersion).toBe(1);
      expect(first.digest).toBe(second.digest);
      expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
