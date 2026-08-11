import type { SupabaseClient } from "@supabase/supabase-js";

import { toCostRateRows } from "@/domain/onboarding/cost-rates";
import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import type {
  OnboardingCostComponent,
  OnboardingIdempotencyRecord,
  OnboardingRepository,
} from "@/modules/onboarding/application/service";

type OnboardingClient = SupabaseClient<Database>;

export type OnboardingExtractionRepository = {
  findUpload(input: {
    organizationId: string;
    uploadId: string;
  }): Promise<Database["public"]["Tables"]["onboarding_uploads"]["Row"] | null>;
  findUploadByChecksum(input: {
    organizationId: string;
    checksum: string;
  }): Promise<Database["public"]["Tables"]["onboarding_uploads"]["Row"] | null>;
  createUpload(
    input: Database["public"]["Tables"]["onboarding_uploads"]["Insert"],
  ): Promise<Database["public"]["Tables"]["onboarding_uploads"]["Row"]>;
  updateUpload(input: {
    organizationId: string;
    uploadId: string;
    patch: Database["public"]["Tables"]["onboarding_uploads"]["Update"];
  }): Promise<Database["public"]["Tables"]["onboarding_uploads"]["Row"]>;
  createExtraction(
    input: Database["public"]["Tables"]["onboarding_extractions"]["Insert"],
  ): Promise<Database["public"]["Tables"]["onboarding_extractions"]["Row"]>;
  updateExtraction(input: {
    organizationId: string;
    extractionId: string;
    patch: Database["public"]["Tables"]["onboarding_extractions"]["Update"];
  }): Promise<Database["public"]["Tables"]["onboarding_extractions"]["Row"]>;
  createCandidate(
    input: Database["public"]["Tables"]["onboarding_extraction_candidates"]["Insert"],
  ): Promise<Database["public"]["Tables"]["onboarding_extraction_candidates"]["Row"]>;
  findCandidate(input: {
    organizationId: string;
    candidateId: string;
  }): Promise<Database["public"]["Tables"]["onboarding_extraction_candidates"]["Row"] | null>;
  updateCandidate(input: {
    organizationId: string;
    candidateId: string;
    patch: Database["public"]["Tables"]["onboarding_extraction_candidates"]["Update"];
  }): Promise<Database["public"]["Tables"]["onboarding_extraction_candidates"]["Row"]>;
};

function raise(message: string, cause?: unknown): never {
  throw new DomainError("DOMAIN_ERROR", message, cause);
}

/**
 * Writes the costs an operator typed as effective-dated rates.
 *
 * The section stores what was said; this is what makes it count, because a rate
 * here is what the channel economics ledger prices every margin against. The
 * shaping lives in `toCostRateRows`; this is the I/O around it.
 *
 * Saving again on the same date updates the rate rather than colliding.
 * Correcting a typo is not a commission tier change, and only a new date opens
 * a new effective period.
 */
async function promoteCostRates(
  supabase: OnboardingClient,
  input: { organizationId: string; payload: Record<string, unknown> },
): Promise<void> {
  const [{ data: organization }, { data: definitions, error: definitionError }] = await Promise.all(
    [
      supabase
        .from("organizations")
        .select("base_currency")
        .eq("id", input.organizationId)
        .maybeSingle(),
      supabase
        .from("cost_component_definitions")
        .select("id, key, organization_id")
        .eq("is_active", true)
        .or(`organization_id.is.null,organization_id.eq.${input.organizationId}`),
    ],
  );

  if (definitionError) raise("Cost components could not be read.", definitionError);
  if (!organization) raise("The organization could not be read.");

  const definitionIdByKey = new Map<string, string>();
  for (const row of definitions ?? []) {
    // A custom definition outranks shared vocabulary for the same key.
    if (definitionIdByKey.has(row.key) && row.organization_id === null) continue;
    definitionIdByKey.set(row.key, row.id);
  }

  const rows = toCostRateRows(input.payload, {
    definitionIdByKey,
    baseCurrency: organization.base_currency,
  });
  if (rows.length === 0) return;

  const { error } = await supabase.rpc("record_cost_component_rates", {
    target_organization_id: input.organizationId,
    input_rates: rows,
  });
  if (error) raise("Cost rates could not be recorded.", error);
}

export function createOnboardingRepository(supabase: OnboardingClient): OnboardingRepository {
  return {
    async findSession(organizationId) {
      const { data, error } = await supabase
        .from("onboarding_sessions")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) raise("Onboarding session could not be loaded.", error);
      return data;
    },

    async createSession(input) {
      const { data, error } = await supabase
        .from("onboarding_sessions")
        .insert({
          organization_id: input.organizationId,
          owner_id: input.userId,
        })
        .select("*")
        .single();
      if (error || !data) raise("Onboarding session could not be created.", error);
      return data;
    },

    async updateSession(input) {
      const { data, error } = await supabase
        .from("onboarding_sessions")
        .update(input.patch)
        .eq("organization_id", input.organizationId)
        .eq("id", input.sessionId)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding session could not be updated.", error);
      return data;
    },

    async findIdempotency(input) {
      const { data, error } = await supabase
        .from("onboarding_idempotency_records")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("operation", input.operation)
        .eq("idempotency_key", input.key)
        .maybeSingle();
      if (error) raise("Onboarding retry record could not be loaded.", error);
      return data as OnboardingIdempotencyRecord | null;
    },

    async saveIdempotency(input) {
      const { data, error } = await supabase
        .from("onboarding_idempotency_records")
        .insert({
          organization_id: input.organizationId,
          operation: input.operation,
          idempotency_key: input.key,
          request_hash: input.requestHash,
          response_payload: input.responsePayload,
          created_by: input.userId,
        })
        .select("*")
        .single();
      if (error || !data) {
        if (error?.code === "23505") {
          const existing = await this.findIdempotency(input);
          if (existing) return existing;
        }
        raise("Onboarding retry record could not be saved.", error);
      }
      return data;
    },

    async upsertSectionState(input) {
      const { data, error } = await supabase
        .from("onboarding_section_states")
        .upsert(
          {
            organization_id: input.organizationId,
            session_id: input.sessionId,
            section_key: input.sectionKey,
            status: input.status,
            payload: input.payload,
            source_metadata: input.sourceMetadata,
            updated_by: input.userId,
            completed_at: input.status === "complete" ? new Date().toISOString() : null,
          },
          { onConflict: "session_id,section_key" },
        )
        .select("*")
        .single();
      if (error || !data) raise("Onboarding section could not be saved.", error);
      return data;
    },

    async createRequest(input) {
      const { data, error } = await supabase
        .from("onboarding_requests")
        .insert(input)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding request could not be created.", error);
      return data;
    },

    async getSnapshot(organizationId) {
      const [
        session,
        sections,
        requests,
        uploads,
        extractions,
        candidates,
        readiness,
        costComponents,
      ] = await Promise.all([
        this.findSession(organizationId),
        supabase
          .from("onboarding_section_states")
          .select("*")
          .eq("organization_id", organizationId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("onboarding_requests")
          .select("*")
          .eq("organization_id", organizationId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("onboarding_uploads")
          .select("*")
          .eq("organization_id", organizationId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("onboarding_extractions")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("onboarding_extraction_candidates")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("ai_readiness_assessments")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Shared vocabulary plus this organization's own keys, the same
        // resolution the ledger uses. Cost structure asks the operator to
        // price whatever the pack registered, so the catalog travels with the
        // workspace rather than being fetched by the section.
        supabase
          .from("cost_component_definitions")
          .select("key, label, computation_kind, organization_id")
          .eq("is_active", true)
          .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
          .order("key", { ascending: true }),
      ]);

      const failed = [
        sections,
        requests,
        uploads,
        extractions,
        candidates,
        readiness,
        costComponents,
      ].find((result) => result.error);
      if (failed?.error) raise("Onboarding workspace could not be loaded.", failed.error);

      const componentsByKey = new Map<string, OnboardingCostComponent>();
      for (const row of costComponents.data ?? []) {
        // A custom definition outranks shared vocabulary for the same key.
        if (componentsByKey.has(row.key) && row.organization_id === null) continue;
        componentsByKey.set(row.key, {
          key: row.key,
          label: row.label,
          computationKind: row.computation_kind,
        });
      }

      return {
        session,
        sections: sections.data ?? [],
        requests: requests.data ?? [],
        uploads: uploads.data ?? [],
        extractions: extractions.data ?? [],
        candidates: candidates.data ?? [],
        readiness: readiness.data,
        costComponents: [...componentsByKey.values()],
      };
    },

    async saveReadinessAssessment(input) {
      const { data, error } = await supabase
        .from("ai_readiness_assessments")
        .insert(input)
        .select("*")
        .single();
      if (error || !data) raise("Readiness assessment could not be saved.", error);
      return data;
    },
    async persistCanonicalSection(input) {
      if (input.sectionKey === "cost_structure") {
        await promoteCostRates(supabase, input);
        return;
      }
      if (input.sectionKey !== "business_identity") return;
      const organizationPatch: Database["public"]["Tables"]["organizations"]["Update"] = {};
      if (typeof input.payload.name === "string" && input.payload.name.trim())
        organizationPatch.name = input.payload.name.trim();
      if (typeof input.payload.industry === "string" && input.payload.industry.trim())
        organizationPatch.industry = input.payload.industry.trim();
      if (Object.keys(organizationPatch).length) {
        const { error } = await supabase
          .from("organizations")
          .update(organizationPatch)
          .eq("id", input.organizationId);
        if (error) raise("Business identity could not be promoted.", error);
      }
      if (
        typeof input.payload.valueProposition === "string" ||
        typeof input.payload.legalIdentity === "string"
      ) {
        const { error } = await supabase.from("business_profiles").upsert({
          organization_id: input.organizationId,
          value_proposition:
            typeof input.payload.valueProposition === "string"
              ? input.payload.valueProposition
              : null,
          brand_context:
            typeof input.payload.legalIdentity === "string"
              ? { legalIdentity: input.payload.legalIdentity }
              : {},
          source: "operator",
          updated_by: input.userId,
          customer_segments: [],
          languages: [],
          operating_model: {},
          business_model: null,
        });
        if (error) raise("Business profile could not be promoted.", error);
      }
    },
  };
}

export function createOnboardingExtractionRepository(
  supabase: OnboardingClient,
): OnboardingExtractionRepository {
  return {
    async findUpload(input) {
      const { data, error } = await supabase
        .from("onboarding_uploads")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("id", input.uploadId)
        .maybeSingle();
      if (error) raise("Onboarding upload could not be loaded.", error);
      return data;
    },
    async findUploadByChecksum(input) {
      const { data, error } = await supabase
        .from("onboarding_uploads")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("checksum", input.checksum)
        .maybeSingle();
      if (error) raise("Onboarding upload could not be checked.", error);
      return data;
    },
    async createUpload(input) {
      const { data, error } = await supabase
        .from("onboarding_uploads")
        .insert(input)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding upload could not be created.", error);
      return data;
    },
    async updateUpload(input) {
      const { data, error } = await supabase
        .from("onboarding_uploads")
        .update(input.patch)
        .eq("organization_id", input.organizationId)
        .eq("id", input.uploadId)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding upload could not be updated.", error);
      return data;
    },
    async createExtraction(input) {
      const { data, error } = await supabase
        .from("onboarding_extractions")
        .insert(input)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding extraction could not be created.", error);
      return data;
    },
    async updateExtraction(input) {
      const { data, error } = await supabase
        .from("onboarding_extractions")
        .update(input.patch)
        .eq("organization_id", input.organizationId)
        .eq("id", input.extractionId)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding extraction could not be updated.", error);
      return data;
    },
    async createCandidate(input) {
      const { data, error } = await supabase
        .from("onboarding_extraction_candidates")
        .insert(input)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding candidate could not be created.", error);
      return data;
    },
    async findCandidate(input) {
      const { data, error } = await supabase
        .from("onboarding_extraction_candidates")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("id", input.candidateId)
        .maybeSingle();
      if (error) raise("Onboarding candidate could not be loaded.", error);
      return data;
    },
    async updateCandidate(input) {
      const { data, error } = await supabase
        .from("onboarding_extraction_candidates")
        .update(input.patch)
        .eq("organization_id", input.organizationId)
        .eq("id", input.candidateId)
        .select("*")
        .single();
      if (error || !data) raise("Onboarding candidate could not be updated.", error);
      return data;
    },
  };
}
