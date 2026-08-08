"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { measurementPeriodSchema, type MeasurementPeriod } from "@/domain/onboarding/vocabularies";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parts(value: string) {
  const [year, month] = value.split("-");
  return { year: year ?? "", month: month ?? "" };
}

function partial(value: unknown): { start: string; end: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      start: typeof record.start === "string" ? record.start : "",
      end: typeof record.end === "string" ? record.end : "",
    };
  }
  return { start: "", end: "" };
}

/**
 * A measurement period is a closed window of whole months, so it is collected
 * as two ISO year-months rather than a calendar date the operator has to guess.
 */
export function MonthRangeField({
  id,
  value,
  yearSpan = 7,
  onChange,
  onBlur,
}: {
  id: string;
  value: unknown;
  yearSpan?: number;
  onChange: (value: MeasurementPeriod | { start: string; end: string }) => void;
  onBlur?: () => void;
}) {
  const current = partial(value);
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: yearSpan }, (_, index) => String(thisYear - index));

  function set(bound: "start" | "end", segment: "year" | "month", segmentValue: string) {
    const existing = parts(current[bound]);
    const next = { ...existing, [segment]: segmentValue };
    const composed = next.year && next.month ? `${next.year}-${next.month}` : "";
    const candidate = { ...current, [bound]: composed };
    const parsed = measurementPeriodSchema.safeParse(candidate);
    onChange(parsed.success ? parsed.data : candidate);
    onBlur?.();
  }

  function bound(label: string, key: "start" | "end") {
    const segments = parts(current[key]);
    return (
      <div className="flex flex-1 items-center gap-2">
        <Select value={segments.month} onValueChange={(month) => set(key, "month", month)}>
          <SelectTrigger className="w-full" aria-label={`${label} month`}>
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {months.map((month, index) => (
              <SelectItem key={month} value={String(index + 1).padStart(2, "0")}>
                {month}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={segments.year} onValueChange={(year) => set(key, "year", year)}>
          <SelectTrigger className="w-32" aria-label={`${label} year`}>
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={`${id}-label`}
      className="flex flex-wrap items-center gap-2"
    >
      {bound("Period start", "start")}
      <span className="text-sm text-muted-foreground">to</span>
      {bound("Period end", "end")}
    </div>
  );
}
