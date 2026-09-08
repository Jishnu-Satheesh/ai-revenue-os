"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatWindow } from "@/components/analysis/format";
import { addLocalDays } from "@/domain/analysis/calendar";
import {
  describeGrainMismatch,
  isWindowCovered,
  type AnalysisWindowSelection,
  type CoverageSegment,
  type CoverageWindow,
} from "@/domain/analysis/window-selection";
import type { AnalysisGrain } from "@/domain/analysis/types";

/**
 * Plain words for the grain the warning blames, matched to how an operator
 * would describe their own report rather than to the database's vocabulary.
 */
const GRAIN_DESCRIPTION: Record<AnalysisGrain, string> = {
  day: "one figure per day",
  week: "one figure per week",
  month: "one figure per month",
  span: "one figure for the whole period",
};

/** Local calendar date, `YYYY-MM-DD`, as a `Date` at local midnight -- never UTC. */
function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The inverse of `parseLocalDate`, reading the same local fields back out. */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const NOT_COVERED_REASON = "No approved report covers those dates.";

/**
 * The presets offered above the calendar. Each is computed against the
 * coverage segments rather than hard-coded to a channel's history, so a
 * preset that would land outside coverage still appears -- disabled, with a
 * reason -- instead of quietly vanishing.
 */
function usePresets(input: {
  today: string;
  draft: AnalysisWindowSelection;
  segments: readonly CoverageSegment[];
}): { id: string; label: string; range: AnalysisWindowSelection | null; covered: boolean }[] {
  return React.useMemo(() => {
    const lastSevenDays = { from: addLocalDays(input.today, -6), to: input.today };
    // The stretch containing the *current* draft, never the union across a
    // gap -- a range bridging two stretches is a question the reports cannot
    // answer, so "all reported" must not offer to ask it.
    const containingSegment =
      input.segments.find(
        (segment) => segment.start <= input.draft.from && input.draft.from <= segment.end,
      ) ?? null;
    const containing: AnalysisWindowSelection | null = containingSegment && {
      from: containingSegment.start,
      to: containingSegment.end,
    };

    const presets: { id: string; label: string; range: AnalysisWindowSelection | null }[] = [
      { id: "last-7-days", label: "Last 7 days", range: lastSevenDays },
      { id: "all-reported", label: "All reported", range: containing },
    ];

    return presets.map((preset) => ({
      ...preset,
      covered:
        preset.range !== null &&
        isWindowCovered(preset.range.from, preset.range.to, input.segments),
    }));
  }, [input.today, input.draft, input.segments]);
}

/**
 * The operator's control for picking any date range their approved reports
 * cover -- day, week, month, or a single span -- in place of a picker that
 * could only offer whole calendar months.
 *
 * Presentational only: it takes coverage and the current selection as props
 * and calls back on Apply. It does not fetch, and it does not decide whether
 * a range is admissible -- `isWindowCovered` and `describeGrainMismatch`
 * already own that, and re-deciding it here would let the two disagree.
 */
export function WindowRangePicker(props: {
  segments: readonly CoverageSegment[];
  windows: readonly CoverageWindow[];
  selected: AnalysisWindowSelection;
  today: string;
  onApply: (selection: AnalysisWindowSelection) => void;
  disabled?: boolean;
}) {
  const { segments, windows, selected, today, onApply, disabled = false } = props;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<AnalysisWindowSelection>(selected);
  const reactId = React.useId();

  const presets = usePresets({ today, draft, segments });
  const mismatch = describeGrainMismatch({ from: draft.from, to: draft.to, windows });
  const draftCovered = isWindowCovered(draft.from, draft.to, segments);

  function handleOpenChange(next: boolean) {
    // The draft always starts from the last applied selection, never from
    // wherever the calendar was left last time it closed unapplied.
    if (next) setDraft(selected);
    setOpen(next);
  }

  function handleCalendarSelect(range: DateRange | undefined) {
    if (!range?.from) return;
    setDraft({
      from: formatLocalDate(range.from),
      to: formatLocalDate(range.to ?? range.from),
    });
  }

  function handleApply() {
    onApply(draft);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <CalendarIcon aria-hidden="true" className="text-muted-foreground" />
          {formatWindow(selected.from, selected.to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto" align="start">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => {
              const descriptionId = `${reactId}-${preset.id}-reason`;
              return (
                <React.Fragment key={preset.id}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!preset.covered}
                    aria-describedby={!preset.covered ? descriptionId : undefined}
                    onClick={() => {
                      if (preset.range) setDraft(preset.range);
                    }}
                  >
                    {preset.label}
                  </Button>
                  {!preset.covered && (
                    <span id={descriptionId} className="sr-only">
                      {NOT_COVERED_REASON}
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <Calendar
            mode="range"
            selected={{ from: parseLocalDate(draft.from), to: parseLocalDate(draft.to) }}
            defaultMonth={parseLocalDate(draft.from)}
            onSelect={handleCalendarSelect}
            disabled={(date) => {
              const value = formatLocalDate(date);
              return !segments.some((segment) => segment.start <= value && value <= segment.end);
            }}
          />

          {mismatch && (
            <div
              role="status"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-foreground"
            >
              <p>
                {`This channel files ${GRAIN_DESCRIPTION[mismatch.grain]}, covering ${formatWindow(mismatch.declaredStart, mismatch.declaredEnd)}. That range can't be split any finer.`}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1.5"
                onClick={() => setDraft(mismatch.suggested)}
              >
                {`Use ${formatWindow(mismatch.suggested.from, mismatch.suggested.to)}`}
              </Button>
            </div>
          )}

          <Button
            type="button"
            onClick={handleApply}
            disabled={disabled || !draftCovered}
            className="self-end"
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
