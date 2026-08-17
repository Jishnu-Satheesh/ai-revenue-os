import Link from "next/link";
import { AlertTriangle, FileText, Loader2, Plus, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { CampaignState } from "@/domain/campaigns/state-machine";
import type {
  CampaignGeneration,
  CampaignListItem,
  Money,
} from "@/modules/campaigns/application/studio-view";

/**
 * What is happening to a campaign that has no proposal yet.
 *
 * Rendered only in that window, and deliberately never as a bare spinner. A
 * spinner asserts that work is in progress, and the one state an operator most
 * needs to see is the one where it is not: a worker that died mid-run leaves
 * its row claimed forever, and spinning at that row would wait for something
 * nobody is doing.
 */
function GenerationNotice({ generation }: Readonly<{ generation: CampaignGeneration }>) {
  if (generation.status === "settled") return null;

  if (generation.status === "generating") {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed p-2 text-xs"
        role="status"
      >
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>{generation.detail}</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs"
      role="status"
    >
      <AlertTriangle
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="flex flex-col gap-1">
        <span className="font-medium">
          {generation.status === "failed" ? "Generation failed" : "Generation did not finish"}
        </span>
        <span className="text-muted-foreground">{generation.detail}</span>
      </span>
    </div>
  );
}

/**
 * Every campaign state gets its own label, including the ones an operator will
 * rarely see. A state missing from this map would render as raw database text
 * in front of a client.
 */
const STATE: Readonly<
  Record<
    CampaignState,
    { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
  >
> = {
  draft: { label: "Draft", variant: "outline" },
  needs_data: { label: "Needs data", variant: "secondary" },
  ready_for_review: { label: "Ready for review", variant: "default" },
  approved: { label: "Approved", variant: "default" },
  scheduled: { label: "Scheduled", variant: "default" },
  executing: { label: "Executing", variant: "default" },
  measuring: { label: "Measuring", variant: "secondary" },
  completed: { label: "Completed", variant: "secondary" },
  partially_completed: { label: "Partially completed", variant: "secondary" },
  blocked: { label: "Blocked", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};

function formatMoney(money: Money | null): string {
  // A null ceiling means the bundle carries no paid action at all. Rendering
  // it as "0.00" would read as a budget of nothing, which is a different claim.
  if (!money) return "No paid spend";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

function updatedLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function CampaignPortfolio({
  organizationId,
  campaigns,
  timeZone,
}: Readonly<{
  organizationId: string;
  campaigns: readonly CampaignListItem[];
  timeZone: string;
}>) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Sparkles />
        <AlertTitle>Two entry points, one governed pipeline</AlertTitle>
        <AlertDescription>
          A Decision Engine opportunity and a manual brief create the same kind of campaign and pass
          the same checks before anything can be approved.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/organizations/${organizationId}/campaigns/new`}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            New campaign brief
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/organizations/${organizationId}/opportunities`}>
            <FileText data-icon="inline-start" aria-hidden="true" />
            Start from an opportunity
          </Link>
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              Start from a Decision Engine opportunity, or write a brief yourself. Both arrive here
              as a proposal to review before anything is published.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul aria-label="Campaigns" className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((campaign) => {
            const state = STATE[campaign.state];
            const href = `/organizations/${organizationId}/campaigns/${campaign.id}`;
            return (
              <li key={campaign.id} className="flex">
                <Card className="flex w-full flex-col">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {campaign.openable ? (
                        <Link href={href} className="underline-offset-4 hover:underline">
                          {campaign.title}
                        </Link>
                      ) : (
                        // Not a link, rather than a link that 404s. There is no
                        // proposal behind this campaign yet, so the route it
                        // would open has nothing to render.
                        <span>{campaign.title}</span>
                      )}
                      <Badge variant={state.variant}>{state.label}</Badge>
                      {campaign.version === null ? null : (
                        <Badge variant="outline">v{campaign.version}</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {/* The objective lives in a bundle version. Until one
                          exists there is nothing truthful to put here. */}
                      {campaign.objective ?? "Waiting for the first proposal to be generated."}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col gap-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground uppercase">Source</span>
                      <span>{campaign.sourceLabel}</span>
                    </div>

                    <GenerationNotice generation={campaign.generation} />

                    {campaign.awaitingFirstVersion ? null : (
                      <div className="flex flex-wrap gap-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground uppercase">Channels</span>
                          <span>{campaign.channels.join(" · ")}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground uppercase">
                            Spend ceiling
                          </span>
                          <span>{formatMoney(campaign.spendCeiling)}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>

                  <CardFooter className="justify-between">
                    <span className="text-xs text-muted-foreground">
                      Updated {updatedLabel(campaign.updatedAt, timeZone)}
                    </span>
                    {campaign.openable ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={href}>Review</Link>
                      </Button>
                    ) : (
                      // `disabled` on a Button with `asChild` renders an anchor,
                      // and an anchor ignores it — which is how a campaign with
                      // no version stayed clickable all the way to a 404.
                      <Button variant="outline" size="sm" disabled>
                        Review
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
