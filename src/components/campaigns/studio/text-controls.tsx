"use client";

import { Info, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RenderableScript } from "@/domain/campaigns/poster-template";
import type { PosterStudioCopy } from "@/modules/campaigns/application/poster-studio-view";

/**
 * The words, with what they were beside what they are.
 *
 * Every field shows its original value the moment it differs, because an
 * operator editing approved copy is changing something a person signed off.
 * "Original" is not nostalgia — it is the thing the approval was given for, and
 * being able to see it is what makes reverting a decision rather than a guess.
 *
 * **The offer line is not an input, and that is deliberate.** The manifest holds
 * no governed short offer sentence: `lockedOfferRef` is an internal key, the
 * brief's offer text never reaches the manifest, and the only money-typed
 * fields are advertising spend ceilings rather than prices. A text box here
 * would be the one place in the product where somebody could type "50% off"
 * onto artwork nobody approved. So it is shown with its reason, and supplying
 * one is described as what it is: a manifest change with its own approval.
 */

const SCRIPT_DIRECTION: Readonly<Record<RenderableScript, "ltr" | "rtl">> = {
  Latn: "ltr",
  Mlym: "ltr",
  Arab: "rtl",
};

export type StudioTextDraft = {
  readonly hook: string;
  readonly callToAction: string;
  /** Poster-only and ungoverned. Never written back to the manifest. */
  readonly extra: string;
};

function Field({
  id,
  label,
  original,
  value,
  dir,
  multiline,
  maxLength,
  disabled,
  hint,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  /** Null for a field with nothing approved behind it, such as the free line. */
  original: string | null;
  value: string;
  dir: "ltr" | "rtl";
  multiline?: boolean;
  maxLength: number;
  disabled: boolean;
  hint?: string;
  onChange: (next: string) => void;
}>) {
  const changed = original !== null && value !== original;
  const Control = multiline ? Textarea : Input;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {changed ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-1.5 py-0.5 text-xs"
            onClick={() => onChange(original)}
          >
            <RotateCcw aria-hidden="true" />
            Revert
          </Button>
        ) : null}
      </div>

      <Control
        id={id}
        dir={dir}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />

      {changed ? (
        <p className="text-xs text-muted-foreground">
          Original: <span dir={dir}>“{original}”</span>
        </p>
      ) : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextControls({
  copy,
  draft,
  script,
  canEdit,
  onChange,
}: Readonly<{
  /** Null when this template's placement has no copy in the campaign. */
  copy: PosterStudioCopy | null;
  draft: StudioTextDraft;
  script: RenderableScript;
  /** `campaign.edit`. A viewer reads the words and changes none of them. */
  canEdit: boolean;
  onChange: (next: StudioTextDraft) => void;
}>) {
  const dir = SCRIPT_DIRECTION[script];

  if (!copy) {
    return (
      <p className="text-sm text-muted-foreground">
        This campaign wrote no copy for this template&apos;s placement, so there are no words to
        edit. Choose a template on the Layout tab whose placement this campaign covers.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Field
        id="studio-hook"
        label="Headline"
        original={copy.hook}
        value={draft.hook}
        dir={dir}
        maxLength={200}
        disabled={!canEdit}
        onChange={(hook) => onChange({ ...draft, hook })}
      />

      {/* Shown, never an input. See the note at the top of this file. */}
      <div className="flex flex-col gap-1.5">
        <Label>Offer line</Label>
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Nothing in the approved campaign supplies one.
        </p>
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            A poster may only draw an offer the campaign actually recorded. Adding one changes what
            was approved, so it is a new proposal version rather than an edit here — and templates
            that require an offer line stay unavailable until there is one.
          </span>
        </p>
      </div>

      <Field
        id="studio-cta"
        label="Call to action"
        original={copy.callToAction}
        value={draft.callToAction}
        dir={dir}
        maxLength={120}
        disabled={!canEdit}
        onChange={(callToAction) => onChange({ ...draft, callToAction })}
      />

      <Field
        id="studio-extra"
        label="Free line"
        original={null}
        value={draft.extra}
        dir={dir}
        multiline
        maxLength={200}
        disabled={!canEdit}
        hint="The one line you write yourself. It is checked against this campaign's evidence before it can be drawn, so it cannot promise an offer the campaign never recorded. It belongs to the poster, not to the approved copy."
        onChange={(extra) => onChange({ ...draft, extra })}
      />

      {canEdit ? null : (
        <p className="text-sm text-muted-foreground">
          Your role can read the Studio but not change the words.
        </p>
      )}
    </div>
  );
}
