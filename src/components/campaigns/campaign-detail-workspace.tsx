"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, Palette } from "lucide-react";

import { AllocationLedger, type AllocationLedgerEvent } from "@/components/campaigns/allocation-ledger";
import { decideLearningProposal } from "@/components/campaigns/campaign-actions";
import { CampaignPhaseStrip } from "@/components/campaigns/campaign-phase-strip";
import {
  CampaignPublishing,
  type PublishingDeliverable,
} from "@/components/campaigns/campaign-publishing";
import { CampaignResults } from "@/components/campaigns/campaign-results";
import { CampaignStudio } from "@/components/campaigns/campaign-studio";
import type { LearningDecision, LearningProposalData } from "@/components/campaigns/learning-review";
import type { OutcomeProofData } from "@/components/campaigns/outcome-proof";
import type { VariantCard } from "@/components/campaigns/variant-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CampaignPhaseVerdict } from "@/domain/campaigns/phase";
import type { StudioView } from "@/modules/campaigns/application/studio-view";

/**
 * The campaign detail workspace.
 *
 * One campaign has five genuinely different questions asked of it, and they were
 * previously answered by one long scroll: is this worth doing, does the artwork
 * hold up, may these exact outputs go out, what happened, and what did the
 * system do. Each is a different job with a different audience and a different
 * capability behind it, so each gets a tab.
 *
 * The order is the order of the work. Overview states where this stands.
 * Creative is where a version is judged and approved for preparation. Publishing
 * is the second gate, where each finished output is reviewed on its own bytes.
 * Results is what actually happened. Activity is the audit trail.
 *
 * Nothing on Results or Activity is gated on a live approval. History has to
 * outlive authority, or a lapsed approval would quietly erase the record of a
 * campaign that really ran.
 */

export type CampaignDetailTab = "overview" | "creative" | "publishing" | "results" | "activity";

const TAB_LABEL: Readonly<Record<CampaignDetailTab, string>> = {
  overview: "Overview",
  creative: "Creative",
  publishing: "Publishing",
  results: "Results",
  activity: "Activity",
};

function Fact({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
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
  allocationEvents,
  outcome,
  learningProposal,
  canReviewOutputs,
  canPublish,
  canDecideLearning,
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
  deliverables: readonly PublishingDeliverable[];
  /** True when the deliverable list could not be read — not the same as empty. */
  deliverablesReadFailed: boolean;
  allocationEvents: readonly AllocationLedgerEvent[];
  outcome: OutcomeProofData | null;
  learningProposal: LearningProposalData | null;
  /** `campaign.approve`: may record a verdict on one finished output. */
  canReviewOutputs: boolean;
  /** `campaign.publish`: may authorize a publication. Deliberately separate. */
  canPublish: boolean;
  canDecideLearning: boolean;
  initialTab?: CampaignDetailTab;
}>) {
  const router = useRouter();
  const [tab, setTab] = useState<CampaignDetailTab>(initialTab);

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

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <CampaignPhaseStrip verdict={phase} canAct={canActOnNext} />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as CampaignDetailTab)}
        className="flex min-w-0 flex-col"
      >
        {/* Scrollable rather than wrapped: five tabs do not fit a phone, and a
            second row of tabs reads as a second, unrelated control. */}
        <TabsList aria-label="Campaign sections" className="w-full justify-start overflow-x-auto">
          {(Object.keys(TAB_LABEL) as CampaignDetailTab[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABEL[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4 flex min-w-0 flex-col gap-4">
          <Alert>
            <AlertTitle>Objective</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{view.objective}</span>
              <span className="text-xs">{view.rationale}</span>
            </AlertDescription>
          </Alert>

          <section className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3">
            <Fact label="Source" value={view.sourceLabel} />
            <Fact label="Version" value={view.versionNumber} />
            <Fact
              label="Channels"
              value={[...new Set(view.actions.map((action) => action.channel))].sort().join(" · ")}
            />
            <Fact label="Actions covered" value={view.actions.length} />
            <Fact
              label="Measured on"
              value={view.measurement.primaryMetricKey}
            />
            <Fact label="Outcome window" value={`${view.measurement.outcomeWindowDays} days`} />
          </section>

          {view.versions.length < 2 ? null : (
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h3 className="text-base font-semibold">Versions</h3>
              <p className="text-sm text-muted-foreground">
                Each version is its own record. Opening an older one shows the artwork and words as
                they were approved then, never the newest artwork under an older approval.
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
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link
                href={`/organizations/${organizationId}/campaigns/${view.campaignId}/studio?version=${view.versionId}`}
              >
                <Palette data-icon="inline-start" aria-hidden="true" />
                Creative Studio
              </Link>
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="creative" className="mt-4 min-w-0">
          <CampaignStudio
            view={view}
            organizationId={organizationId}
            organizationName={organizationName}
            timeZone={timeZone}
            variants={variants}
            variantsRemaining={variantsRemaining}
          />
        </TabsContent>

        <TabsContent value="publishing" className="mt-4 min-w-0">
          <CampaignPublishing
            deliverables={deliverables}
            organizationId={organizationId}
            campaignId={view.campaignId}
            timeZone={timeZone}
            canReview={canReviewOutputs}
            canPublish={canPublish}
            readFailed={deliverablesReadFailed}
          />
        </TabsContent>

        <TabsContent value="results" className="mt-4 min-w-0">
          <CampaignResults
            outcome={outcome}
            learningProposal={learningProposal}
            canDecideLearning={canDecideLearning}
            timeZone={timeZone}
            onDecideLearning={decideLearning}
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
              <AllocationLedger
                events={allocationEvents}
                timeZone={timeZone}
                currency={currency}
              />
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
              Technical detail
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 border-t p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                  Version digest
                </span>
                <span className="font-mono text-[10px] break-all text-muted-foreground">
                  {view.digest}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                  Bundle version id
                </span>
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
                  <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
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
