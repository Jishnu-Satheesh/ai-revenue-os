import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";
import { selectPlaybookGuidance } from "@/workflows/analysis/channel-playbooks";
import type {
  NarrationChannelContext,
  NarrationPromptFinding,
  PlaybookGuidanceItem,
  WebEvidenceItem,
} from "@/workflows/analysis/recommendation-prompt";
import type { ChannelPilotContext } from "@/workflows/analysis/run-channel-recommendations";

/**
 * The narrator's pilot-context loader.
 *
 * Kept in its own module — rather than inside the Trigger task file — for the
 * same reason as `synthesis-loaders.ts`: the task file pulls server-only
 * transport (`@/lib/env`, the Trigger SDK), which unit tests cannot import,
 * while this loader is plain reads plus pure assembly and is tested directly.
 * The task file wires it as its `loadPilotContext` dependency.
 */

/**
 * Whitelisted pilot-context row shapes. Each schema names exactly the columns
 * the prompt may see, so a wider row — a future column, a `select("*")`
 * refactor — cannot smuggle PII past this point: anything undeclared is
 * stripped, and anything unparseable throws into the workflow's fail-open
 * path rather than arriving as a half-shaped context.
 */
const pilotRunRowShape = z.object({
  channel_id: z.string().uuid().nullable(),
  branch_id: z.string().uuid().nullable(),
});

const pilotChannelRowShape = z.object({
  key: z.string(),
  display_name: z.string(),
  category: z.string(),
  template_key: z.string().nullable(),
});

const pilotOrganizationRowShape = z.object({
  name: z.string(),
  industry: z.string(),
  country_code: z.string(),
  base_currency: z.string(),
  default_timezone: z.string(),
});

const pilotBranchRowShape = z.object({
  name: z.string(),
  timezone: z.string(),
});

function emptyPilotContext(): ChannelPilotContext {
  return { channelContext: null, playbookGuidance: [], webEvidence: [] };
}

/**
 * Reason labels are a documented heuristic, not stored dimensions.
 *
 * The narration finding shape carries no dimension values — `valueSummary`
 * is null by construction, because raw metric rows are never loaded into the
 * prompt — so there is no reason column to read. Instead a finding whose
 * code, headline, or limitations text names CLOSED (as a whole word,
 * case-insensitive) contributes the `CLOSED` label, which is what steers the
 * Talabat selector toward its closed-cancellation checklist. A finding that
 * never names it contributes nothing.
 */
function derivePilotReasonLabels(findings: readonly NarrationPromptFinding[]): string[] {
  const labels = new Set<string>();
  for (const finding of findings) {
    const haystack = [finding.code, finding.headline, ...finding.limitations].join("\n");
    if (/\bCLOSED\b/i.test(haystack)) labels.add("CLOSED");
  }
  return [...labels].sort();
}

/**
 * Loads the pilot's stored channel context for one narration run.
 *
 * The `channel_analysis_runs` row (by analysis run id, scoped by
 * organization id) is authoritative for channel and branch scope:
 * `payload.channelId` only says who asked and is never read here, so a hint
 * from another tenant cannot steer this loader. The channel, organization,
 * and branch reads are each scoped by organization id, which is what makes a
 * foreign channel id resolve to no row — null context — rather than to
 * someone else's storefront.
 *
 * Only display names, keys, template keys, categories, industry, country,
 * timezone, and currency are ever selected. Branch `service_area`,
 * `operating_hours`, `contact_details`, and `capacity_metadata` have no slot
 * in the context type and are never named in a select.
 *
 * Any throw — a database error, a row that no longer matches its schema —
 * propagates to the workflow, which fails open to the v4-shape prompt. A
 * null channel (a cross-channel comparison run) or a channel row outside
 * this tenant is not an error: it returns null context with empty guidance,
 * which renders the same v4 shape.
 */
export async function loadRecommendationPilotContext(
  supabase: SupabaseClient<Database>,
  input: {
    organizationId: string;
    analysisRunId: string;
    findings: readonly NarrationPromptFinding[];
  },
): Promise<ChannelPilotContext> {
  const { data: runRow, error: runError } = await supabase
    .from("channel_analysis_runs")
    .select("channel_id, branch_id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.analysisRunId)
    .maybeSingle();
  if (runError) throw new Error(`Channel recommendation context load failed: ${runError.code}`);
  const run = runRow ? pilotRunRowShape.parse(runRow) : null;
  if (!run?.channel_id) return emptyPilotContext();

  const { data: channelRow, error: channelError } = await supabase
    .from("organization_channels")
    .select("key, display_name, category, template_key")
    .eq("organization_id", input.organizationId)
    .eq("id", run.channel_id)
    .maybeSingle();
  if (channelError) throw new Error(`Channel recommendation context load failed: ${channelError.code}`);
  if (!channelRow) return emptyPilotContext();
  const channel = pilotChannelRowShape.parse(channelRow);

  const { data: organizationRow, error: organizationError } = await supabase
    .from("organizations")
    .select("name, industry, country_code, base_currency, default_timezone")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (organizationError) {
    throw new Error(`Channel recommendation context load failed: ${organizationError.code}`);
  }
  const organization = organizationRow ? pilotOrganizationRowShape.parse(organizationRow) : null;

  const { data: branchRow, error: branchError } = run.branch_id
    ? await supabase
        .from("branches")
        .select("name, timezone")
        .eq("organization_id", input.organizationId)
        .eq("id", run.branch_id)
        .maybeSingle()
    : { data: null, error: null };
  if (branchError) throw new Error(`Channel recommendation context load failed: ${branchError.code}`);
  const branch = branchRow ? pilotBranchRowShape.parse(branchRow) : null;

  const channelContext: NarrationChannelContext = {
    organizationName: organization?.name ?? null,
    industry: organization?.industry ?? null,
    countryCode: organization?.country_code ?? null,
    baseCurrency: organization?.base_currency ?? null,
    organizationTimezone: organization?.default_timezone ?? null,
    channelKey: channel.key,
    channelDisplayName: channel.display_name,
    channelCategory: channel.category,
    templateKey: channel.template_key,
    branchName: branch?.name ?? null,
    branchTimezone: branch?.timezone ?? null,
  };

  const playbookGuidance: readonly PlaybookGuidanceItem[] = selectPlaybookGuidance({
    channelKey: channel.key,
    templateKey: channel.template_key,
    channelDisplayName: channel.display_name,
    detectorKeys: input.findings.map((finding) => finding.detectorKey),
    reasonLabels: derivePilotReasonLabels(input.findings),
  });

  // Live Brave transport is unqualified — the research pipeline runs on
  // fixtures only — so this slot ships prepared and empty: never fetched,
  // never invented. Qualifying live search is the explicit follow-up.
  const webEvidence: readonly WebEvidenceItem[] = [];

  return { channelContext, playbookGuidance, webEvidence };
}
