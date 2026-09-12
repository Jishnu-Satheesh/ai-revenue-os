import Link from "next/link";
import { ArrowRight, Megaphone, Plus } from "lucide-react";

import { HomePreviewImage } from "@/components/organizations/home/home-preview-image";
import { HomeRefreshButton } from "@/components/organizations/home/home-refresh-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  HomeCampaign,
  HomeSection,
} from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

function formatShortDate(value: string, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(value));
  // en-GB abbreviates September as "Sept"; the reference writes "Sep".
  // The day is still resolved in the organization timezone.
  return formatted.replace("Sept", "Sep");
}

function stateTone(state: HomeCampaign["state"]): "success" | "warning" {
  // Reference tags (prototype campaign cards): amber "Ready for review",
  // green "Draft". Amber marks the states that need a look; every other
  // state — draft, approved, scheduled, in-flight, finished, cancelled —
  // stays green. Soft tints come from the shared StatusBadge tones.
  switch (state) {
    case "ready_for_review":
    case "needs_data":
    case "blocked":
    case "failed":
      return "warning";
    default:
      return "success";
  }
}

function readableState(state: HomeCampaign["state"]): string {
  return state
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/**
 * Campaigns: the first two records as large cover cards plus an optional
 * third compact row, all from the derived CTA/href verbatim. A no-version
 * record links to the portfolio (never a detail link or spinner). Each card
 * carries the cover label as a chip overlaid on the artwork, a soft-tint
 * state tag, and a divider foot row with a short date plus an inline text
 * CTA; each record appears once. Gated sources render nothing; failures
 * stay local with a shared Retry.
 */
export function HomeCampaigns({
  organizationId,
  timeZone,
  section,
  canCreateCampaign,
}: Readonly<{
  organizationId: string;
  timeZone: string;
  section: HomeSection<readonly HomeCampaign[]>;
  canCreateCampaign: boolean;
}>) {
  if (section.status === "disabled") return null;

  const portfolioHref = `/organizations/${organizationId}/campaigns`;

  return (
    <section id="home-campaigns" aria-label="Your campaigns" className={styles.campaigns}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Your campaigns</h2>
          <p className={styles.caption}>Recent work, ready to pick up.</p>
        </div>
        <Button asChild variant="link" size="sm">
          <Link href={portfolioHref}>
            All campaigns
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      {section.status === "failed" ? (
        <Alert>
          <Megaphone aria-hidden="true" />
          <AlertTitle>Campaigns could not be loaded</AlertTitle>
          <AlertDescription>
            What could be read elsewhere on this page is still current. Retry refreshes the
            whole page from the server.
          </AlertDescription>
          <div className="mt-3">
            <HomeRefreshButton label="Retry" />
          </div>
        </Alert>
      ) : section.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              {canCreateCampaign ? (
                <>
                  Start your first campaign to see it here.{" "}
                  <Link
                    href={`/organizations/${organizationId}/campaigns/new`}
                    className={styles.inlineLink}
                  >
                    <Plus aria-hidden="true" className="mr-1 inline size-3.5" />
                    New campaign
                  </Link>
                </>
              ) : (
                "Campaigns will appear here once your team creates one."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className={styles.campaignGrid}>
            {section.data.slice(0, 2).map((homeCampaign) => (
              <Card key={homeCampaign.id} className={styles.campaignCard}>
                {homeCampaign.cover !== null ? (
                  <div className={styles.cover}>
                    <HomePreviewImage
                      image={homeCampaign.cover}
                      frameClassName={styles.coverFallback}
                    />
                    {homeCampaign.coverLabel !== null ? (
                      <span className={styles.coverChip}>{homeCampaign.coverLabel}</span>
                    ) : null}
                  </div>
                ) : null}
                <CardContent className="flex flex-col gap-1.5 pt-4">
                  <StatusBadge
                    label={readableState(homeCampaign.state)}
                    tone={stateTone(homeCampaign.state)}
                  />
                  <h3 dir="auto" className={styles.cardTitle}>
                    {homeCampaign.title}
                  </h3>
                  {homeCampaign.objective !== null ? (
                    <p dir="auto" className={styles.cardText}>
                      {homeCampaign.objective}
                    </p>
                  ) : null}
                  <div className={styles.campaignFoot}>
                    <p className={styles.meta}>
                      Updated{" "}
                      <time dateTime={homeCampaign.updatedAt}>
                        {formatShortDate(homeCampaign.updatedAt, timeZone)}
                      </time>
                    </p>
                    <Button asChild variant="link" size="sm">
                      <Link href={homeCampaign.href}>
                        {homeCampaign.actionLabel}
                        <ArrowRight aria-hidden="true" data-icon="inline-end" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {section.data.length > 2 && section.data[2] !== undefined ? (
            <div className={styles.compactList} aria-label="Third campaign">
              <div className={styles.compactRow}>
                <span dir="auto" className={styles.compactName}>
                  {section.data[2].title}
                </span>
                <Button asChild variant="ghost" size="sm">
                  <Link href={section.data[2].href}>
                    {section.data[2].actionLabel}
                    <ArrowRight aria-hidden="true" data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
