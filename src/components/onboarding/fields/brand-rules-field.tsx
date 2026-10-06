"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BRAND_RULE_STRENGTHS, type BrandRule } from "@/domain/brand/guidelines";

/**
 * The brand's do's and don'ts, each marked absolute or preferred.
 *
 * The strength is not decoration and it is never inferred. An absolute rule
 * becomes a hard constraint that can stop a campaign being built; a preferred
 * one guides the work and can be departed from with the departure disclosed.
 * "Never show alcohol" and "we usually lead with the food" are different kinds
 * of statement, and a platform that cannot tell them apart either refuses work
 * it should have offered or publishes work it should have refused.
 *
 * So a rule with no strength cannot be added. Defaulting to either one would
 * put words in the operator's mouth about what the platform may publish in
 * their client's name.
 */

const STRENGTH_COPY: Record<(typeof BRAND_RULE_STRENGTHS)[number], {
  label: string;
  consequence: string;
}> = {
  hard: {
    label: "Absolute",
    consequence: "Can stop a campaign being built.",
  },
  soft: {
    label: "Preferred",
    consequence: "Guides the work; a departure is disclosed.",
  },
};

function readRules(value: unknown): BrandRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): BrandRule[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { text, strength } = entry as { text?: unknown; strength?: unknown };
    if (typeof text !== "string" || typeof strength !== "string") return [];
    if (strength !== "hard" && strength !== "soft") return [];
    return [{ text, strength }];
  });
}

export function BrandRulesField({
  id,
  value,
  onChange,
  onBlur,
  showList = true,
}: {
  id: string;
  value: unknown;
  onChange: (value: BrandRule[]) => void;
  onBlur?: () => void;
  /**
   * False where the caller already renders the rules itself. The Brand
   * Guidelines tab groups them by strength with the restricted terms, and a
   * second copy underneath would leave an operator unsure which list is the
   * one actually in force.
   */
  showList?: boolean;
}) {
  const rules = readRules(value);
  const [text, setText] = useState("");
  const [strength, setStrength] = useState<"hard" | "soft" | "">("");
  const [hint, setHint] = useState<string | null>(null);

  const trimmed = text.trim();
  const ready = trimmed.length >= 3 && strength !== "";

  function add() {
    if (!ready) {
      // Said plainly rather than by a disabled button with no explanation.
      setHint(
        trimmed.length < 3
          ? "Write the rule first."
          : "Choose whether this rule is absolute or preferred.",
      );
      return;
    }
    if (rules.some((rule) => rule.text.toLowerCase() === trimmed.toLowerCase())) {
      setHint("That rule is already on the list.");
      return;
    }
    onChange([...rules, { text: trimmed, strength: strength as "hard" | "soft" }]);
    setText("");
    setStrength("");
    setHint(null);
    onBlur?.();
  }

  return (
    <div className="flex flex-col gap-3" id={id} aria-labelledby={`${id}-label`}>
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <Input
          aria-label="Rule"
          value={text}
          placeholder="Never imply a medical benefit"
          onChange={(event) => {
            setText(event.target.value);
            setHint(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <RadioGroup
          aria-label="How strong is this rule?"
          value={strength}
          onValueChange={(next) => {
            setStrength(next as "hard" | "soft");
            setHint(null);
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          {BRAND_RULE_STRENGTHS.map((option) => (
            <label
              key={option}
              htmlFor={`${id}-strength-${option}`}
              className="flex cursor-pointer items-start gap-2 rounded-lg p-2.5 ring-1 ring-foreground/10 has-data-checked:ring-primary/40"
            >
              <RadioGroupItem id={`${id}-strength-${option}`} value={option} className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{STRENGTH_COPY[option].label}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {STRENGTH_COPY[option].consequence}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" role={hint ? "alert" : undefined}>
            {hint ?? "A rule needs both its wording and its strength."}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus data-icon="inline-start" />
            Add rule
          </Button>
        </div>
      </div>

      {showList && rules.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {rules.map((rule, index) => (
            <li
              key={`${rule.text}-${index}`}
              className="flex items-start gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm"
            >
              <Badge
                variant={rule.strength === "hard" ? "default" : "secondary"}
                className="mt-px shrink-0"
              >
                {STRENGTH_COPY[rule.strength].label}
              </Badge>
              <span className="min-w-0 flex-1 break-words">{rule.text}</span>
              <button
                type="button"
                aria-label={`Remove ${rule.text}`}
                className="mt-0.5 shrink-0 opacity-60 transition-opacity hover:opacity-100"
                onClick={() => {
                  onChange(rules.filter((_, position) => position !== index));
                  onBlur?.();
                }}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
