"use client";

import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { CircleAlert, Info } from "lucide-react";

import {
  ComboboxField,
  MultiSelectField,
  type FieldOption,
} from "@/components/onboarding/fields/combobox-field";
import { MoneyField, minorUnitsHint } from "@/components/onboarding/fields/money-field";
import { MonthRangeField } from "@/components/onboarding/fields/month-range-field";
import { TagListField } from "@/components/onboarding/fields/tag-list-field";
import { WeeklyHoursField } from "@/components/onboarding/fields/weekly-hours-field";
import { useOnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { emptyWeeklyHours } from "@/domain/onboarding/vocabularies";
import { evaluateSectionCompletion } from "@/domain/onboarding/section-registry";
import { toSectionPayload } from "@/domain/onboarding/payload";
import type { OnboardingSectionKey } from "@/domain/onboarding/types";
import { ScrollArea } from "@/components/ui/scroll-area";

export type { FieldOption };

type FieldBase = {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
};

/**
 * Every onboarding answer is collected through one of these controls. The
 * control decides the shape that reaches the section payload, which is what
 * keeps answers comparable across organizations.
 */
export type SectionField = FieldBase &
  (
    | { control?: "text" }
    | { control: "textarea" }
    | { control: "select"; options: readonly FieldOption[] }
    | { control: "combobox"; options: readonly FieldOption[]; searchPlaceholder?: string }
    | {
      control: "multiselect";
      options: readonly FieldOption[];
      searchPlaceholder?: string;
    }
    | { control: "tags"; multiline?: boolean }
    | { control: "radio"; options: readonly FieldOption[] }
    | { control: "switch"; switchLabel: string }
    | { control: "weeklyHours" }
    | { control: "monthRange" }
    | { control: "money"; currencyField: string }
  );

export type SectionSaveStatus = "in_progress" | "complete";

function controlOf(field: SectionField) {
  return field.control ?? "text";
}

/** Rehydrates saved payload values into the shape each control expects. */
function initialValues(fields: readonly SectionField[], payload: Record<string, unknown>) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const stored = payload[field.name];
    switch (controlOf(field)) {
      case "multiselect":
      case "tags":
        values[field.name] = Array.isArray(stored) ? stored.map(String) : [];
        break;
      case "switch":
        values[field.name] = stored === true;
        break;
      case "money":
        values[field.name] = typeof stored === "number" ? stored : null;
        break;
      case "weeklyHours":
        values[field.name] = Array.isArray(stored) && stored.length ? stored : emptyWeeklyHours();
        break;
      case "monthRange":
        values[field.name] =
          stored && typeof stored === "object" && !Array.isArray(stored)
            ? stored
            : { start: "", end: "" };
        break;
      default:
        values[field.name] = typeof stored === "string" ? stored : "";
    }
  }
  return values;
}

export function SectionForm({
  sectionKey,
  title,
  description,
  fields,
  defaultValues = {},
  onSave,
  beforeFields,
  children,
}: {
  sectionKey: OnboardingSectionKey;
  title: string;
  description: string;
  fields: readonly SectionField[];
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
  /** Rendered above the fields, inside the scrolling body. */
  beforeFields?: React.ReactNode;
  /** Rendered below the fields, inside the scrolling body. */
  children?: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<SectionSaveStatus | null>(null);
  const workspace = useOnboardingWorkspace();
  const intent = useRef<SectionSaveStatus>("in_progress");
  const form = useForm({
    defaultValues: initialValues(fields, defaultValues),
    onSubmit: async ({ value }) => {
      setError(null);
      const payload = toSectionPayload(sectionKey, value);
      // A section is only marked complete when its deterministic requirements
      // are met. Anything short of that is saved as a draft instead of being
      // rejected, so the operator is never blocked from moving on.
      const complete =
        intent.current === "complete" &&
        evaluateSectionCompletion(sectionKey, payload).every(
          (requirement) => requirement.satisfied,
        );
      try {
        await onSave(payload, complete ? "complete" : "in_progress");
        setSavedAs(complete ? "complete" : "in_progress");
        if (intent.current === "complete") workspace?.goToNextSection();
      } catch (submissionError) {
        setSavedAs(null);
        setError(
          submissionError instanceof Error
            ? submissionError.message
            : "Section could not be saved.",
        );
      }
    },
  });

  function submit(status: SectionSaveStatus) {
    intent.current = status;
    void form.handleSubmit();
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit("in_progress");
      }}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-h-0 flex-1 px-(--card-spacing) py-5">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {beforeFields}
            <FieldGroup>
              {fields.map((config) => (
                <form.Field key={config.name} name={config.name}>
                  {(field) => {
                    const controlId = `onboarding-${sectionKey}-${config.name}`;
                    const value = field.state.value;
                    const control = controlOf(config);
                    // Group controls are not labelable elements, so they are named
                    // through aria-labelledby instead of a `for` association.
                    const grouped =
                      control === "weeklyHours" || control === "monthRange" || control === "radio";

                    return (
                      <Field>
                        <FieldLabel
                          id={`${controlId}-label`}
                          htmlFor={grouped ? undefined : controlId}
                        >
                          {config.label}
                          {config.required ? (
                            <span className="text-xs font-normal text-muted-foreground">
                              Required
                            </span>
                          ) : null}
                        </FieldLabel>
                        {control === "money" ? (
                          <form.Subscribe
                            selector={(state) =>
                              String(
                                state.values[(config as { currencyField: string }).currencyField] ??
                                "",
                              )
                            }
                          >
                            {(currency) => (
                              <>
                                <MoneyField
                                  id={controlId}
                                  value={value}
                                  currency={currency}
                                  placeholder={config.placeholder}
                                  onChange={field.handleChange}
                                  onBlur={field.handleBlur}
                                />
                                {config.description ? (
                                  <FieldDescription>{config.description}</FieldDescription>
                                ) : null}
                                {minorUnitsHint(value, currency) ? (
                                  <FieldDescription>
                                    {minorUnitsHint(value, currency)}
                                  </FieldDescription>
                                ) : null}
                              </>
                            )}
                          </form.Subscribe>
                        ) : (
                          <>
                            <SectionControl
                              config={config}
                              controlId={controlId}
                              value={value}
                              onChange={field.handleChange}
                              onBlur={field.handleBlur}
                            />
                            {config.description ? (
                              <FieldDescription>{config.description}</FieldDescription>
                            ) : null}
                          </>
                        )}
                      </Field>
                    );
                  }}
                </form.Field>
              ))}
            </FieldGroup>
            {children}
            {error ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Save failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </ScrollArea>
      <form.Subscribe
        selector={(state) => ({ isSubmitting: state.isSubmitting, values: state.values })}
      >
        {({ isSubmitting, values }) => {
          const missing = evaluateSectionCompletion(
            sectionKey,
            toSectionPayload(sectionKey, values),
          ).filter((requirement) => !requirement.satisfied);
          return (
            <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-card px-(--card-spacing) py-4">
              {missing.length > 0 ? (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {missing.length} more to mark this section complete:{" "}
                    <span className="font-medium text-foreground">
                      {missing.map((requirement) => requirement.label).join(", ")}
                    </span>
                  </span>
                </p>
              ) : savedAs === "complete" ? (
                <p className="text-xs text-muted-foreground">
                  All requirements for this section are met.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Every requirement is answered. Save and continue to mark this section complete.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => submit("in_progress")}
                >
                  {isSubmitting && intent.current === "in_progress" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Save draft
                </Button>
                <Button type="button" disabled={isSubmitting} onClick={() => submit("complete")}>
                  {isSubmitting && intent.current === "complete" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Save and continue
                </Button>
              </div>
            </div>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

function SectionControl({
  config,
  controlId,
  value,
  onChange,
  onBlur,
}: {
  config: SectionField;
  controlId: string;
  value: unknown;
  onChange: (value: never) => void;
  onBlur: () => void;
}) {
  const change = onChange as (next: unknown) => void;

  switch (controlOf(config)) {
    case "textarea":
      return (
        <Textarea
          id={controlId}
          value={String(value ?? "")}
          placeholder={config.placeholder}
          onBlur={onBlur}
          onChange={(event) => change(event.target.value)}
        />
      );
    case "select":
      return (
        <Select value={String(value ?? "")} onValueChange={change}>
          <SelectTrigger id={controlId} className="w-full">
            <SelectValue placeholder={config.placeholder ?? "Select an option"} />
          </SelectTrigger>
          <SelectContent>
            {(config as { options: readonly FieldOption[] }).options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "combobox":
      return (
        <ComboboxField
          id={controlId}
          value={String(value ?? "")}
          options={(config as { options: readonly FieldOption[] }).options}
          placeholder={config.placeholder ?? "Select an option"}
          searchPlaceholder={(config as { searchPlaceholder?: string }).searchPlaceholder}
          onChange={change}
          onBlur={onBlur}
        />
      );
    case "multiselect":
      return (
        <MultiSelectField
          id={controlId}
          values={Array.isArray(value) ? value.map(String) : []}
          options={(config as { options: readonly FieldOption[] }).options}
          placeholder={config.placeholder ?? "Select all that apply"}
          searchPlaceholder={(config as { searchPlaceholder?: string }).searchPlaceholder}
          onChange={change}
          onBlur={onBlur}
        />
      );
    case "tags":
      return (
        <TagListField
          id={controlId}
          values={Array.isArray(value) ? value.map(String) : []}
          placeholder={config.placeholder}
          multiline={(config as { multiline?: boolean }).multiline}
          addLabel={`Add ${config.label.toLowerCase()}`}
          onChange={change}
          onBlur={onBlur}
        />
      );
    case "radio":
      return (
        <RadioGroup
          id={controlId}
          aria-labelledby={`${controlId}-label`}
          value={String(value ?? "")}
          onValueChange={(next) => {
            change(next);
            onBlur();
          }}
          className="gap-2"
        >
          {(config as { options: readonly FieldOption[] }).options.map((option) => (
            <FieldLabel
              key={option.value}
              htmlFor={`${controlId}-${option.value}`}
              className="items-start rounded-lg p-3 ring-1 ring-foreground/10 has-data-checked:ring-primary/40"
            >
              <RadioGroupItem
                id={`${controlId}-${option.value}`}
                value={option.value}
                className="mt-0.5"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{option.label}</span>
                {option.description ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </FieldLabel>
          ))}
        </RadioGroup>
      );
    case "switch":
      return (
        <div className="flex items-center gap-2.5">
          <Switch id={controlId} checked={value === true} onCheckedChange={change} />
          <label htmlFor={controlId} className="text-sm">
            {(config as { switchLabel: string }).switchLabel}
          </label>
        </div>
      );
    case "weeklyHours":
      return <WeeklyHoursField id={controlId} value={value} onChange={change} onBlur={onBlur} />;
    case "monthRange":
      return <MonthRangeField id={controlId} value={value} onChange={change} onBlur={onBlur} />;
    default:
      return (
        <Input
          id={controlId}
          value={String(value ?? "")}
          placeholder={config.placeholder}
          onBlur={onBlur}
          onChange={(event) => change(event.target.value)}
        />
      );
  }
}
