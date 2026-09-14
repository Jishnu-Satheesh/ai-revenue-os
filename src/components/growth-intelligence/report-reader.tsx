"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  REPORT_READER_SECTIONS,
  reportDownloadPath,
  type AssembledReportView,
  type ReportReaderSectionKey,
} from "@/modules/growth-intelligence/application/report-reader";

function formatReportDate(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function sectionLabel(key: ReportReaderSectionKey): string {
  return REPORT_READER_SECTIONS.find((section) => section.key === key)?.label ?? key;
}

export function ReportReaderSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 sm:p-7" aria-label="Loading report">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

function CitationButton({
  sourceRef,
  known,
  onOpenSource,
}: {
  sourceRef: string;
  known: boolean;
  onOpenSource: (sourceRef: string) => void;
}) {
  if (!known) return <span className="font-semibold">[{sourceRef}]</span>;
  return (
    <button
      type="button"
      aria-label={`See source ${sourceRef}`}
      onClick={() => onOpenSource(sourceRef)}
      className="font-semibold text-primary underline-offset-2 hover:underline"
    >
      [{sourceRef}]
    </button>
  );
}

/**
 * The readable report: section index, lead summary with local meaning
 * first, qualitative findings with inline citations into their source
 * records, competitor comparison, the labelled estimate block, gaps,
 * draft advice as local selection only, and sources.
 *
 * Selection never writes anywhere: acceptance and feed handoff arrive
 * with the review slice, so toggling a checkbox only counts locally.
 */
export function ReportReaderView({
  view,
  timeZone,
}: {
  view: AssembledReportView;
  timeZone: string;
}) {
  const [section, setSection] = useState<ReportReaderSectionKey>("summary");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [flashSource, setFlashSource] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const sourceRefs = useRef(new Map<string, HTMLElement>());
  const knownSources = new Set(view.sources.map((source) => source.sourceRef));
  const reportDate = formatReportDate(view.identity.reportCreatedAt, timeZone);

  const openSource = useCallback((sourceRef: string) => {
    setSection("sources");
    setFlashSource(sourceRef);
  }, []);

  useEffect(() => {
    if (flashSource === null) return;
    sourceRefs.current.get(flashSource)?.scrollIntoView?.({ block: "nearest" });
  }, [flashSource, section]);

  useEffect(() => {
    articleRef.current?.scrollTo?.({ top: 0 });
  }, [section]);

  function toggleSelection(key: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const identity = view.identity;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:grid lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav
        aria-label="Report sections"
        className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:p-3"
      >
        {REPORT_READER_SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-current={section === entry.key ? "page" : undefined}
            onClick={() => setSection(entry.key)}
            className={
              section === entry.key
                ? "shrink-0 rounded-md bg-muted px-3 py-2 text-left text-xs font-semibold whitespace-nowrap"
                : "shrink-0 rounded-md px-3 py-2 text-left text-xs text-muted-foreground whitespace-nowrap hover:bg-muted/60"
            }
          >
            {entry.label}
          </button>
        ))}
        <p className="mt-auto hidden px-3 pt-4 text-[11px] leading-relaxed text-muted-foreground lg:block">
          Brief {identity.briefRevisionNumber}
          <br />
          Report · {reportDate}
          <br />
          {identity.locationName}
        </p>
      </nav>

      <article
        ref={articleRef}
        aria-label={sectionLabel(section)}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-7"
      >
        {section === "summary" ? (
          <div className="flex min-w-0 flex-col">
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              The short version
            </p>
            <h3 className="mt-2 text-xl font-semibold">What matters for {identity.locationName}</h3>
            <p className="mt-3 max-w-prose text-sm leading-relaxed">{view.summary}</p>
            <h4 className="mt-5 text-sm font-semibold">What it means for {identity.locationName}</h4>
            <p className="mt-1 max-w-prose text-sm leading-relaxed">{view.localMeaning}</p>
            <div className="mt-5 border-l-2 border-primary pl-4">
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Your research question
              </p>
              <p className="mt-1 max-w-prose text-sm leading-relaxed">{view.brief.question}</p>
            </div>
            <h4 className="mt-6 text-sm font-semibold">Findings to keep in view</h4>
            <ol className="mt-1 flex min-w-0 flex-col">
              {view.findings.map((finding, index) => (
                <li
                  key={finding.key}
                  className="flex min-w-0 gap-3 border-b py-4 last:border-b-0"
                >
                  <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="min-w-0 text-sm break-words">
                      {finding.statement}{" "}
                      {finding.citations.map((ref) => (
                        <CitationButton
                          key={ref}
                          sourceRef={ref}
                          known={knownSources.has(ref)}
                          onOpenSource={openSource}
                        />
                      ))}
                    </p>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={selected.has(`finding:${finding.key}`)}
                        onChange={(event) =>
                          toggleSelection(`finding:${finding.key}`, event.target.checked)
                        }
                      />
                      Select finding for Insights
                    </label>
                  </div>
                </li>
              ))}
            </ol>
            {view.gaps.length > 0 ? (
              <div className="mt-4 rounded-lg bg-muted p-4">
                <p className="text-sm font-semibold">Where the evidence is incomplete</p>
                {view.gaps.map((gap) => (
                  <p key={gap.key} className="mt-1 min-w-0 text-sm text-muted-foreground break-words">
                    {gap.description}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {section === "competitors" ? (
          <div className="flex min-w-0 flex-col">
            <h3 className="text-xl font-semibold">Competitors &amp; their offers</h3>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              Compare the offer and customer experience. Public visibility is a signal, not proof
              of business performance.
            </p>
            <div className="mt-4 min-w-0 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="px-2 py-2 font-semibold">Competitor</th>
                    <th className="px-2 py-2 font-semibold">What we found</th>
                  </tr>
                </thead>
                <tbody>
                  {view.competitorComparison.map((entry) => (
                    <tr key={entry.competitorName} className="border-b align-top last:border-b-0">
                      <td className="min-w-0 px-2 py-3 font-semibold break-words">
                        {entry.competitorName}
                      </td>
                      <td className="min-w-0 px-2 py-3 text-muted-foreground break-words">
                        {entry.summary}{" "}
                        {entry.citations.map((ref) => (
                          <CitationButton
                            key={ref}
                            sourceRef={ref}
                            known={knownSources.has(ref)}
                            onOpenSource={openSource}
                          />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.speculativeEstimate ? (
              <div className="mt-6 rounded-lg border p-4 sm:p-5">
                <p className="inline-block rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                  Speculative estimate
                </p>
                <h4 className="mt-3 text-sm font-semibold">{view.speculativeEstimate.label}</h4>
                <p className="mt-1 text-2xl font-bold tracking-tight">
                  {view.speculativeEstimate.rangeText}{" "}
                  <span className="text-xs font-normal text-muted-foreground">per period</span>
                </p>
                <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
                  Speculative estimate, not reported revenue. These are assumed figures, not
                  measured competitor results, and sales before costs — never profit.
                </p>
                <details open className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold">
                    Assumptions behind this range
                  </summary>
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {view.speculativeEstimate.assumptions.map((assumption, index) => (
                      <li key={`${index}:${assumption.slice(0, 24)}`}>{assumption}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs font-semibold">Reasoning</p>
                  <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
                    {view.speculativeEstimate.reasoning}
                  </p>
                </details>
              </div>
            ) : null}
          </div>
        ) : null}

        {section === "opportunity" ? (
          <div className="flex min-w-0 flex-col">
            <h3 className="text-xl font-semibold">The local opportunity</h3>
            <p className="mt-3 max-w-prose text-sm leading-relaxed">{view.localMeaning}</p>
            <div className="mt-4 rounded-lg bg-muted p-4">
              <p className="text-sm font-semibold">Potential opportunity, not a promised result</p>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                The report proposes what to investigate. It does not claim that a campaign has
                earned revenue or profit.
              </p>
            </div>
          </div>
        ) : null}

        {section === "advice" ? (
          <div className="flex min-w-0 flex-col">
            <h3 className="text-xl font-semibold">Draft advice for your review</h3>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              Choose the ideas worth taking forward. Each one keeps its link to this report and
              supporting evidence.
            </p>
            {view.draftAdvice.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No draft advice was saved with this report.
              </p>
            ) : null}
            {view.draftAdvice.map((advice) => (
              <article
                key={advice.itemKey}
                className={
                  selected.has(`advice:${advice.itemKey}`)
                    ? "mt-3 rounded-lg border border-primary bg-primary/5 p-4"
                    : "mt-3 rounded-lg border p-4"
                }
              >
                <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0 accent-primary"
                    checked={selected.has(`advice:${advice.itemKey}`)}
                    onChange={(event) =>
                      toggleSelection(`advice:${advice.itemKey}`, event.target.checked)
                    }
                  />
                  <span className="min-w-0 break-words">{advice.title}</span>
                </label>
                <p className="mt-2 ml-6 min-w-0 text-sm leading-relaxed text-muted-foreground break-words">
                  {advice.detail}
                </p>
                <p className="mt-3 ml-6 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    Adds to {advice.destinationLabel}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5">Review required</span>
                </p>
              </article>
            ))}
            <div className="mt-4 rounded-lg bg-muted p-4">
              <p className="text-sm font-semibold">Your review comes first</p>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                These are draft ideas. Campaign approval, budget and publishing remain separate
                decisions.
              </p>
            </div>
          </div>
        ) : null}

        {section === "sources" ? (
          <div className="flex min-w-0 flex-col">
            <h3 className="text-xl font-semibold">Sources &amp; evidence</h3>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              Report date: {reportDate}. Evidence periods and source dates are shown separately
              below.
            </p>
            <p className="mt-1 text-xs text-muted-foreground break-all">
              Evidence digest: {identity.evidenceDigest}
            </p>
            {view.sources.map((source) => (
              <article
                key={source.sourceRef}
                ref={(element) => {
                  if (element) sourceRefs.current.set(source.sourceRef, element);
                  else sourceRefs.current.delete(source.sourceRef);
                }}
                data-testid={`reader-source-${source.sourceRef}`}
                className={
                  flashSource === source.sourceRef
                    ? "mt-2 rounded-lg bg-primary/10 p-3"
                    : "mt-2 border-b py-4 last:border-b-0"
                }
              >
                <h4 className="min-w-0 text-sm font-semibold break-words">[{source.sourceRef}]</h4>
                {source.available && source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 text-sm break-all text-primary underline-offset-2 hover:underline"
                  >
                    {source.url}
                  </a>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Source evidence no longer available. The reference [{source.sourceRef}] is
                    retained with the report.
                  </p>
                )}
                {source.retrievedAtUtc ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Retrieved {formatReportDate(source.retrievedAtUtc, timeZone)}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </article>

      <span className="sr-only" role="status">
        {selected.size === 0
          ? "Nothing selected for review."
          : `${selected.size} ${selected.size === 1 ? "item" : "items"} selected for review. Acceptance arrives with the review step.`}
      </span>
    </div>
  );
}

/**
 * Self-loading report dialog. The fetch is keyed by organization and report
 * version only: changing page filters never changes an opened report, and a
 * failed refresh keeps the last loaded report with its date on screen.
 */
export function ReportReaderDialog({
  organizationId,
  reportVersionId,
  open,
  onOpenChange,
  timeZone,
}: {
  organizationId: string;
  reportVersionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeZone: string;
}) {
  const [payload, setPayload] = useState<AssembledReportView | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [refreshError, setRefreshError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const loadedVersion = useRef<string | null>(null);
  const payloadRef = useRef<AssembledReportView | null>(null);

  // Closing resets the refresh cycle so the next open starts clean. State
  // settles during render (never in an effect), after the New research
  // dialog's draft-seed pattern. A retained payload for another version is
  // cleared so reopening never flashes the wrong report.
  const [closeSeed, setCloseSeed] = useState({ open, reportVersionId });
  if (closeSeed.open !== open || closeSeed.reportVersionId !== reportVersionId) {
    setCloseSeed({ open, reportVersionId });
    if (!open) {
      setReloadToken(0);
      setRefreshError(false);
      if (payload !== null && payload.identity.reportVersionId !== reportVersionId) {
        setPayload(null);
        setLoadState("idle");
      }
    }
  }

  // The fetch cycle reads the payload through a ref because the effect
  // deliberately ignores surrounding state. The ref syncs every commit.
  useEffect(() => {
    payloadRef.current = payload;
  });

  // Focus containment rides the Radix dialog trap. Restoration is ours,
  // like the New research dialog: the opener is captured from the
  // open-autofocus event — still the opener at that moment, before the
  // trap moves focus inside — and refocused from the close gesture,
  // deferred past unmount so the trap cannot pull it back. The ref is read
  // at gesture time because the trap owns focus afterwards.
  const openerRef = useRef<Element | null>(null);

  function scheduleRestore() {
    const opener = openerRef.current;
    window.setTimeout(() => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }, 0);
  }

  function closeNow() {
    scheduleRestore();
    onOpenChange(false);
  }

  useEffect(() => {
    if (!open || reportVersionId === null) return;
    if (loadedVersion.current === reportVersionId && reloadToken === 0) return;
    let disposed = false;
    const controller = new AbortController();
    async function read() {
      // A refresh keeps the retained report visible while it reloads; only
      // the first load shows the skeleton.
      if (payloadRef.current === null) setLoadState("loading");
      setRefreshError(false);
      try {
        const response = await fetch(
          `/api/organizations/${organizationId}/growth-intelligence/monitoring/reports/${reportVersionId}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("REPORT_LOAD_FAILED");
        const body = (await response.json()) as { report?: AssembledReportView };
        if (!body.report || body.report.identity.reportVersionId !== reportVersionId) {
          throw new Error("REPORT_LOAD_FAILED");
        }
        if (disposed) return;
        loadedVersion.current = reportVersionId;
        setPayload(body.report);
        setLoadState("ready");
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        // A failed refresh never clears the retained report: the last
        // loaded version stays on screen with its date and a retry.
        if (payloadRef.current === null) setLoadState("failed");
        else setRefreshError(true);
      }
    }
    void read();
    return () => {
      disposed = true;
      controller.abort();
    };
    // Filters and surrounding list state are deliberately absent: an opened
    // report follows its version id only.
  }, [open, organizationId, reportVersionId, reloadToken]);

  function retry() {
    if (payload === null) setLoadState("loading");
    setReloadToken((token) => token + 1);
  }

  const title = payload?.identity.projectTitle ?? "Report";
  const subtitle =
    payload === null
      ? "Loading the pinned report version."
      : `${payload.identity.locationName} · Report ${formatReportDate(payload.identity.reportCreatedAt, timeZone)} · Brief ${payload.identity.briefRevisionNumber}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement;
        }}
        onEscapeKeyDown={scheduleRestore}
        className="flex max-h-[90vh] w-full flex-col gap-0 p-0 sm:max-w-[860px] lg:max-w-[1024px] max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 text-left sm:px-7">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Research report
          </p>
          <DialogTitle className="mt-1 min-w-0 text-lg font-semibold break-words">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-0.5 min-w-0 break-words">{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {refreshError && payload !== null ? (
            <div className="shrink-0 border-b px-5 py-2 sm:px-7" role="alert">
              <p className="text-xs text-muted-foreground">
                The refresh could not be loaded. Showing the {formatReportDate(payload.identity.reportCreatedAt, timeZone)}{" "}
                report.{" "}
                <button
                  type="button"
                  onClick={retry}
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  Retry
                </button>
              </p>
            </div>
          ) : null}
          {loadState === "ready" && payload !== null ? (
            <ReportReaderView
              key={payload.identity.reportVersionId}
              view={payload}
              timeZone={timeZone}
            />
          ) : loadState === "failed" ? (
            <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-5 sm:p-7">
              <Alert variant="destructive">
                <AlertTitle>This report could not be loaded</AlertTitle>
                <AlertDescription>
                  Nothing changed. Retry to open the pinned report version.
                </AlertDescription>
              </Alert>
              <Button variant="outline" size="sm" className="self-start" onClick={retry}>
                Retry
              </Button>
            </div>
          ) : (
            <ReportReaderSkeleton />
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t px-5 py-3 sm:px-7">
          <span className="hidden min-w-0 text-xs text-muted-foreground sm:block">
            {payload === null
              ? "Pinned report version."
              : `Brief ${payload.identity.briefRevisionNumber} · ${formatReportDate(payload.identity.reportCreatedAt, timeZone)}`}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {payload === null ? null : (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={reportDownloadPath(organizationId, payload.identity.reportVersionId)}
                  download
                >
                  <Download aria-hidden="true" />
                  Download PDF
                </a>
              </Button>
            )}
            <Button size="sm" onClick={closeNow}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
