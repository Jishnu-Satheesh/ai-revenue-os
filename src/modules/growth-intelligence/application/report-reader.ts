import { z } from "zod";

import {
  briefRevisionSchema,
  type BriefRevision,
} from "@/domain/growth-intelligence/brief";
import {
  marketMonitoringReportSchema,
  type MarketMonitoringReport,
} from "@/domain/growth-intelligence/report";
import { resolveDraftItemDestination } from "@/domain/growth-intelligence/acceptance";
import { DomainError } from "@/lib/errors";

/**
 * Market Monitoring report reader assembly (Slice 5).
 *
 * The reader dialog and the PDF download are two presentations of one
 * assembled report version: a report row plus its pinned brief revision
 * plus the evidence digest. Both routes load through
 * `loadAssembledReportView`, so opening a history entry always resolves the
 * exact pinned version even after later brief edits, and changing page
 * filters never changes an opened report (the dialog is keyed by
 * reportVersionId only).
 *
 * Reads only: this module never writes, never triggers work, and never
 * calls a provider. Acceptance writes belong to Slice 6 — draft advice
 * renders here as local selection state only.
 */

export const REPORT_READER_SECTIONS = [
  { key: "summary", label: "Summary" },
  { key: "competitors", label: "Competitors" },
  { key: "opportunity", label: "Local opportunity" },
  { key: "advice", label: "Draft advice" },
  { key: "sources", label: "Sources" },
] as const;

export type ReportReaderSectionKey = (typeof REPORT_READER_SECTIONS)[number]["key"];

const INVESTIGATION_AREA_LABELS: Record<string, string> = {
  demand: "Local demand",
  presence: "Competitor presence",
  offers: "Offers",
  reviews: "Reviews",
  observable_performance: "Observable performance",
};

export function investigationAreaLabel(area: string): string {
  return INVESTIGATION_AREA_LABELS[area] ?? area;
}

export function briefCompetitorSourceLabel(source: string): string {
  return source === "operator_lead" ? "Verified lead" : "Suggestion";
}

export type ReportReaderCitation = {
  findingKey: string;
  sourceRef: string;
};

export type AssembledReportSource = {
  sourceRef: string;
  url: string | null;
  retrievedAtUtc: string | null;
  /**
   * A source without a retrievable location renders the retained
   * "Source evidence no longer available" state with its id kept, never a
   * guessed replacement. Liveness re-checks belong to Slice 7.
   */
  available: boolean;
};

export type AssembledReportView = {
  identity: {
    reportId: string;
    reportVersionId: string;
    projectId: string;
    projectTitle: string;
    projectQuestion: string;
    locationId: string;
    locationName: string;
    briefRevisionId: string;
    briefRevisionNumber: number;
    evidenceDigest: string;
    /** ISO timestamp of the persisted report row (UTC storage). */
    reportCreatedAt: string;
    /** Deterministic UTC day label used by the PDF identity line. */
    reportDateUtcLabel: string;
    reviewState: "pending_review" | "accepted";
    plainLanguageRequired: boolean;
  };
  brief: {
    question: string;
    title: string | null;
    eventDate: string | null;
    researchArea: string;
    competitors: {
      name: string;
      website: string | null;
      locationHint: string | null;
      source: string;
      sourceLabel: string;
    }[];
    investigationAreas: { key: string; label: string }[];
    evidencePeriods: { label: string }[];
    frequency: string;
  };
  summary: string;
  localMeaning: string;
  findings: {
    key: string;
    statement: string;
    /** Deduplicated source refs in slot order; unknown refs render inert. */
    citations: string[];
  }[];
  competitorComparison: {
    competitorName: string;
    summary: string;
    citations: string[];
  }[];
  speculativeEstimate: {
    label: string;
    rangeText: string;
    assumptions: string[];
    reasoning: string;
  } | null;
  gaps: { key: string; description: string }[];
  draftAdvice: {
    itemKey: string;
    kind: "action" | "finding";
    title: string;
    detail: string;
    destinationLabel: string;
  }[];
  sources: AssembledReportSource[];
};

export type ReportVersionRowInput = {
  reportId: string;
  reportVersionId: string;
  organizationId: string;
  projectId: string;
  branchId: string;
  briefRevisionId: string;
  evidenceDigest: string;
  content: unknown;
  reviewState: string;
  createdAt: string;
};

export type BriefRevisionRowInput = {
  revisionId: string;
  organizationId: string;
  projectId: string;
  revisionNumber: number;
  document: unknown;
  createdAt: string;
};

export type ReaderProjectInput = {
  projectId: string;
  organizationId: string;
  branchId: string;
  title: string;
  question: string;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function utcDayLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("DOMAIN_ERROR", "This report date could not be read.");
  }
  return `${parsed.getUTCDate()} ${MONTH_LABELS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/** Minor-unit range to "AED 45,000–70,000". No conversion, no rounding of intent. */
export function formatSpeculativeRange(input: {
  lowMinorUnits: number;
  highMinorUnits: number;
  currency: string;
}): string {
  const format = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 });
  return `${input.currency} ${format.format(input.lowMinorUnits / 100)}–${format.format(input.highMinorUnits / 100)}`;
}

/** "Prepare for National Day" to "Prepare-for-National-Day.pdf". */
export function reportDownloadFilename(title: string): string {
  const slug = title
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug.length > 0 ? slug : "research-report"}.pdf`;
}

export function reportReaderPath(organizationId: string, reportVersionId: string): string {
  return `/api/organizations/${organizationId}/growth-intelligence/monitoring/reports/${reportVersionId}`;
}

export function reportDownloadPath(organizationId: string, reportVersionId: string): string {
  return `${reportReaderPath(organizationId, reportVersionId)}/download`;
}

function dedupeRefs(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    refs.push(value);
  }
  return refs;
}

function pinFailure(): never {
  throw new DomainError(
    "DOMAIN_ERROR",
    "This report was pinned to another project, location, or brief revision.",
  );
}

/**
 * Assemble one reader view from its pinned rows. Every pin is rechecked:
 * the content's organization, project, location, brief revision and
 * evidence digest must match the rows that carried them, and the brief
 * document must name the same organization and project. Estimate honesty
 * (label + assumptions + reasoning together, never partial) is enforced by
 * the domain schema at parse time.
 */
export function assembleReportReader(input: {
  organizationId: string;
  reportRow: ReportVersionRowInput;
  briefRow: BriefRevisionRowInput;
  project: ReaderProjectInput;
  branchName: string | null;
}): AssembledReportView {
  const { organizationId, reportRow, briefRow, project, branchName } = input;

  if (
    reportRow.organizationId !== organizationId ||
    project.organizationId !== organizationId ||
    briefRow.organizationId !== organizationId
  ) {
    throw new DomainError(
      "TENANT_SCOPE_ERROR",
      "This report could not be found in your organization.",
    );
  }
  if (reportRow.projectId !== project.projectId || briefRow.projectId !== project.projectId) {
    pinFailure();
  }
  if (reportRow.branchId !== project.branchId) pinFailure();
  if (reportRow.briefRevisionId !== briefRow.revisionId) pinFailure();

  const content = marketMonitoringReportSchema.safeParse(reportRow.content);
  if (!content.success) {
    throw new DomainError("DOMAIN_ERROR", "This report could not be read.");
  }
  const report: MarketMonitoringReport = content.data;
  if (report.organizationId !== organizationId) {
    throw new DomainError(
      "TENANT_SCOPE_ERROR",
      "This report could not be found in your organization.",
    );
  }
  if (
    report.projectId !== reportRow.projectId ||
    report.locationId !== reportRow.branchId ||
    report.briefRevisionId !== reportRow.briefRevisionId ||
    report.reportVersionId !== reportRow.reportVersionId ||
    report.evidenceDigest !== reportRow.evidenceDigest
  ) {
    pinFailure();
  }

  const briefDocument = briefRevisionSchema.safeParse(briefRow.document);
  if (!briefDocument.success) {
    throw new DomainError("DOMAIN_ERROR", "The brief revision behind this report could not be read.");
  }
  const brief: BriefRevision = briefDocument.data;
  if (
    brief.organizationId !== organizationId ||
    brief.projectId !== reportRow.projectId ||
    brief.revisionNumber !== briefRow.revisionNumber
  ) {
    pinFailure();
  }

  const reviewState = z.enum(["pending_review", "accepted"]).safeParse(reportRow.reviewState);
  if (!reviewState.success) {
    throw new DomainError("DOMAIN_ERROR", "This report could not be read.");
  }

  return {
    identity: {
      reportId: reportRow.reportId,
      reportVersionId: reportRow.reportVersionId,
      projectId: reportRow.projectId,
      projectTitle: project.title,
      projectQuestion: project.question,
      locationId: reportRow.branchId,
      locationName: branchName ?? reportRow.branchId,
      briefRevisionId: reportRow.briefRevisionId,
      briefRevisionNumber: briefRow.revisionNumber,
      evidenceDigest: reportRow.evidenceDigest,
      reportCreatedAt: reportRow.createdAt,
      reportDateUtcLabel: utcDayLabel(reportRow.createdAt),
      reviewState: reviewState.data,
      plainLanguageRequired: report.plainLanguageRequired,
    },
    brief: {
      question: brief.question,
      title: brief.title ?? null,
      eventDate: brief.eventDate ?? null,
      researchArea: brief.researchArea,
      competitors: brief.competitors.map((competitor) => ({
        name: competitor.name,
        website: competitor.website ?? null,
        locationHint: competitor.locationHint ?? null,
        source: competitor.source,
        sourceLabel: briefCompetitorSourceLabel(competitor.source),
      })),
      investigationAreas: brief.investigationAreas.map((area) => ({
        key: area,
        label: investigationAreaLabel(area),
      })),
      evidencePeriods: brief.evidencePeriods.map((period) => ({ label: period.label })),
      frequency: brief.frequency,
    },
    summary: report.summary,
    localMeaning: report.localMeaning,
    findings: report.findings.map((finding) => ({
      key: finding.key,
      statement: finding.statement,
      // Kept verbatim in slot order: a ref without a source record renders
      // as inert text in the reader, never as a jump to nowhere.
      citations: dedupeRefs(finding.citationSlots.map((slot) => slot.sourceRef)),
    })),
    competitorComparison: report.competitorComparison.map((entry) => ({
      competitorName: entry.competitorName,
      summary: entry.summary,
      citations: dedupeRefs((entry.citationSlots ?? []).map((slot) => slot.sourceRef)),
    })),
    speculativeEstimate: report.speculativeEstimate
      ? {
          label: report.speculativeEstimate.label,
          rangeText: formatSpeculativeRange(report.speculativeEstimate.range),
          assumptions: [...report.speculativeEstimate.assumptions],
          reasoning: report.speculativeEstimate.reasoning,
        }
      : null,
    gaps: report.gaps.map((gap) => ({ key: gap.key, description: gap.description })),
    draftAdvice: report.draftAdvice.map((advice) => ({
      itemKey: advice.itemKey,
      kind: advice.kind,
      title: advice.title,
      detail: advice.detail,
      destinationLabel: resolveDraftItemDestination(advice.kind),
    })),
    sources: report.sources.map((source) => ({
      sourceRef: source.sourceRef,
      url: source.url ?? null,
      retrievedAtUtc: source.retrievedAtUtc ?? null,
      available: Boolean(source.url),
    })),
  };
}

/**
 * The canonical text model shared by the reader and the PDF parity checks:
 * identity, findings, assumptions, advice and sources in one deterministic
 * string. The PDF renderer must carry every one of these lines.
 */
export function extractReaderText(view: AssembledReportView): string {
  const lines: string[] = [
    view.identity.projectTitle,
    `Brief ${view.identity.briefRevisionNumber}`,
    `Report ${view.identity.reportDateUtcLabel}`,
    view.identity.locationName,
    view.identity.evidenceDigest,
    view.summary,
    view.localMeaning,
    view.brief.question,
    ...view.findings.flatMap((finding) => [finding.statement, ...finding.citations]),
    ...view.gaps.map((gap) => gap.description),
    ...view.competitorComparison.flatMap((entry) => [
      entry.competitorName,
      entry.summary,
      ...entry.citations,
    ]),
    ...(view.speculativeEstimate
      ? [
          view.speculativeEstimate.label,
          view.speculativeEstimate.rangeText,
          ...view.speculativeEstimate.assumptions,
          view.speculativeEstimate.reasoning,
        ]
      : []),
    ...view.draftAdvice.flatMap((advice) => [advice.title, advice.detail]),
    ...view.sources.flatMap((source) => [source.sourceRef, source.url ?? ""]),
  ];
  return lines.join("\n");
}

type ReportReaderQueryBuilder<T> = {
  select(columns: string): ReportReaderQueryBuilder<T>;
  eq(column: string, value: unknown): ReportReaderQueryBuilder<T>;
  maybeSingle(): Promise<{ data: T; error: unknown }>;
};

export type ReportReaderPersistence = {
  from(table: string): ReportReaderQueryBuilder<unknown>;
};

function query<T>(persistence: ReportReaderPersistence, table: string): ReportReaderQueryBuilder<T> {
  return persistence.from(table) as ReportReaderQueryBuilder<T>;
}

const reportRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    project_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    brief_revision_id: z.string().uuid(),
    report_version_id: z.string().uuid(),
    evidence_digest: z.string().min(1),
    content: z.unknown(),
    review_state: z.string(),
    created_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

const briefRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    project_id: z.string().uuid(),
    revision_number: z.number().int(),
    document: z.unknown(),
    created_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

const projectRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    title: z.string(),
    question: z.string(),
  })
  .passthrough();

const branchRowSchema = z.object({ id: z.string().uuid(), name: z.string() }).passthrough();

const REPORT_COLUMNS =
  "id,organization_id,project_id,branch_id,brief_revision_id,report_version_id,evidence_digest,content,review_state,created_at";
const BRIEF_COLUMNS = "id,organization_id,project_id,revision_number,document,created_at";
const PROJECT_COLUMNS = "id,organization_id,branch_id,title,question";

function notFound(): never {
  throw new DomainError(
    "TENANT_SCOPE_ERROR",
    "This report could not be found in your organization.",
  );
}

function unreadable(scope: string): never {
  throw new DomainError("DOMAIN_ERROR", `This ${scope} could not be read.`);
}

/**
 * Load one assembled report version through the signed-in persistence. The
 * report row names its brief revision explicitly, so a history entry keeps
 * opening that exact revision after later brief edits — the latest revision
 * is never substituted in. Every select pins the organization id; a foreign
 * report reads as not-found, never as another organization's content.
 */
export async function loadAssembledReportView(
  persistence: ReportReaderPersistence,
  input: { organizationId: string; reportVersionId: string; branchId?: string },
): Promise<AssembledReportView> {
  const parsed = z
    .object({
      organizationId: z.string().uuid(),
      reportVersionId: z.string().uuid(),
      branchId: z.string().uuid().optional(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "The report lookup could not be understood.");
  }
  const { organizationId, reportVersionId } = parsed.data;

  const reportResult = await query<Record<string, unknown> | null>(
    persistence,
    "growth_intelligence_reports",
  )
    .select(REPORT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("report_version_id", reportVersionId)
    .maybeSingle();
  if (reportResult.error) unreadable("report");
  if (!reportResult.data) notFound();
  const reportRow = reportRowSchema.safeParse(reportResult.data);
  if (!reportRow.success) unreadable("report");
  const report = reportRow.data;

  if (parsed.data.branchId !== undefined && report.branch_id !== parsed.data.branchId) {
    notFound();
  }

  const [briefResult, projectResult, branchResult] = await Promise.all([
    query<Record<string, unknown> | null>(persistence, "growth_intelligence_brief_revisions")
      .select(BRIEF_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", report.brief_revision_id)
      .maybeSingle(),
    query<Record<string, unknown> | null>(persistence, "growth_intelligence_research_projects")
      .select(PROJECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", report.project_id)
      .maybeSingle(),
    query<Record<string, unknown> | null>(persistence, "branches")
      .select("id,name")
      .eq("organization_id", organizationId)
      .eq("id", report.branch_id)
      .maybeSingle(),
  ]);
  if (briefResult.error || projectResult.error || branchResult.error) unreadable("report");
  if (!briefResult.data) {
    throw new DomainError(
      "DOMAIN_ERROR",
      "The brief revision behind this report could not be read.",
    );
  }
  if (!projectResult.data) unreadable("report");
  const brief = briefRowSchema.safeParse(briefResult.data);
  const project = projectRowSchema.safeParse(projectResult.data);
  if (!brief.success || !project.success) unreadable("report");
  const branch = branchRowSchema.safeParse(branchResult.data);

  return assembleReportReader({
    organizationId,
    reportRow: {
      reportId: report.id,
      reportVersionId: report.report_version_id,
      organizationId: report.organization_id,
      projectId: report.project_id,
      branchId: report.branch_id,
      briefRevisionId: report.brief_revision_id,
      evidenceDigest: report.evidence_digest,
      content: report.content,
      reviewState: report.review_state,
      createdAt: report.created_at,
    },
    briefRow: {
      revisionId: brief.data.id,
      organizationId: brief.data.organization_id,
      projectId: brief.data.project_id,
      revisionNumber: brief.data.revision_number,
      document: brief.data.document,
      createdAt: brief.data.created_at,
    },
    project: {
      projectId: project.data.id,
      organizationId: project.data.organization_id,
      branchId: project.data.branch_id,
      title: project.data.title,
      question: project.data.question,
    },
    branchName: branch.success ? branch.data.name : null,
  });
}
