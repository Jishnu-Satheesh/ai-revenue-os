import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CreateOrganizationInput } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";

type OrganizationRow = { id: string; name: string; slug: string; status: string };

export async function createOrganization(
  supabase: SupabaseClient<Database>,
  input: CreateOrganizationInput,
): Promise<OrganizationRow> {
  const { data: organization, error } = await supabase.rpc("create_organization_with_owner", {
    input_name: input.name,
    input_slug: input.slug,
    input_industry: input.industry,
    input_country_code: input.countryCode,
    input_base_currency: input.currency,
    input_timezone: input.timezone,
  }).single();

  if (error || !organization) {
    throw new DomainError("DOMAIN_ERROR", "Organization could not be created.", error);
  }

  return organization as OrganizationRow;
}
