import Link from "next/link";
import { CircleSlash, FileText, Plus, Sparkles } from "lucide-react";

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
  formatMinor,
  type CampaignLifecycle,
  type DemoCampaignSummary,
} from "@/modules/campaigns/demo/fixtures";

const LIFECYCLE: Readonly<
  Record<
    CampaignLifecycle,
    { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
  >
> = {
  draft: { label: "Draft", variant: "outline" },
  needs_data: { label: "Needs data", variant: "secondary" },
  ready_for_review: { label: "Ready for review", variant: "default" },
  approved: { label: "Approved", variant: "default" },
  scheduled: { label: "Scheduled", variant: "default" },
  blocked: { label: "Blocked", variant: "destructive" },
};

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
  campaigns: readonly DemoCampaignSummary[];
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
        <Button disabled>
          <Plus aria-hidden="true" />
          New campaign brief
        </Button>
        <Button variant="outline" asChild>
          <Link href="/opportunities">
            <FileText aria-hidden="true" />
            Start from an opportunity
          </Link>
        </Button>
      </div>

      <ul aria-label="Campaigns" className="grid gap-4 lg:grid-cols-2">
        {campaigns.map((campaign) => {
          const lifecycle = LIFECYCLE[campaign.lifecycle];
          return (
            <li key={campaign.id} className="flex">
              <Card className="flex w-full flex-col">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/organizations/${organizationId}/campaigns/${campaign.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {campaign.title}
                    </Link>
                    <Badge variant={lifecycle.variant}>{lifecycle.label}</Badge>
                    <Badge variant="outline">v{campaign.version}</Badge>
                  </CardTitle>
                  <CardDescription>{campaign.objective}</CardDescription>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-3 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase">Source</span>
                    <span>{campaign.sourceLabel}</span>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground uppercase">Channels</span>
                      <span>{campaign.channels.join(" · ")}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground uppercase">Spend ceiling</span>
                      <span>{formatMinor(campaign.spendCeiling)}</span>
                    </div>
                  </div>

                  {campaign.blockerCount > 0 ? (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <CircleSlash aria-hidden="true" className="size-4" />
                      {campaign.blockerCount} channel action
                      {campaign.blockerCount === 1 ? "" : "s"} blocked
                    </p>
                  ) : null}
                </CardContent>

                <CardFooter className="justify-between">
                  <span className="text-xs text-muted-foreground">
                    Updated {updatedLabel(campaign.updatedAt, timeZone)}
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/organizations/${organizationId}/campaigns/${campaign.id}`}>
                      Review
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
