import Link from "next/link";
import { ArrowRight, Megaphone, Plus } from "lucide-react";

import { resolveCampaignStateChip } from "@/components/campaigns/campaign-state-chip";
import {
  SharedCampaignCard,
  SharedCompactCampaignRow,
} from "@/components/campaigns/shared-campaign-card";
import { HomeRefreshButton } from "@/components/organizations/home/home-refresh-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { HomeCampaign, HomeSection } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * The compact third row's reason line: the stalled generation detail verbatim
 * when the run left one (safe code-derived wording, already rendered on the
 * portfolio), else the saved objective, else no line at all. Nothing invented.
 */
function compactReason(homeCampaign: HomeCampaign): string | null {
  return homeCampaign.generation.detail ?? homeCampaign.objective;
}

/**
 * Campaigns: the first two records as the shared campaign cards plus an
 * optional third compact row (title, stalled reason, "Needs attention" tag,
 * text-link CTA), all from the derived CTA/href verbatim. A no-version
 * record links to the portfolio (never a detail link or spinner). Each card
 * carries the cover label as a chip overlaid on the artwork, the shared
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
            What could be read elsewhere on this page is still current. Retry refreshes the whole
            page from the server.
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
            {section.data.slice(0, 2).map((homeCampaign) => {
              const chip = resolveCampaignStateChip({ state: homeCampaign.state });
              return (
                <SharedCampaignCard
                  key={homeCampaign.id}
                  title={homeCampaign.title}
                  description={homeCampaign.objective}
                  href={homeCampaign.href}
                  updatedAt={homeCampaign.updatedAt}
                  timeZone={timeZone}
                  stateLabel={chip.label}
                  stateTone={chip.tone}
                  previewUrl={homeCampaign.cover?.url ?? null}
                  coverAlt={homeCampaign.cover?.alt ?? ""}
                  coverWidth={homeCampaign.cover?.width}
                  coverHeight={homeCampaign.cover?.height}
                  imageFit="contain"
                  coverChip={homeCampaign.coverLabel}
                  fallbackHint={null}
                  generation={homeCampaign.generation}
                  primaryAction={{
                    label: homeCampaign.actionLabel,
                    href: homeCampaign.href,
                  }}
                  restart={null}
                  repair={null}
                />
              );
            })}
          </div>
          {section.data.length > 2 && section.data[2] !== undefined ? (
            <div className={styles.compactList}>
              <SharedCompactCampaignRow
                title={section.data[2].title}
                reason={compactReason(section.data[2])}
                href={section.data[2].href}
                ctaLabel={section.data[2].actionLabel}
                ariaLabel="Third campaign"
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
