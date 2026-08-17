"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type CsvColumnMappingEntry = {
  header: string;
  include: boolean;
  targetField: string;
};

export type MetricTargetChoice = {
  key: string;
  label: string;
  importable: boolean;
};

/**
 * Targets the metric projection reads itself rather than as a metric key. They
 * carry the row's period and dimensions, and a metrics import is useless
 * without `period`.
 */
export const ROW_CONTEXT_TARGETS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "period", label: "Date or timestamp of the row" },
  { key: "channel", label: "Sales channel" },
  { key: "currency", label: "Currency code" },
];

/**
 * Turns a CSV header into a stable target-field suggestion.
 *
 * Deliberately does not guess a metric key. Deciding that a column called
 * "Total" is `revenue.gross` is a judgement the operator makes and confirms;
 * inferring it here would put an unreviewed mapping behind a real number.
 */
export function suggestTargetField(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function toColumnMapping(entries: readonly CsvColumnMappingEntry[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.include || !entry.targetField.trim()) continue;
    mapping[entry.targetField.trim()] = entry.header;
  }
  return mapping;
}

/** True once a mapping claims at least one metric key, which makes `period` required. */
export function mappingNeedsPeriod(entries: readonly CsvColumnMappingEntry[]): boolean {
  const included = entries.filter((entry) => entry.include);
  const claimsMetric = included.some((entry) => entry.targetField.includes("."));
  return claimsMetric && !included.some((entry) => entry.targetField.trim() === "period");
}

/**
 * The operator maps each kept column onto a target. Registered metric keys are
 * offered directly, because they are the vocabulary the metric registry
 * actually resolves; a free-typed target is still accepted, since
 * `column_mapping` is shared configuration and other consumers own their own
 * target names. The server re-validates every pair against the uploaded header
 * row before anything is stored.
 */
export function CsvMappingForm({
  entries,
  metricTargets,
  onChange,
  disabled,
}: Readonly<{
  entries: readonly CsvColumnMappingEntry[];
  metricTargets: readonly MetricTargetChoice[];
  onChange: (entries: CsvColumnMappingEntry[]) => void;
  disabled?: boolean;
}>) {
  function update(index: number, patch: Partial<CsvColumnMappingEntry>) {
    onChange(
      entries.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  return (
    <FieldGroup>
      <FieldDescription>
        Choose the columns to import and the field each one becomes. Cell values are never read in
        the browser.
      </FieldDescription>

      {mappingNeedsPeriod(entries) ? (
        <p role="status" className="text-sm text-destructive">
          Map one column to “period”. Metrics cannot be imported without the date each row belongs
          to.
        </p>
      ) : null}

      {entries.map((entry, index) => (
        <Field key={entry.header} orientation="responsive">
          <FieldLabel htmlFor={`csv-target-${index}`}>{entry.header}</FieldLabel>
          <div className="flex items-center gap-3">
            <Checkbox
              id={`csv-include-${index}`}
              aria-label={`Include ${entry.header}`}
              checked={entry.include}
              disabled={disabled}
              onCheckedChange={(checked) => update(index, { include: checked === true })}
            />
            <TargetPicker
              id={`csv-target-${index}`}
              header={entry.header}
              value={entry.targetField}
              metricTargets={metricTargets}
              disabled={disabled || !entry.include}
              onSelect={(targetField) => update(index, { targetField })}
            />
          </div>
        </Field>
      ))}
    </FieldGroup>
  );
}

function TargetPicker({
  id,
  header,
  value,
  metricTargets,
  disabled,
  onSelect,
}: Readonly<{
  id: string;
  header: string;
  value: string;
  metricTargets: readonly MetricTargetChoice[];
  disabled?: boolean;
  onSelect: (value: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const importable = metricTargets.filter((target) => target.importable);
  const rateOnly = metricTargets.filter((target) => !target.importable);
  const typed = search.trim();
  const isKnown =
    ROW_CONTEXT_TARGETS.some((target) => target.key === typed) ||
    metricTargets.some((target) => target.key === typed);

  function choose(next: string) {
    onSelect(next);
    setSearch("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Target field for ${header}`}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!value && "text-muted-foreground")}>{value || "Not mapped"}</span>
          <ChevronsUpDown className="size-4 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search targets, or type your own"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No matching target.</CommandEmpty>

            <CommandGroup heading="Row context">
              {ROW_CONTEXT_TARGETS.map((target) => (
                <CommandItem
                  key={target.key}
                  value={target.key}
                  onSelect={() => choose(target.key)}
                >
                  <Check
                    className={cn("size-4", value === target.key ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="font-medium">{target.key}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{target.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {importable.length > 0 ? (
              <CommandGroup heading="Metrics">
                {importable.map((target) => (
                  <CommandItem
                    key={target.key}
                    value={target.key}
                    onSelect={() => choose(target.key)}
                  >
                    <Check
                      className={cn("size-4", value === target.key ? "opacity-100" : "opacity-0")}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{target.key}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{target.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {rateOnly.length > 0 ? (
              // Listed but unselectable. A rate needs a numerator and a
              // denominator, and one column can only carry the quotient, so
              // choosing it here would reject every row at import time.
              <CommandGroup heading="Rates — need two columns, not yet supported">
                {rateOnly.map((target) => (
                  <CommandItem key={target.key} value={target.key} disabled>
                    <span className="size-4" aria-hidden="true" />
                    <span>{target.key}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{target.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {typed && !isKnown ? (
              <CommandGroup heading="Other">
                <CommandItem value={`custom-${typed}`} onSelect={() => choose(typed)}>
                  <span className="size-4" aria-hidden="true" />
                  Use “{typed}” as a plain field
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
