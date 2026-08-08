"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type CsvColumnMappingEntry = {
  header: string;
  include: boolean;
  targetField: string;
};

/** Turns a CSV header into a stable target-field suggestion. */
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

/**
 * V1 has no downstream ingestion vocabulary yet, so the operator names the
 * target field for each column they keep. The server re-validates every pair
 * against the uploaded header row before anything is stored.
 */
export function CsvMappingForm({
  entries,
  onChange,
  disabled,
}: Readonly<{
  entries: readonly CsvColumnMappingEntry[];
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
        Choose the columns to import and name the field each one becomes. Cell values are never read
        in the browser.
      </FieldDescription>
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
            <Input
              id={`csv-target-${index}`}
              value={entry.targetField}
              disabled={disabled || !entry.include}
              aria-label={`Target field for ${entry.header}`}
              onChange={(event) => update(index, { targetField: event.target.value })}
            />
          </div>
        </Field>
      ))}
    </FieldGroup>
  );
}
