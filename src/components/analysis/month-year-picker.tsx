"use client";

import { useMemo, useState } from "react";

import { CalendarRange } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The twelve month names the Month control always shows, whatever the year. */
const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
] as const;

/**
 * The audit page's Year and Month selects, shared wherever a reported horizon
 * is picked one month at a time. The months in the horizon stay selectable;
 * every other calendar month stays visible but disabled, so the control reads
 * as a calendar rather than as a list of what happens to exist.
 */
export function MonthYearPicker({
  months,
  selectedMonth,
  onSelectMonth,
}: {
  /** Canonical `YYYY-MM` months, ascending. */
  months: readonly string[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}) {
  const years = useMemo(() => [...new Set(months.map((month) => month.slice(0, 4)))], [months]);
  const selectedYear = selectedMonth.slice(0, 4);
  /**
   * A year the reader picked that the selection has not caught up with yet.
   *
   * Remembered against the month it was picked over, not on its own. Picking a
   * year normally moves the selection into it, and then the selected month is
   * the honest answer; but a year whose months are all refused leaves the
   * control showing what was asked for. Tying the override to a month also
   * clears it the moment the selection changes underneath -- browser Back to a
   * month in another year used to leave the Year control on the old year and
   * the Month control showing nothing at all, because no option matched.
   */
  const [override, setOverride] = useState<{ forMonth: string; year: string } | null>(null);
  const activeYear = override?.forMonth === selectedMonth ? override.year : selectedYear;
  const selectable = (month: string) => months.includes(month);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={activeYear ?? undefined}
        onValueChange={(next) => {
          setOverride({ forMonth: selectedMonth, year: next });
          const firstInYear = months.find((month) => month.slice(0, 4) === next);
          if (firstInYear && firstInYear !== selectedMonth) {
            onSelectMonth(firstInYear);
          }
        }}
      >
        <SelectTrigger
          aria-label="Year to analyse"
          className="h-9 rounded-full border-border bg-card pl-3.5 pr-3 text-xs font-semibold shadow-sm"
        >
          <CalendarRange aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          {years.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedMonth} onValueChange={onSelectMonth}>
        <SelectTrigger
          aria-label="Month to analyse"
          className="h-9 rounded-full border-border bg-card pl-3.5 pr-3 text-xs font-semibold shadow-sm"
        >
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          {/* All twelve names stay visible so the control reads as
              a calendar; pairs outside the reported horizon are
              disabled rather than hidden. */}
          {MONTH_OPTIONS.map((option) => {
            const value = `${activeYear}-${option.value}`;
            return (
              <SelectItem key={option.value} value={value} disabled={!selectable(value)}>
                {option.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
