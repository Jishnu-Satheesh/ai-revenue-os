import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import type {
  BranchInput,
  BusinessFactInput,
  BusinessProfileInput,
  ConstraintInput,
  CreateOrganizationInput,
  GoalInput,
  PolicyInput,
} from "@/domain/organizations/types";

type OrganizationClient = SupabaseClient<Database>;
type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];
type BranchRow = Database["public"]["Tables"]["branches"]["Row"];
type ConstraintRow = Database["public"]["Tables"]["constraints"]["Row"];
type PolicyRow = Database["public"]["Tables"]["policies"]["Row"];

export type DigitalTwinSnapshot = {
  organization: OrganizationRow;
  branches: Database["public"]["Tables"]["branches"]["Row"][];
  profile: Database["public"]["Tables"]["business_profiles"]["Row"] | null;
  facts: Database["public"]["Tables"]["business_facts"]["Row"][];
  goals: Database["public"]["Tables"]["goals"]["Row"][];
  constraints: Database["public"]["Tables"]["constraints"]["Row"][];
  policies: Database["public"]["Tables"]["policies"]["Row"][];
  auditEvents: Database["public"]["Tables"]["audit_events"]["Row"][];
};

function raise(message: string, cause?: unknown): never {
  throw new DomainError("DOMAIN_ERROR", message, cause);
}

export async function createOrganization(
  supabase: OrganizationClient,
  input: CreateOrganizationInput,
): Promise<OrganizationRow> {
  const firstBranch = input.firstBranch;
  const { data, error } = await supabase
    // v3 records the account that owns the client. The account is deliberately
    // not passed: a caller belonging to exactly one agency should not have to
    // name it, and one belonging to several must, which the function enforces.
    .rpc("create_organization_with_owner_v3", {
      input_name: input.name,
      input_slug: input.slug,
      input_industry: input.industry,
      input_country_code: input.countryCode,
      input_base_currency: input.currency,
      input_timezone: input.timezone,
      input_industry_pack_slug: input.industryPackSlug,
      input_first_branch_name: firstBranch?.name ?? null,
      input_first_branch_slug: firstBranch?.slug ?? null,
      input_first_branch_kind: firstBranch?.kind ?? "physical",
    })
    .single();

  if (error || !data) raise("Organization could not be created.", error);
  return data as OrganizationRow;
}

export async function getOrganization(supabase: OrganizationClient, organizationId: string) {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) raise("Organization could not be loaded.", error);
  return data;
}

/**
 * The organizations a user can actually work in. Archived organizations are
 * abandoned drafts, so excluding them here keeps the switcher's list identical
 * to the candidate set `resolve_landing_organization` chooses from -- otherwise
 * the menu could offer a destination the landing would refuse to resolve.
 */
export async function listOrganizations(supabase: OrganizationClient) {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .neq("status", "archived")
    .order("name", { ascending: true });
  if (error) raise("Organizations could not be loaded.", error);
  return data;
}

export async function getDigitalTwin(
  supabase: OrganizationClient,
  organizationId: string,
): Promise<DigitalTwinSnapshot> {
  const [organization, branches, profile, facts, goals, constraints, policies, auditEvents] =
    await Promise.all([
      getOrganization(supabase, organizationId),
      supabase
        .from("branches")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at"),
      supabase
        .from("business_profiles")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("business_facts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false }),
      supabase.from("goals").select("*").eq("organization_id", organizationId).order("priority"),
      supabase
        .from("constraints")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("policies")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("policy_type"),
      supabase
        .from("audit_events")
        .select("*")
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false })
        .limit(50),
    ]);

  const resultSets = [branches, profile, facts, goals, constraints, policies, auditEvents];
  const failed = resultSets.find((result) => result.error);
  if (failed?.error) raise("Digital Twin data could not be loaded.", failed.error);

  return {
    organization,
    branches: branches.data ?? [],
    profile: profile.data,
    facts: facts.data ?? [],
    goals: goals.data ?? [],
    constraints: constraints.data ?? [],
    policies: policies.data ?? [],
    auditEvents: auditEvents.data ?? [],
  };
}

export async function createBranch(
  supabase: OrganizationClient,
  organizationId: string,
  input: BranchInput,
): Promise<BranchRow> {
  const { data, error } = await supabase
    .from("branches")
    .insert({
      organization_id: organizationId,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      timezone: input.timezone,
      currency: input.currency,
      service_area: input.serviceArea,
      operating_hours: input.operatingHours,
      contact_details: input.contactDetails,
      capacity_metadata: input.capacityMetadata,
    })
    .select("*")
    .single();
  if (error || !data) raise("Branch could not be created.", error);
  return data;
}

export async function updateBusinessProfile(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  input: BusinessProfileInput,
) {
  const { data, error } = await supabase
    .from("business_profiles")
    .upsert({
      organization_id: organizationId,
      business_model: input.businessModel ?? null,
      value_proposition: input.valueProposition ?? null,
      customer_segments: input.customerSegments,
      brand_context: input.brandContext,
      languages: input.languages,
      operating_model: input.operatingModel,
      source: input.source,
      updated_by: userId,
    })
    .select("*")
    .single();
  if (error || !data) raise("Business profile could not be saved.", error);
  return data;
}

export async function saveBusinessFact(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  input: BusinessFactInput,
) {
  const existingQuery = supabase
    .from("business_facts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("fact_key", input.factKey);
  const { data: existingFacts, error: existingError } = input.branchId
    ? await existingQuery.eq("branch_id", input.branchId).limit(1)
    : await existingQuery.is("branch_id", null).limit(1);
  if (existingError) raise("Existing business fact could not be checked.", existingError);
  const existing = existingFacts?.[0];
  if (existing?.status === "verified" && input.status !== "verified") {
    throw new DomainError(
      "DOMAIN_ERROR",
      "An inferred or imported fact cannot overwrite a verified fact.",
    );
  }

  const record = {
    organization_id: organizationId,
    branch_id: input.branchId ?? null,
    fact_key: input.factKey,
    value: input.value,
    source: input.source,
    source_reference: input.sourceReference ?? null,
    status: input.status,
    confidence: input.confidence ?? null,
    effective_from: input.effectiveFrom ?? null,
    effective_to: input.effectiveTo ?? null,
    last_verified_at:
      input.status === "verified" ? new Date().toISOString() : (existing?.last_verified_at ?? null),
    created_by: existing?.created_by ?? userId,
    updated_by: userId,
  };
  const query = existing
    ? supabase.from("business_facts").update(record).eq("id", existing.id)
    : supabase.from("business_facts").insert(record);
  const { data, error } = await query.select("*").single();
  if (error || !data) raise("Business fact could not be saved.", error);
  return data;
}

export async function createGoal(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  input: GoalInput,
) {
  const { data, error } = await supabase
    .from("goals")
    .insert({
      organization_id: organizationId,
      name: input.name,
      metric: input.metric,
      baseline_status: input.baselineStatus,
      baseline_value: input.baselineValue ?? null,
      target_value: input.targetValue,
      unit: input.unit,
      currency: input.currency ?? null,
      deadline: input.deadline ?? null,
      scope_kind: input.scopeKind,
      scope_branch_id: input.scopeBranchId ?? null,
      owner_id: input.ownerId ?? userId,
      priority: input.priority,
    })
    .select("*")
    .single();
  if (error || !data) raise("Goal could not be created.", error);
  return data;
}

/**
 * Writes a new constraint version. The RPC retires the incumbent at the same
 * key and scope in the same transaction, which the partial unique index on
 * active rows requires and a two-statement client cannot guarantee.
 */
export async function saveConstraintVersion(
  supabase: OrganizationClient,
  organizationId: string,
  input: ConstraintInput,
): Promise<ConstraintRow> {
  const { data, error } = await supabase
    .rpc("save_constraint_version", {
      target_organization_id: organizationId,
      input_constraint_key: input.constraintKey,
      input_name: input.name,
      input_constraint_type: input.constraintType,
      input_value: input.value,
      input_severity: input.severity,
      input_source: input.source,
      input_scope_kind: input.scopeKind,
      input_scope_ref: input.scopeRef ?? null,
      input_effective_from: input.effectiveFrom ?? null,
    })
    .single();
  if (error || !data) raise("Constraint could not be saved.", error);
  return data;
}

/**
 * Writes a new policy version. Version allocation and retirement of the
 * incumbent happen inside one transaction: the previous implementation read
 * the highest version and inserted a new active row without retiring its
 * predecessor, so a policy type accumulated active versions and the version
 * tuple in `specs/011-learning-ledger.md` could not resolve one.
 */
export async function savePolicy(
  supabase: OrganizationClient,
  organizationId: string,
  input: PolicyInput,
): Promise<PolicyRow> {
  const { data, error } = await supabase
    .rpc("save_policy_version", {
      target_organization_id: organizationId,
      input_policy_type: input.policyType,
      input_name: input.name,
      input_mode: input.mode,
      input_configuration: input.configuration,
      input_monthly_budget_minor: input.monthlyBudgetMinor ?? null,
      input_budget_currency: input.budgetCurrency ?? null,
    })
    .single();
  if (error || !data) raise("Policy could not be saved.", error);
  return data;
}

export async function activateOrganization(supabase: OrganizationClient, organizationId: string) {
  const { data, error } = await supabase
    .rpc("activate_organization", { target_organization_id: organizationId })
    .single();
  if (error || !data) raise("Organization is not ready to activate.", error);
  return data;
}

export async function archiveDraftOrganization(
  supabase: OrganizationClient,
  organizationId: string,
) {
  const { data, error } = await supabase
    .rpc("archive_draft_organization", { target_organization_id: organizationId })
    .single();
  if (error || !data) raise("Only draft organizations can be archived.", error);
  return data;
}
