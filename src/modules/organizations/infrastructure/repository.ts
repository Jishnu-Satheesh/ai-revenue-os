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
    .rpc("create_organization_with_owner_v2", {
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

export async function listOrganizations(supabase: OrganizationClient) {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });
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

export async function createConstraint(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  input: ConstraintInput,
) {
  const { data, error } = await supabase
    .from("constraints")
    .insert({
      organization_id: organizationId,
      name: input.name,
      constraint_type: input.constraintType,
      value: input.value,
      severity: input.severity,
      source: input.source,
      is_active: input.isActive,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error || !data) raise("Constraint could not be created.", error);
  return data;
}

export async function savePolicy(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  input: PolicyInput,
) {
  const { data: latest, error: latestError } = await supabase
    .from("policies")
    .select("version")
    .eq("organization_id", organizationId)
    .eq("policy_type", input.policyType)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) raise("Current policy could not be loaded.", latestError);
  const nextVersion = (latest?.version ?? 0) + 1;
  const { data, error } = await supabase
    .from("policies")
    .insert({
      organization_id: organizationId,
      policy_type: input.policyType,
      name: input.name,
      mode: input.mode,
      configuration: input.configuration,
      monthly_budget_minor: input.monthlyBudgetMinor ?? null,
      budget_currency: input.budgetCurrency ?? null,
      version: nextVersion,
      is_active: true,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
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
