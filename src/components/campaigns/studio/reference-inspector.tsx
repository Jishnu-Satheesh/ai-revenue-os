"use client";

import { VerificationPanel } from "@/components/campaigns/studio/verification-panel";
import type {
  PosterStudioDirection,
  PosterStudioOffer,
  PosterStudioRender,
  PosterStudioView,
} from "@/modules/campaigns/application/poster-studio-view";

/**
 * The terms this poster is being composed under, beside the poster.
 *
 * Creative drifts from its brief quietly. An operator adjusting a headline for
 * the fourth time is not thinking about the objective or the measure, and by
 * the time anyone checks, the words have wandered somewhere nobody approved.
 * Keeping the approved terms in view is cheap and stops that.
 *
 * **It reports only what this version actually carries.** The generation
 * blueprint's positive reference selections and their reasons live with the
 * creative-history record rather than in the manifest, so they are named as
 * living there rather than summarised from something else. A plausible-looking
 * "references" list assembled from whatever was to hand would be worse than an
 * honest pointer: it would be read as the receipt it is not.
 */

function Section({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function ReferenceInspector({
  view,
  direction,
  offer,
  renders,
}: Readonly<{
  view: PosterStudioView;
  direction: PosterStudioDirection | null;
  offer: PosterStudioOffer | null;
  /** Already narrowed to this script and template by the caller. */
  renders: readonly PosterStudioRender[];
}>) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      <Section title="Proposal terms">
        <p>{view.objective}</p>
        <p className="text-xs text-muted-foreground">
          Measured on{" "}
          <span className="font-medium text-foreground">{view.measurement.primaryMetricKey}</span>{" "}
          against {view.measurement.baselineSource} over {view.measurement.outcomeWindowDays} days.
        </p>
      </Section>

      {direction ? (
        <Section title="This direction">
          <p className="font-medium">{direction.name}</p>
          <p className="text-xs text-muted-foreground">{direction.rationale}</p>
        </Section>
      ) : null}

      <Section title="Known departures">
        {direction && direction.softConventionDepartures.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
            {direction.softConventionDepartures.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            This direction declares no departure from the brand conventions. A departure nobody
            wrote down is one nobody reviewed, so an empty list here means none were claimed —
            not that none were checked.
          </p>
        )}
      </Section>

      <Section title="Provenance">
        <dl className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-medium">{view.version}</dd>
          </div>
          {offer ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Template</dt>
              <dd className="font-medium">
                {offer.templateKey} v{offer.templateVersion}
              </dd>
            </div>
          ) : null}
          {direction ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Picture</dt>
              <dd className="font-medium">{direction.plateAssetKey}</dd>
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Approved digest</dt>
            {/* Breaks anywhere: a 64-character hash with nowhere to wrap pushes
                a 280px rail wider than the column it was given. */}
            <dd className="font-mono text-[11px] break-all">{view.digest}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          The reference images this direction was generated from, and why each was chosen, are
          recorded against the creative-history entry for that generation rather than in this
          version&apos;s manifest.
        </p>
      </Section>

      <Section title="Checks">
        <VerificationPanel renders={renders} />
      </Section>
    </div>
  );
}
