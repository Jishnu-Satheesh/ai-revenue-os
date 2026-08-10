"use client";

import { useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";
import { AlertCircle, Upload } from "lucide-react";
import { z } from "zod";

import {
  CsvMappingForm,
  type MetricTargetChoice,
  suggestTargetField,
  toColumnMapping,
  type CsvColumnMappingEntry,
} from "@/components/integrations/csv-mapping-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { MAX_CSV_BYTES } from "@/modules/integrations/application/csv";
import type { IntegrationBranchOption } from "@/modules/integrations/application/ports";

const NO_BRANCH = "__no_branch__";

const nameSchema = z.string().trim().min(2).max(160);

export type ManualSourceSubmission = { name: string; branchId: string | null };
export type CsvSourceSubmission = ManualSourceSubmission & {
  file: File;
  columnMapping: Record<string, string>;
};

/**
 * Reads only the header row. Cell values never enter component state, so a
 * validation message cannot leak one even by accident.
 */
async function readCsvHeaders(file: File): Promise<string[]> {
  const text = await file.slice(0, 64 * 1024).text();
  const withoutBom = text.replace(/^﻿/, "");
  const firstLine = withoutBom.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.split(",").map((header) => header.trim());
}

function validateHeaders(headers: readonly string[]): string | null {
  if (headers.length === 0 || headers.some((header) => !header)) {
    return "The CSV header row must contain unique, non-empty columns.";
  }
  if (new Set(headers).size !== headers.length) {
    return "The CSV header row must contain unique, non-empty columns.";
  }
  return null;
}

function validateFile(file: File): string | null {
  if (!/\.csv$/i.test(file.name)) return "Only .csv files are supported.";
  if (file.type && file.type.toLowerCase() !== "text/csv") {
    return "CSV files must use the text/csv media type.";
  }
  if (file.size > MAX_CSV_BYTES) return "CSV files must be no larger than 10 MiB.";
  return null;
}

export function DataSourceForm({
  branches,
  metricTargets,
  isSubmitting,
  onRegisterManual,
  onUploadCsv,
}: Readonly<{
  branches: readonly IntegrationBranchOption[];
  metricTargets: readonly MetricTargetChoice[];
  isSubmitting: boolean;
  onRegisterManual: (input: ManualSourceSubmission) => Promise<void>;
  onUploadCsv: (input: CsvSourceSubmission) => Promise<void>;
}>) {
  const [sourceType, setSourceType] = useState<"manual" | "csv_import">("manual");
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<CsvColumnMappingEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const errorSummary = useRef<HTMLDivElement | null>(null);

  const form = useForm({
    defaultValues: { name: "", branchId: null as string | null },
    onSubmit: async ({ value }) => {
      const parsedName = nameSchema.safeParse(value.name);
      if (!parsedName.success) return fail(["Enter a source name of 2 to 160 characters."]);

      if (sourceType === "manual") {
        return run(() => onRegisterManual({ name: parsedName.data, branchId: value.branchId }));
      }
      if (!file) return fail(["Choose a UTF-8 CSV file to upload."]);
      const columnMapping = toColumnMapping(columns);
      if (Object.keys(columnMapping).length === 0) {
        return fail(["Map at least one CSV column before uploading."]);
      }
      return run(() =>
        onUploadCsv({ name: parsedName.data, branchId: value.branchId, file, columnMapping }),
      );
    },
  });

  function fail(messages: string[]) {
    setErrors(messages);
    requestAnimationFrame(() => errorSummary.current?.focus());
  }

  async function run(operation: () => Promise<void>) {
    setErrors([]);
    try {
      await operation();
      form.reset();
      setFile(null);
      setColumns([]);
    } catch (error) {
      fail([error instanceof Error ? error.message : "The data source could not be saved."]);
    }
  }

  async function selectFile(selected: File | null) {
    setFile(null);
    setColumns([]);
    if (!selected) return setErrors([]);
    const fileError = validateFile(selected);
    if (fileError) return fail([fileError]);
    const headers = await readCsvHeaders(selected);
    const headerError = validateHeaders(headers);
    if (headerError) return fail([headerError]);
    setErrors([]);
    setFile(selected);
    setColumns(
      headers.map((header) => ({
        header,
        include: true,
        targetField: suggestTargetField(header),
      })),
    );
  }

  return (
    <form
      aria-label="Register a data source"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {errors.length > 0 ? (
        <Alert variant="destructive" role="alert" tabIndex={-1} ref={errorSummary}>
          <AlertCircle />
          <AlertTitle>The source was not saved</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="data-source-type">Source type</FieldLabel>
          <RadioGroup
            id="data-source-type"
            value={sourceType}
            onValueChange={(value) => {
              setSourceType(value as "manual" | "csv_import");
              setErrors([]);
            }}
            className="grid-cols-1 sm:grid-cols-2"
          >
            <FieldLabel htmlFor="source-type-manual" className="items-center gap-2">
              <RadioGroupItem id="source-type-manual" value="manual" />
              Manual entry
            </FieldLabel>
            <FieldLabel htmlFor="source-type-csv" className="items-center gap-2">
              <RadioGroupItem id="source-type-csv" value="csv_import" />
              CSV upload
            </FieldLabel>
          </RadioGroup>
          <FieldDescription>
            A manual source records data the agency maintains by hand. A CSV source stores an
            uploaded file privately and imports it through a background run.
          </FieldDescription>
        </Field>

        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="data-source-name">Source name</FieldLabel>
              <Input
                id="data-source-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="branchId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="data-source-branch">Branch</FieldLabel>
              <Select
                value={field.state.value ?? NO_BRANCH}
                onValueChange={(value) => field.handleChange(value === NO_BRANCH ? null : value)}
              >
                <SelectTrigger id="data-source-branch">
                  <SelectValue placeholder="Organization-wide" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Branches in this organization</SelectLabel>
                    <SelectItem value={NO_BRANCH}>Organization-wide</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>

        {sourceType === "csv_import" ? (
          <>
            <Field>
              <FieldLabel htmlFor="data-source-file">CSV file</FieldLabel>
              <Input
                id="data-source-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
              />
              <FieldDescription>UTF-8, at most 10 MiB, stored privately.</FieldDescription>
            </Field>
            {columns.length > 0 ? (
              <CsvMappingForm
                entries={columns}
                metricTargets={metricTargets}
                onChange={setColumns}
                disabled={isSubmitting}
              />
            ) : null}
            {isSubmitting ? <Progress value={null} aria-label="Uploading the CSV file" /> : null}
          </>
        ) : null}
      </FieldGroup>

      <FieldSeparator />
      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? <Spinner /> : <Upload data-icon="inline-start" />}
        {sourceType === "manual" ? "Register source" : "Upload CSV source"}
      </Button>
    </form>
  );
}
