"use client";

import { useMemo, useState } from "react";
import { z } from "zod";

import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { cn } from "@/lib/utils";
import type {
  QuestionnaireItem as QuestionnaireItemSpec,
  QuestionnaireKind,
  QuestionnaireSpec,
} from "@/domain/agent-router/contracts";

export type QuestionnaireAnswers = Record<string, string | string[] | boolean>;

export type AgentQuestionnaireCardProps = {
  spec: QuestionnaireSpec;
  /** Previously saved answers (History reopen restores these). */
  savedAnswers?: Record<string, unknown>;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Single-select option values rendered disabled (e.g. the duplicate-watch
   * Update-fields choice while the schedule-update migration is unpushed
   * or the caller lacks the manage grant). Viewing and cancelling stay
   * usable; only the gated choices refuse.
   */
  disabledOptionValues?: string[];
  disabledOptionReason?: string;
  onSubmit: (answers: QuestionnaireAnswers) => void;
  onCancel?: () => void;
  className?: string;
};

const KIND_INTRO: Record<QuestionnaireKind, string> = {
  clarify: "One sentence is enough to route this correctly.",
  missing_fields: "Fill in what you can — skipped fields stay out of the request.",
  deepthink_upgrade:
    "Quick answers use memory only and never spend. DeepThink may run one bounded research task with honest progress.",
  duplicate_watch:
    "A similar watch is already running. Viewing it costs nothing; starting fresh runs a second watch.",
  evidence_window: "Advice is only as wide as the evidence window behind it.",
};

function normalizeSaved(value: unknown): string | string[] | boolean | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  return undefined;
}

function requiredMessage(item: QuestionnaireItemSpec): string {
  switch (item.kind) {
    case "date":
      return "Pick a date before continuing.";
    case "single_select":
      return "Choose one option before continuing.";
    case "multi_select":
      return "Choose at least one option before continuing.";
    case "confirm":
      return "Confirm to continue, or cancel this step.";
    case "text":
    default:
      return "An answer is needed before continuing.";
  }
}

function validateItem(
  item: QuestionnaireItemSpec,
  value: string | string[] | boolean | undefined,
): string | null {
  const text = z.string().trim();
  switch (item.kind) {
    case "text": {
      if (value === undefined || (typeof value === "string" && value.trim() === "")) {
        return item.required ? requiredMessage(item) : null;
      }
      if (typeof value !== "string") return "Use text for this answer.";
      return text.min(1).safeParse(value).success ? null : requiredMessage(item);
    }
    case "date": {
      if (value === undefined || value === "") {
        return item.required ? requiredMessage(item) : null;
      }
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        return "That date does not parse — pick a calendar date.";
      }
      return null;
    }
    case "single_select": {
      const allowed = (item.options ?? []).map((option) => option.value);
      if (typeof value !== "string" || !allowed.includes(value)) {
        return item.required ? requiredMessage(item) : null;
      }
      return null;
    }
    case "multi_select": {
      const allowed = new Set((item.options ?? []).map((option) => option.value));
      const picked = Array.isArray(value) ? value : [];
      if (item.required && picked.length === 0) {
        return requiredMessage(item);
      }
      return picked.every((entry) => allowed.has(entry))
        ? null
        : "One of the chosen options is not on the list.";
    }
    case "confirm": {
      if (value === true) return null;
      return item.required ? requiredMessage(item) : null;
    }
  }
}

/**
 * Renders one router QuestionnaireSpec (spec section 5.2). The Questionnaire
 * primitive owns order, answers plumbing, validation display, and
 * navigation; this host owns branching (duplicate-watch conditionals),
 * Zod validation, persistence keys, and transport (onSubmit).
 *
 * Controlled active item gives resume: reopening passes savedAnswers and
 * the card restarts on the first unanswered item. Validation failures
 * return to the invalid item with a QuestionnaireError.
 */
export function AgentQuestionnaireCard({
  spec,
  savedAnswers = {},
  disabled = false,
  disabledReason,
  disabledOptionValues = [],
  disabledOptionReason,
  onSubmit,
  onCancel,
  className,
}: AgentQuestionnaireCardProps) {
  const initialAnswers = useMemo<QuestionnaireAnswers>(() => {
    const answers: QuestionnaireAnswers = {};
    for (const item of spec.items) {
      const saved = normalizeSaved(savedAnswers[item.key]);
      if (saved !== undefined) answers[item.key] = saved;
      else if (item.kind === "multi_select") answers[item.key] = [];
      else if (item.kind === "confirm") answers[item.key] = false;
      else answers[item.key] = "";
    }
    return answers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.resumeKey]);

  const [answers, setAnswers] = useState<QuestionnaireAnswers>(initialAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Duplicate-watch branching: the field items only apply when the operator
  // chose to update the existing watch or start fresh anyway. Viewing or
  // cancelling needs no further answers.
  const choiceValue = spec.kind === "duplicate_watch" ? answers["choice"] : undefined;
  const visibleItems = useMemo(() => {
    if (
      spec.kind !== "duplicate_watch" ||
      choiceValue === "update_fields" ||
      choiceValue === "start_fresh"
    ) {
      return spec.items;
    }
    if (typeof choiceValue === "string" && choiceValue !== "") {
      return spec.items.filter((item) => item.key === "choice");
    }
    return spec.items;
  }, [spec, choiceValue]);

  const firstUnanswered = visibleItems.find(
    (item) => item.required && validateItem(item, answers[item.key]) !== null,
  );
  const [active, setActive] = useState<string>(
    firstUnanswered?.key ?? visibleItems[0]?.key ?? spec.items[0]?.key ?? "",
  );
  const activeItem = visibleItems.find((item) => item.key === active) ?? visibleItems[0];
  const activeIndex = activeItem
    ? visibleItems.findIndex((item) => item.key === activeItem.key)
    : 0;

  const itemDefs = useMemo(
    () => visibleItems.map((item) => ({ name: item.key, required: item.required })),
    [visibleItems],
  );

  function setAnswer(key: string, value: string | string[] | boolean) {
    setAnswers((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const failures: Record<string, string> = {};
    const unavailable = new Set(disabledOptionValues);
    for (const item of visibleItems) {
      // A gated choice picked before the gate applied (or forged) refuses
      // with the gate reason instead of travelling to the server.
      const value = answers[item.key];
      if (
        typeof value === "string" &&
        unavailable.has(value) &&
        (item.kind === "single_select" || item.kind === "multi_select")
      ) {
        failures[item.key] = disabledOptionReason ?? "That option is not available right now.";
        continue;
      }
      const message = validateItem(item, answers[item.key]);
      if (message) failures[item.key] = message;
    }
    setErrors(failures);
    const firstInvalid = visibleItems.find((item) => failures[item.key]);
    if (firstInvalid) {
      setActive(firstInvalid.key);
      return;
    }
    const normalized: QuestionnaireAnswers = {};
    for (const item of visibleItems) {
      const value = answers[item.key];
      normalized[item.key] =
        typeof value === "string"
          ? value.trim()
          : (value ?? (item.kind === "multi_select" ? [] : ""));
    }
    onSubmit(normalized);
  }

  function renderControl(item: QuestionnaireItemSpec) {
    const value = answers[item.key];
    const invalid = Boolean(errors[item.key]);
    if (item.kind === "text" || item.kind === "date") {
      return (
        <QuestionnaireInput
          type={item.kind === "date" ? "date" : "text"}
          value={typeof value === "string" ? value : ""}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onChange={(event) => setAnswer(item.key, event.target.value)}
        />
      );
    }
    if (item.kind === "confirm") {
      return (
        <QuestionnaireChoices>
          <QuestionnaireChoice
            value="yes"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => setAnswer(item.key, event.target.checked)}
          >
            Yes
          </QuestionnaireChoice>
        </QuestionnaireChoices>
      );
    }
    const multiple = item.kind === "multi_select";
    const picked =
      multiple && Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const disabledOptions = new Set(disabledOptionValues);
    return (
      <QuestionnaireChoices>
        {(item.options ?? []).map((option) => (
          <QuestionnaireChoice
            key={option.value}
            value={option.value}
            checked={picked.includes(option.value)}
            disabled={disabled || disabledOptions.has(option.value)}
            onChange={(event) => {
              if (!multiple) {
                setAnswer(item.key, option.value);
                return;
              }
              const next = event.target.checked
                ? [...picked, option.value]
                : picked.filter((entry) => entry !== option.value);
              setAnswer(item.key, next);
            }}
          >
            {option.label}
          </QuestionnaireChoice>
        ))}
      </QuestionnaireChoices>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-4", className)}
    >
      <Questionnaire
        items={itemDefs}
        item={activeItem?.key}
        defaultItem={visibleItems[0]?.key}
        onItemChange={setActive}
        onSubmit={handleSubmit}
        noValidate
        aria-label={spec.title}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{spec.title}</p>
          <QuestionnaireProgress />
        </div>
        <p className="text-sm text-muted-foreground">{KIND_INTRO[spec.kind]}</p>

        {visibleItems.map((item) => (
          <div key={item.key} hidden={activeItem?.key !== item.key}>
            <QuestionnaireItem
              name={item.key}
              required={item.required}
              multiple={item.kind === "multi_select"}
              invalid={Boolean(errors[item.key])}
            >
              <QuestionnaireTitle>{item.label}</QuestionnaireTitle>
              {item.helpText ? (
                <QuestionnaireDescription>{item.helpText}</QuestionnaireDescription>
              ) : null}
              {renderControl(item)}
              {/* Always mounted: the primitive reveals it (with the host
                  copy below) when its own pre-submit validation stops on
                  this item; the Zod gate reuses the same copy. Optional
                  items keep the primitive default, which points at Skip. */}
              <QuestionnaireError>
                {errors[item.key] ?? (item.required ? requiredMessage(item) : undefined)}
              </QuestionnaireError>
            </QuestionnaireItem>
          </div>
        ))}

        <QuestionnaireActions>
          {activeIndex > 0 ? (
            <QuestionnairePrevious disabled={disabled}>Previous</QuestionnairePrevious>
          ) : null}
          {activeItem && !activeItem.required ? (
            <QuestionnaireSkip disabled={disabled}>Skip</QuestionnaireSkip>
          ) : null}
          {activeIndex < visibleItems.length - 1 ? (
            <QuestionnaireNext disabled={disabled}>Next</QuestionnaireNext>
          ) : null}
          {activeIndex >= visibleItems.length - 1 ? (
            <QuestionnaireSubmit disabled={disabled}>Submit</QuestionnaireSubmit>
          ) : null}
        </QuestionnaireActions>
      </Questionnaire>

      {disabled && disabledReason ? (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      ) : null}
      {disabledOptionValues.length > 0 && disabledOptionReason ? (
        <p className="text-sm text-muted-foreground">{disabledOptionReason}</p>
      ) : null}
      {onCancel ? (
        <button
          type="button"
          className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={onCancel}
        >
          Cancel this step
        </button>
      ) : null}
    </div>
  );
}
