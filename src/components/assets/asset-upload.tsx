"use client";

import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { useState } from "react";

import { ownershipChoice } from "@/components/assets/asset-vocabulary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ASSET_OWNERSHIPS, type AssetOwnership } from "@/domain/campaigns/asset-library";

/**
 * Adding a reference, and the one question that changes what may be done with it.
 *
 * `exact_match` — copying a reference closely rather than taking inspiration
 * from it — is gated on `ownership = 'owned'`. That gate is only as good as the
 * answer given here, so the question is asked in plain words rather than as a
 * checkbox labelled "owned", and the safe answer is the one already selected.
 * An operator who does not read the question ends up with the conservative
 * outcome, which is the correct way round for a claim about someone else's
 * copyright.
 *
 * Each file in a batch reports its own outcome. A summary that says "3 of 5
 * uploaded" leaves the operator to work out which two, and they will guess.
 */

export type UploadOutcome = {
  fileName: string;
  state: "uploading" | "uploaded" | "failed";
  /** Present on failure, and written for the operator rather than the log. */
  message: string | null;
};

export type UploadRequest = {
  label: string;
  ownership: AssetOwnership;
};

type AssetUploadProps = {
  outcomes: readonly UploadOutcome[];
  onUpload: (request: UploadRequest) => void;
  pending?: boolean;
};

const OUTCOME_ICON = {
  uploading: Loader2,
  uploaded: CheckCircle2,
  failed: CircleAlert,
} as const;

export function AssetUpload({ outcomes, onUpload, pending = false }: AssetUploadProps) {
  const [label, setLabel] = useState("");
  const [ownership, setOwnership] = useState<AssetOwnership>("third_party");
  const [missingLabel, setMissingLabel] = useState(false);

  function submit() {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      setMissingLabel(true);
      return;
    }
    setMissingLabel(false);
    onUpload({ label: trimmed, ownership });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="asset-upload-label">What is this a picture of?</Label>
        <Input
          id="asset-upload-label"
          dir="auto"
          value={label}
          maxLength={160}
          onChange={(event) => {
            setLabel(event.target.value);
            setMissingLabel(false);
          }}
          placeholder="Kingfish curry in a clay pot"
          disabled={pending}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Who made this?</legend>
        <RadioGroup
          value={ownership}
          onValueChange={(next) => setOwnership(next as AssetOwnership)}
          disabled={pending}
        >
          {ASSET_OWNERSHIPS.map((option) => {
            const choice = ownershipChoice(option);
            return (
              <div key={option} className="flex items-start gap-2.5">
                <RadioGroupItem value={option} id={`ownership-${option}`} className="mt-1" />
                <div className="flex flex-col">
                  <Label htmlFor={`ownership-${option}`} className="font-normal">
                    {choice.label}
                  </Label>
                  <span className="text-xs text-muted-foreground">{choice.help}</span>
                </div>
              </div>
            );
          })}
        </RadioGroup>
      </fieldset>

      {missingLabel ? (
        <p role="alert" className="text-sm text-destructive">
          Give this a name. A reference nobody can name is a reference nobody will find again.
        </p>
      ) : null}

      {outcomes.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5">
          {outcomes.map((entry) => {
            const Icon = OUTCOME_ICON[entry.state];
            return (
              <li key={entry.fileName} className="flex items-center gap-2 text-sm">
                <Icon
                  className={
                    entry.state === "failed"
                      ? "size-4 text-destructive"
                      : entry.state === "uploading"
                        ? "size-4 animate-spin text-muted-foreground"
                        : "size-4 text-muted-foreground"
                  }
                />
                <span dir="auto" className="truncate">
                  {entry.fileName}
                </span>
                {entry.message === null ? null : (
                  // The reason sits beside the file it belongs to. A separate
                  // error block would say the same sentence twice and still
                  // leave the operator matching messages to filenames.
                  <span
                    role={entry.state === "failed" ? "alert" : undefined}
                    className={
                      entry.state === "failed"
                        ? "text-xs text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {entry.message}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <Button type="button" onClick={submit} disabled={pending}>
          Add to library
        </Button>
      </div>
    </div>
  );
}
