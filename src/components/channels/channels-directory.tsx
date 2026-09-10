"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { WaypointsIcon } from "lucide-react";

import { ChannelIcon } from "@/components/channels/channel-icons";
import styles from "@/components/channels/channels-landing.module.css";
import type {
  ChannelDirectoryFilter,
  ChannelRevenueSort,
  ChannelsLandingAnalysis,
  ChannelsPortfolioPresentation,
} from "@/components/channels/channels-presentation";
import {
  countChannelDirectoryFilters,
  formatChannelsWindowOption,
  labelForChannelCategory,
  selectChannelDirectoryRows,
} from "@/components/channels/channels-presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AnalysisMoney } from "@/domain/analysis/money-split";
import type { ChannelsOverviewRow } from "@/modules/analysis/application/channels-overview";
import type {
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

export type ChannelsDirectoryProps = {
  organizationId: string;
  channels: readonly OrganizationChannelRow[];
  branchMappings: readonly OrganizationChannelBranchRow[];
  analysis: ChannelsLandingAnalysis;
  /** Active-portfolio summary for per-row shares; null unless analysis is ready. */
  portfolio: ChannelsPortfolioPresentation | null;
  canManage: boolean;
  canMapBranches?: boolean;
  /**
   * Task 6 seam for the manage dialog (D05). The ellipsis emits the channel
   * ID here and builds no dialog itself, the same pattern as `onAdd`.
   */
  onManage?: (channelId: string) => void;
  onAdd?: () => void;
  onAboutSetup?: () => void;
};

type DirectoryTone = "measured" | "revenue" | "review" | "archived" | "neutral";

const TONE_CLASS: Record<DirectoryTone, string> = {
  measured: styles.dirBadgeMeasured,
  revenue: styles.dirBadgeRevenue,
  review: styles.dirBadgeReview,
  archived: styles.dirBadgeArchived,
  neutral: styles.dirBadgeNeutral,
};

/**
 * State pill + explanation for one row (visual contract V09). Gate-off and
 * failed-read rows name the capability state instead of fabricating a
 * failure count; archived rows keep history wording and never take a share.
 */
function directoryStateFor({
  status,
  bandState,
  analysisState,
}: {
  status: string;
  bandState: ChannelsOverviewRow["band"]["state"] | null;
  analysisState: ChannelsLandingAnalysis["state"];
}): { badge: string; note: string | null; tone: DirectoryTone } {
  if (status === "archived") {
    return { badge: "Archived", note: "Retained for history", tone: "archived" };
  }
  if (analysisState === "disabled") {
    return { badge: "Analysis not enabled", note: null, tone: "neutral" };
  }
  if (analysisState === "unavailable") {
    return { badge: "Analysis unavailable", note: null, tone: "neutral" };
  }
  if (bandState === "complete") {
    return { badge: "Measured", note: "Revenue and loss available", tone: "measured" };
  }
  if (bandState === "revenue_only") {
    return { badge: "Revenue only", note: "Loss not recorded", tone: "revenue" };
  }
  return {
    badge: "Needs review",
    note: "No comparable revenue figure for this window.",
    tone: "review",
  };
}

/**
 * Exact major-unit amount without the currency code, so the code can carry
 * the prefix styling while the figure keeps the currency's own exponent
 * (JPY keeps none, BHD keeps three). Negative adjustments stay signed.
 */
function formatMajorAmount(minorUnits: number, currency: string): string {
  const probe = new Intl.NumberFormat("en-AE", { style: "currency", currency });
  const exponent = probe.resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en-AE", {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minorUnits / 10 ** exponent);
}

/** One-decimal active share, e.g. `58.0% of reported total`. */
function formatSharePercent(numerator: number, denominator: number): string {
  const percent = (numerator / denominator) * 100;
  return `${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(percent)}%`;
}

function CategoryTile({ category }: { category: OrganizationChannelRow["category"] }) {
  const icon = category === "owned_digital" ? "globe" : category === "physical" ? "store" : "box";
  return (
    <span
      aria-hidden="true"
      className={`${styles.dirTile} ${category === "physical" ? styles.dirTilePhysical : ""}`}
    >
      <ChannelIcon name={icon} />
    </span>
  );
}

function DirectoryBadge({ badge, tone }: { badge: string; tone: DirectoryTone }) {
  return (
    <span className={`${styles.dirBadge} ${TONE_CLASS[tone]}`}>
      <span aria-hidden="true" className={styles.dirDot} />
      {badge}
    </span>
  );
}

export function ChannelsDirectory({
  organizationId,
  channels,
  branchMappings,
  analysis,
  portfolio,
  canManage,
  canMapBranches,
  onManage,
  onAdd,
  onAboutSetup,
}: ChannelsDirectoryProps) {
  const [filter, setFilter] = useState<ChannelDirectoryFilter>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ChannelRevenueSort>("descending");

  const counts = useMemo(
    () => countChannelDirectoryFilters({ channels, analysis }),
    [channels, analysis],
  );
  const evidenceAvailable = analysis.state === "ready";
  const evidenceExplanation =
    analysis.state === "disabled"
      ? "Analysis is not enabled for this organization."
      : "Channel performance is unavailable.";

  const bandByChannel = useMemo(() => {
    const map = new Map<string, ChannelsOverviewRow>();
    if (analysis.state === "ready") {
      for (const row of analysis.view.rows) map.set(row.channelId, row);
    }
    return map;
  }, [analysis]);

  const rows = useMemo(
    () => selectChannelDirectoryRows({ channels, analysis, query, filter, sort }),
    [channels, analysis, query, filter, sort],
  );

  // Mirrors the selector's fallback: when the listed rows carry more than one
  // currency, monetary sorting is disabled and the selector already returned
  // alphabetical order. Original-currency amounts stay on every row.
  const mixedCurrencies = useMemo(() => {
    const seen = new Set<string>();
    for (const channel of rows) {
      const currency = bandByChannel.get(channel.id)?.band.potential?.currency;
      if (currency) seen.add(currency);
    }
    return seen.size > 1;
  }, [rows, bandByChannel]);

  const mappingsByChannel = useMemo(() => {
    const map = new Map<string, OrganizationChannelBranchRow[]>();
    for (const mapping of branchMappings) {
      const list = map.get(mapping.channel_id) ?? [];
      list.push(mapping);
      map.set(mapping.channel_id, list);
    }
    return map;
  }, [branchMappings]);

  // The footer names the reporting range only when analysis actually selected
  // one. Gate-off, failed-read and windowless states show the count alone
  // rather than copying another window's dates.
  const periodLabel =
    analysis.state === "ready" && analysis.view.selectedWindow
      ? formatChannelsWindowOption(analysis.view.selectedWindow, analysis.view.windows)
      : null;

  const showArchivesOnly =
    channels.length > 0 &&
    rows.length === 0 &&
    query.trim().length === 0 &&
    filter !== "archived" &&
    counts.active === 0 &&
    counts.archived > 0;

  function clearFilters() {
    setQuery("");
    setFilter("active");
  }

  function evidenceItem(value: "measured" | "attention", label: string, count: number) {
    const item = (
      <ToggleGroupItem
        value={value}
        disabled={!evidenceAvailable}
        aria-describedby={!evidenceAvailable ? "evidence-filter-hint" : undefined}
        className={styles.dirFilterItem}
      >
        {label} <span className={styles.dirFilterCount}>{count}</span>
      </ToggleGroupItem>
    );
    if (evidenceAvailable) return item;
    // A disabled primitive swallows pointer events, so the tooltip lives on a
    // wrapper span; the same explanation stays in the tree as screen-reader
    // text for keyboard users and tests.
    return (
      <Tooltip key={value}>
        <TooltipTrigger asChild>
          <span className={styles.dirFilterHint}>{item}</span>
        </TooltipTrigger>
        <TooltipContent className={styles.theme}>{evidenceExplanation}</TooltipContent>
      </Tooltip>
    );
  }

  function revenueLines(channel: OrganizationChannelRow) {
    const amount: AnalysisMoney | null = bandByChannel.get(channel.id)?.band.potential ?? null;
    if (!amount) {
      return (
        <>
          <p className={styles.dirMoneyDash}>—</p>
          <p className={styles.dirSub}>No reported figure</p>
        </>
      );
    }
    const money = (
      <p className={styles.dirMoney}>
        <span className={styles.dirMoneyPrefix}>{amount.currency}</span>
        <span className={styles.dirMoneyValue}>
          {formatMajorAmount(amount.minorUnits, amount.currency)}
        </span>
      </p>
    );
    if (channel.status === "archived") {
      return (
        <>
          {money}
          <p className={styles.dirSub}>Historical reporting window</p>
        </>
      );
    }
    if (portfolio?.reportedTotal && portfolio.comparisonReason === null) {
      return (
        <>
          {money}
          <p className={styles.dirSub}>
            {formatSharePercent(amount.minorUnits, portfolio.reportedTotal.minorUnits)} of reported
            total
          </p>
        </>
      );
    }
    return (
      <>
        {money}
        <p className={styles.dirSub}>Share unavailable</p>
      </>
    );
  }

  function locationLines(channel: OrganizationChannelRow) {
    const mappings = mappingsByChannel.get(channel.id) ?? [];
    if (mappings.length === 0) {
      return <p className={styles.dirLocation}>Organization-wide</p>;
    }
    const active = new Set(
      mappings.filter((mapping) => mapping.status === "active").map((mapping) => mapping.branch_id),
    ).size;
    const historical = mappings.filter((mapping) => mapping.status === "inactive").length;
    if (active === 0) {
      return (
        <>
          <p className={styles.dirLocation}>No active mappings</p>
          {historical > 0 ? <p className={styles.dirLocation}>{historical} historical</p> : null}
        </>
      );
    }
    return (
      <>
        <p className={styles.dirLocation}>
          {active} mapped location{active === 1 ? "" : "s"}
        </p>
        {historical > 0 ? <p className={styles.dirLocation}>{historical} historical</p> : null}
      </>
    );
  }

  function rowActions(channel: OrganizationChannelRow) {
    // The label follows the capability gate, not amount availability: a
    // transient read failure keeps Channel Audit, while a gate-off
    // organization links to the setup-capable detail instead.
    const auditLabel =
      channel.status === "archived"
        ? "View history"
        : analysis.state === "disabled"
          ? "Open channel"
          : "Channel Audit";
    const manageLabel =
      canManage || canMapBranches
        ? `Manage ${channel.display_name}`
        : `View details for ${channel.display_name}`;
    return (
      <>
        <Button asChild variant="ghost" className={styles.dirAuditLink}>
          <Link href={`/organizations/${organizationId}/channels/${channel.id}`}>
            {auditLabel}
            <ChannelIcon name="up" />
          </Link>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={manageLabel}
              onClick={() => onManage?.(channel.id)}
              className={styles.dirEllipsis}
            >
              <ChannelIcon name="more" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className={styles.theme}>{manageLabel}</TooltipContent>
        </Tooltip>
      </>
    );
  }

  return (
    <TooltipProvider>
      <section aria-labelledby="channel-directory-heading" className={styles.directory}>
        <div className={styles.dirHeader}>
          <div>
            <h2 id="channel-directory-heading" className={styles.dirTitle}>
              Your channels <span className={styles.dirCount}>{counts.active}</span>
            </h2>
            <p className={styles.dirSubtitle}>Performance and setup, side by side.</p>
          </div>
          <Button
            type="button"
            variant="link"
            onClick={() => onAboutSetup?.()}
            className={styles.dirAbout}
          >
            About channel setup
            <ChannelIcon name="up" className={styles.dirAboutIcon} />
          </Button>
        </div>

        <div className={styles.dirTools}>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value as ChannelDirectoryFilter);
            }}
            aria-label="Filter channel directory"
            className={styles.dirFilters}
          >
            <ToggleGroupItem value="active" className={styles.dirFilterItem}>
              Active <span className={styles.dirFilterCount}>{counts.active}</span>
            </ToggleGroupItem>
            {evidenceItem("measured", "Measured", counts.measured)}
            {evidenceItem("attention", "Needs attention", counts.attention)}
            <ToggleGroupItem value="archived" className={styles.dirFilterItem}>
              Archived <span className={styles.dirFilterCount}>{counts.archived}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          {!evidenceAvailable ? (
            <span id="evidence-filter-hint" className="sr-only">
              {evidenceExplanation}
            </span>
          ) : null}
          <div className={styles.dirSearch}>
            <ChannelIcon name="search" />
            <Input
              type="search"
              value={query}
              maxLength={160}
              placeholder="Find a channel…"
              aria-label="Search channels"
              onChange={(event) => setQuery(event.target.value.slice(0, 160))}
              className={styles.dirSearchInput}
            />
            {query.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear channel search"
                onClick={() => setQuery("")}
                className={styles.dirClear}
              >
                <ChannelIcon name="close" />
              </Button>
            ) : null}
          </div>
        </div>

        {mixedCurrencies ? (
          <p className={styles.dirMixedNote}>Different currencies cannot be ranked together</p>
        ) : null}

        <div className={styles.dirCard}>
          {channels.length === 0 ? (
            <div className={styles.dirEmpty}>
              <WaypointsIcon aria-hidden="true" className={styles.dirEmptyIcon} />
              <p className={styles.dirEmptyTitle}>No channels yet</p>
              <p className={styles.dirEmptyCopy}>
                Add a channel to organise reporting and compare its performance.
              </p>
              {canManage ? (
                <div className={styles.dirEmptyAction}>
                  <Button onClick={() => onAdd?.()} className={styles.control}>
                    <ChannelIcon name="plus" />
                    Add channel
                  </Button>
                </div>
              ) : null}
            </div>
          ) : showArchivesOnly ? (
            <div className={styles.dirEmpty}>
              <p className={styles.dirEmptyTitle}>No active channels</p>
              <p className={styles.dirEmptyCopy}>Your archived channels remain available.</p>
              <div className={styles.dirEmptyAction}>
                <Button type="button" variant="outline" onClick={() => setFilter("archived")}>
                  View archived channels
                </Button>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.dirEmpty}>
              <p className={styles.dirEmptyTitle}>No channels in this view</p>
              <p className={styles.dirEmptyCopy}>Try another filter or a different channel name.</p>
              <div className={styles.dirEmptyAction}>
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.dirTableWrap}>
                <Table aria-label="Channels" className={styles.dirTable}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={styles.dirHead}>Channel</TableHead>
                      <TableHead
                        aria-sort={mixedCurrencies ? "none" : sort}
                        className={styles.dirHead}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSort(sort === "descending" ? "ascending" : "descending")
                          }
                          disabled={mixedCurrencies}
                          aria-label="Sort channels by reported revenue"
                          title={
                            mixedCurrencies
                              ? "Different currencies cannot be ranked together"
                              : undefined
                          }
                          className={styles.dirSort}
                        >
                          Reported revenue
                          <span aria-hidden="true" className={styles.dirSortArrow}>
                            {sort === "descending" ? "↓" : "↑"}
                          </span>
                        </button>
                      </TableHead>
                      <TableHead className={styles.dirHead}>Data coverage</TableHead>
                      <TableHead className={`${styles.dirHead} ${styles.dirLocationCell}`}>
                        Locations
                      </TableHead>
                      <TableHead className={`${styles.dirHead} ${styles.dirHeadActions}`}>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((channel) => {
                      const state = directoryStateFor({
                        status: channel.status,
                        bandState: bandByChannel.get(channel.id)?.band.state ?? null,
                        analysisState: analysis.state,
                      });
                      return (
                        <TableRow key={channel.id}>
                          <TableCell className={styles.dirCell}>
                            <div className={styles.dirIdentity}>
                              <CategoryTile category={channel.category} />
                              <div>
                                <p className={styles.dirName}>{channel.display_name}</p>
                                <p className={styles.dirCategory}>
                                  {labelForChannelCategory(channel.category)}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className={styles.dirCell}>{revenueLines(channel)}</TableCell>
                          <TableCell className={styles.dirCell}>
                            <DirectoryBadge badge={state.badge} tone={state.tone} />
                            {state.note ? <p className={styles.dirSub}>{state.note}</p> : null}
                          </TableCell>
                          <TableCell className={`${styles.dirCell} ${styles.dirLocationCell}`}>
                            {locationLines(channel)}
                          </TableCell>
                          <TableCell className={`${styles.dirCell} ${styles.dirCellActions}`}>
                            <div className={styles.dirActions}>{rowActions(channel)}</div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <ul aria-label="Channels" className={styles.dirMobile}>
                {rows.map((channel) => {
                  const state = directoryStateFor({
                    status: channel.status,
                    bandState: bandByChannel.get(channel.id)?.band.state ?? null,
                    analysisState: analysis.state,
                  });
                  return (
                    <li key={channel.id} className={styles.dirMobileItem}>
                      <div className={`${styles.dirIdentity} ${styles.dirMobileIdentity}`}>
                        <CategoryTile category={channel.category} />
                        <div>
                          <p className={styles.dirName}>{channel.display_name}</p>
                          <p className={styles.dirCategory}>
                            {labelForChannelCategory(channel.category)}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className={styles.dirMobileCaption}>Reported revenue</p>
                        {revenueLines(channel)}
                        <div className={styles.dirMobileLocation}>{locationLines(channel)}</div>
                      </div>
                      <div>
                        <DirectoryBadge badge={state.badge} tone={state.tone} />
                        {state.note ? <p className={styles.dirSub}>{state.note}</p> : null}
                      </div>
                      <div className={styles.dirMobileActions}>{rowActions(channel)}</div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className={styles.dirFoot}>
            <span>
              {rows.length} {rows.length === 1 ? "channel" : "channels"} shown
              {periodLabel ? ` · ${periodLabel}` : ""}
            </span>
            <span>Directory filters apply to this list only</span>
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}
