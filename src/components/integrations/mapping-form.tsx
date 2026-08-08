"use client";

import { useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle } from "lucide-react";
import type {
  IntegrationAccountMappingRow,
  IntegrationBranchOption,
} from "@/modules/integrations/application/ports";

const UNASSIGNED = "__unassigned__";

export const mappingFormSchema = z.object({
  mappings: z
    .array(
      z.object({
        externalResourceId: z.string().min(1),
        externalResourceLabel: z.string().min(1),
        branchId: z.string().uuid().nullable(),
        status: z.enum(["unmapped", "mapped", "ignored"]),
      }),
    )
    .max(100),
});

export type MappingFormValue = z.infer<typeof mappingFormSchema>["mappings"][number];

/**
 * Mapped resources must name a branch. The rule is enforced here for immediate
 * feedback and again by the API and the database transaction, so a bypassed
 * client can never commit a half-mapped resource.
 */
function validate(mappings: readonly MappingFormValue[]): string[] {
  return mappings
    .filter((mapping) => mapping.status === "mapped" && !mapping.branchId)
    .map((mapping) => `${mapping.externalResourceLabel} is mapped but has no branch.`);
}

export function MappingForm({
  connectionId,
  mappings,
  branches,
  canEdit,
  onSubmit,
}: Readonly<{
  connectionId: string;
  mappings: readonly IntegrationAccountMappingRow[];
  branches: readonly IntegrationBranchOption[];
  canEdit: boolean;
  onSubmit: (mappings: MappingFormValue[]) => Promise<void>;
}>) {
  const [errors, setErrors] = useState<string[]>([]);
  const errorSummary = useRef<HTMLDivElement | null>(null);
  const form = useForm({
    defaultValues: {
      mappings: mappings.map((mapping) => ({
        externalResourceId: mapping.external_resource_id,
        externalResourceLabel: mapping.external_resource_label,
        branchId: mapping.branch_id,
        status: mapping.status,
      })) as MappingFormValue[],
    },
    onSubmit: async ({ value }) => {
      const parsed = mappingFormSchema.safeParse(value);
      const failures = parsed.success
        ? validate(parsed.data.mappings)
        : ["The mapping form contains invalid values."];
      if (failures.length > 0) {
        setErrors(failures);
        // Move the reader to the summary rather than leaving focus on a button
        // whose label no longer describes what happened.
        requestAnimationFrame(() => errorSummary.current?.focus());
        return;
      }
      setErrors([]);
      try {
        await onSubmit(parsed.success ? parsed.data.mappings : []);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : "Mappings could not be saved."]);
        requestAnimationFrame(() => errorSummary.current?.focus());
      }
    },
  });

  if (mappings.length === 0) {
    return (
      <FieldDescription>
        No external resources have been discovered for this connection yet.
      </FieldDescription>
    );
  }

  return (
    <form
      aria-label="Branch mappings"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {errors.length > 0 ? (
        <Alert
          variant="destructive"
          role="alert"
          aria-label="Mapping errors"
          tabIndex={-1}
          ref={errorSummary}
        >
          <AlertCircle />
          <AlertTitle>Mappings were not saved</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        {form.state.values.mappings.map((mapping, index) => {
          const controlId = `mapping-${connectionId}-${index}`;
          return (
            <Field key={mapping.externalResourceId}>
              <FieldLabel htmlFor={`${controlId}-branch`}>
                {mapping.externalResourceLabel}
              </FieldLabel>
              <FieldDescription>Resource {mapping.externalResourceId}</FieldDescription>
              <div className="grid gap-2 sm:grid-cols-2">
                <form.Field name={`mappings[${index}].status`}>
                  {(field) => (
                    <Select
                      value={String(field.state.value)}
                      disabled={!canEdit}
                      onValueChange={(value) =>
                        field.handleChange(value as MappingFormValue["status"])
                      }
                    >
                      <SelectTrigger
                        id={`${controlId}-status`}
                        aria-label={`${mapping.externalResourceLabel} status`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Mapping status</SelectLabel>
                          <SelectItem value="unmapped">Unmapped</SelectItem>
                          <SelectItem value="mapped">Mapped</SelectItem>
                          <SelectItem value="ignored">Ignored</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                </form.Field>
                <form.Field name={`mappings[${index}].branchId`}>
                  {(field) => (
                    <Select
                      value={field.state.value ?? UNASSIGNED}
                      disabled={!canEdit}
                      onValueChange={(value) =>
                        field.handleChange(value === UNASSIGNED ? null : value)
                      }
                    >
                      <SelectTrigger
                        id={`${controlId}-branch`}
                        aria-label={`${mapping.externalResourceLabel} branch`}
                      >
                        <SelectValue placeholder="Select a branch" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Branches in this organization</SelectLabel>
                          <SelectItem value={UNASSIGNED}>No branch</SelectItem>
                          {branches.map((branch) => (
                            <SelectItem key={branch.id} value={branch.id}>
                              {branch.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                </form.Field>
              </div>
            </Field>
          );
        })}
      </FieldGroup>

      {canEdit ? (
        <>
          <FieldSeparator />
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting} className="self-start">
                {isSubmitting ? <Spinner /> : null}
                Save mappings
              </Button>
            )}
          </form.Subscribe>
        </>
      ) : null}
    </form>
  );
}
