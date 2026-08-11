"use client";

import { Plus, X } from "lucide-react";

import { MoneyField } from "@/components/onboarding/fields/money-field";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { costConfidenceOptions, costRateEntriesSchema } from "@/domain/onboarding/vocabularies";
import type { CostRateEntry } from "@/domain/onboarding/vocabularies";

/**
 * A cost component the organization may price, as registered in the catalog.
 *
 * The rows are driven by this list rather than a hard-coded one, so the
 * Restaurant Pack's components appear today and a distributor's freight and
 * returns appear later without touching this control.
 */
export type CostComponentOption = {
  key: string;
  label: string;
  computationKind: "fixed_amount" | "rate_of_revenue" | "per_unit" | "sourced";
};

const ALL_CHANNELS = "__all__";

/** What the operator is actually being asked for, per computation kind. */
const kindHint: Record<CostComponentOption["computationKind"], string> = {
  rate_of_revenue: "Share of revenue",
  fixed_amount: "Per order",
  per_unit: "Per item",
  sourced: "From provider reports",
};

function normalize(value: unknown): CostRateEntry[] {
  const parsed = costRateEntriesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function rowKey(entry: { componentKey: string; channel: string | null }) {
  return `${entry.componentKey}::${entry.channel ?? ""}`;
}

/**
 * Collects what each order costs, one row per registered cost component.
 *
 * Two rules shape it. A cost that genuinely does not apply is entered as zero
 * rather than left blank — dine-in commission really is zero, and saying so is
 * what turns an `indicative` margin into a real one. And every row carries how
 * well the operator knows the number, because a guess recorded as a fact is the
 * one input that can make a margin confidently wrong.
 */
export function CostRateField({
  id,
  value,
  components,
  channels,
  currency,
  onChange,
  onBlur,
}: {
  id: string;
  value: unknown;
  components: readonly CostComponentOption[];
  /** Channels the operator already named, offered as scopes for an override. */
  channels: readonly string[];
  currency: string;
  onChange: (value: CostRateEntry[]) => void;
  onBlur?: () => void;
}) {
  const entries = normalize(value);
  const byRow = new Map(entries.map((entry) => [rowKey(entry), entry]));

  // Every registered component gets a row whether or not it is priced yet, then
  // any channel-specific overrides the operator added beneath it.
  const rows = components.flatMap((component) => [
    { component, channel: null as string | null },
    ...entries
      .filter((entry) => entry.componentKey === component.key && entry.channel !== null)
      .map((entry) => ({ component, channel: entry.channel })),
  ]);

  function write(next: CostRateEntry[]) {
    onChange(next);
    onBlur?.();
  }

  function update(
    component: CostComponentOption,
    channel: string | null,
    patch: Partial<CostRateEntry>,
  ) {
    const key = rowKey({ componentKey: component.key, channel });
    const existing = byRow.get(key);

    const merged: CostRateEntry = {
      componentKey: component.key,
      channel,
      percent: null,
      amountMinor: null,
      // An unstated confidence is a guess, which is the safe reading: it grades
      // the margin `partial` rather than letting a typed number pass as measured.
      confidence: existing?.confidence ?? "assumed",
      ...existing,
      ...patch,
    };

    // A cleared all-channels row is dropped rather than stored as a blank: its
    // row is always on screen anyway, and an empty entry would claim the
    // operator answered when they did not. A channel override is kept even
    // while empty, because the operator added it deliberately and it would
    // otherwise vanish the moment it appeared.
    const cleared = merged.percent === null && merged.amountMinor === null;
    const remaining = entries.filter((entry) => rowKey(entry) !== key);
    write(cleared && channel === null ? remaining : [...remaining, merged]);
  }

  function addChannelOverride(component: CostComponentOption, channel: string) {
    if (byRow.has(rowKey({ componentKey: component.key, channel }))) return;
    write([
      ...entries,
      {
        componentKey: component.key,
        channel,
        percent: null,
        amountMinor: null,
        confidence: "assumed",
      },
    ]);
  }

  function removeRow(component: CostComponentOption, channel: string | null) {
    write(
      entries.filter((entry) => rowKey(entry) !== rowKey({ componentKey: component.key, channel })),
    );
  }

  const unusedChannelsFor = (component: CostComponentOption) =>
    channels.filter((channel) => !byRow.has(rowKey({ componentKey: component.key, channel })));

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={`${id}-label`}
      className="flex flex-col gap-1 rounded-lg ring-1 ring-foreground/10"
    >
      {rows.map(({ component, channel }) => {
        const entry = byRow.get(rowKey({ componentKey: component.key, channel }));
        const controlId = `${id}-${component.key}-${channel ?? ALL_CHANNELS}`;
        const sourced = component.computationKind === "sourced";
        const scopeLabel = channel ?? "All channels";
        const name = channel ? `${component.label} on ${channel}` : component.label;

        return (
          <div
            key={controlId}
            className="flex flex-wrap items-center gap-3 px-3 py-2 not-last:border-b not-last:border-border/60"
          >
            <div className="flex min-w-44 flex-col gap-0.5">
              <span className="text-sm font-medium">{component.label}</span>
              <span className="text-xs text-muted-foreground">
                {kindHint[component.computationKind]}
                {channel ? ` · ${scopeLabel}` : null}
              </span>
            </div>

            {sourced ? (
              // Not typeable, and saying why is the point. Leaving an enabled
              // empty box would read as the operator's omission when it is
              // actually waiting on a provider report.
              <span className="text-sm text-muted-foreground">
                Comes from your provider reports.
              </span>
            ) : (
              <>
                <div className="w-40">
                  {component.computationKind === "rate_of_revenue" ? (
                    <InputGroup>
                      <InputGroupInput
                        id={controlId}
                        inputMode="decimal"
                        aria-label={`${name} percentage`}
                        placeholder="0"
                        value={entry?.percent ?? ""}
                        onChange={(event) => {
                          const next = event.target.value.trim();
                          update(component, channel, {
                            percent: next === "" ? null : Number(next),
                            amountMinor: null,
                          });
                        }}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>%</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  ) : (
                    <MoneyField
                      id={controlId}
                      value={entry?.amountMinor ?? null}
                      currency={currency}
                      placeholder="0"
                      ariaLabel={`${name} amount`}
                      onChange={(amountMinor) =>
                        update(component, channel, { amountMinor, percent: null })
                      }
                    />
                  )}
                </div>

                <Select
                  value={entry?.confidence ?? ""}
                  onValueChange={(confidence) =>
                    update(component, channel, {
                      confidence: confidence as CostRateEntry["confidence"],
                    })
                  }
                >
                  <SelectTrigger className="w-56" aria-label={`${name} confidence`}>
                    <SelectValue placeholder="How well do you know this?" />
                  </SelectTrigger>
                  <SelectContent>
                    {costConfidenceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {channel ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove the ${scopeLabel} rate for ${component.label}`}
                    onClick={() => removeRow(component, channel)}
                  >
                    <X data-icon="inline-start" />
                    Remove
                  </Button>
                ) : (
                  unusedChannelsFor(component).length > 0 && (
                    <Select value="" onValueChange={(next) => addChannelOverride(component, next)}>
                      <SelectTrigger
                        className="w-52"
                        aria-label={`Add a channel-specific rate for ${component.label}`}
                      >
                        <SelectValue
                          placeholder={
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Plus className="size-3.5" aria-hidden="true" />
                              Differs by channel
                            </span>
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {unusedChannelsFor(component).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                )}
              </>
            )}
          </div>
        );
      })}

      <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
        Enter zero where a cost genuinely does not apply — that is an answer, and it is what turns a
        bounded margin into a real one. Leave a cost blank if you do not know it yet; it will be
        named as missing rather than counted as nothing.
      </p>
    </div>
  );
}
