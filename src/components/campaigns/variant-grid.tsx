import { AlertTriangle, ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CampaignVariantState } from "@/domain/campaigns/variants";

/**
 * The creative produced under one approval.
 *
 * Every state carries its own words, including the ones an operator will rarely
 * see. The one that matters most is `provider_outcome_unknown`: it is not a
 * failure and must never be styled as one, because it means a post may already
 * be public and the next step is reconciliation rather than a retry.
 *
 * States that will later carry provider truth render as explicit placeholders.
 * A variant that has not been published yet says so, rather than showing an
 * empty metric that reads like a measured zero.
 */

export type VariantCard = {
  id: string;
  directionId: string;
  directionName: string;
  directionKind: "control" | "evidence_led" | "experimental";
  ordinal: number;
  state: CampaignVariantState;
  hook: string;
  caption: string;
  callToAction: string;
  hashtags: readonly string[];
  channel: string;
  placement: string;
  previewUrl: string | null;
};

const STATE: Readonly<
  Record<
    CampaignVariantState,
    {
      label: string;
      variant: "default" | "secondary" | "outline" | "destructive";
      note: string | null;
    }
  >
> = {
  draft: { label: "Draft", variant: "secondary", note: "Not scheduled yet." },
  scheduled: { label: "Scheduled", variant: "outline", note: "Waiting for its send time." },
  published: { label: "Published", variant: "default", note: null },
  paused_by_agent: {
    label: "Paused automatically",
    variant: "outline",
    note: "Stopped to contain spend. Only a person can start it again.",
  },
  paused_by_operator: {
    label: "Paused",
    variant: "outline",
    note: "Stopped by an operator.",
  },
  failed: { label: "Failed", variant: "destructive", note: "This variant did not publish." },
  provider_outcome_unknown: {
    label: "Outcome unknown",
    variant: "destructive",
    // Deliberately not "failed". A retry here is how something publishes twice.
    note: "It is not known whether this reached the provider. It is being checked before anything is retried.",
  },
};

const KIND_LABEL: Readonly<Record<VariantCard["directionKind"], string>> = {
  control: "Control",
  evidence_led: "Evidence-led",
  experimental: "Experimental",
};

export function VariantGrid({
  variants,
  remaining,
}: Readonly<{
  variants: readonly VariantCard[];
  /** How many more this approval still allows, per direction. */
  remaining: Readonly<Record<string, number>>;
}>) {
  if (variants.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-6 text-center" aria-label="Variants">
        <p className="text-sm font-medium">No variants yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This approval allows creative to be generated inside it. Nothing has been produced so far.
        </p>
      </section>
    );
  }

  const byDirection = new Map<string, VariantCard[]>();
  for (const variant of variants) {
    byDirection.set(variant.directionId, [
      ...(byDirection.get(variant.directionId) ?? []),
      variant,
    ]);
  }

  return (
    <section className="flex flex-col gap-6" aria-label="Variants">
      {[...byDirection.entries()].map(([directionId, group]) => {
        const left = remaining[directionId] ?? 0;
        const first = group[0];
        return (
          <div key={directionId} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{first?.directionName}</h3>
              <Badge variant="outline">{KIND_LABEL[first?.directionKind ?? "control"]}</Badge>
              <span className="text-xs text-muted-foreground">
                {group.length} produced
                {/* The room left is stated, not implied by an absence. */}
                {left > 0 ? ` · ${left} more allowed` : " · no more allowed under this approval"}
              </span>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Creative variants">
              {group.map((variant) => {
                const state = STATE[variant.state];
                return (
                  <li key={variant.id} className="flex">
                    <Card className="flex w-full flex-col overflow-hidden">
                      <div className="relative aspect-square w-full bg-muted">
                        {variant.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={variant.previewUrl}
                            alt={variant.hook}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                            <ImageOff className="size-5" aria-hidden="true" />
                            <span className="text-xs">Preview unavailable</span>
                          </div>
                        )}
                      </div>

                      <CardContent className="flex flex-1 flex-col gap-2 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={state.variant}>{state.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            #{variant.ordinal} · {variant.channel} {variant.placement}
                          </span>
                        </div>

                        <p className="font-medium">{variant.hook}</p>
                        <p className="text-muted-foreground">{variant.caption}</p>
                        <p className="text-xs text-muted-foreground">{variant.callToAction}</p>

                        {variant.hashtags.length > 0 ? (
                          <p className="text-xs break-words text-muted-foreground">
                            {variant.hashtags.join(" ")}
                          </p>
                        ) : null}

                        {state.note ? (
                          <p
                            className="mt-auto flex items-start gap-1.5 rounded-md border border-dashed p-2 text-xs"
                            role={
                              variant.state === "provider_outcome_unknown" ? "status" : undefined
                            }
                          >
                            {variant.state === "provider_outcome_unknown" ? (
                              <AlertTriangle
                                className="mt-0.5 size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                            ) : null}
                            <span className="text-muted-foreground">{state.note}</span>
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
