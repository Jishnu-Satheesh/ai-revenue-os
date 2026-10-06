import type { ContextPackReaders } from "./context-pack";

export type AgentContextScope =
  | { kind: "organization" }
  | { kind: "branch"; branchId: string }
  | { kind: "ambiguous" }
  | { kind: "unavailable" };

/** Resolve an explicit branch mention against tenant-owned names only. */
export function resolveResearchBranchScope(
  question: string,
  branches: readonly { id: string; name: string }[],
): Exclude<AgentContextScope, { kind: "unavailable" }> {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const text = ` ${normalize(question)} `;
  const matches = branches.filter((branch) => {
    const name = normalize(branch.name);
    const aliases = [name, name.replace(/ branch$/, "")];
    return aliases.some((alias) => alias.length >= 2 && text.includes(` ${alias} `));
  });
  const ids = [...new Set(matches.map((branch) => branch.id))];
  if (ids.length > 1) return { kind: "ambiguous" };
  return ids[0] ? { kind: "branch", branchId: ids[0] } : { kind: "organization" };
}

/** Reuse this binding in request and worker packs so failed scope never binds a different profile. */
export function bindAgentContextScope(
  scope: AgentContextScope,
  readers: ContextPackReaders,
): { branchId?: string; readers: ContextPackReaders } {
  if (scope.kind === "branch") return { branchId: scope.branchId, readers };
  if (scope.kind === "organization") return { readers };
  return {
    readers: {
      ...readers,
      getMarketProfile: scope.kind === "ambiguous"
        ? async () => ({ status: "missing", reasonCode: "PROFILE_SCOPE_MISMATCH" })
        : async () => { throw new Error("AGENT_CONTEXT_SCOPE_READ_FAILED"); },
    },
  };
}
