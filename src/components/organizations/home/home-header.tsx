import Link from "next/link";
import { Clock, Plus, SlidersHorizontal } from "lucide-react";

import { HomePreviewImage } from "@/components/organizations/home/home-preview-image";
import { LocationsControl } from "@/components/organizations/home/home-context";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { OrganizationHomeView } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * Saved-status wording for the context row. The active and onboarding states
 * carry prototype-attested sentence copy; archived follows the same saved
 * pattern, and anything else renders the saved value verbatim rather than an
 * invented label.
 */
function statusLabel(status: string): string {
  if (status === "active") return "Active organization";
  if (status === "draft_onboarding") return "Organization setup";
  if (status === "archived") return "Archived organization";
  return status;
}

/**
 * Identity block: the small-caps eyebrow plus the one `h1` (the saved
 * organization name), the eligible logo or a name-only layout, the saved
 * description or nothing invented, the context row (status, locations,
 * timezone · currency) and a divider. Primary actions sit right-aligned:
 * Manage organization is a real anchor to the management surface Task 6
 * mounts below, and New campaign navigates to the creation route only when
 * the view permits it — viewers see neither.
 */
export function HomeHeader({ view }: Readonly<{ view: OrganizationHomeView }>) {
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <div className={styles.identity}>
          {view.logo !== null ? (
            <span className={styles.logoFrame}>
              <HomePreviewImage image={view.logo} frameClassName={styles.coverFallback} />
            </span>
          ) : null}
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
              Your organization
            </p>
            <h1 dir="auto" className={styles.title}>
              {view.name}
            </h1>
          </div>
        </div>
        <div className={styles.actions}>
          {view.permissions.canManageCore ? (
            <Button asChild variant="outline" className={styles.homeButton}>
              <Link href="#organization-management">
                <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />
                Manage organization
              </Link>
            </Button>
          ) : null}
          {view.permissions.canCreateCampaign ? (
            <Button asChild className={styles.homeButton}>
              <Link href={`/organizations/${view.organizationId}/campaigns/new`}>
                <Plus aria-hidden="true" data-icon="inline-start" />
                New campaign
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {view.description !== null ? (
        <p dir="auto" className={styles.description}>
          {view.description}
        </p>
      ) : null}

      <div className={styles.contextRow} aria-label="Organization context">
        <span className={styles.contextItem}>
          <span
            aria-hidden="true"
            className="inline-block size-[5px] rounded-full bg-primary"
          />
          {statusLabel(view.status)}
        </span>
        <LocationsControl
          locations={view.locations}
          branchlessConfirmed={view.branchlessConfirmed}
        />
        <span className={styles.contextItem}>
          <Clock aria-hidden="true" className="size-3.5" />
          {view.timeZone} · {view.currency}
        </span>
      </div>

      <Separator className={styles.divider} />
    </header>
  );
}
