"use client";

import { CopyPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  emptyWeeklyHours,
  timeOptions,
  weekdayLabels,
  weekdays,
  weeklyHoursSchema,
  type DayHours,
  type Weekday,
  type WeeklyHours,
} from "@/domain/onboarding/vocabularies";

function normalize(value: unknown): WeeklyHours {
  const parsed = weeklyHoursSchema.safeParse(value);
  const provided = new Map((parsed.success ? parsed.data : []).map((entry) => [entry.day, entry]));
  return weekdays.map(
    (day) => provided.get(day) ?? { day, closed: false, opensAt: null, closesAt: null },
  );
}

/**
 * Operating hours are a recurring weekly pattern, not a date, so the control
 * collects an open/closed state and an aligned open-close range per weekday.
 */
export function WeeklyHoursField({
  id,
  value,
  onChange,
  onBlur,
}: {
  id: string;
  value: unknown;
  onChange: (value: WeeklyHours) => void;
  onBlur?: () => void;
}) {
  const schedule = normalize(value);
  const first = schedule[0];
  const canCopy = Boolean(!first.closed && first.opensAt && first.closesAt);

  function update(day: Weekday, patch: Partial<DayHours>) {
    onChange(schedule.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)));
    onBlur?.();
  }

  function copyFirstDayToAll() {
    onChange(
      schedule.map((entry) => ({
        ...entry,
        closed: first.closed,
        opensAt: first.opensAt,
        closesAt: first.closesAt,
      })),
    );
    onBlur?.();
  }

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={`${id}-label`}
      className="flex flex-col gap-1 rounded-lg ring-1 ring-foreground/10"
    >
      {schedule.map((entry) => (
        <div
          key={entry.day}
          className="flex flex-wrap items-center gap-3 px-3 py-2 not-last:border-b not-last:border-border/60"
        >
          <div className="flex min-w-32 items-center gap-2.5">
            <Switch
              id={`${id}-${entry.day}`}
              checked={!entry.closed}
              aria-label={`${weekdayLabels[entry.day]} open`}
              onCheckedChange={(open) => update(entry.day, { closed: !open })}
            />
            <label htmlFor={`${id}-${entry.day}`} className="text-sm font-medium">
              {weekdayLabels[entry.day]}
            </label>
          </div>
          {entry.closed ? (
            <span className="text-sm text-muted-foreground">Closed</span>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                value={entry.opensAt ?? ""}
                onValueChange={(opensAt) => update(entry.day, { opensAt })}
              >
                <SelectTrigger
                  className="w-28"
                  aria-label={`${weekdayLabels[entry.day]} opening time`}
                >
                  <SelectValue placeholder="Opens" />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">–</span>
              <Select
                value={entry.closesAt ?? ""}
                onValueChange={(closesAt) => update(entry.day, { closesAt })}
              >
                <SelectTrigger
                  className="w-28"
                  aria-label={`${weekdayLabels[entry.day]} closing time`}
                >
                  <SelectValue placeholder="Closes" />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Times close after midnight are recorded as the next day&apos;s early hours.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(emptyWeeklyHours())}
          >
            Reset
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canCopy}
            onClick={copyFirstDayToAll}
          >
            <CopyPlus data-icon="inline-start" />
            Apply Monday to all days
          </Button>
        </div>
      </div>
    </div>
  );
}
