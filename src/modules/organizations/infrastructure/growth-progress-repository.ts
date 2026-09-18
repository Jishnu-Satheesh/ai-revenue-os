import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toCalendarDate } from "@/domain/metrics/periods";
import { addLocalDays, isoDateSchema } from "@/domain/organizations/growth-periods";
import {
  currencySchema,
  frozenGrowthProjectionSchema,
  GROWTH_SERIES_MAX_FACTS,
  revenueFactSchema,
  type FrozenGrowthProjection,
  type RevenueFact,
  type ScopePartition,
} from "@/domain/organizations/growth-progress";
import type {
  GrowthProgressReadPort,
  ProjectionReadEnvelope,
  ReadProjectionsInput,
  ReadRevenueFactsInput,
  RevenueFactsEnvelope,
} from "@/modules/organizations/application/growth-progress-ports";
import {
  readProjectionsInputSchema,
  readRevenueFactsInputSchema,
} from "@/modules/organizations/application/growth-progress-ports";
import {
  assertComparableGrowthScope,
  GrowthScopeError,
} from "@/modules/organizations/application/growth-projection-builder";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Session-only growth reads (data contract D05/D07).
 *
 * Like a librarian fetching only the borrower's own reserved slips: the
 * passed session client stays the boundary on every query, so RLS plus an
 * explicit organization predicate scope each read. A missing projection, a
 * corrupt one, a locked door and a failed fetch are four different answers —
 * never laundered into an empty "no data".
 *
 * The existing aggregate reader is untouched: it discards the branch,
 * dimension and row identities this comparison must keep until its arithmetic
 * is complete.
 */

type SessionClient = SupabaseClient<Database>;

const REVENUE_GROSS_KEY = "revenue.gross";
const FACT_PAGE_SIZE = 500;
/** Raw-page brake far above the admitted-fact cap; hitting it reports truncation. */
const FACT_MAX_PAGES_PER_TABLE = 22;
const FETCH_WIDENING_DAYS = 2;
const MS_PER_DAY = 86_400_000;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;

const PROJECTION_COLUMNS =
  "id,organization_id,schedule_origin_date,cycle_index,horizon_months,period_start,period_end_exclusive,issued_at,source_cutoff_date,timezone,currency,metric_key,scope_digest,input_digest,document_version,method_version,requires_growth_read,requires_campaign_read,frozen_document,created_at";

const NORMALIZED_COLUMNS =
  "id,organization_id,branch_id,channel_id,metric_definition_id,value_kind,dimensions,period_start,period_end,period_timezone,value_numerator,currency,quality_tier,revision,superseded_by_id,reconciliation_state,reconciliation_digest,created_at";

const EXACT_RANGE_COLUMNS =
  "id,organization_id,branch_id,channel_id,metric_definition_id,value_kind,period_start,period_end,period_timezone,value_numerator,currency,quality_state,completeness_state,revision,superseded_by_id,reconciliation_state,reconciliation_digest,created_at";

const failedProjection = (): ProjectionReadEnvelope => ({
  status: "failed",
  reason: "SOURCE_READ_FAILED",
});

const failedFacts = (): RevenueFactsEnvelope => ({
  status: "failed",
  reason: "SOURCE_READ_FAILED",
});

/**
 * Membership probe through the member-gated organizations row.
 *
 * RLS hides other tenants' rows rather than refusing, so an empty answer
 * here means "no membership" (or a nonexistent organization, which is
 * deliberately indistinguishable). `private.is_organization_member` is not
 * callable over PostgREST, so this row read is the session-safe probe.
 */
async function hasOrganizationAccess(
  supabase: SessionClient,
  organizationId: string,
): Promise<"ok" | "denied" | "failed"> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .limit(1)
    .maybeSingle();
  if (error) return "failed";
  if (!data) return "denied";
  return "ok";
}

function corruptProjection(): ProjectionReadEnvelope {
  return { status: "corrupt", reason: "PROJECTION_CORRUPT" };
}

type StoredProjectionRow = {
  id: string;
  organization_id: string;
  schedule_origin_date: string;
  cycle_index: number;
  horizon_months: number;
  period_start: string;
  period_end_exclusive: string;
  issued_at: string;
  source_cutoff_date: string;
  timezone: string;
  currency: string;
  metric_key: string;
  scope_digest: string;
  input_digest: string;
  document_version: number;
  method_version: string;
  requires_growth_read: boolean;
  requires_campaign_read: boolean;
  frozen_document: unknown;
  created_at: string;
};

function toValidProjection(row: StoredProjectionRow): FrozenGrowthProjection | null {
  const parsed = frozenGrowthProjectionSchema.safeParse(row.frozen_document);
  if (!parsed.success) return null;
  const document = parsed.data;
  // Column/JSON consistency: a row whose envelope disagrees with its frozen
  // document is corrupt, never repaired on read.
  if (
    document.organizationId !== row.organization_id ||
    document.horizonMonths !== row.horizon_months ||
    document.cycleIndex !== row.cycle_index ||
    document.startDate !== row.period_start ||
    document.endDateExclusive !== row.period_end_exclusive ||
    document.currency !== row.currency ||
    document.timeZone !== row.timezone ||
    row.metric_key !== REVENUE_GROSS_KEY ||
    !HEX64_PATTERN.test(row.input_digest)
  ) {
    return null;
  }
  return document;
}

async function readProjections(
  supabase: SessionClient,
  rawInput: ReadProjectionsInput,
): Promise<ProjectionReadEnvelope> {
  const parsed = readProjectionsInputSchema.safeParse(rawInput);
  if (!parsed.success) return failedProjection();
  const input = parsed.data;

  const access = await hasOrganizationAccess(supabase, input.organizationId);
  if (access === "denied") return { status: "denied", reason: "PERMISSION_DENIED" };
  if (access === "failed") return failedProjection();

  const { data, error } = await supabase
    .from("organization_growth_projections")
    .select(PROJECTION_COLUMNS)
    .eq("organization_id", input.organizationId)
    .gt("period_end_exclusive", input.asOfDate)
    .order("period_start", { ascending: true })
    .limit(8);
  if (error || !data) return failedProjection();
  if (data.length === 0) return { status: "missing", reason: "PROJECTION_MISSING" };

  const valid: FrozenGrowthProjection[] = [];
  for (const row of data as StoredProjectionRow[]) {
    const document = toValidProjection(row);
    if (!document) return corruptProjection();
    valid.push(document);
  }
  // At most the active-or-upcoming row per horizon: the earliest start wins.
  const byHorizon = new Map<number, FrozenGrowthProjection>();
  for (const document of valid) {
    const current = byHorizon.get(document.horizonMonths);
    if (!current || document.startDate < current.startDate) {
      byHorizon.set(document.horizonMonths, document);
    }
  }
  const projections = [...byHorizon.values()].sort(
    (left, right) => left.horizonMonths - right.horizonMonths,
  );
  return { status: "ready", projections };
}

type MetricEligibility = { definitionId: string } | { none: true } | { failed: true };

async function resolveRevenueDefinition(
  supabase: SessionClient,
  organizationId: string,
): Promise<MetricEligibility> {
  // Shared vocabulary carries no organization; a custom key carries this one.
  // The organization's own row wins, mirroring the metric series repository —
  // even an inactive override shadows shared vocabulary rather than falling
  // through to it. Money travels in integer minor units by convention (the
  // seed stores unit null), so the registry gate is active money-kind with
  // sum aggregation, and the integer shape is verified on every row below.
  const { data, error } = await supabase
    .from("metric_definitions")
    .select("id,key,value_kind,aggregation,is_active,organization_id")
    .eq("key", REVENUE_GROSS_KEY)
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .limit(3);
  if (error || !data) return { failed: true };
  if (data.length > 2) return { failed: true };
  const effective =
    data.find((row) => row.organization_id === organizationId) ??
    data.find((row) => row.organization_id === null) ??
    null;
  if (
    !effective ||
    !effective.is_active ||
    effective.value_kind !== "money" ||
    effective.aggregation !== "sum"
  ) {
    return { none: true };
  }
  return { definitionId: effective.id };
}

async function verifyScopeTenancy(
  supabase: SessionClient,
  organizationId: string,
  partitions: readonly ScopePartition[],
  definitionId: string,
): Promise<"ok" | "failed"> {
  // Cross-tenant channel, branch and metric references are rejected at this
  // boundary, mirroring publication: a foreign id matches no local row, so a
  // miss here is a scope refusal raised by the caller, not a read failure.
  for (const partition of partitions) {
    if (partition.metricDefinitionId !== definitionId) {
      throw new GrowthScopeError("The scope names a metric outside this comparison.");
    }
  }
  const channelIds = [...new Set(partitions.map((p) => p.channelId).filter((id) => id !== null))];
  const branchIds = [...new Set(partitions.map((p) => p.branchId).filter((id) => id !== null))];
  if (channelIds.length > 0) {
    const { data, error } = await supabase
      .from("organization_channels")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", channelIds)
      .limit(channelIds.length + 1);
    if (error || !data) return "failed";
    if (data.length !== channelIds.length) {
      throw new GrowthScopeError("The scope names a channel outside this organization.");
    }
  }
  if (branchIds.length > 0) {
    const { data, error } = await supabase
      .from("branches")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", branchIds)
      .limit(branchIds.length + 1);
    if (error || !data) return "failed";
    if (data.length !== branchIds.length) {
      throw new GrowthScopeError("The scope names a branch outside this organization.");
    }
  }
  return "ok";
}

function toSafeAmount(value: number | string): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function hasEmptyDimensions(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

/** True only for an instant at a local-midnight boundary in its own zone. */
function isLocalMidnight(instant: string, timeZone: string): boolean {
  const epoch = Date.parse(instant);
  if (Number.isNaN(epoch)) return false;
  try {
    const rendered = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(epoch));
    return rendered === "00:00:00";
  } catch {
    return false;
  }
}

function sliceIsoDate(value: string): string | null {
  const date = value.slice(0, 10);
  return isoDateSchema.safeParse(date).success ? date : null;
}

function matchPartition(
  partitions: readonly ScopePartition[],
  coords: {
    channelId: string | null;
    branchId: string | null;
    metricDefinitionId: string;
    periodTimezone: string;
  },
): ScopePartition | null {
  return (
    partitions.find(
      (partition) =>
        partition.channelId === coords.channelId &&
        partition.branchId === coords.branchId &&
        partition.metricDefinitionId === coords.metricDefinitionId &&
        partition.periodTimezone === coords.periodTimezone,
    ) ?? null
  );
}

function toCurrency(value: unknown): string | null {
  const parsed = currencySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type NormalizedRow = {
  id: string;
  organization_id: string;
  branch_id: string | null;
  channel_id: string | null;
  metric_definition_id: string;
  value_kind: string;
  dimensions: unknown;
  period_start: string;
  period_end: string;
  period_timezone: string;
  value_numerator: number | string;
  currency: string | null;
  quality_tier: string;
  revision: number;
  superseded_by_id: string | null;
  reconciliation_state: string;
  reconciliation_digest: string | null;
  created_at: string;
};

function toPeriodFact(
  row: NormalizedRow,
  partitions: readonly ScopePartition[],
  window: { from: string; toExclusive: string },
): RevenueFact | null {
  // Qualification mirrors the publication gates: current standing, a digest,
  // measured-or-derived quality, money kind, integer minor units and a real
  // currency. Anything less is excluded — absence downstream reads as a gap,
  // never as zero.
  if (row.superseded_by_id !== null || row.reconciliation_state !== "current") return null;
  if (!row.reconciliation_digest) return null;
  if (row.quality_tier !== "measured" && row.quality_tier !== "derived") return null;
  if (row.value_kind !== "money") return null;
  if (!hasEmptyDimensions(row.dimensions)) return null;
  const amountMinor = toSafeAmount(row.value_numerator);
  const currency = toCurrency(row.currency);
  if (amountMinor === null || currency === null) return null;
  let startDate: string;
  let endDateExclusive: string;
  try {
    if (!isLocalMidnight(row.period_start, row.period_timezone)) return null;
    if (!isLocalMidnight(row.period_end, row.period_timezone)) return null;
    startDate = toCalendarDate(new Date(row.period_start), row.period_timezone);
    endDateExclusive = toCalendarDate(new Date(row.period_end), row.period_timezone);
  } catch {
    return null;
  }
  // Rows crossing the window edges are never clipped into it.
  if (startDate < window.from || endDateExclusive > window.toExclusive) return null;
  const partition = matchPartition(partitions, {
    channelId: row.channel_id,
    branchId: row.branch_id,
    metricDefinitionId: row.metric_definition_id,
    periodTimezone: row.period_timezone,
  });
  if (!partition) return null;
  const fact = {
    sourceTable: "normalized_metrics" as const,
    rowId: row.id,
    organizationId: row.organization_id,
    partitionKey: partition.partitionKey,
    startDate,
    endDateExclusive,
    amountMinor,
    currency,
    createdAt: row.created_at,
    reconciliationDigest: row.reconciliation_digest,
  };
  return revenueFactSchema.safeParse(fact).success ? fact : null;
}

type ExactRangeRow = {
  id: string;
  organization_id: string;
  branch_id: string | null;
  channel_id: string | null;
  metric_definition_id: string;
  value_kind: string;
  period_start: string;
  period_end: string;
  period_timezone: string;
  value_numerator: number | string;
  currency: string | null;
  quality_state: string;
  completeness_state: string;
  revision: number;
  superseded_by_id: string | null;
  reconciliation_state: string;
  reconciliation_digest: string | null;
  created_at: string;
};

function toSpanFact(
  row: ExactRangeRow,
  partitions: readonly ScopePartition[],
  window: { from: string; toExclusive: string },
): RevenueFact | null {
  // Exact-range eligibility follows its own contract — quality_state plus
  // completeness_state plus reconciliation_state. There is no quality_tier
  // column on this table, and none is guessed here. Branch and channel are
  // always set on span observations, so a null in either is unusable.
  if (row.superseded_by_id !== null || row.reconciliation_state !== "current") return null;
  if (!row.reconciliation_digest) return null;
  if (row.quality_state !== "complete" || row.completeness_state !== "complete") return null;
  if (row.value_kind !== "money") return null;
  if (row.branch_id === null || row.channel_id === null) return null;
  if (!row.period_timezone) return null;
  const amountMinor = toSafeAmount(row.value_numerator);
  const currency = toCurrency(row.currency);
  const startDate = sliceIsoDate(row.period_start);
  const endInclusive = sliceIsoDate(row.period_end);
  if (amountMinor === null || currency === null || startDate === null || endInclusive === null) {
    return null;
  }
  // Inclusive stored end dates arrive end-exclusive internally.
  const endDateExclusive = addLocalDays(endInclusive, 1);
  if (startDate < window.from || endDateExclusive > window.toExclusive) return null;
  const partition = matchPartition(partitions, {
    channelId: row.channel_id,
    branchId: row.branch_id,
    metricDefinitionId: row.metric_definition_id,
    periodTimezone: row.period_timezone,
  });
  if (!partition) return null;
  const fact = {
    sourceTable: "exact_range_metric_observations" as const,
    rowId: row.id,
    organizationId: row.organization_id,
    partitionKey: partition.partitionKey,
    startDate,
    endDateExclusive,
    amountMinor,
    currency,
    createdAt: row.created_at,
    reconciliationDigest: row.reconciliation_digest,
  };
  return revenueFactSchema.safeParse(fact).success ? fact : null;
}

async function readRevenueFacts(
  supabase: SessionClient,
  rawInput: ReadRevenueFactsInput,
): Promise<RevenueFactsEnvelope> {
  const parsed = readRevenueFactsInputSchema.safeParse(rawInput);
  if (!parsed.success) return failedFacts();
  const input = parsed.data;
  if (input.from >= input.toExclusive) return failedFacts();

  const access = await hasOrganizationAccess(supabase, input.organizationId);
  if (access === "denied") return { status: "denied", reason: "PERMISSION_DENIED" };
  if (access === "failed") return failedFacts();

  // Unresolvable scopes throw rather than returning a partial envelope: the
  // caller maps SCOPE_NOT_COMPARABLE to its own unavailable state.
  assertComparableGrowthScope(input.scopePartitions);

  const registry = await resolveRevenueDefinition(supabase, input.organizationId);
  if ("failed" in registry) return failedFacts();
  if ("none" in registry) return { status: "ready", facts: [] };

  const tenancy = await verifyScopeTenancy(
    supabase,
    input.organizationId,
    input.scopePartitions,
    registry.definitionId,
  );
  if (tenancy === "failed") return failedFacts();

  // The fetch window widens past the widest UTC offset in use; the exact
  // calendar-day check per row's own timezone still decides what counts.
  const fetchStart = new Date(
    Date.parse(`${input.from}T00:00:00Z`) - FETCH_WIDENING_DAYS * MS_PER_DAY,
  ).toISOString();
  const fetchEndExclusive = new Date(
    Date.parse(`${input.toExclusive}T00:00:00Z`) + FETCH_WIDENING_DAYS * MS_PER_DAY,
  ).toISOString();
  const window = { from: input.from, toExclusive: input.toExclusive };
  const facts: RevenueFact[] = [];

  const page = async (table: "normalized_metrics" | "exact_range_metric_observations") => {
    for (let pageIndex = 0; pageIndex < FACT_MAX_PAGES_PER_TABLE; pageIndex += 1) {
      const from = pageIndex * FACT_PAGE_SIZE;
      const to = from + FACT_PAGE_SIZE - 1;
      // One branch per ledger: their filter vocabularies differ by design —
      // exact-range rows carry quality_state/completeness_state and no
      // quality_tier, so a shared typed query cannot even name the columns.
      const outcome =
        table === "normalized_metrics"
          ? await supabase
              .from("normalized_metrics")
              .select(NORMALIZED_COLUMNS)
              .eq("organization_id", input.organizationId)
              .eq("metric_definition_id", registry.definitionId)
              .is("superseded_by_id", null)
              .eq("reconciliation_state", "current")
              .not("reconciliation_digest", "is", null)
              .eq("value_kind", "money")
              .not("currency", "is", null)
              .in("quality_tier", ["measured", "derived"])
              .gte("period_start", fetchStart)
              .lt("period_start", fetchEndExclusive)
              .order("period_start", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          : await supabase
              .from("exact_range_metric_observations")
              .select(EXACT_RANGE_COLUMNS)
              .eq("organization_id", input.organizationId)
              .eq("metric_definition_id", registry.definitionId)
              .is("superseded_by_id", null)
              .eq("reconciliation_state", "current")
              .not("reconciliation_digest", "is", null)
              .eq("value_kind", "money")
              .not("currency", "is", null)
              .eq("quality_state", "complete")
              .eq("completeness_state", "complete")
              .gte("period_start", fetchStart)
              .lt("period_start", fetchEndExclusive)
              .order("period_start", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to);
      const { data, error } = outcome;
      if (error || !data) return failedFacts();
      const rows = data as unknown as Array<NormalizedRow & ExactRangeRow>;
      for (const row of rows) {
        const fact =
          table === "normalized_metrics"
            ? toPeriodFact(row, input.scopePartitions, window)
            : toSpanFact(row, input.scopePartitions, window);
        if (fact) {
          facts.push(fact);
          if (facts.length > GROWTH_SERIES_MAX_FACTS) {
            return { status: "limited", reason: "SOURCE_LIMIT_EXCEEDED" } as RevenueFactsEnvelope;
          }
        }
      }
      if (rows.length < FACT_PAGE_SIZE) return null;
    }
    return { status: "limited", reason: "SOURCE_LIMIT_EXCEEDED" } as RevenueFactsEnvelope;
  };

  const periodOutcome = await page("normalized_metrics");
  if (periodOutcome) return periodOutcome;
  const spanOutcome = await page("exact_range_metric_observations");
  if (spanOutcome) return spanOutcome;
  return { status: "ready", facts };
}

/** Session-only growth reads bound to the caller's own client. Never the service role. */
export function createGrowthProgressRepository(supabase: SessionClient): GrowthProgressReadPort {
  return {
    readProjections: (input) => readProjections(supabase, input),
    readRevenueFacts: (input) => readRevenueFacts(supabase, input),
  };
}
