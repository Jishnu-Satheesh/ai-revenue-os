import Link from "next/link";

import { Images, Megaphone, Target } from "lucide-react";

import { formatInstant } from "@/components/organizations/home/home-dates";
import type { HomeActivityItem } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * Per-kind icon reusing the surface's visual-contract mapping: campaign rows
 * take the Campaigns Megaphone, asset rows the library Images, and
 * organization rows (goals, locations, profile) the goals Target. All three
 * icons are already used elsewhere on this surface, and the mapping mirrors
 * the prototype's campaign/image/target activity icons.
 */
const ACTIVITY_ICONS = {
  campaign: Megaphone,
  asset: Images,
  organization: Target,
} as const;

/**
 * Recent activity: up to five source-backed rows, each a small gray semantic
 * label with an icon, an optional authorized bold title, and an absolute
 * date/time in the organization timezone (passed as a prop, never guessed).
 * Rows link only when the view carries an href; unknown audit payloads never
 * reach this surface, so there is nothing raw to render and no "published"
 * wording.
 */
export function HomeActivity({
  items,
  timeZone,
}: Readonly<{ items: readonly HomeActivityItem[]; timeZone: string }>) {
  const rows = items.slice(0, 5);

  return (
    <section id="home-activity" aria-label="Recent activity" className={styles.activity}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Recent activity</h2>
        <span className={styles.caption}>Campaign, asset and organization updates</span>
      </div>
      {rows.length === 0 ? (
        <p className={styles.emptyNote}>No recent activity to show.</p>
      ) : (
        <ul className={styles.feedList}>
          {rows.map((item) => {
            const Icon = ACTIVITY_ICONS[item.kind];
            return (
              <li key={item.id} className={styles.feedRow}>
                <span aria-hidden="true" className={styles.feedIcon}>
                  <Icon className="size-4" />
                </span>
                <span className={styles.feedText}>
                  <span className={styles.feedLabel}>{item.label}</span>
                  {item.title !== null ? (
                    <span dir="auto" className={styles.feedTitle}>
                      {item.href !== null ? (
                        <Link href={item.href} className={styles.activityLink}>
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </span>
                  ) : null}
                  <span className={styles.meta}>
                    <time dateTime={item.occurredAt}>
                      {formatInstant(item.occurredAt, timeZone)}
                    </time>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
