import { HomeHeader } from "@/components/organizations/home/home-header";
import { HomeCampaigns } from "@/components/organizations/home/home-campaigns";
import { HomeAssets } from "@/components/organizations/home/home-assets";
import { HomeAttention } from "@/components/organizations/home/home-attention";
import { HomeDestinations, HomeGoals } from "@/components/organizations/home/home-context";
import { HomeActivity } from "@/components/organizations/home/home-activity";
import type { OrganizationHomeView } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * Organization home composition. Receives only the settled
 * `OrganizationHomeView` — section components get view slices as props and
 * never touch readers or the database. DOM order is the reading order
 * (identity, campaigns, library, attention, goals, destinations, activity);
 * narrow layouts follow this sequence exactly, wider bands compose the same
 * nodes into primary and rail columns without tabindex or CSS order tricks.
 * The shell (sidebar, breadcrumb, scroll) stays the route's job.
 */
export function OrganizationHome({ view }: Readonly<{ view: OrganizationHomeView }>) {
  return (
    <div className={styles.home}>
      <HomeHeader view={view} />
      <div className={styles.body}>
        <HomeCampaigns
          organizationId={view.organizationId}
          timeZone={view.timeZone}
          section={view.campaigns}
          canCreateCampaign={view.permissions.canCreateCampaign}
        />
        <HomeAssets
          organizationId={view.organizationId}
          organizationName={view.name}
          timeZone={view.timeZone}
          section={view.assets}
          partial={view.assetsPartial}
        />
        <HomeAttention items={view.attention} incomplete={view.attentionIncomplete} />
        <HomeGoals
          goals={view.goals}
          focusGoalId={view.focusGoalId}
          timeZone={view.timeZone}
          canManageCore={view.permissions.canManageCore}
        />
        <HomeDestinations destinations={view.destinations} />
        <HomeActivity items={view.activity} timeZone={view.timeZone} />
      </div>
      <footer className={styles.footer}>
        Organization home · the place to return to your work.
      </footer>
    </div>
  );
}
