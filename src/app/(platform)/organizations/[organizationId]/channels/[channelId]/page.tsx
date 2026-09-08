import { notFound } from "next/navigation";

import { ChannelWorkspace } from "@/components/analysis/channel-workspace";
import { ChannelDetail } from "@/components/channels/channel-detail";
import { ChannelSetupPanel } from "@/components/channels/channels-management";
import { ReportPackageUpload } from "@/components/integrations/report-package-upload";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { localPeriodEnd } from "@/domain/analysis/calendar";
import {
  defaultAnalysisWindow,
  isWindowCovered,
  type CoverageWindow,
} from "@/domain/analysis/window-selection";
import { ChannelAnalysisError } from "@/domain/analysis/errors";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { buildChannelWorkspaceView } from "@/modules/analysis/application/read-model";
import type { ChannelRecommendationRecord } from "@/modules/analysis/application/ports";
import { readCachedRunPayload } from "@/modules/analysis/application/view-cache";
import {
  MAX_EVIDENCE_WINDOWS,
  createAuthenticatedChannelAnalysisRepository,
} from "@/modules/analysis/infrastructure/read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * Today, as the organization's own calendar reads it.
 *
 * `en-CA` renders `YYYY-MM-DD`, which is the shape every date on this page
 * already uses. Reading "today" in the server's zone instead would shift the
 * default window by a day for anything either side of midnight in Dubai.
 */
function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/**
 * One channel, one page.
 *
 * Replaces the split between a register dialog (setup) and a separate
 * `/economics/channels/[channelId]` route (analysis). The analysis data
 * loading below -- `loadRuns`, the `displayedRun` selection,
 * `loadFindingsForRun`, `loadEvidence`, `loadRecommendationsForRun` and
 * `buildChannelWorkspaceView` -- is unchanged from that retired route; only
 * when it runs, and what it is wrapped in, is new. See
 * `docs/superpowers/specs/2026-08-28-channels-and-economics-merge-design.md`.
 */
export default async function ChannelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; channelId: string }>;
  searchParams?: Promise<{ from?: string; to?: string; month?: string }>;
}) {
  const { channelId } = await params;
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const role = context.membership.role;

  const snapshot = await createChannelService(
    createAuthenticatedChannelRepository(context.supabase),
  ).listManagementSnapshot({
    organizationId: context.organizationId,
    actorId: context.user.id,
    role,
  });
  const channel = snapshot.channels.find((candidate) => candidate.id === channelId);
  if (!channel) notFound();

  // Two differences from the route this replaces. The analysis flag no longer
  // 404s the page, because Setup is worth reaching without it; and an archived
  // channel opens on Setup, matching today, where the workspace link is hidden
  // for archived channels.
  const analysisAvailable =
    isGovernedChannelAnalysisEnabled(context.organizationId) && channel.status === "active";

  let workspace: React.ReactNode | null = null;
  if (analysisAvailable) {
    const analysis = createAuthenticatedChannelAnalysisRepository(context.supabase);
    const [runs, segments, evidenceWindows] = await Promise.all([
      analysis.loadRuns({ organizationId: context.organizationId, channelId, limit: 10 }),
      analysis.loadCoverageSegments({ organizationId: context.organizationId, channelId }),
      analysis.loadEvidenceWindows({
        organizationId: context.organizationId,
        channelId,
        limit: MAX_EVIDENCE_WINDOWS,
      }),
    ]);
    const coverageWindows: CoverageWindow[] = evidenceWindows.map((window) => ({
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      grain: window.grain,
      governedRowCount: window.governedRowCount,
    }));

    const query = await searchParams;
    // One release of grace for links and bookmarks minted under the month
    // picker. `?month=2026-01` means the whole of January, which is exactly
    // what it always meant.
    const requested =
      query?.from && query?.to
        ? { from: query.from, to: query.to }
        : query?.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
          ? { from: `${query.month}-01`, to: localPeriodEnd(`${query.month}-01`, "month") }
          : null;

    // A range the reports do not cover falls back to the default rather than
    // being analysed: a hand-typed URL cannot widen what this page will ask.
    // A hand-typed URL can also name dates that never existed, which the
    // coverage check refuses by throwing -- that is still "not covered", so
    // it falls back the same way instead of failing the page.
    let coveredRequested: { from: string; to: string } | null = null;
    try {
      coveredRequested =
        requested && isWindowCovered(requested.from, requested.to, segments) ? requested : null;
    } catch (error) {
      if (!(error instanceof ChannelAnalysisError)) throw error;
      coveredRequested = null;
    }
    const selectedWindow =
      coveredRequested ??
      defaultAnalysisWindow({
        today: todayInZone(organization.default_timezone),
        windows: coverageWindows,
      });

    // Unchanged in spirit from the month version: findings are read for the
    // one run the page is about to display, so every figure on the page was
    // computed for the window the page names. A window with no completed run
    // shows the workspace in its not-analysed state, never another window's
    // run.
    const displayedRun =
      selectedWindow === null
        ? null
        : (runs.find(
            (run) =>
              run.status === "completed" &&
              run.windowStart === selectedWindow.from &&
              run.windowEnd === selectedWindow.to,
          ) ?? null);

    // The findings, the evidence and the recommendation *text* for a
    // completed run are immutable, so they go through `readCachedRunPayload`.
    // The viewer's own accept and dismiss decisions do **not**: they are read
    // outside the cache and merged on top, because caching them under a run
    // id would show one operator another's choices.
    const cached =
      displayedRun === null || displayedRun.resultDigest === null
        ? null
        : await readCachedRunPayload({
            organizationId: context.organizationId,
            analysisRunId: displayedRun.id,
            resultDigest: displayedRun.resultDigest,
            load: async () => {
              const runFindings = await analysis.loadFindingsForRun({
                organizationId: context.organizationId,
                analysisRunId: displayedRun.id,
              });
              const [runEvidence, runRecommendations] = await Promise.all([
                analysis.loadEvidence({
                  organizationId: context.organizationId,
                  findingIds: runFindings.map((finding) => finding.id),
                }),
                // `viewerId: null` asks for the recommendations without any
                // viewer's decisions attached. That is what makes this payload
                // safe to share between operators.
                analysis.loadRecommendationsForRun({
                  organizationId: context.organizationId,
                  analysisRunId: displayedRun.id,
                  viewerId: null,
                }),
              ]);
              return {
                // The cache schema carries mutable arrays where the read
                // records carry readonly ones, and it structurally refuses
                // viewer state -- so both are converted at this boundary
                // rather than cast past it.
                findings: runFindings.map((finding) => ({
                  ...finding,
                  limitations: [...finding.limitations],
                })),
                evidence: runEvidence.map((row) =>
                  row.metric
                    ? {
                        ...row,
                        metric: { ...row.metric, dimensions: { ...row.metric.dimensions } },
                      }
                    : { ...row },
                ),
                recommendations: runRecommendations.map(
                  ({ decisions: _decisions, myFeedback: _myFeedback, ...shareable }) => ({
                    ...shareable,
                    supportedActions: [...shareable.supportedActions],
                    limitations: [...shareable.limitations],
                    citationFindingIds: [...shareable.citationFindingIds],
                  }),
                ),
              };
            },
          });

    let recommendations: ChannelRecommendationRecord[] = [];
    if (cached !== null && displayedRun !== null) {
      const viewerStates = await analysis.loadRecommendationViewerState({
        organizationId: context.organizationId,
        analysisRunId: displayedRun.id,
        viewerId: context.user.id,
      });
      const stateById = new Map(viewerStates.map((state) => [state.recommendationId, state]));
      recommendations = cached.recommendations.map((recommendation) => ({
        ...recommendation,
        decisions: stateById.get(recommendation.id)?.decisions ?? [],
        myFeedback: stateById.get(recommendation.id)?.myFeedback ?? null,
      }));
    }

    const view = buildChannelWorkspaceView({
      runs,
      findings: cached?.findings ?? [],
      evidence: cached?.evidence ?? [],
      recommendations,
    });

    workspace = (
      <ChannelWorkspace
        organizationId={context.organizationId}
        channel={{
          id: channel.id,
          key: channel.key,
          displayName: channel.display_name,
          category: channel.category,
          templateKey: channel.template_key,
          status: channel.status,
        }}
        view={view}
        // The stretches this channel's declared packages cover. A span
        // counted back from today reaches an uploaded report only by
        // coincidence, because reports arrive covering periods already past.
        segments={segments}
        coverageWindows={coverageWindows}
        selectedWindow={selectedWindow}
        timeZone={displayedRun?.windowTimezone ?? organization.default_timezone}
        canRunAnalysis={hasOrganizationPermission(role, "channel.manage")}
        channelsHref={`/organizations/${context.organizationId}/channels`}
        economicsHref={`/organizations/${context.organizationId}/channels`}
      />
    );
  }

  return (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={channelId} label={channel.display_name} />
      <ChannelDetail
        channelName={channel.display_name}
        workspace={workspace}
        reports={
          // Intake where the work happens: the same governed-reports flow as
          // the Integrations view, with the channel fixed from the route so
          // the form is shorter and every upload lands on this channel. An
          // operator uploads, an owner or admin approves, and the audit
          // starts on its own after a clean projection.
          hasOrganizationPermission(role, "report.upload") ||
          hasOrganizationPermission(role, "report.contract_approve") ? (
            <ReportPackageUpload
              organizationId={context.organizationId}
              role={role}
              timeZone={organization.default_timezone}
              fixedChannelId={channel.id}
            />
          ) : null
        }
        defaultTab={analysisAvailable ? "analysis" : "setup"}
        setup={
          <ChannelSetupPanel
            organizationId={context.organizationId}
            channel={channel}
            branches={snapshot.branches}
            branchMappings={snapshot.branchMappings}
            aliases={snapshot.aliases}
            canManage={hasOrganizationPermission(role, "channel.manage")}
            canMapBranches={hasOrganizationPermission(role, "channel.map_branch")}
          />
        }
      />
    </>
  );
}
