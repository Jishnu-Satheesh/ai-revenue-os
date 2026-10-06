import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { HomeAttentionItem } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * Attention: at most three named records with concrete reasons, captioned
 * with an exact "N shown" count. A partial check says so explicitly and never
 * shares the page with the all-clear sentence; the all-clear sentence appears
 * only after a complete check found nothing. Wording stays informational —
 * every action is view-derived navigation, never a repair instruction.
 */
export function HomeAttention({
  items,
  incomplete,
}: Readonly<{ items: readonly HomeAttentionItem[]; incomplete: boolean }>) {
  const shown = items.slice(0, 3);

  return (
    <section id="home-attention" aria-label="For your attention" className={styles.attention}>
      <div className={styles.attentionPanel}>
        <div className={styles.sectionHead}>
          <h2 className={styles.railTitle}>For your attention</h2>
          {shown.length > 0 ? (
            <StatusBadge label={`${shown.length} shown`} tone="warning" />
          ) : null}
        </div>

        {shown.length === 0 ? (
          incomplete ? (
            <p className={styles.emptyNote}>
              Not everything could be checked just now — more items may need attention.
            </p>
          ) : (
            <p className={styles.emptyNote}>
              Nothing in the recent work shown needs attention.
            </p>
          )
        ) : (
          <>
            <ul className={styles.attentionList}>
              {shown.map((item) => (
                <li key={item.id} className={styles.attentionRow}>
                  <span className={styles.caption}>{item.sourceLabel}</span>
                  <span dir="auto" className={styles.attentionTitle}>
                    {item.title}
                  </span>
                  <span className={styles.attentionReason}>{item.reason}</span>
                  <Button asChild variant="link" size="sm" className="h-auto justify-start p-0">
                    <Link href={item.href}>
                      {item.actionLabel}
                      <ArrowRight aria-hidden="true" data-icon="inline-end" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
            {incomplete ? (
              <p className={styles.caption}>
                Not everything could be checked just now — more items may need attention.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
