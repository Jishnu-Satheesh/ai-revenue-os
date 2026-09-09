const CANONICAL_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * The activity month from navigation. A canonical `YYYY-MM` selects which
 * month's activity history the workspace shows; anything else resolves to
 * null and the service falls back to the organization's current local month.
 * Month navigation never relabels an evidence period, so a refusal here is
 * the same view with a different month, never an error surface.
 */
export function parseWorkspaceMonth(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return CANONICAL_MONTH.test(value) ? value : null;
}

/** One activity month back, for history navigation. Pure calendar arithmetic. */
export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const part = Number(month.slice(5, 7));
  if (part === 1) return `${year - 1}-12`;
  return `${year}-${String(part - 1).padStart(2, "0")}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The research branch from navigation. A canonical UUID selects the branch
 * whose pipeline the observer follows; anything else resolves to null and
 * the research surfaces stay branchless rather than guessing a branch.
 */
export function parseResearchBranch(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID.test(value) ? value : null;
}

/** Poll cadence for an actively running research pipeline. */
export const RESEARCH_ACTIVE_POLL_MS = 5_000;
/** Backoff after a failed pipeline status read. */
export const RESEARCH_ERROR_BACKOFF_MS = 30_000;

const ACTIVE_PIPELINE_STAGES: ReadonlySet<string> = new Set([
  "queued",
  "researching",
  "preparing_insights",
]);

/** Active stages keep polling; terminal stages settle and stop. */
export function isActivePipelineStage(stage: string): boolean {
  return ACTIVE_PIPELINE_STAGES.has(stage);
}

/**
 * Stable observer key for pipeline reads. Organization, branch and pipeline
 * all travel in the key so one branch's response can never satisfy another
 * branch's read.
 */
export function researchQueryKey(
  organizationId: string,
  branchId: string | null,
  pipelineId: string | null = null,
): readonly string[] {
  return pipelineId === null
    ? (["growth-intelligence", "research", organizationId, branchId ?? "none"] as const)
    : ([
        "growth-intelligence",
        "research",
        organizationId,
        branchId ?? "none",
        pipelineId,
      ] as const);
}

/** Window event that opens the Review market monitoring dialog from any entry point. */
export const MARKET_MONITORING_OPEN_EVENT = "growth-intelligence:open-market-monitoring";

export function requestMarketMonitoringDialog(): void {
  window.dispatchEvent(new CustomEvent(MARKET_MONITORING_OPEN_EVENT));
}

/**
 * One-line summary of a branch service_area record for the Location
 * dropdown. Strings and string arrays join; anything else is skipped so an
 * unexpected record shape never breaks the selector.
 */
export function summarizeServiceArea(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object" && value !== null) {
    const parts = Object.values(value as Record<string, unknown>)
      .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return null;
}
