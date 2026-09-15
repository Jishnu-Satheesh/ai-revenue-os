"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { History, Palette } from "lucide-react";

import {
  AllocationLedger,
  type AllocationLedgerEvent,
} from "@/components/campaigns/allocation-ledger";
import { decideLearningProposal } from "@/components/campaigns/campaign-actions";
import {
  CampaignCreativeReview,
  type ReviewableDeliverable,
} from "@/components/campaigns/campaign-creative-review";
import { CampaignPhaseStrip } from "@/components/campaigns/campaign-phase-strip";
import { CampaignPublishing } from "@/components/campaigns/campaign-publishing";
import { CampaignResults } from "@/components/campaigns/campaign-results";
import { CampaignStudio } from "@/components/campaigns/campaign-studio";
import type {
  LearningDecision,
  LearningProposalData,
} from "@/components/campaigns/learning-review";
import type { OutcomeProofData } from "@/components/campaigns/outcome-proof";
import type { PostPerformanceSeries } from "@/components/campaigns/post-performance";
import type { VariantCard } from "@/components/campaigns/variant-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CampaignDetailTab, CampaignPhaseVerdict } from "@/domain/campaigns/phase";
import type { StudioView } from "@/modules/campaigns/application/studio-view";

/**
 * The campaign detail workspace.
 *
 * One campaign has five genuinely different questions asked of it, and they
 * were previously answered by one long scroll: is this worth doing, does the
 * artwork hold up, may these exact outputs go out, what happened, and what did
 * the system do. Each is a different job with a different audience and a
 * different capability behind it, so each gets a tab.
 *
 * Reviewing finished outputs lives on Creative, not Publishing. It is a
 * judgement about the work itself; Publishing answers the separate question of
 * destination, schedule and spend. Keeping them apart is what stops "the
 * picture is fine" from quietly reading as "send it".
 *
 * Nothing on Results or Activity is gated on a live approval. History has to
 * outlive authority, or a lapsed approval would quietly erase the record of a
 * campaign that really ran.
 */

const TAB_LABEL: Readonly<Record<CampaignDetailTab, string>> = {
  overview: "Overview",
  creative: "Creative",
  publishing: "Publishing",
  results: "Results",
  activity: "Activity",
};

const TABS = Object.keys(TAB_LABEL) as CampaignDetailTab[];

/** Ignores an unknown `?tab=` rather than widening anything. */
function validTab(value: string | null | undefined): CampaignDetailTab | null {
  return value && (TABS as string[]).includes(value) ? (value as CampaignDetailTab) : null;
}

function Fact({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function Panel({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function CampaignDetailWorkspace({
  view,
  phase,
  organizationId,
  organizationName,
  timeZone,
  currency,
  variants,
  variantsRemaining,
  deliverables,
  deliverablesReadFailed,
  launchAuthorized,
  allocationEvents,
  outcome,
  learningProposal,
  postPerformance,
  canReviewOutputs,
  canPublish,
  canDecideLearning,
  lastUpdatedLabel,
  initialTab = "overview",
}: Readonly<{
  view: StudioView;
  phase: CampaignPhaseVerdict;
  organizationId: string;
  organizationName: string;
  timeZone: string;
  currency: string | null;
  variants: readonly VariantCard[];
  variantsRemaining: Readonly<Record<string, number>>;
  deliverables: readonly ReviewableDeliverable[];
  /** True when the deliverable list could not be read — not the same as empty. */
  deliverablesReadFailed: boolean;
  /** `null` when it could not be read. Never rendered as "not authorized". */
  launchAuthorized: boolean | null;
  allocationEvents: readonly AllocationLedgerEvent[];
  outcome: OutcomeProofData | null;
  learningProposal: LearningProposalData | null;
  /**
   * The provider's own figures per published post, or null when they could not
   * be read. Null is a different statement from an empty list.
   */
  postPerformance: readonly PostPerformanceSeries[] | null;
  /** `campaign.approve`: may record a verdict on one finished output. */
  canReviewOutputs: boolean;
  /** `campaign.publish`: may authorize a publication. Deliberately separate. */
  canPublish: boolean;
  canDecideLearning: boolean;
  /** Already rendered in the organization's timezone by the page. */
  lastUpdatedLabel: string;
  initialTab?: CampaignDetailTab;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<CampaignDetailTab>(
    validTab(searchParams?.get("tab")) ?? initialTab,
  );

  /**
   * Moves the tab into the address, so a link to "the Publishing tab of this
   * campaign" is a real link somebody can send. `replace` rather than `push`:
   * flicking through tabs should not fill the back button with them.
   */
  function openTab(next: CampaignDetailTab) {
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  /**
   * Records the operator's decision on a learning proposal and refreshes so the
   * closed proposal renders as history. The decision route only records a
   * human's choice; it promotes nothing.
   */
  async function decideLearning(decision: LearningDecision) {
    if (!learningProposal) return { ok: false as const, message: "No proposal to decide." };
    const result = await decideLearningProposal({
      organizationId,
      campaignId: view.campaignId,
      proposalId: learningProposal.id,
      decision,
    });
    if (!result.ok) return { ok: false as const, message: result.message };
    router.refresh();
    return { ok: true as const };
  }

  const canActOnNext =
    phase.nextAction === null
      ? false
      : phase.nextAction.permission === "campaign.publish"
        ? canPublish
        : phase.nextAction.permission === "campaign.approve"
          ? canReviewOutputs
          : true;

  const produced = deliverables.filter((entry) => entry.currentVersion !== null);
  const allOutputsReviewed =
    produced.length > 0 && produced.every((entry) => entry.eligibility.publishable);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Header: what this is, where it stands, and the one thing to do next. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{view.title}</h1>
          <p className="text-sm text-muted-foreground">
            Objective: {view.objective} · Phase:{" "}
            <span className="font-medium text-foreground">{phase.label}</span> · Last saved update{" "}
            {lastUpdatedLabel}
          </p>
        </div>

        {phase.nextAction === null ? null : (
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={() => openTab(phase.nextAction!.tab)}
              disabled={!canActOnNext}
              title={
                canActOnNext
                  ? undefined
                  : `This needs the ${phase.nextAction.permission} capability.`
              }
            >
              {phase.nextAction.label}
            </Button>
            {canActOnNext ? null : (
              // Said rather than hidden. Somebody who cannot do this still needs
              // to know what the campaign is waiting on, and who it waits for.
              <span className="text-xs text-muted-foreground">
                Needs{" "}
                <span className="font-medium text-foreground">{phase.nextAction.permission}</span>,
                which your role does not hold.
              </span>
            )}
          </div>
        )}
      </div>

      <CampaignPhaseStrip verdict={phase} />

      <Tabs
        value={tab}
        onValueChange={(value) => openTab(value as CampaignDetailTab)}
        className="flex min-w-0 flex-col"
      >
        {/* The `line` variant is the underline tab bar the contract asks for,
            already in the design system. Scrollable rather than wrapped: five
            tabs do not fit a phone, and a second row of tabs reads as an
            unrelated control. `flex-none` keeps them grouped at the left —
            the variant's triggers are `flex-1`, which would spread five tabs
            across the full width and stop reading as a tab bar at all. */}
        <TabsList
          variant="line"
          aria-label="Campaign sections"
          className="w-full justify-start overflow-x-auto border-b"
        >
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key} className="flex-none">
              {TAB_LABEL[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4 min-w-0">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Why this campaign">
                <p className="text-sm text-muted-foreground">{view.rationale}</p>
                <p className="text-xs text-muted-foreground">
                  Measured on {view.measurement.primaryMetricKey} against{" "}
                  {view.measurement.baselineSource} over the previous{" "}
                  {view.measurement.baselineLookbackDays} days.
                </p>
              </Panel>

              <Panel title="Approved audience, offer & budget">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Fact
                    label="Channels"
                    value={[...new Set(view.actions.map((action) => action.channel))]
                      .sort()
                      .join(" · ")}
                  />
                  <Fact label="Actions covered" value={view.actions.length} />
                  <Fact
                    label="Media budget (proposed)"
                    value={
                      view.totalSpendCeiling
                        ? new Intl.NumberFormat("en-GB", {
                            style: "currency",
                            currency: view.totalSpendCeiling.currency,
                          }).format(view.totalSpendCeiling.amountMinor / 100)
                        : "No paid spend"
                    }
                  />
                  <Fact
                    label="Success measure"
                    value={`${view.measurement.primaryMetricKey}, ${view.measurement.outcomeWindowDays}-day window`}
                  />
                </div>
              </Panel>

              {view.versions.length < 2 ? null : (
                <Panel title="Versions">
                  <p className="text-sm text-muted-foreground">
                    Each version is its own record. Opening an older one shows the artwork and words
                    as they were approved then, never the newest artwork under an older approval.
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {view.versions.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                        {entry.isCurrent ? (
                          <span className="font-medium">Version {entry.version}</span>
                        ) : (
                          <Link
                            href={`/organizations/${organizationId}/campaigns/${view.campaignId}?version=${entry.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            Version {entry.version}
                          </Link>
                        )}
                        {entry.isCurrent ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Showing
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>

            <aside className="flex min-w-0 flex-col gap-4" aria-label="Next steps and sources">
              <Panel title="Next action">
                {phase.nextAction === null ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is waiting on anybody. {phase.summary}
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{phase.nextAction.detail}</p>
                    <Button
                      className="w-fit"
                      onClick={() => openTab(phase.nextAction!.tab)}
                      disabled={!canActOnNext}
                    >
                      {phase.nextAction.label}
                    </Button>
                  </>
                )}
              </Panel>

              {/*
                The single most load-bearing sentence on this page. Somebody who
                believes the first approval published something will not look
                for the second one.
              */}
              <section className="flex flex-col gap-2 rounded-lg border bg-accent/40 p-4">
                <h3 className="text-sm font-semibold">Two-gate approval</h3>
                <p className="text-xs text-muted-foreground">
                  The approved proposal authorized creative{" "}
                  <span className="italic">preparation</span> only. Publishing — including every
                  later variation — requires reviewing each exact finished output separately in
                  Creative, and then authorizing the set in Publishing.
                </p>
              </section>

              <Panel title="Sources">
                <p className="text-xs text-muted-foreground">
                  Built from the pinned source snapshot and the preregistered measurement plan.
                  Shared memory supplied text-only planning context where pinned; only its digest
                  travels with this version.
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  <li>{view.sourceLabel}</li>
                  <li>Baseline: {view.measurement.baselineSource}</li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  Restricted roots are withheld. Cited context appears by digest and summary only;
                  assertions, spend, credentials and asset bytes never leave their own stores.
                </p>
              </Panel>

              <Button asChild variant="outline" className="w-fit">
                <Link
                  href={`/organizations/${organizationId}/campaigns/${view.campaignId}/studio?version=${view.versionId}`}
                >
                  <Palette data-icon="inline-start" aria-hidden="true" />
                  Creative Studio
                </Link>
              </Button>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="creative" className="mt-4 flex min-w-0 flex-col gap-6">
          <CampaignStudio
            view={view}
            organizationId={organizationId}
            organizationName={organizationName}
            timeZone={timeZone}
            variants={variants}
            variantsRemaining={variantsRemaining}
          />

          <CampaignCreativeReview
            deliverables={deliverables}
            organizationId={organizationId}
            campaignId={view.campaignId}
            timeZone={timeZone}
            canReview={canReviewOutputs}
            readFailed={deliverablesReadFailed}
          />
        </TabsContent>

        <TabsContent value="publishing" className="mt-4 min-w-0">
          <CampaignPublishing
            view={view}
            organizationId={organizationId}
            timeZone={timeZone}
            launchAuthorized={launchAuthorized}
            canPublish={canPublish}
            allOutputsReviewed={allOutputsReviewed}
          />
        </TabsContent>

        <TabsContent value="results" className="mt-4 min-w-0">
          <CampaignResults
            outcome={outcome}
            learningProposal={learningProposal}
            canDecideLearning={canDecideLearning}
            timeZone={timeZone}
            onDecideLearning={decideLearning}
            postPerformance={postPerformance}
            measurement={{
              primaryMetricKey: view.measurement.primaryMetricKey,
              outcomeWindowDays: view.measurement.outcomeWindowDays,
              minimumEvidenceTier: view.measurement.minimumEvidenceTier,
            }}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4 flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Allocation decisions</h2>
            <p className="text-sm text-muted-foreground">
              Every decision the loop made, and why — including the decisions not to act. Each one
              names the rule, the values it compared, and when.
            </p>
            {allocationEvents.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                The loop has not recorded a decision for this campaign. That is an empty record, not
                a decision to do nothing.
              </p>
            ) : (
              <AllocationLedger events={allocationEvents} timeZone={timeZone} currency={currency} />
            )}
          </section>

          {/*
            Diagnostics belong behind a disclosure rather than on the approval
            surface — but they stay on the page. Moving a digest out of sight is
            reasonable; removing it would cost the audit trail its evidence.
          */}
          <Collapsible className="rounded-lg border">
            <CollapsibleTrigger className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium">
              <History className="size-4" aria-hidden="true" />
              Technical details
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 border-t p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Version digest</span>
                <span className="font-mono text-[10px] break-all text-muted-foreground">
                  {view.digest}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Bundle version id</span>
                <span className="font-mono text-[10px] break-all text-muted-foreground">
                  {view.versionId}
                </span>
              </div>
              {view.changeSummary === null ? (
                <p className="text-xs text-muted-foreground">
                  This is the first version, so there is nothing to compare it against. That is not
                  the same as compared and found identical.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    Changed from version {view.changeSummary.fromVersion}
                  </span>
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {view.changeSummary.changes.map((change) => (
                      <li key={change.path}>{change.label}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>
      </Tabs>
    </div>
  );
}
