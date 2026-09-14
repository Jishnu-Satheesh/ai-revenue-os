"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { brandVoiceOptions } from "@/domain/onboarding/vocabularies";
import { missingDetailLabel } from "@/domain/campaigns/readiness";

/**
 * Collecting the evidence a campaign said it was missing, where it was said.
 *
 * The failure names its gaps precisely and the only answer used to be a trip to
 * onboarding, which did not work anyway: the section was never promoted, and
 * the campaign generates from evidence pinned before the trip.
 *
 * Three rules shape it.
 *
 * It asks only for what is missing. Re-asking everything would be the
 * onboarding trip again, in a smaller window.
 *
 * It asks in words. `primary_metric` and `baseline_source` are not two gaps in
 * an operator's head — they are one question, "how will we know this worked",
 * and they come from one goal.
 *
 * It never offers an input that writes nowhere. A gap this dialog cannot close
 * is named, with where it can be closed, instead of being given a box that
 * silently does nothing.
 */

export type MissingDetailsMetricOption = {
  key: string;
  label: string;
  valueKind: "count" | "money" | "ratio" | "duration" | "rating";
};

/** The gaps this dialog can actually close. Everything else is referred out. */
const MEASUREMENT_KEYS = ["primary_metric", "baseline_source"];

/** Where a gap this dialog cannot collect is actually fixed. */
const REFERRALS: Record<string, string> = {
  organization_profile: "Set the business name in the organization's own settings.",
  brand_constraints: "Record the brand's constraints in Business Memory.",
  currency: "The organization's base currency is set when the organization is created.",
  objective: "Open the campaign and describe what it is for.",
  audience: "Open the campaign and describe who it is for.",
  no_declared_subject: "Name what this campaign is about in the Creative Studio.",
};

type BaselineStatus = "known" | "estimated" | "unknown";

/**
 * The unit a goal is counted in, taken from the metric rather than asked.
 *
 * One fewer question, and a truer answer than a free-text box: the registered
 * metric already says what kind of quantity it is.
 */
function unitFor(option: MissingDetailsMetricOption | undefined, currency: string | null): string {
  if (!option) return "count";
  if (option.valueKind === "money") return currency ?? "money";
  return option.valueKind;
}

export function MissingDetailsDialog({
  organizationId,
  campaignId,
  missingDetails,
  metricOptions,
  currency = null,
}: Readonly<{
  organizationId: string;
  campaignId: string;
  missingDetails: readonly string[];
  metricOptions: readonly MissingDetailsMetricOption[];
  /** The organization's base currency, for a money-valued goal. */
  currency?: string | null;
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [voice, setVoice] = useState<string[]>([]);
  const [metricKey, setMetricKey] = useState("");
  const [target, setTarget] = useState("");
  const [baselineStatus, setBaselineStatus] = useState<BaselineStatus>("known");
  const [baselineValue, setBaselineValue] = useState("");

  const asksVoice = missingDetails.includes("brand_voice");
  const asksMeasurement = missingDetails.some((key) => MEASUREMENT_KEYS.includes(key));
  const referred = missingDetails.filter(
    (key) => key !== "brand_voice" && !MEASUREMENT_KEYS.includes(key),
  );

  const chosenMetric = useMemo(
    () => metricOptions.find((option) => option.key === metricKey),
    [metricOptions, metricKey],
  );

  async function save() {
    setError(null);

    if (asksMeasurement && (!metricKey || target.trim() === "")) {
      setError("Choose what counts as this working, and the number you are aiming for.");
      return;
    }
    if (asksMeasurement && !Number.isFinite(Number(target))) {
      setError("The target has to be a number.");
      return;
    }
    if (
      asksMeasurement &&
      baselineStatus !== "unknown" &&
      (baselineValue.trim() === "" || !Number.isFinite(Number(baselineValue)))
    ) {
      setError("Give today's number, or say you do not know it yet.");
      return;
    }

    const body: Record<string, unknown> = {};
    if (asksVoice && voice.length > 0) body.brandVoice = voice;
    if (asksMeasurement) {
      body.goal = {
        name: chosenMetric?.label ?? metricKey,
        metricKey,
        baselineStatus,
        baselineValue: baselineStatus === "unknown" ? null : Number(baselineValue),
        targetValue: Number(target),
        unit: unitFor(chosenMetric, currency),
        currency: chosenMetric?.valueKind === "money" ? currency : null,
      };
    }

    setSaving(true);
    const response = await fetch(
      `/api/organizations/${organizationId}/campaigns/${campaignId}/evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ).catch(() => null);
    setSaving(false);

    if (!response?.ok) {
      const message =
        (await response?.json().catch(() => null))?.error?.message ??
        "The details could not be saved.";
      setError(message);
      return;
    }

    const result = (await response.json()) as { evidenceRefreshed?: boolean };
    setOpen(false);
    // Truthful either way. Saying the campaign is ready when its pinned
    // evidence did not change is what sends somebody to retry a run that must
    // fail in exactly the same way.
    if (result.evidenceRefreshed) {
      toast.success("Details saved", {
        description: "This campaign now uses the updated information. You can generate it again.",
      });
    } else {
      toast.success("Details saved", {
        description: "Nothing this campaign was waiting on has changed yet.",
      });
    }
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add the missing details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What this campaign still needs</DialogTitle>
          <DialogDescription>
            Fill these in and this campaign will be rebuilt from the updated information.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          {asksVoice ? (
            <fieldset className="flex flex-col gap-2" aria-labelledby="missing-brand-voice">
              <Label id="missing-brand-voice">Brand voice</Label>
              <FieldDescription>
                How this business sounds when it speaks to customers. Pick every trait that fits.
              </FieldDescription>
              <ToggleGroup
                type="multiple"
                variant="outline"
                className="flex flex-wrap justify-start"
                value={voice}
                onValueChange={setVoice}
              >
                {brandVoiceOptions.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </fieldset>
          ) : null}

          {asksVoice && asksMeasurement ? <Separator /> : null}

          {asksMeasurement ? (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="missing-metric">What counts as this working?</FieldLabel>
                <FieldDescription>
                  The one number this campaign is meant to move.
                </FieldDescription>
                <Select value={metricKey} onValueChange={setMetricKey}>
                  <SelectTrigger id="missing-metric" className="w-full">
                    <SelectValue placeholder="Choose a measure" />
                  </SelectTrigger>
                  <SelectContent>
                    {metricOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="missing-target">What are you aiming for?</FieldLabel>
                <Input
                  id="missing-target"
                  inputMode="decimal"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="60000"
                />
              </Field>

              <fieldset className="flex flex-col gap-2">
                <Label>What are we comparing against?</Label>
                <FieldDescription>
                  Today&apos;s number for that measure, so a result can be read as a change rather
                  than a bare figure.
                </FieldDescription>
                <RadioGroup
                  value={baselineStatus}
                  onValueChange={(value) => setBaselineStatus(value as BaselineStatus)}
                  className="gap-2"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="known" id="baseline-known" />
                    <Label htmlFor="baseline-known" className="font-normal">
                      I know today&apos;s number
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="estimated" id="baseline-estimated" />
                    <Label htmlFor="baseline-estimated" className="font-normal">
                      I can estimate it
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="unknown" id="baseline-unknown" />
                    <Label htmlFor="baseline-unknown" className="font-normal">
                      I don&apos;t know it yet
                    </Label>
                  </div>
                </RadioGroup>

                {baselineStatus === "unknown" ? (
                  // Allowed, and labelled. Accepting it quietly and failing
                  // again with the same message is the loop this work ends.
                  <p className="text-sm text-destructive">
                    Without a baseline there is nothing to measure against, so
                    &ldquo;Baseline source&rdquo; will still be missing and this campaign will not
                    build yet.
                  </p>
                ) : (
                  <Input
                    aria-label="Today's number"
                    inputMode="decimal"
                    value={baselineValue}
                    onChange={(event) => setBaselineValue(event.target.value)}
                    placeholder="42000"
                  />
                )}
              </fieldset>
            </div>
          ) : null}

          {referred.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">These cannot be fixed from here</p>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {referred.map((key) => (
                  <li key={key}>
                    <span className="font-medium text-foreground">{missingDetailLabel(key)}</span>
                    {REFERRALS[key] ? ` — ${REFERRALS[key]}` : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <FieldError>{error}</FieldError> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save and continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
