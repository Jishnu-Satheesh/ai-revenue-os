"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Open-ended list input for values that cannot come from a fixed vocabulary
 * (branch names, goal statements, catalog items). Each entry is stored as its
 * own array element rather than a delimiter-joined string, so a semicolon in an
 * answer can never split one entry into two.
 */
export function TagListField({
  id,
  values,
  placeholder,
  invalid,
  multiline = false,
  addLabel = "Add",
  onChange,
  onBlur,
}: {
  id: string;
  values: readonly string[];
  placeholder?: string;
  invalid?: boolean;
  multiline?: boolean;
  addLabel?: string;
  onChange: (values: string[]) => void;
  onBlur?: () => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const entry = draft.trim();
    if (!entry || values.includes(entry)) {
      setDraft("");
      return;
    }
    onChange([...values, entry]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          aria-invalid={invalid}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            commit();
            onBlur?.();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit();
          }}
        />
        <Button type="button" variant="outline" size="icon" aria-label={addLabel} onClick={commit}>
          <Plus />
        </Button>
      </div>
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>
              {multiline ? (
                <span className="flex max-w-full items-start gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 break-words">{value}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${value}`}
                    className="mt-0.5 shrink-0 opacity-60 transition-opacity hover:opacity-100"
                    onClick={() => onChange(values.filter((_, position) => position !== index))}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ) : (
                <Badge variant="secondary" className="max-w-full gap-1 pr-1">
                  <span className="truncate">{value}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${value}`}
                    className="shrink-0 rounded-sm opacity-60 transition-opacity hover:opacity-100"
                    onClick={() => onChange(values.filter((_, position) => position !== index))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
