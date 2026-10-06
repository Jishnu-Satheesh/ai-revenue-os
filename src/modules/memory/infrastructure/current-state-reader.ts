import "server-only";

import { z } from "zod";

import { memoryError } from "@/domain/memory/errors";

/**
 * Current-state reader (Spec 023 §7 step 2). Server-only. Reads the
 * authoritative profile/facts/goals/constraints directly from their owners
 * using exactly the registered columns below — inspected against
 * `20260807200000_organization_digital_twin.sql` before this slice. A column
 * added to those tables is invisible here until it is registered in this
 * file and in the matching SQL summary expression.
 *
 * Scope semantics: organization-wide rows plus exact-branch overrides for the
 * requested branch. A branch-scoped fact with the same key takes precedence
 * over its organization default; equally authoritative conflicts are labeled,
 * never merged by a model. Nothing here logs values: only identifiers and
 * counts leave this module.
 */

const uuidSchema = z.string().uuid();

const profileRowSchema = z
  .object({
    organization_id: uuidSchema,
    business_model: z.string().nullable(),
    value_proposition: z.string().nullable(),
    source: z.string(),
    updated_at: z.string(),
  })
  .strict();

const factRowSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    branch_id: uuidSchema.nullable(),
    fact_key: z.string(),
    value: z.unknown(),
    source: z.string(),
    status: z.enum(["verified", "imported", "inferred", "stale"]),
    effective_from: z.string().nullable(),
    effective_to: z.string().nullable(),
    updated_at: z.string(),
  })
  .strict();

const goalRowSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
    metric: z.string(),
    target_value: z.number(),
    unit: z.string(),
    deadline: z.string().nullable(),
    scope_kind: z.enum(["organization", "branch"]),
    scope_branch_id: uuidSchema.nullable(),
    priority: z.number().int(),
  })
  .strict();

const constraintRowSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
    constraint_type: z.string(),
    value: z.unknown(),
    severity: z.enum(["soft", "hard"]),
    is_active: z.boolean(),
    source: z.string(),
  })
  .strict();

export type BusinessProfileView = z.infer<typeof profileRowSchema>;
export type BusinessFactView = z.infer<typeof factRowSchema>;
export type GoalView = z.infer<typeof goalRowSchema>;
export type ConstraintView = z.infer<typeof constraintRowSchema>;

export type StateQueryResult = { rows: unknown[] };

export type CurrentStateQuery = (input: {
  table: "business_profiles" | "business_facts" | "goals" | "constraints";
  columns: string;
  organizationId: string;
  /** Null target means organization scope only; a value adds exact-branch rows. */
  branchId: string | null;
  branchColumn: "branch_id" | "scope_branch_id" | null;
}) => Promise<StateQueryResult>;

function readError(cause: unknown): never {
  throw memoryError("CONFLICT", {}, cause);
}

function parseRows<T>(schema: z.ZodType<T>, rows: unknown[], table: string): T[] {
  return rows.map((row) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) readError(new Error(`current-state ${table} row is invalid`));
    return parsed.data;
  });
}

export type LabeledFact = {
  fact: BusinessFactView;
  /** `organization` default or exact-`branch` override. */
  scope: "organization" | "branch";
  /** True when a branch override replaced this organization default. */
  overridden: boolean;
  /** Equal-authority conflicts are labeled, never merged. */
  conflict: { withIds: string[] } | null;
};

/**
 * Organization defaults plus exact-branch overrides. A branch fact with the
 * same key takes precedence; the default is retained as overridden so the
 * pack can show what changed. Same-key pairs cannot currently occur (the
 * (organization_id, fact_key) unique index forbids them); the branch exists
 * so a future relaxation degrades to labeled precedence, never a silent merge.
 */
export function applyBranchOverrides(
  organizationFacts: readonly BusinessFactView[],
  branchFacts: readonly BusinessFactView[],
): LabeledFact[] {
  const branchKeys = new Set(branchFacts.map((fact) => fact.fact_key));
  const labeled: LabeledFact[] = organizationFacts.map((fact) => ({
    fact,
    scope: "organization" as const,
    overridden: branchKeys.has(fact.fact_key),
    conflict: null,
  }));
  for (const fact of branchFacts) {
    labeled.push({ fact, scope: "branch" as const, overridden: false, conflict: null });
  }
  return labelEqualAuthorityConflicts(labeled);
}

/**
 * Labels equally authoritative conflicts without merging: two labeled facts
 * sharing a key at the same scope level both survive, each pointing at the
 * other. A model must present them as opposing evidence, not average them.
 */
export function labelEqualAuthorityConflicts(facts: readonly LabeledFact[]): LabeledFact[] {
  const byKeyAndScope = new Map<string, LabeledFact[]>();
  for (const labeled of facts) {
    const key = `${labeled.scope}:${labeled.fact.fact_key}`;
    const group = byKeyAndScope.get(key) ?? [];
    group.push(labeled);
    byKeyAndScope.set(key, group);
  }
  return facts.map((labeled) => {
    const group = byKeyAndScope.get(`${labeled.scope}:${labeled.fact.fact_key}`) ?? [];
    if (group.length < 2) return labeled;
    return {
      ...labeled,
      conflict: { withIds: group.filter((peer) => peer.fact.id !== labeled.fact.id).map((peer) => peer.fact.id) },
    };
  });
}

export type CurrentState = {
  profile: BusinessProfileView | null;
  facts: LabeledFact[];
  goals: GoalView[];
  constraints: ConstraintView[];
};

type StructuralAnswer = {
  data: Record<string, unknown>[] | null;
  error: { code?: string; message?: string } | null;
};

type StructuralQuery = {
  eq(column: string, value: string): StructuralQuery;
  is(column: string, value: null): StructuralQuery;
  order(column: string, options?: { ascending?: boolean }): StructuralQuery;
  limit(count: number): StructuralQuery;
} & PromiseLike<StructuralAnswer>;

type StructuralSupabase = {
  from(table: string): {
    select(columns: string): StructuralQuery;
  };
};

/**
 * Supabase transport for the reader. Every filter repeats the organization
 * ID; branch filtering uses exact equality or explicit null, never a silent
 * cross-branch read. Goals arrive organization-wide plus the exact branch and
 * are narrowed client-side in readCurrentState.
 */
export function createSupabaseCurrentStateQuery(
  supabase: StructuralSupabase,
): CurrentStateQuery {
  return async (input) => {
    try {
      let selected = supabase.from(input.table).select(input.columns).eq("organization_id", input.organizationId);
      if (input.branchColumn && input.table === "business_facts") {
        selected =
          input.branchId === null
            ? selected.is(input.branchColumn, null)
            : selected.eq(input.branchColumn, input.branchId);
      }
      const result = await selected.order("updated_at", { ascending: false }).limit(200);
      if (result.error) readError(result.error);
      return { rows: result.data ?? [] };
    } catch (cause) {
      readError(cause);
    }
  };
}

/**
 * Reads current authoritative state. A transport failure or an invalid row
 * fails closed (throws): a current authority read the source workflow
 * requires must never degrade to an empty pack silently.
 */
export async function readCurrentState(
  query: CurrentStateQuery,
  input: { organizationId: string; branchId: string | null },
): Promise<CurrentState> {
  const failClosed = async <T>(promise: Promise<T>): Promise<T> => {
    try {
      return await promise;
    } catch (cause) {
      readError(cause);
    }
  };

  const [profileResult, orgFactsResult, branchFactsResult, goalsResult, constraintsResult] =
    await Promise.all([
      failClosed(
        query({
          table: "business_profiles",
          columns: "organization_id,business_model,value_proposition,source,updated_at",
          organizationId: input.organizationId,
          branchId: null,
          branchColumn: null,
        }),
      ),
      failClosed(
        query({
          table: "business_facts",
          columns:
            "id,organization_id,branch_id,fact_key,value,source,status,effective_from,effective_to,updated_at",
          organizationId: input.organizationId,
          branchId: null,
          branchColumn: "branch_id",
        }),
      ),
      input.branchId
        ? failClosed(
            query({
              table: "business_facts",
              columns:
                "id,organization_id,branch_id,fact_key,value,source,status,effective_from,effective_to,updated_at",
              organizationId: input.organizationId,
              branchId: input.branchId,
              branchColumn: "branch_id",
            }),
          )
        : Promise.resolve({ rows: [] }),
      failClosed(
        query({
          table: "goals",
          columns:
            "id,organization_id,name,metric,target_value,unit,deadline,scope_kind,scope_branch_id,priority",
          organizationId: input.organizationId,
          branchId: input.branchId,
          branchColumn: "scope_branch_id",
        }),
      ),
      failClosed(
        query({
          table: "constraints",
          columns: "id,organization_id,name,constraint_type,value,severity,is_active,source",
          organizationId: input.organizationId,
          branchId: null,
          branchColumn: null,
        }),
      ),
    ]);

  const profiles = parseRows(profileRowSchema, profileResult.rows, "business_profiles");
  const orgFacts = parseRows(factRowSchema, orgFactsResult.rows, "business_facts");
  const branchFacts = parseRows(factRowSchema, branchFactsResult.rows, "business_facts");
  const goals = parseRows(goalRowSchema, goalsResult.rows, "goals").filter(
    (goal) =>
      goal.scope_kind === "organization" ||
      (goal.scope_kind === "branch" && goal.scope_branch_id === input.branchId),
  );
  const constraints = parseRows(constraintRowSchema, constraintsResult.rows, "constraints").filter(
    (constraint) => constraint.is_active,
  );

  return {
    profile: profiles[0] ?? null,
    facts: applyBranchOverrides(orgFacts, branchFacts),
    goals,
    constraints,
  };
}
