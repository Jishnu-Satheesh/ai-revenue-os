"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, HelpCircle, Layers, Lock, Table2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeMetrics } from "@/domain/reports/provider-library/copy";

/**
 * Step two of report intake: saying what an uploaded file is.
 *
 * Either the platform recognises the export and the operator confirms it, or it
 * does not and the operator describes their own columns. Both paths end in the
 * same place — a proposed mapping an owner or admin still has to approve — and
 * neither asks anyone to write JSON.
 *
 * See the approved design at `.superdesign/resume.json`, target
 * `/organizations/[organizationId]/integrations#report-intake`.
 */

export type RecognisedFamily = {
  key: string;
  provider: string;
  reportType: string;
  summary: string;
  reads: string[];
  columns: string[];
};

export type ProfiledSheetColumns = {
  normalizedSheetName: string;
  sheetPosition: number;
  rowCount: number;
  headerRows: { rowPosition: number; columns: string[] }[];
};

type Recognition = { sheets: ProfiledSheetColumns[]; recognisedFamilies: RecognisedFamily[] };

/** The forms a provider writes a date in, in the operator's words. */
const DATE_ENCODINGS = [
  { value: "iso_date", label: "2026-01-31" },
  { value: "compact_date", label: "20260131" },
  { value: "text_date", label: "1 Jan 2026" },
  { value: "day_month", label: "01/Jan — no year in the file" },
  { value: "excel_serial", label: "A spreadsheet date cell" },
] as const;

const NONE = "__none__";

/** A column name as the operator's file spells it, near enough to recognise. */
function columnLabel(normalized: string): string {
  return normalized.replaceAll("_", " ");
}

export function ReportIntakeMapping({
  organizationId,
  packageId,
  onProposed,
}: Readonly<{ organizationId: string; packageId: string; onProposed: () => void }>) {
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState("");
  const [dateColumn, setDateColumn] = useState(NONE);
  const [dateEncoding, setDateEncoding] = useState<string>("iso_date");
  const [salesColumn, setSalesColumn] = useState(NONE);
  const [ordersColumn, setOrdersColumn] = useState(NONE);
  const [totalsColumn, setTotalsColumn] = useState(NONE);
  const [totalsLabel, setTotalsLabel] = useState("Total");
  const [absentMarker, setAbsentMarker] = useState("");

  const recognition = useQuery({
    queryKey: ["report-recognised-families", organizationId, packageId],
    queryFn: () =>
      fetch(
        `/api/organizations/${organizationId}/report-packages/${packageId}/recognised-families`,
      ).then(async (response) => {
        if (!response.ok) throw new Error("We could not read this upload's structure.");
        return (await response.json()) as Recognition;
      }),
  });

  const propose = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await fetch(
        `/api/organizations/${organizationId}/report-packages/${packageId}/contract-proposals`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...body,
            idempotencyKey: `report-contract-proposal:${crypto.randomUUID()}`,
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "The mapping could not be saved.");
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success("Mapping proposed. It reads nothing until an owner or admin approves it.");
      onProposed();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The mapping could not be saved."),
  });

  if (recognition.isPending) {
    return <p className="text-sm text-muted-foreground">Reading the file&rsquo;s structure…</p>;
  }
  if (recognition.isError) {
    return (
      <p className="text-sm text-destructive">
        We could not read this upload&rsquo;s structure. Try profiling it again.
      </p>
    );
  }

  const families = recognition.data?.recognisedFamilies ?? [];
  const sheets = recognition.data?.sheets ?? [];

  if (families.length > 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">We recognise this report</p>
          <Badge variant="outline" className="text-emerald-700">
            <CheckCircle2 className="mr-1 size-3" /> Known report
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Matched from the file&rsquo;s structure alone. Confirm it is the right one — you know what
          you downloaded, the platform only knows what it looks like.
        </p>
        {families.map((family) => (
          <div key={family.key} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <Layers className="size-4 text-muted-foreground" />
                  {family.provider} · {family.reportType.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{family.summary}</p>
              </div>
              <Button
                size="sm"
                disabled={propose.isPending}
                onClick={() =>
                  propose.mutate({ source: "library", providerDefinitionKey: family.key })
                }
              >
                Use this mapping
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  It would record
                </p>
                <p className="mt-1 text-sm font-medium">{describeMetrics(family.reads)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Columns it reads
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {family.columns.map((column) => (
                    <Badge key={column} variant="secondary" className="font-normal">
                      {columnLabel(column)}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Choosing this proposes the mapping. Nothing is read from the file until an owner or
              admin approves it.
            </p>
          </div>
        ))}
      </div>
    );
  }

  const selectedSheet =
    sheets.find((sheet) => sheet.normalizedSheetName === sheetName) ??
    sheets.find((sheet) => sheet.headerRows.length > 0);
  const selectedHeaderRow =
    selectedSheet?.headerRows.find((row) => String(row.rowPosition) === headerRow) ??
    selectedSheet?.headerRows[0];
  const columns = selectedHeaderRow?.columns ?? [];

  const optional = (value: string) => (value === NONE ? undefined : value);
  const guided = {
    normalizedSheetName: selectedSheet?.normalizedSheetName ?? "",
    headerRow: selectedHeaderRow?.rowPosition ?? 1,
    periodColumn:
      dateColumn === NONE ? undefined : { sourceHeader: dateColumn, encoding: dateEncoding },
    salesColumn: optional(salesColumn),
    ordersColumn: optional(ordersColumn),
    totalsRow:
      totalsColumn === NONE || !totalsLabel.trim()
        ? undefined
        : { sourceHeader: totalsColumn, label: totalsLabel.trim() },
    absentMarkers: absentMarker.trim() ? [absentMarker.trim()] : undefined,
  };
  const canPropose =
    Boolean(selectedSheet) && (salesColumn !== NONE || ordersColumn !== NONE) && !propose.isPending;

  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">We could not find a row of column headings</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every row in this file looks like data. Check that the export has a heading row, then
          upload it again.
        </p>
      </div>
    );
  }

  const columnSelect = (
    id: string,
    value: string,
    onChange: (next: string) => void,
    emptyLabel: string,
  ) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Choose a column" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{emptyLabel}</SelectItem>
        {columns.map((column) => (
          <SelectItem key={column} value={column}>
            {columnLabel(column)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const question = (
    id: string,
    title: string,
    hint: string,
    control: React.ReactNode,
    badge?: string,
  ) => (
    <div className="grid items-center gap-2 sm:grid-cols-12 sm:gap-4">
      <div className="sm:col-span-5">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="sm:col-span-5">{control}</div>
      <div className="sm:col-span-2">
        {badge ? (
          <Badge variant="secondary" className="font-normal">
            {badge}
          </Badge>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Tell us what these columns mean</p>
        <Badge variant="outline">
          <HelpCircle className="mr-1 size-3" /> Not a known report
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        This export doesn&rsquo;t match anything we already read. Point each figure at its column
        and the platform will read it the same way every month.
      </p>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2 border-b pb-3">
          <Table2 className="size-4 text-muted-foreground" />
          {sheets.length > 1 ? (
            <Select
              value={selectedSheet?.normalizedSheetName ?? ""}
              onValueChange={(value) => {
                setSheetName(value);
                setHeaderRow("");
                setDateColumn(NONE);
                setSalesColumn(NONE);
                setOrdersColumn(NONE);
                setTotalsColumn(NONE);
              }}
            >
              <SelectTrigger aria-label="Sheet to read" className="max-w-xs">
                <SelectValue placeholder="Choose a sheet" />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((sheet) => (
                  <SelectItem key={sheet.normalizedSheetName} value={sheet.normalizedSheetName}>
                    {columnLabel(sheet.normalizedSheetName)} · {sheet.rowCount} rows
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm font-medium">
              Sheet {columnLabel(selectedSheet?.normalizedSheetName ?? "")} · {columns.length}{" "}
              columns found
            </p>
          )}
          {(selectedSheet?.headerRows.length ?? 0) > 1 ? (
            <Select value={String(selectedHeaderRow?.rowPosition ?? "")} onValueChange={setHeaderRow}>
              <SelectTrigger aria-label="Row the headings are on" className="max-w-[14rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectedSheet?.headerRows.map((row) => (
                  <SelectItem key={row.rowPosition} value={String(row.rowPosition)}>
                    Headings on row {row.rowPosition}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <div className="mt-4 space-y-4">
          {question(
            "guided-date",
            "Which column is the date?",
            "Leave this unset if the file is one total for the whole period.",
            columnSelect("guided-date", dateColumn, setDateColumn, "— this file has no dates —"),
          )}
          {dateColumn === NONE
            ? null
            : question(
                "guided-encoding",
                "How does this file write dates?",
                "03/04/2026 is two different days. We won't guess.",
                <Select value={dateEncoding} onValueChange={setDateEncoding}>
                  <SelectTrigger id="guided-encoding">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_ENCODINGS.map((encoding) => (
                      <SelectItem key={encoding.value} value={encoding.value}>
                        {encoding.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>,
              )}
          {question(
            "guided-sales",
            "Which column is your sales?",
            "The money the customer paid, before anything is taken.",
            columnSelect("guided-sales", salesColumn, setSalesColumn, "— this file doesn't have it —"),
            salesColumn === NONE ? undefined : "Recorded",
          )}
          {question(
            "guided-orders",
            "Which column is your orders?",
            "Needed before margin per order can be worked out.",
            columnSelect(
              "guided-orders",
              ordersColumn,
              setOrdersColumn,
              "— this file doesn't have it —",
            ),
            ordersColumn === NONE ? undefined : "Recorded",
          )}
          {question(
            "guided-totals",
            "Does it have a totals row?",
            "If we counted it as data, every figure would double.",
            columnSelect(
              "guided-totals",
              totalsColumn,
              setTotalsColumn,
              "— no totals row —",
            ),
          )}
          {totalsColumn === NONE
            ? null
            : question(
                "guided-totals-label",
                "What does that row say?",
                "The word in that column on the totals row, exactly as written.",
                <Input
                  id="guided-totals-label"
                  value={totalsLabel}
                  onChange={(event) => setTotalsLabel(event.target.value)}
                  placeholder="Total"
                />,
              )}
          {question(
            "guided-absent",
            "How does it write “no data”?",
            "Keeta writes a dash. Leave blank if empty cells are used.",
            <Input
              id="guided-absent"
              value={absentMarker}
              onChange={(event) => setAbsentMarker(event.target.value)}
              placeholder="-"
              className="max-w-[8rem]"
            />,
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Leave a figure unset if the file genuinely doesn&rsquo;t carry it. Blank stays blank; it
            never becomes zero.
          </p>
          <Button
            size="sm"
            disabled={!canPropose}
            onClick={() => propose.mutate({ source: "guided", guided })}
          >
            Propose this mapping
          </Button>
        </div>
      </div>
    </div>
  );
}
