import Link from "next/link";

import { formatInstant } from "@/components/organizations/home/home-dates";
import type { HomeActivityItem } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * Recent activity: up to five source-backed rows, each a semantic label with
 * an optional authorized title and an absolute date/time in the
 * organization timezone (passed as a prop, never guessed). Rows link only
 * when the view carries an href; unknown audit payloads never reach this
 * surface, so there is nothing raw to render and no "published" wording.
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
      </div>
      {rows.length === 0 ? (
        <p className={styles.emptyNote}>No recent activity to show.</p>
      ) : (
        <ul className={styles.activityList}>
          {rows.map((item) => (
            <li key={item.id} className={styles.activityRow}>
              <span className={styles.activityLabel}>{item.label}</span>
              {item.title !== null ? (
                <span dir="auto" className={styles.activityTitle}>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
