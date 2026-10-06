"use client";

import { Input } from "@/components/ui/input";

/**
 * The brand's colours, as a picker beside the hex a brand book actually quotes.
 *
 * Both controls edit the same value on purpose. A brand guide names a colour as
 * `#C8102E`, and making somebody match that by eye in a colour wheel is how the
 * wrong red ends up on their artwork; equally, a brand that only knows its
 * colour by sight should not have to find its hex.
 *
 * Only filled slots are emitted. An empty string is not a colour, and passing
 * one on would fail validation at save time and silently discard the whole
 * record — the slot is simply absent instead, which is the honest answer for a
 * brand that has not chosen a third colour.
 */

const SLOTS = [
  {
    key: "primary",
    label: "Primary",
    hint: "The colour the brand is recognised by.",
    example: "#c8102e",
  },
  {
    key: "secondary",
    label: "Secondary",
    hint: "Supporting colour, if there is one.",
    example: "#1d3557",
  },
  {
    key: "tertiary",
    label: "Tertiary",
    hint: "Accent colour, if there is one.",
    example: "#f4a300",
  },
] as const;

/** A partly-typed hex is normal while editing; it is just not a colour yet. */
function isComplete(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function PaletteField({
  id,
  value,
  onChange,
  onBlur,
}: {
  id: string;
  value: unknown;
  onChange: (value: Record<string, string>) => void;
  onBlur?: () => void;
}) {
  const palette =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const slotValue = (key: string) => {
    const stored = palette[key];
    return typeof stored === "string" ? stored : "";
  };

  function set(key: string, next: string) {
    const merged: Record<string, string> = {};
    for (const slot of SLOTS) {
      const current = slot.key === key ? next : slotValue(slot.key);
      // A half-typed hex is kept so the field does not fight the person typing
      // it; it is dropped on the way into the payload, not here.
      if (current.trim()) merged[slot.key] = current.trim().toLowerCase();
    }
    onChange(merged);
  }

  return (
    <div className="flex flex-col gap-3" id={id} aria-labelledby={`${id}-label`}>
      {SLOTS.map((slot) => {
        const current = slotValue(slot.key);
        return (
          <div key={slot.key} className="flex items-center gap-3">
            <input
              type="color"
              aria-label={`${slot.label} colour picker`}
              // A picker has no way to show "unset". Three black swatches read
              // as a brand whose colours are black, so an empty slot is drawn
              // faded with a dashed edge and the text beside it stays empty.
              // The text is the record; this is only how it is picked.
              value={isComplete(current) ? current : "#ffffff"}
              onChange={(event) => set(slot.key, event.target.value)}
              onBlur={onBlur}
              className={[
                "size-9 shrink-0 cursor-pointer rounded-md bg-background p-1",
                isComplete(current)
                  ? "border border-input"
                  : "border border-dashed border-input opacity-60",
              ].join(" ")}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Input
                aria-label={slot.label}
                value={current}
                placeholder={slot.example}
                spellCheck={false}
                aria-invalid={current.trim().length > 0 && !isComplete(current)}
                onChange={(event) => set(slot.key, event.target.value)}
                onBlur={onBlur}
              />
              <span className="text-xs text-muted-foreground">
                {slot.hint}
                {current.trim() ? null : " Not set."}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
