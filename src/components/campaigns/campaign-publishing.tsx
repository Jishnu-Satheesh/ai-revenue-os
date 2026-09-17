import Link from "next/link";
import { AlertTriangle, PlugZap } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReviewableDeliverable } from "@/components/campaigns/campaign-creative-review";
import type { Money, StudioChannelReadiness, StudioView } from "@/modules/campaigns/application/studio-view";

/**
 * Where each approved output is going, when, and on whose account.
 *
 * One row per action the approved version carries. This is deliberately the
 * *planned* set rather than a set of provider receipts: nothing dispatches yet,
 * and inventing a "Queued" or "Submitting" state for work no worker has taken
 * would be a claim about a provider we have not spoken to.
 *
 * So every row's state is derived from two things that are actually known —
 * whether publication has been authorized at all, and whether the channel is
 * ready to accept it. When dispatch records exist, they replace the derived
 * state; until then the honest answer is "not dispatched", and the reason.
 */

function formatMoney(money: Money | null): string {
  // An organic action carries no ceiling. Rendering it as "0.00" would read as
  // a budget of nothing, which is a different claim from having no budget.
  if (!money) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

/**
 * Why one output in the authorization set is blocking it, in words.
 *
 * Mirrors the Creative tab's vocabulary for the same states, so the two tabs
 * cannot disagree about what is holding a publication up.
 */
function standingCopy(reasonCode: string | undefined): string {
  switch (reasonCode) {
    case "rejected":
      return "this was rejected and needs a new version before it can go out";
    case "superseded_by_newer_version":
      return "a newer version of this output has replaced it";
    case "reviewed_different_content":
      return "this changed after it was approved, so the approval no longer fits";
    default:
      return "nobody has reviewed this yet";
  }
}

function formatSchedule(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

type RowState = {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  note: string | null;
};

/**
 * What can honestly be said about one action right now.
 *
 * `readiness` being null means the platform could not determine it, which is
 * not the same as everything being fine and must never render as if it were.
 */
function rowState(input: {
  readiness: StudioChannelReadiness | null | undefined;
  readinessUnknown: boolean;
  launchAuthorized: boolean | null;
}): RowState {
  if (input.readinessUnknown) {
    return {
      label: "Unknown",
      variant: "outline",
      note: "Channel readiness could not be determined. This is not a confirmation that it is fine.",
    };
  }

  if (input.readiness?.verdict === "blocked") {
    return {
      label: "Blocked",
      variant: "destructive",
      note: input.readiness.blockers[0]?.reason ?? "This channel cannot accept the action yet.",
    };
  }

  if (input.launchAuthorized === null) {
    return {
      label: "Unknown",
      variant: "outline",
      note: "Whether publication is authorized could not be read.",
    };
  }

  if (!input.launchAuthorized) {
    return {
      label: "Not authorized",
      variant: "secondary",
      note: "Reviewed outputs still need a publication authorization before anything is sent.",
    };
  }

  return {
    label: "Not dispatched",
    variant: "secondary",
    note: "Authorized. No worker has sent this yet.",
  };
}

export function CampaignPublishing({
  view,
  organizationId,
  timeZone,
  launchAuthorized,
  canPublish,
  allOutputsReviewed,
  deliverables,
  deliverablesReadFailed,
}: Readonly<{
  view: StudioView;
  organizationId: string;
  timeZone: string;
  /** `null` when it could not be read — never rendered as "not authorized". */
  launchAuthorized: boolean | null;
  /** `campaign.publish`. Reviewing outputs does not confer this. */
  canPublish: boolean;
  /** Whether every produced output carries its own standing approval. */
  allOutputsReviewed: boolean;
  /** The exact outputs an authorization would bind to, with their bytes. */
  deliverables: readonly ReviewableDeliverable[];
  /** True when the output list could not be read — not the same as empty. */
  deliverablesReadFailed: boolean;
}>) {
  const readinessUnknown = view.readiness === null;
  // Only produced outputs can be authorized. A planned output with no finished
  // bytes is not "the same set minus one" — it is not in the set at all.
  const producedOutputs = deliverables.filter(
    (deliverable) => deliverable.currentVersion !== null,
  );
  const readinessByChannel = new Map(
    (view.readiness ?? []).map((entry) => [entry.channel, entry]),
  );
  const directionsById = new Map(view.directions.map((entry) => [entry.id, entry]));

  const blocked = (view.readiness ?? []).filter((entry) => entry.verdict === "blocked");

  return (
    <div className="flex flex-col gap-4">
      {readinessUnknown ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Channel readiness could not be determined</AlertTitle>
          <AlertDescription>
            The states below are incomplete. Treat every row as unverified rather than as ready.
          </AlertDescription>
        </Alert>
      ) : blocked.length === 0 ? null : (
        <Alert variant="destructive">
          <PlugZap />
          <AlertTitle>
            {blocked.length === 1
              ? `${blocked[0]!.channel} cannot publish yet`
              : `${blocked.length} channels cannot publish yet`}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>
              {blocked[0]!.blockers[0]?.recovery ??
                "These placements cannot submit until the channel is connected for this organization."}
            </span>
            <Button asChild size="sm" variant="outline" className="w-fit">
              <Link href={`/organizations/${organizationId}/integrations`}>
                Open Integration Hub
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Tables are the one thing allowed to be wider than the page, inside
          their own scroller, so a phone can read a six-column row. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">
            Every action this approved version would publish, with its destination, schedule and
            current state.
          </caption>
          <thead className="border-b bg-muted/40">
            <tr className="text-left">
              <th scope="col" className="px-3 py-2 font-medium">
                Output / action
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Destination
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Type
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Schedule ({timeZone})
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Budget
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                State
              </th>
            </tr>
          </thead>
          <tbody>
            {view.actions.map((action) => {
              const readiness = readinessByChannel.get(action.channel);
              const state = rowState({ readiness, readinessUnknown, launchAuthorized });
              const direction = directionsById.get(action.directionId);

              return (
                <tr key={action.id} className="border-b last:border-b-0 align-top">
                  <td className="px-3 py-3">
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{direction?.name ?? "Unnamed direction"}</span>
                      <span className="text-xs text-muted-foreground">
                        {action.channel} · {action.placement}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {/* An unconnected channel says so, rather than showing a
                        blank that reads as "fine". */}
                    {readinessUnknown
                      ? "Unknown"
                      : (readiness?.accountLabel ?? "No account connected")}
                  </td>
                  <td className="px-3 py-3">{action.spendCeiling ? "Paid" : "Organic"}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {formatSchedule(action.scheduledFor, timeZone)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {formatMoney(action.spendCeiling)}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex flex-col gap-1">
                      <Badge variant={state.variant} className="w-fit">
                        {state.label}
                      </Badge>
                      {state.note ? (
                        <span className="text-xs text-muted-foreground">{state.note}</span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
        <h3 className="text-base font-semibold">Authorize publication</h3>
        <p className="text-sm text-muted-foreground">
          Publication is authorized for an exact set of reviewed outputs together with the accounts,
          words, schedule and spend they go out with. Changing any of those terms needs a new
          authorization rather than an edit to this one.
        </p>

        {allOutputsReviewed ? null : (
          <p className="text-sm text-muted-foreground">
            Every produced output has to be reviewed on the Creative tab first.
          </p>
        )}

        {canPublish ? null : (
          <p className="text-sm text-muted-foreground">
            Authorizing publication needs the{" "}
            <span className="font-medium text-foreground">campaign.publish</span> capability, which
            your role does not hold. Reviewing outputs does not confer it.
          </p>
        )}

        {/*
          The exact set an authorization binds to: every produced output, named
          by its row and its bytes. A batch authorization covers this whole list
          and nothing else — an output added later, or re-rendered after review,
          needs its own authorization rather than riding along on this one.
        */}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">The exact set under authorization</h4>
          {deliverablesReadFailed ? (
            <p className="text-sm text-muted-foreground">
              The output list could not be read. That is a failed read, not an empty set — nothing
              below should be taken as the full list.
            </p>
          ) : producedOutputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No finished outputs yet, so there is nothing to authorize. This is an empty record,
              not a complete set.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {producedOutputs.map((deliverable) => {
                const version = deliverable.currentVersion!;
                return (
                  <li
                    key={deliverable.id}
                    className="flex flex-wrap items-baseline gap-x-2 text-sm"
                  >
                    <span className="font-medium">
                      {deliverable.channel} · {deliverable.placement} · {deliverable.format} ·{" "}
                      {deliverable.language}
                    </span>
                    <span className="text-muted-foreground">version {version.version}</span>
                    {/* Truncated for reading; the authorization binds the full hash. */}
                    <code
                      className="rounded bg-muted px-1 font-mono text-xs"
                      title={version.contentHash}
                    >
                      {version.contentHash.slice(0, 16)}…
                    </code>
                    {deliverable.eligibility.publishable ? (
                      <span className="text-xs text-muted-foreground">
                        Reviewed — these exact bytes.
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-destructive">
                        Blocking: {standingCopy(deliverable.eligibility.reasonCode)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/*
          No control here yet. The terms a publication binds to — the connected
          account, the exact schedule, the spend — are assembled by the dispatch
          planner in Task 13, and offering a button that cannot name them would
          authorize a set of terms nobody chose. The route and its binding exist;
          what is missing is the screen that composes the terms.
        */}
        <p className="text-xs text-muted-foreground">
          The composer for those terms is not built yet, so publication cannot be authorized from
          this screen. Nothing is blocked by permission here — the terms themselves have nowhere to
          come from.
        </p>
      </section>
    </div>
  );
}
