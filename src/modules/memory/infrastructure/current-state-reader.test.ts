import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyBranchOverrides,
  labelEqualAuthorityConflicts,
  readCurrentState,
  type BusinessFactView,
  type CurrentStateQuery,
} from "@/modules/memory/infrastructure/current-state-reader";

const ORG = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const OTHER_BRANCH = "33333333-3333-4333-8333-333333333333";

function fact(overrides: Partial<BusinessFactView> = {}): BusinessFactView {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organization_id: ORG,
    branch_id: null,
    fact_key: "avg_ticket",
    value: 42,
    source: "pos",
    status: "verified",
    effective_from: null,
    effective_to: null,
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function queryWith(tables: Record<string, unknown[]>): CurrentStateQuery {
  return async (input) => ({ rows: tables[input.table] ?? [] });
}

describe("applyBranchOverrides", () => {
  it("prefers the exact-branch fact and retains the default as overridden", () => {
    const labeled = applyBranchOverrides(
      [fact({ id: "org-fact", fact_key: "hours", value: "9-5" })],
      [fact({ id: "branch-fact", branch_id: BRANCH, fact_key: "hours", value: "9-11" })],
    );
    const def = labeled.find((entry) => entry.fact.id === "org-fact");
    const override = labeled.find((entry) => entry.fact.id === "branch-fact");
    expect(def?.scope).toBe("organization");
    expect(def?.overridden).toBe(true);
    expect(override?.scope).toBe("branch");
    expect(override?.overridden).toBe(false);
  });

  it("labels equal-authority conflicts instead of merging them", () => {
    const labeled = labelEqualAuthorityConflicts([
      { fact: fact({ id: "a" }), scope: "organization", overridden: false, conflict: null },
      { fact: fact({ id: "b" }), scope: "organization", overridden: false, conflict: null },
    ]);
    expect(labeled[0].conflict).toEqual({ withIds: ["b"] });
    expect(labeled[1].conflict).toEqual({ withIds: ["a"] });
    // Both survive: labeling never deletes.
    expect(labeled).toHaveLength(2);
  });

  it("leaves a lone fact unlabeled", () => {
    const labeled = applyBranchOverrides([fact()], []);
    expect(labeled).toHaveLength(1);
    expect(labeled[0].conflict).toBeNull();
    expect(labeled[0].overridden).toBe(false);
  });
});

describe("readCurrentState", () => {
  const profile = {
    organization_id: ORG,
    business_model: "Dine-in",
    value_proposition: "Family tables",
    source: "user",
    updated_at: "2026-09-01T00:00:00.000Z",
  };

  it("reads organization defaults plus the exact branch, never another branch", async () => {
    const seen: { table: string; branchId: string | null }[] = [];
    const query: CurrentStateQuery = async (input) => {
      seen.push({ table: input.table, branchId: input.branchId });
      if (input.table === "business_profiles") return { rows: [profile] };
      if (input.table === "business_facts" && input.branchId === null) {
        return { rows: [fact({ id: "44444444-4444-4444-8444-444444444441" })] };
      }
      if (input.table === "business_facts") return { rows: [fact({ id: "44444444-4444-4444-8444-444444444442", branch_id: BRANCH })] };
      if (input.table === "goals") {
        return {
          rows: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              organization_id: ORG,
              name: "Grow",
              metric: "revenue",
              target_value: 100,
              unit: "AED",
              deadline: null,
              scope_kind: "organization",
              scope_branch_id: null,
              priority: 1,
            },
            {
              id: "66666666-6666-4666-8666-666666666666",
              organization_id: ORG,
              name: "Other branch goal",
              metric: "covers",
              target_value: 10,
              unit: "covers",
              deadline: null,
              scope_kind: "branch",
              scope_branch_id: OTHER_BRANCH,
              priority: 2,
            },
          ],
        };
      }
      return { rows: [] };
    };

    const state = await readCurrentState(query, { organizationId: ORG, branchId: BRANCH });
    expect(state.profile?.business_model).toBe("Dine-in");
    expect(state.facts.map((entry) => entry.fact.id).sort()).toEqual([
      "44444444-4444-4444-8444-444444444441",
      "44444444-4444-4444-8444-444444444442",
    ]);
    // The other branch's goal is filtered client-side: never inferred, never merged.
    expect(state.goals.map((goal) => goal.id)).toEqual(["55555555-5555-4555-8555-555555555555"]);
    expect(seen.some((call) => call.table === "business_facts" && call.branchId === BRANCH)).toBe(true);
  });

  it("keeps expired sources with their dates so downstream exclusion can see them", async () => {
    const state = await readCurrentState(
      queryWith({
        business_profiles: [],
        business_facts: [fact({ id: "44444444-4444-4444-8444-444444444443", effective_to: "2020-01-01" })],
        goals: [],
        constraints: [],
      }),
      { organizationId: ORG, branchId: null },
    );
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0].fact.effective_to).toBe("2020-01-01");
  });

  it("fails closed on a transport error instead of returning an empty pack", async () => {
    const failing: CurrentStateQuery = async () => {
      throw new Error("database is down");
    };
    await expect(readCurrentState(failing, { organizationId: ORG, branchId: null })).rejects.toThrow();
  });

  it("fails closed on an invalid row instead of skipping it silently", async () => {
    const state = queryWith({ business_profiles: [], business_facts: [{ nope: true }], goals: [], constraints: [] });
    await expect(readCurrentState(state, { organizationId: ORG, branchId: null })).rejects.toThrow();
  });
});
