import { RegisterRouteLabel } from "@/components/layout/route-context";
import { ChannelsManagement } from "@/components/channels/channels-management";
import type { ChannelsLandingAnalysis } from "@/components/channels/channels-presentation";
import {
  parseChannelsDateRange,
  parseChannelsWindow,
} from "@/components/channels/channels-presentation";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { AnalysisGrain } from "@/domain/analysis/types";
import { isWindowCovered, type CoverageWindow } from "@/domain/analysis/window-selection";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import {
  buildChannelsOverviewView,
  buildOverviewWindows,
  resolveDefaultWindow,
  resolveOverviewWindow,
} from "@/modules/analysis/application/channels-overview";
import {
  ChannelAnalysisReadError,
  createAuthenticatedChannelAnalysisRepository,
} from "@/modules/analysis/infrastructure/read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * Today, as the organization's own calendar reads it. `en-CA` renders
 * `YYYY-MM-DD`, the shape every date on this page already uses. An unusable
 * zone falls back to UTC rather than failing the whole page -- the picker
 * presets degrade by hours, nothing else reads this value.
 */
function todayInZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  }
}

/**
 * Keep the diagnostic log free of tenant text. Postgres codes (`42501`) and
 * the repository's own bounded codes (`VALUE_NOT_EXACT`) pass through;
 * anything else is cardinality, not information, so it becomes `unknown`.
 */
function toSafeReadCode(code: string): string {
  return /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : "unknown";
}

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ window?: string; from?: string; to?: string }>;
}) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const snapshot = await createChannelService(
    createAuthenticatedChannelRepository(context.supabase),
  ).listManagementSnapshot({
    organizationId: context.organizationId,
    actorId: context.user.id,
    role: context.membership.role,
  });

  // The flag is enforced here rather than in navigation. An organization it is
  // off for does not reach the analysis reads at all, so the page degrades to
  // the register and there is nothing to pay for or to leak.
  const workspaceEnabled = isGovernedChannelAnalysisEnabled(context.organizationId);

  let analysis: ChannelsLandingAnalysis = { state: "disabled" };
  if (workspaceEnabled) {
    try {
      const repository = createAuthenticatedChannelAnalysisRepository(context.supabase);
      const [evidenceWindows, analysedKeys, segments] = await Promise.all([
        repository.loadEvidenceWindows({
          organizationId: context.organizationId,
          channelId: null,
          limit: 24,
        }),
        repository.loadAnalysedWindowKeys({ organizationId: context.organizationId }),
        repository.loadCoverageSegments({
          organizationId: context.organizationId,
          channelId: null,
        }),
      ]);
      const coverageWindows: CoverageWindow[] = evidenceWindows.map((window) => ({
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        grain: window.grain,
        governedRowCount: window.governedRowCount,
      }));

      // The page resolves which window to answer for before reading any band,
      // because a band read is scoped to one window and the read model cannot
      // infer which one it was given afterwards. A free `?from=&to=` the
      // approved reports fully cover resolves to exactly one declared window
      // (grain included); a covered range with no exact declared window, or a
      // range outside coverage, falls through to the legacy value and then
      // the default -- never widened or snapped. The default resolver runs
      // only when the URL does not parse; a URL that parses but names no
      // declared window stays explicitly unresolved (`selectedWindow: null`)
      // so the landing suppresses figures instead of showing fallback ones.
      const params = await searchParams;
      const declared = buildOverviewWindows(evidenceWindows);
      const freeRange = parseChannelsDateRange(params.from, params.to);
      let selected: {
        windowStart: string;
        windowEnd: string;
        grain: AnalysisGrain;
      } | null = null;
      if (freeRange !== null && isWindowCovered(freeRange.from, freeRange.to, segments)) {
        const resolution = resolveOverviewWindow({
          from: freeRange.from,
          to: freeRange.to,
          evidenceWindows,
          analysed: analysedKeys,
        });
        selected =
          resolution.kind === "resolved"
            ? {
                windowStart: resolution.windowStart,
                windowEnd: resolution.windowEnd,
                grain: resolution.grain,
              }
            : null;
      } else {
        const requested = parseChannelsWindow(params.window);
        selected = requested ?? resolveDefaultWindow({ windows: declared, analysed: analysedKeys });
      }

      const bands = selected
        ? await repository.loadChannelBandsForWindow({
            organizationId: context.organizationId,
            windowStart: selected.windowStart,
            windowEnd: selected.windowEnd,
            grain: selected.grain,
          })
        : [];

      const timeZone =
        typeof organization.default_timezone === "string" &&
        organization.default_timezone.length > 0
          ? organization.default_timezone
          : "UTC";
      analysis = {
        state: "ready",
        view: buildChannelsOverviewView({
          channels: snapshot.channels,
          bands,
          evidenceWindows,
          selected,
        }),
        range: {
          segments,
          coverageWindows,
          today: todayInZone(timeZone),
        },
      };
    } catch (error) {
      // Only a known analysis-read failure degrades to `unavailable` with the
      // directory intact. Authentication, tenant and unexpected failures throw
      // on to the error boundary; turning them into an empty success would
      // hide an outage behind a working-looking page.
      if (!(error instanceof ChannelAnalysisReadError)) throw error;
      logger.warn("channels_overview.read_failed", {
        organizationId: context.organizationId,
        errorCode: toSafeReadCode(error.code),
      });
      analysis = { state: "unavailable" };
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <ChannelsManagement
        organizationId={context.organizationId}
        organizationName={organization.name}
        channels={snapshot.channels}
        branches={snapshot.branches}
        branchMappings={snapshot.branchMappings}
        aliases={snapshot.aliases}
        canManage={hasOrganizationPermission(context.membership.role, "channel.manage")}
        canMapBranches={hasOrganizationPermission(context.membership.role, "channel.map_branch")}
        analysis={analysis}
      />
    </div>
  );
}
