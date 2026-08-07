"use client";

import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useOnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";

export type SectionField = {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  multiline?: boolean;
  required?: boolean;
};

export type SectionSaveStatus = "in_progress" | "complete";

export function SectionForm({
  title,
  description,
  fields,
  defaultValues,
  onSave,
}: {
  title: string;
  description: string;
  fields: readonly SectionField[];
  defaultValues: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const workspace = useOnboardingWorkspace();
  const intent = useRef<SectionSaveStatus>("in_progress");
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await onSave(value, intent.current);
        if (intent.current === "complete") workspace?.completeCurrentSection();
      } catch (submissionError) {
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
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit("in_progress");
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <FieldGroup>
        {fields.map((config) => (
          <form.Field
            key={config.name}
            name={config.name}
            validators={{
              onBlur: ({ value }) =>
                config.required && !String(value ?? "").trim()
                  ? `${config.label} is required.`
                  : undefined,
            }}
          >
            {(field) => {
              const invalid = field.state.meta.errors.length > 0;
              const controlId = `onboarding-${config.name}`;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={controlId}>{config.label}</FieldLabel>
                  {config.multiline ? (
                    <Textarea
                      id={controlId}
                      value={field.state.value ?? ""}
                      placeholder={config.placeholder}
                      aria-invalid={invalid}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  ) : (
                    <Input
                      id={controlId}
                      value={field.state.value ?? ""}
                      placeholder={config.placeholder}
                      aria-invalid={invalid}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  )}
                  {config.description ? (
                    <FieldDescription>{config.description}</FieldDescription>
                  ) : null}
                  {invalid ? (
                    <FieldError
                      errors={field.state.meta.errors.map((message) => ({
                        message: String(message),
                      }))}
                    />
                  ) : null}
                </Field>
              );
            }}
          </form.Field>
        ))}
      </FieldGroup>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <form.Subscribe selector={(state) => ({ isSubmitting: state.isSubmitting })}>
        {({ isSubmitting }) => (
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
        )}
      </form.Subscribe>
    </form>
  );
}
