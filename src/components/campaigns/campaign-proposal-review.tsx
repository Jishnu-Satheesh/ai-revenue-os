"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";

import {
  formatProposalDay,
  formatProposalMoment,
  formatProposalMoney,
  proposalDecisionLabel,
  proposalStateDetail,
  proposalStateLabel,
  summarizeChannels,
} from "@/components/campaigns/proposal-copy";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  CampaignProposalDecisionKind,
  CampaignProposalReviewView,
} from "@/modules/campaigns/application/proposal-read-model";

/**
 * Reading one proposal in full, and answering it.
 *
 * The whole point of this surface is that the person deciding sees the exact
 * terms they are agreeing to, so it states them rather than summarizing them:
 * what approval permits, what it does not, the cost ceiling it is bound to, and
 * everything the proposal itself says is missing.
 *
 * Three rules hold the page together.
 *
 * Approval means preparation only. The button says so, the terms beside it say
 * so, and the confirmation afterwards says so again — because the one failure
 * mode worth designing against here is somebody believing they approved a
 * publication (ADR 0057, D05).
 *
 * The gaps are shown at the same weight as the argument. A proposal with no
 * estimate behind it is still worth reading, and saying what it cannot support
 * is what makes it honest rather than aspirational (D07).
 *
 * A control appears only where the decision would actually be accepted. The
 * database admits a decision from three states, against the current version's
 * exact digest, and approval needs a capability an operator does not hold.
 * Rendering a button the server will refuse teaches people to distrust the
 * interface.
 */
export function CampaignProposalReview({
  review,
  organizationId,
  timeZone,
  canDecide,
  canApprove,
}: {
  review: CampaignProposalReviewView;
  organizationId: string;
  timeZone: string;
  /** `campaign.edit`: ask for changes, snooze, dismiss. */
  canDecide: boolean;
  /** `campaign.proposal_approve`: agree to it. Owners and admins only. */
  canApprove: boolean;
}) {
  const document = review.content.kind === "document" ? review.content.document : null;

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {document?.title ?? "A campaign proposal is being worked out"}
          </h1>
          <Badge variant={review.decidable ? "default" : "secondary"}>
            {proposalStateLabel(review.state)}
            {review.state === "snoozed" && review.snoozedUntil !== null
              ? ` until ${formatProposalDay(review.snoozedUntil, timeZone)}`
              : ""}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{proposalStateDetail(review)}</p>
        {review.content.kind === "document" ? (
          <p className="text-xs text-muted-foreground">
            Version {review.content.versionNumber}, written{" "}
            {formatProposalMoment(review.content.writtenAt, timeZone)}
          </p>
        ) : null}
        {review.linkedCampaignId !== null ? (
          <Link
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href={`/organizations/${organizationId}/campaigns/${review.linkedCampaignId}`}
          >
            Open the campaign this opened
          </Link>
        ) : null}
      </header>

      {review.refusal !== null ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>This proposal cannot be reviewed as written</AlertTitle>
          <AlertDescription>{review.refusal}</AlertDescription>
        </Alert>
      ) : null}

      {review.content.kind === "unreadable" ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>This proposal cannot be shown</AlertTitle>
          <AlertDescription>
            It was written in a form this version of the platform cannot read. Showing part of it
            would be worse than showing none. Nothing has been approved and nothing has been spent.
          </AlertDescription>
        </Alert>
      ) : null}

      {document !== null ? (
        <>
          <ProposalTerms review={review} document={document} timeZone={timeZone} />
          {review.decidable && (canDecide || canApprove) ? (
            <DecisionPanel
              review={review}
              organizationId={organizationId}
              canDecide={canDecide}
              canApprove={canApprove}
            />
          ) : (
            <NoControlsNote review={review} canDecide={canDecide} canApprove={canApprove} />
          )}
        </>
      ) : null}

      {review.decisions.length > 0 ? (
        <DecisionHistory decisions={review.decisions} timeZone={timeZone} />
      ) : null}
    </div>
  );
}

/**
 * The document, stated in full.
 *
 * Ordered the way a person reads an argument: the problem, who it is for, what
 * would be made, what it costs, how anyone would tell whether it worked, and
 * what it cannot support. The gaps come last not because they matter least but
 * because they are what the reader weighs everything above against.
 */
function ProposalTerms({
  review,
  document,
  timeZone,
}: {
  review: CampaignProposalReviewView;
  document: NonNullable<
    Extract<CampaignProposalReviewView["content"], { kind: "document" }>["document"]
  >;
  timeZone: string;
}) {
  const plan = document.successPlan;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>What this is for</CardTitle>
          <CardDescription>The problem it addresses and who it speaks to.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <Field label="Business problem">{document.businessProblem}</Field>
          <Field label="Objective">{document.objective}</Field>
          <Field label="Audience">{document.audience}</Field>
          <Field label="Offer">
            {document.offer.kind === "no_offer"
              ? "No offer. The campaign carries no discount or promotion."
              : document.offer.offerRef}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What would be made, and what it costs</CardTitle>
          <CardDescription>
            Media spend and the cost of preparing creative are separate amounts, approved at
            separate gates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Pair term="Channels" detail={summarizeChannels(document.channels)} />
            <Pair
              term="Runs from"
              detail={`${formatProposalDay(document.timing.startAt, timeZone)}${
                document.timing.endAt === null
                  ? " with no stated end"
                  : ` to ${formatProposalDay(document.timing.endAt, timeZone)}`
              }`}
            />
            <Pair
              term="Media budget"
              detail={formatProposalMoney(
                document.proposedMediaBudget,
                "None. This is an organic-only campaign.",
              )}
            />
            <Pair
              term="Most the preparation may cost"
              detail={formatProposalMoney(document.generationCostCeiling, "Not stated")}
            />
          </dl>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Deliverables</p>
            <ul className="mt-1 list-inside list-disc text-sm">
              {document.deliverables.map((deliverable, index) => (
                <li key={`${deliverable.format}-${deliverable.language}-${index}`}>
                  {deliverable.count} × {deliverable.format} in {deliverable.language}
                </li>
              ))}
            </ul>
          </div>
          <Field label="If it has to be stopped">{document.pausePolicyRef}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How anyone would tell whether it worked</CardTitle>
          <CardDescription>
            Written before anything is made, so the answer is not chosen after the fact.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Pair term="Measured by" detail={plan.primaryMetricKey} />
            <Pair term="Compared against" detail={plan.baselineSource} />
            <Pair
              term="Baseline period"
              detail={
                plan.baselineFrom === null || plan.baselineTo === null
                  ? "Not established yet"
                  : `${formatProposalDay(plan.baselineFrom, timeZone)} to ${formatProposalDay(plan.baselineTo, timeZone)}`
              }
            />
            <Pair term="Watched for" detail={`${plan.observationWindowDays} days`} />
            <Pair
              term="Figures settle after"
              detail={`${plan.reportingDelayDays} days of reporting delay, ${plan.settlementDelayDays} of settlement`}
            />
            <Pair term="Method" detail={plan.measurementMethod ?? "Not stated"} />
          </dl>
          {/* A target is an estimate, and it is labelled as one. Without its
              inputs on the same surface it would read as a promise. */}
          <Field label="Target">
            {plan.target === null
              ? "No target. Nobody could justify one from the evidence behind this proposal, and a target nothing supports is worse than none."
              : `An estimate of ${plan.target.value} ${plan.target.unit}, not a measurement and not a guarantee.`}
          </Field>
        </CardContent>
      </Card>

      {review.authority !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>What approving this actually authorizes</CardTitle>
            <CardDescription>
              The exact terms bound to this version. They are narrower than the word
              &ldquo;approve&rdquo; suggests.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <ul className="flex flex-col gap-2">
              <AuthorityLine allowed={review.authority.mayPrepareCreative}>
                Drafting the creative, up to{" "}
                {formatProposalMoney(review.authority.generationCostCeiling, "no stated limit")}
              </AuthorityLine>
              <AuthorityLine allowed={review.authority.mayReserveMediaSpend}>
                Reserving or spending any media money
              </AuthorityLine>
              <AuthorityLine allowed={review.authority.mayPublish}>
                Publishing anything to a public account
              </AuthorityLine>
              <AuthorityLine allowed={review.authority.mayConfirmCreative}>
                Confirming a finished creative as approved
              </AuthorityLine>
              <AuthorityLine allowed={review.authority.mayAuthorizeLaterVariation}>
                Authorizing later versions of the same creative
              </AuthorityLine>
            </ul>
            <p className="text-xs text-muted-foreground">
              Every finished output is reviewed on its own before it can be published, and media
              spend is authorized separately at launch.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What this proposal cannot tell you</CardTitle>
          <CardDescription>
            Stated by the proposal itself. A gap here does not make the advice unusable — it is what
            you weigh it against.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ListBlock label="Gaps" items={review.declaredGaps} empty="Nothing declared missing." />
          <ListBlock
            label="Assumptions it rests on"
            items={document.assumptions}
            empty="No assumptions were stated."
          />
          <ListBlock
            label="Limitations"
            items={document.limitations}
            empty="No limitations were stated."
          />
          {document.readiness.blockers.length > 0 ? (
            <ListBlock
              label="In the way of preparing it"
              items={document.readiness.blockers}
              empty=""
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {document.evidence.length === 0
              ? "No stored records are cited. This proposal rests on its stated assumptions alone."
              : `${document.evidence.length} stored record${document.evidence.length === 1 ? "" : "s"} from this organization are cited behind it.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthorityLine({
  allowed,
  children,
}: {
  allowed: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      {allowed ? (
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      ) : (
        <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-center font-bold">
          &minus;
        </span>
      )}
      <span className={allowed ? "" : "text-muted-foreground"}>
        <span className="font-medium">{allowed ? "Allowed: " : "Not allowed: "}</span>
        {children}
      </span>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-line">{children}</p>
    </div>
  );
}

function Pair({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="mt-1">{detail}</dd>
    </div>
  );
}

function ListBlock({
  label,
  items,
  empty,
}: {
  label: string;
  items: readonly string[];
  empty: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 list-inside list-disc">
          {items.map((item, index) => (
            <li key={`${label}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Why there are no controls, when there are none.
 *
 * Silence would read as a broken page. Each case has a different answer, and
 * only one of them is about the reader's permissions.
 */
function NoControlsNote({
  review,
  canDecide,
  canApprove,
}: {
  review: CampaignProposalReviewView;
  canDecide: boolean;
  canApprove: boolean;
}) {
  if (!canDecide && !canApprove) {
    return (
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>You are reading this, not deciding it</AlertTitle>
        <AlertDescription>
          Everything above is the full proposal and the evidence behind it. Deciding on it is for
          those who can commit the organization to the work.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>There is nothing to decide right now</AlertTitle>
      <AlertDescription>
        {review.state === "approved_for_preparation"
          ? "This has already been approved for preparation. A change of mind is handled on the campaign itself, not by deciding this again."
          : review.state === "changes_requested"
            ? "Changes were asked for. A new version has to be written before this can be decided again."
            : "This proposal is not at a point where a decision would be accepted."}
      </AlertDescription>
    </Alert>
  );
}

type PanelState =
  | { kind: "idle" }
  | { kind: "working"; decision: CampaignProposalDecisionKind }
  | { kind: "failed"; message: string }
  | { kind: "done"; decision: CampaignProposalDecisionKind; replayed: boolean };

/**
 * The four decisions, and the words each one needs.
 *
 * Changes and a dismissal both require writing: "do it differently" with no
 * detail is not an instruction, and turning down work without saying why leaves
 * the record useless to whoever reads it next. A snooze requires a date,
 * because the service refuses one without it — a snooze with no end is a silent
 * disappearance.
 */
function DecisionPanel({
  review,
  organizationId,
  canDecide,
  canApprove,
}: {
  review: CampaignProposalReviewView;
  organizationId: string;
  canDecide: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [chosen, setChosen] = useState<CampaignProposalDecisionKind | null>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");

  /**
   * One idempotency key per decision and content, reused across retries.
   *
   * A fresh key on every attempt would turn a timed-out request into a second
   * decision. Reusing the key means a retry replays the decision already
   * committed instead of recording another one.
   */
  const attempt = useRef<{ decision: string; digest: string; key: string } | null>(null);

  if (review.content.kind !== "document") return null;
  const { versionId, digest } = review.content;

  function idempotencyKeyFor(decision: CampaignProposalDecisionKind): string {
    const held = attempt.current;
    if (held && held.decision === decision && held.digest === digest) return held.key;
    const key = crypto.randomUUID();
    attempt.current = { decision, digest, key };
    return key;
  }

  async function submit(decision: CampaignProposalDecisionKind) {
    setState({ kind: "working", decision });
    const trimmed = note.trim();

    let response: Response;
    try {
      response = await fetch(
        `/api/organizations/${organizationId}/campaign-proposals/${review.proposalId}/decisions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            proposalVersionId: versionId,
            // The digest is what binds the decision to the exact words above.
            // Send it from the content that was rendered, never re-read: if the
            // proposal moved on while this page was open, the server refuses
            // rather than letting the decision land on text nobody read.
            proposalDigest: digest,
            decision,
            reason: decision === "approved_for_preparation" ? null : (trimmed || null),
            instructions: decision === "changes_requested" ? trimmed : null,
            snoozedUntil:
              decision === "snoozed" && until !== ""
                ? new Date(`${until}T00:00:00Z`).toISOString().replace(".000Z", "")
                : null,
            idempotencyKey: idempotencyKeyFor(decision),
          }),
        },
      );
    } catch {
      setState({
        kind: "failed",
        message: "That could not be sent. Nothing was recorded — try again.",
      });
      return;
    }

    const body: unknown = await response.json().catch(() => null);
    const outcome =
      typeof body === "object" && body !== null && "outcome" in body
        ? String((body as { outcome: unknown }).outcome)
        : null;

    // The status alone is not the answer. A refusal can arrive with a 200-range
    // status carrying a typed outcome, and rendering that as success would
    // report a decision nobody recorded.
    if (response.ok && (outcome === "saved" || outcome === "replayed")) {
      attempt.current = null;
      setState({ kind: "done", decision, replayed: outcome === "replayed" });
      router.refresh();
      return;
    }

    setState({ kind: "failed", message: refusalMessage(response.status, outcome) });
  }

  if (state.kind === "done") {
    return (
      <Alert>
        <Check aria-hidden="true" />
        <AlertTitle>{proposalDecisionLabel(state.decision)}</AlertTitle>
        <AlertDescription>
          {state.replayed
            ? "This was already recorded, so nothing changed. "
            : "Recorded against this exact version. "}
          {state.decision === "approved_for_preparation"
            ? "Creative preparation is authorized. Nothing has been published, and publishing needs its own approval of each finished output."
            : "Nothing has been made and nothing has been spent."}
        </AlertDescription>
      </Alert>
    );
  }

  const working = state.kind === "working";
  const needsNote = chosen === "changes_requested" || chosen === "dismissed";
  const noteReady = !needsNote || note.trim().length > 0;
  const snoozeReady = chosen !== "snoozed" || until !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your decision</CardTitle>
        <CardDescription>
          Recorded against version {review.content.versionNumber} and its exact contents. If the
          proposal changes before you decide, this is refused rather than applied to new words.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {canApprove ? (
            <Button
              type="button"
              disabled={working}
              onClick={() => {
                setChosen("approved_for_preparation");
                setState({ kind: "idle" });
              }}
              variant={chosen === "approved_for_preparation" ? "default" : "outline"}
            >
              Approve &amp; prepare creatives
            </Button>
          ) : null}
          {canDecide ? (
            <>
              <Button
                type="button"
                variant={chosen === "changes_requested" ? "default" : "outline"}
                disabled={working}
                onClick={() => {
                  setChosen("changes_requested");
                  setState({ kind: "idle" });
                }}
              >
                Request changes
              </Button>
              <Button
                type="button"
                variant={chosen === "snoozed" ? "default" : "outline"}
                disabled={working}
                onClick={() => {
                  setChosen("snoozed");
                  setState({ kind: "idle" });
                }}
              >
                Snooze
              </Button>
              <Button
                type="button"
                variant={chosen === "dismissed" ? "default" : "outline"}
                disabled={working}
                onClick={() => {
                  setChosen("dismissed");
                  setState({ kind: "idle" });
                }}
              >
                Dismiss
              </Button>
            </>
          ) : null}
        </div>

        {!canApprove && canDecide ? (
          <p className="text-xs text-muted-foreground">
            Agreeing to a proposal is an owner or admin decision, so it is not offered here. You can
            ask for changes, set it aside or turn it down.
          </p>
        ) : null}

        {chosen === "approved_for_preparation" ? (
          <p className="text-sm">
            This authorizes drafting the creative, up to{" "}
            <span className="font-medium">
              {formatProposalMoney(
                review.content.document.generationCostCeiling,
                "no stated limit",
              )}
            </span>
            . It reserves no media money and publishes nothing.
          </p>
        ) : null}

        {chosen === "snoozed" ? (
          <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
            Come back to it on
            <input
              type="date"
              aria-label="Come back to it on"
              className="rounded-lg border border-border bg-background p-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
            <span className="text-xs font-normal text-muted-foreground">
              A snooze needs a date. Without one it is not a snooze, it is a disappearance.
            </span>
          </label>
        ) : null}

        {chosen !== null && chosen !== "snoozed" ? (
          <label className="flex flex-col gap-1 text-sm font-medium">
            {chosen === "changes_requested"
              ? "What has to change"
              : chosen === "dismissed"
                ? "Why you are turning this down"
                : "Anything to note (optional)"}
            <Textarea
              aria-label={
                chosen === "changes_requested"
                  ? "What has to change"
                  : chosen === "dismissed"
                    ? "Why you are turning this down"
                    : "Anything to note"
              }
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
            />
          </label>
        ) : null}

        {chosen === "snoozed" ? (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Why (optional)
            <Textarea
              aria-label="Why"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </label>
        ) : null}

        {state.kind === "failed" ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.message}
          </p>
        ) : null}

        {chosen !== null ? (
          <>
            <Separator />
            <div>
              <Button
                type="button"
                disabled={working || !noteReady || !snoozeReady}
                onClick={() => submit(chosen)}
              >
                {working ? "Recording…" : `Record: ${proposalDecisionLabel(chosen)}`}
              </Button>
              {!noteReady ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {chosen === "changes_requested"
                    ? "Say what has to change. Nobody can act on a request that does not say."
                    : "Say why. A refusal with no reason is no use to whoever reads this next."}
                </p>
              ) : null}
              {!snoozeReady ? (
                <p className="mt-2 text-xs text-muted-foreground">Pick a date to come back to.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A refusal in words, chosen by what the server actually said. */
function refusalMessage(status: number, outcome: string | null): string {
  if (outcome === "stale_version") {
    return "This proposal changed while you were reading it, so nothing was recorded. Reload and read the new version before deciding.";
  }
  if (outcome === "conflict") {
    return "A different decision is already recorded under this attempt. Nothing was changed — reload to see where it stands.";
  }
  if (outcome === "needs_input") {
    return "That decision is missing something it needs. Nothing was recorded.";
  }
  if (status === 403) return "Your role cannot record that decision. Nothing was changed.";
  if (status === 404) return "This proposal is no longer available to you. Nothing was changed.";
  if (status === 409) {
    return "This proposal moved on while you were reading it. Nothing was recorded — reload before deciding.";
  }
  if (status === 503) {
    return "The decision could not be stored just now. Nothing was recorded — try again.";
  }
  return "That could not be recorded. Nothing was changed.";
}

function DecisionHistory({
  decisions,
  timeZone,
}: {
  decisions: readonly CampaignProposalReviewView["decisions"][number][];
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What has been decided</CardTitle>
        <CardDescription>
          Every decision is kept, against the exact version it was made on. Nothing here can be
          edited or removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {decisions.map((decision) => (
          <div key={decision.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{proposalDecisionLabel(decision.decision)}</span>
              <span className="text-xs text-muted-foreground">
                {formatProposalMoment(decision.decidedAt, timeZone)}
              </span>
              {decision.appliesToCurrentContent ? null : (
                // Said out loud, because otherwise an old approval reads as
                // though it still authorizes the words now on screen.
                <Badge variant="outline">On an earlier version</Badge>
              )}
            </div>
            {decision.instructions !== null ? (
              <p className="whitespace-pre-line">{decision.instructions}</p>
            ) : null}
            {decision.reason !== null ? (
              <p className="whitespace-pre-line text-muted-foreground">{decision.reason}</p>
            ) : null}
            {decision.snoozedUntil !== null ? (
              <p className="text-xs text-muted-foreground">
                Until {formatProposalDay(decision.snoozedUntil, timeZone)}
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
