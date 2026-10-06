"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

import { idempotencyKey, reviewDeliverable } from "@/components/campaigns/campaign-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * The second gate, as a screen: reviewing each finished output.
 *
 * This lives on Creative rather than Publishing because it is a judgement about
 * the work itself — does this artwork and these words hold up — not about where
 * it goes. Publishing answers the separate question of destination, schedule
 * and spend, and keeping them apart is what stops "the picture is fine" from
 * quietly reading as "send it".
 *
 * Two things about this screen are load-bearing:
 *
 * The content hash travels with every verdict. A review approves those exact
 * bytes, so if a re-render lands between this screen being drawn and a button
 * being pressed, the server refuses. Without that, an operator's approval could
 * silently attach to artwork they never saw.
 *
 * A rejection must say why. A rejection with no reason is not a review — the
 * person who has to fix it cannot act on it — so the control stays disabled
 * until there is a reason, rather than sending one the server would refuse.
 */

export type ReviewableDeliverable = {
  id: string;
  channel: string;
  placement: string;
  language: string;
  format: string;
  ordinal: number;
  state: string;
  currentVersion: {
    id: string;
    version: number;
    contentHash: string;
    createdAt: string;
  } | null;
  eligibility: { publishable: boolean; reasonCode?: string };
};

/** Why an output cannot be published, in words rather than codes. */
const NOT_PUBLISHABLE: Readonly<Record<string, string>> = {
  never_reviewed: "Nobody has reviewed this yet.",
  rejected: "This was rejected. It needs a new version before it can go out.",
  superseded_by_newer_version: "A newer version of this output has replaced it.",
  reviewed_different_content: "This changed after it was approved, so the approval no longer fits.",
};

const REJECTION_REASONS = [
  { code: "text_incorrect", label: "Wrong or misspelled text" },
  { code: "brand_incorrect", label: "Off-brand" },
  { code: "image_incorrect", label: "Wrong or poor image" },
  { code: "claim_unsupported", label: "Makes a claim we cannot support" },
  { code: "layout_broken", label: "Layout is broken" },
] as const;

function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

function DeliverableRow({
  deliverable,
  organizationId,
  campaignId,
  timeZone,
  canReview,
}: Readonly<{
  deliverable: ReviewableDeliverable;
  organizationId: string;
  campaignId: string;
  timeZone: string;
  canReview: boolean;
}>) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");

  const version = deliverable.currentVersion;
  const name = `${deliverable.format} · ${deliverable.language} · ${deliverable.channel}`;

  async function submit(decision: "approved" | "rejected") {
    if (!version) return;
    setBusy(decision === "approved" ? "approve" : "reject");
    setError(null);

    const result = await reviewDeliverable({
      organizationId,
      campaignId,
      deliverableVersionId: version.id,
      // The bytes this screen is actually showing. The server checks it again.
      contentHash: version.contentHash,
      decision,
      reasonCodes: decision === "rejected" ? reasons : [],
      note: note.trim() === "" ? null : note.trim(),
      idempotencyKey: idempotencyKey(),
    });

    setBusy(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    if (result.data.outcome === "content_changed") {
      setError(
        "This output changed after the page was loaded, so the review was not recorded. Reload and look at what is there now.",
      );
      return;
    }

    if (result.data.outcome === "superseded") {
      setError("A newer version has replaced this one. Reload to review the current output.");
      return;
    }

    toast.success(decision === "approved" ? "Approved" : "Rejected", {
      description: `${name} — recorded against this exact version.`,
    });
    setRejecting(false);
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {deliverable.placement}
            {version ? ` · version ${version.version}` : ""}
            {version ? ` · produced ${formatWhen(version.createdAt, timeZone)}` : ""}
          </span>
        </div>
        {deliverable.eligibility.publishable ? (
          <Badge className="gap-1">
            <CheckCircle2 className="size-3" aria-hidden="true" />
            Publishable
          </Badge>
        ) : (
          <Badge variant="outline">Not publishable</Badge>
        )}
      </div>

      {version === null ? (
        // Planned but never produced. Shown rather than hidden, so an
        // incomplete campaign looks incomplete.
        <Alert>
          <AlertTriangle />
          <AlertTitle>Not produced yet</AlertTitle>
          <AlertDescription>
            This output was planned but has not been rendered. There is nothing to review until it
            exists.
          </AlertDescription>
        </Alert>
      ) : deliverable.eligibility.publishable ? null : (
        <p className="text-xs text-muted-foreground">
          {NOT_PUBLISHABLE[deliverable.eligibility.reasonCode ?? ""] ??
            "This cannot be published yet."}
        </p>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Not recorded</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {version === null || !canReview ? null : rejecting ? (
        <div className="flex flex-col gap-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium">Why is this being rejected?</legend>
            <div className="flex flex-wrap gap-2">
              {REJECTION_REASONS.map((reason) => (
                <label
                  key={reason.code}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={reasons.includes(reason.code)}
                    onChange={(event) =>
                      setReasons((current) =>
                        event.target.checked
                          ? [...current, reason.code]
                          : current.filter((code) => code !== reason.code),
                      )
                    }
                  />
                  {reason.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`note-${deliverable.id}`} className="text-xs">
              Anything else the person fixing this should know
            </Label>
            <Textarea
              id={`note-${deliverable.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              // A rejection with no reason is not a review. Refused here rather
              // than sent and refused by the server.
              disabled={reasons.length === 0 || busy !== null}
              onClick={() => submit("rejected")}
            >
              {busy === "reject" ? <Spinner data-icon="inline-start" /> : null}
              Record rejection
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            {reasons.length === 0 ? (
              <span className="self-center text-xs text-muted-foreground">
                Pick at least one reason.
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => submit("approved")}>
            {busy === "approve" ? <Spinner data-icon="inline-start" /> : null}
            Approve this output
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
    </li>
  );
}

export function CampaignCreativeReview({
  deliverables,
  organizationId,
  campaignId,
  timeZone,
  canReview,
  readFailed = false,
}: Readonly<{
  /** `null` is never passed here; an unreadable list is reported by `readFailed`. */
  deliverables: readonly ReviewableDeliverable[];
  organizationId: string;
  campaignId: string;
  timeZone: string;
  /** Whether this viewer may record a verdict. `campaign.approve`. */
  canReview: boolean;
  /** True when the list could not be read, which is not the same as empty. */
  readFailed?: boolean;
}>) {
  const produced = deliverables.filter((entry) => entry.currentVersion !== null);
  const publishable = produced.filter((entry) => entry.eligibility.publishable);

  if (readFailed) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>The finished outputs could not be read</AlertTitle>
        <AlertDescription>
          This is not the same as there being none. Nothing here should be treated as a complete
          picture — reload, and if it keeps failing, do not authorize a publication from this screen.
        </AlertDescription>
      </Alert>
    );
  }

  if (deliverables.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlert />
          </EmptyMedia>
          <EmptyTitle>No finished outputs yet</EmptyTitle>
          <EmptyDescription>
            Creative produced under this approval appears here for review. Each one is judged on its
            own exact artwork and words before anything can be published.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Finished outputs</h2>
        <p className="text-sm text-muted-foreground">
          {publishable.length} of {produced.length} produced{" "}
          {produced.length === 1 ? "output is" : "outputs are"} cleared to publish.
          {deliverables.length > produced.length
            ? ` ${deliverables.length - produced.length} planned ${
                deliverables.length - produced.length === 1 ? "output has" : "outputs have"
              } not been produced.`
            : ""}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {deliverables.map((deliverable) => (
          <DeliverableRow
            key={deliverable.id}
            deliverable={deliverable}
            organizationId={organizationId}
            campaignId={campaignId}
            timeZone={timeZone}
            canReview={canReview}
          />
        ))}
      </ul>

    </div>
  );
}
