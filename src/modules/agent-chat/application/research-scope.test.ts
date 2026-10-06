import { describe, expect, it, vi } from "vitest";
import { bindAgentContextScope, resolveResearchBranchScope } from "./research-scope";
import { buildAgentContextPack } from "./context-pack";

const branches = [{ id: "j", name: "Jumeirah" }, { id: "m", name: "Marina" }];
describe("explicit research branch scope", () => {
  it("binds a complete named branch without accepting a supplied identifier", () => {
    expect(resolveResearchBranchScope("Research the JUMEIRAH branch's competitors", branches))
      .toEqual({ kind: "branch", branchId: "j" });
    expect(resolveResearchBranchScope("Research branch id j", branches)).toEqual({ kind: "organization" });
  });
  it("keeps organization scope when no branch is named, including single-branch tenants", () => {
    expect(resolveResearchBranchScope("Research our competitors", branches.slice(0, 1)))
      .toEqual({ kind: "organization" });
    expect(resolveResearchBranchScope("Research Marinara competitors", branches))
      .toEqual({ kind: "organization" });
  });
  it("accepts a natural branch name without its terminal Branch label", () => {
    const namedBranches = [{ id: "j", name: "Jumeirah branch" }, { id: "m", name: "Marina Branch" }];
    expect(resolveResearchBranchScope("Research competitors near Jumeirah", namedBranches))
      .toEqual({ kind: "branch", branchId: "j" });
    expect(resolveResearchBranchScope("Research Marina Branch", namedBranches))
      .toEqual({ kind: "branch", branchId: "m" });
    expect(resolveResearchBranchScope("Research Marinara competitors", namedBranches))
      .toEqual({ kind: "organization" });
    expect(resolveResearchBranchScope("Research branches", [{ id: "short", name: "A Branch" }]))
      .toEqual({ kind: "organization" });
  });
  it("keeps derived aliases ambiguous across distinct tenant branches", () => {
    expect(resolveResearchBranchScope("Research near Jumeirah", [
      { id: "j1", name: "Jumeirah branch" }, { id: "j2", name: "Jumeirah" },
    ])).toEqual({ kind: "ambiguous" });
    expect(resolveResearchBranchScope("Compare Jumeirah and Marina", [
      { id: "j", name: "Jumeirah branch" }, { id: "m", name: "Marina Branch" },
    ])).toEqual({ kind: "ambiguous" });
    expect(resolveResearchBranchScope("Research near Downtown", [{ id: "d", name: "Branch Downtown" }]))
      .toEqual({ kind: "organization" });
  });
  it("refuses multiple mentions and duplicate names rather than choosing a branch", () => {
    expect(resolveResearchBranchScope("Compare Marina and Jumeirah", branches)).toEqual({ kind: "ambiguous" });
    expect(resolveResearchBranchScope("Research Marina", [...branches, { id: "other", name: "Marina" }]))
      .toEqual({ kind: "ambiguous" });
  });
});

describe("context pack scope binding", () => {
  const input = { organizationId: "org", userId: "user", windowDays: 30 as const, page: "overview" };

  it("keeps unnamed advice organization-wide without an implicit branch", async () => {
    const getMarketProfile = vi.fn(async () => ({ status: "missing" }));
    const bound = bindAgentContextScope({ kind: "organization" }, { getMarketProfile });
    expect(bound.branchId).toBeUndefined();
    await buildAgentContextPack({ ...input, ...bound });
    expect(getMarketProfile).toHaveBeenCalledWith({ organizationId: "org" });
  });

  it("refuses unrelated organization profiles after ambiguous branch mentions", async () => {
    const getMarketProfile = vi.fn(async () => ({ status: "current", versionId: "unrelated", digest: "digest" }));
    const pack = await buildAgentContextPack({ ...input,
      ...bindAgentContextScope({ kind: "ambiguous" }, { getMarketProfile }) });
    expect(getMarketProfile).not.toHaveBeenCalled();
    expect(pack.lanes.marketProfile).toEqual({ status: "missing", reasonCode: "PROFILE_SCOPE_MISMATCH" });
    expect(pack.limitations.join(" ")).toContain("does not match the requested branch");
  });

  it("records failed branch reads as unavailable instead of an empty or unconfirmed profile", async () => {
    const getMarketProfile = vi.fn(async () => ({ status: "missing", reasonCode: "PROFILE_NOT_CONFIRMED" }));
    const pack = await buildAgentContextPack({ ...input,
      ...bindAgentContextScope({ kind: "unavailable" }, { getMarketProfile }) });
    expect(getMarketProfile).not.toHaveBeenCalled();
    expect(pack.lanes.marketProfile).toEqual({ status: "missing" });
    expect(pack.limitations.join(" ")).toContain("Market Profile unavailable");
    expect(pack.limitations.join(" ")).not.toContain("not confirmed");
  });
});
