"use client";

import { useState } from "react";

import { reviewReasonLabel } from "@/components/assets/asset-vocabulary";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CORE_CREATIVE_REVIEW_REASON_CODES,
  RESTAURANT_CREATIVE_REVIEW_REASON_CODES,
  type CreativeReviewReasonCode,
  type CreativeReviewSubjectKind,
} from "@/domain/campaigns/asset-library";

/**
 * The review, and the one rule it exists to enforce.
 *
 * An approval needs no explanation — the operator liked it. A rejection does,
 * because a rejected image is not merely discarded: spec 019 routes it into the
 * `avoid` slot of later generations. A rejection with no reason teaches the
 * model nothing and quietly costs the client the one thing rejection was
 * supposed to buy them.
 *
 * So the button refuses, out loud, rather than submitting something the
 * database would reject anyway or — worse — accepting a reasonless rejection
 * that looks recorded and teaches nothing.
 */

export type AssetReviewSubmission = {
  subjectKind: CreativeReviewSubjectKind;
  subjectId: string;
  verdict: "approved" | "rejected";
  reasonCodes: readonly CreativeReviewReasonCode[];
  note: string | null;
};

type AssetReviewFormProps = {
  subjectKind: CreativeReviewSubjectKind;
  subjectId: string;
  onSubmit: (submission: AssetReviewSubmission) => void;
  pending?: boolean;
};

const REASON_GROUPS: ReadonlyArray<{
  heading: string;
  codes: readonly CreativeReviewReasonCode[];
}> = [
  { heading: "What went wrong", codes: CORE_CREATIVE_REVIEW_REASON_CODES },
  { heading: "For a restaurant", codes: RESTAURANT_CREATIVE_REVIEW_REASON_CODES },
];

export function AssetReviewForm({
  subjectKind,
  subjectId,
  onSubmit,
  pending = false,
}: AssetReviewFormProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reasonCodes, setReasonCodes] = useState<readonly CreativeReviewReasonCode[]>([]);
  const [note, setNote] = useState("");
  const [missingReason, setMissingReason] = useState(false);

  function toggleReason(code: CreativeReviewReasonCode) {
    setMissingReason(false);
    setReasonCodes((current) =>
      current.includes(code) ? current.filter((held) => held !== code) : [...current, code],
    );
  }

  function submit(verdict: "approved" | "rejected") {
    if (verdict === "rejected" && reasonCodes.length === 0) {
      setMissingReason(true);
      return;
    }
    const trimmed = note.trim();
    onSubmit({
      subjectKind,
      subjectId,
      verdict,
      reasonCodes: verdict === "approved" ? [] : reasonCodes,
      // An empty note is absence, not an empty sentence.
      note: trimmed.length === 0 ? null : trimmed,
    });
  }

  if (!rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => submit("approved")} disabled={pending}>
          Approve
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setRejecting(true)}
          disabled={pending}
        >
          Reject
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {REASON_GROUPS.map((group) => (
          <div key={group.heading} className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">{group.heading}</p>
            <div className="flex flex-wrap gap-2">
              {group.codes.map((code) => {
                const chosen = reasonCodes.includes(code);
                return (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    variant={chosen ? "default" : "outline"}
                    aria-pressed={chosen}
                    onClick={() => toggleReason(code)}
                    disabled={pending}
                  >
                    {reviewReasonLabel(code)}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="asset-review-note">Anything to add? (optional)</Label>
        <Textarea
          id="asset-review-note"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What would make this right?"
          disabled={pending}
        />
      </div>

      {missingReason ? (
        <p role="alert" className="text-sm text-destructive">
          Choose at least one reason. A rejection without a reason teaches the next attempt nothing.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => submit("rejected")} disabled={pending}>
          Send rejection
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setRejecting(false);
            setMissingReason(false);
            setReasonCodes([]);
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
