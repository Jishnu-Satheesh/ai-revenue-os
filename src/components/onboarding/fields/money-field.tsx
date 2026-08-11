"use client";

import { useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "@/domain/reference/currencies";

/**
 * Collects a money amount in the major units an operator actually types and
 * stores the platform's canonical integer minor units. While the operator is
 * typing, the raw text wins so reformatting never fights the caret; once the
 * field is left, the display is derived from the stored value again.
 */
export function MoneyField({
  id,
  value,
  currency,
  placeholder,
  invalid,
  ariaLabel,
  onChange,
  onBlur,
}: {
  id: string;
  value: unknown;
  currency: string;
  placeholder?: string;
  invalid?: boolean;
  /**
   * Needed only inside a grouped control, where the field's own label names the
   * group rather than this input and every row would otherwise be unnamed.
   */
  ariaLabel?: string;
  onChange: (minorUnits: number | null) => void;
  onBlur?: () => void;
}) {
  const storedMinor = typeof value === "number" ? value : null;
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <InputGroup aria-invalid={invalid}>
      <InputGroupInput
        id={id}
        inputMode="decimal"
        value={draft ?? fromMinorUnits(storedMinor, currency)}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-label={ariaLabel}
        aria-describedby={`${id}-currency`}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          onChange(next.trim() ? toMinorUnits(next, currency) : null);
        }}
        onBlur={() => {
          setDraft(null);
          onBlur?.();
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText id={`${id}-currency`}>{currency || "—"}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** Human-readable echo of what will be stored, shown under the money input. */
export function minorUnitsHint(value: unknown, currency: string) {
  if (typeof value !== "number") return null;
  const exponent = currencyExponent(currency);
  return `Stored as ${value.toLocaleString("en-US")} minor units${
    exponent === 0 ? "" : ` (${currency} ${fromMinorUnits(value, currency)})`
  }.`;
}
