"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  idempotencyKey,
  requestRevision,
  type RevisionScope,
} from "@/components/campaigns/campaign-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * Asking for a revision in words.
 *
 * The scope is an explicit choice rather than something inferred from the
 * prompt. "Make the caption punchier" and "rethink this whole direction" are
 * different amounts of change, and letting a model decide which one was meant
 * would put the blast radius of an edit outside the operator's control.
 */

type ScopeOption = { value: string; label: string; description: string; scope: RevisionScope };

function scopeOptions(directionId: string | null): readonly ScopeOption[] {
  const shared: ScopeOption[] = [
    {
      value: "bundle",
      label: "The whole proposal",
      description: "Objective, directions, actions and timing may all change.",
      scope: { kind: "bundle" },
    },
    {
      value: "schedule",
      label: "Timing only",
      description: "When each action runs. The creative is left alone.",
      scope: { kind: "schedule" },
    },
  ];

  if (!directionId) return shared;

  return [
    {
      value: "copy",
      label: "Caption and hook",
      description: "Wording only, for this direction.",
      scope: { kind: "copy", directionId },
    },
    {
      value: "hashtags",
      label: "Hashtags",
      description: "The public tag set for this direction.",
      scope: { kind: "hashtags", directionId },
    },
    {
      value: "direction",
      label: "This whole direction",
      description: "Artwork, wording and tags together.",
      scope: { kind: "direction", directionId },
    },
    ...shared,
  ];
}

export function RevisionDialog({
  organizationId,
  campaignId,
  baseVersionId,
  baseDigest,
  directionId = null,
  defaultScope,
  trigger,
}: Readonly<{
  organizationId: string;
  campaignId: string;
  baseVersionId: string;
  baseDigest: string;
  directionId?: string | null;
  defaultScope: string;
  trigger: React.ReactNode;
}>) {
  const router = useRouter();
  const options = scopeOptions(directionId);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [scopeValue, setScopeValue] = useState(defaultScope);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = options.find((option) => option.value === scopeValue) ?? options[0];

  async function submit() {
    if (!selected || prompt.trim().length === 0) return;
    setPending(true);
    setError(null);

    const result = await requestRevision({
      organizationId,
      campaignId,
      // The version the operator was actually looking at, not whatever is
      // newest by the time this lands.
      baseVersionId,
      baseDigest,
      prompt: prompt.trim(),
      scope: selected.scope,
      idempotencyKey: idempotencyKey(),
    });

    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setOpen(false);
    setPrompt("");
    toast.success("Revision queued", {
      description: "A new version will appear here when generation finishes.",
    });
    // Non-optimistic: nothing on screen changes until the server has confirmed
    // and the page has re-read. A queued run has not produced a version yet.
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Revise with a prompt</DialogTitle>
          <DialogDescription>
            Describe the change in your own words. This never edits the current version.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="revision-prompt">What should change?</Label>
            <Textarea
              id="revision-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Lead with the family table rather than the dish, and drop the discount language."
              rows={4}
              maxLength={2000}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">How much may change?</legend>
            <RadioGroup value={scopeValue} onValueChange={setScopeValue} className="gap-2">
              {options.map((option) => (
                <Label
                  key={option.value}
                  className="flex items-start gap-3 rounded-md border p-3 text-sm font-normal"
                >
                  <RadioGroupItem value={option.value} className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>

          <Alert>
            <AlertTitle>This creates a new version</AlertTitle>
            <AlertDescription>
              The version you are reading stays exactly as it is. Any approval covering it stops
              applying once the new version is published.
            </AlertDescription>
          </Alert>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Revision not queued</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || prompt.trim().length === 0}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Queue revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
