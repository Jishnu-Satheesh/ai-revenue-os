"use client";

import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Local calendar date, `YYYY-MM-DD`, as a `Date` at local midnight — never UTC. */
function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The inverse of `parseLocalDate`, reading the same local fields back out. */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value: string): string {
  const date = parseLocalDate(value);
  if (!date) return "Pick a date";
  return date.toLocaleDateString("en-AE", { year: "numeric", month: "short", day: "numeric" });
}

const HALF_HOUR_TIMES: readonly string[] = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, "0");
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
});

/**
 * Research start time as a shadcn Select. The value stays the same `HH:MM`
 * string the form state already holds — the picker only changes how it is
 * chosen, never what is stored or sent.
 */
export function ScheduleTimeField({
  id,
  value,
  onChange,
  caption,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  caption: string;
  disabled?: boolean;
}) {
  const options =
    value.length > 0 && !HALF_HOUR_TIMES.includes(value)
      ? [...HALF_HOUR_TIMES, value].sort()
      : HALF_HOUR_TIMES;
  return (
    <Field>
      <FieldLabel htmlFor={id}>Research start time</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose a time" />
        </SelectTrigger>
        <SelectContent>
          {options.map((time) => (
            <SelectItem key={time} value={time}>
              {time}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{caption}</FieldDescription>
    </Field>
  );
}

/**
 * Optional end date as a shadcn Button + Popover + Calendar. The value stays
 * the same `YYYY-MM-DD` string (or empty) the form state already holds — the
 * calendar only changes how it is chosen, never what is stored or sent.
 */
export function ScheduleDateField({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = value.length > 0 ? parseLocalDate(value) : undefined;
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        Stop monitoring on <span className="font-normal text-muted-foreground">Optional</span>
      </FieldLabel>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-start font-normal"
          >
            <CalendarIcon data-icon="inline-start" />
            {value.length > 0 ? displayDate(value) : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => onChange(date ? formatLocalDate(date) : "")}
          />
          {value.length > 0 ? (
            <div className="border-t p-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => onChange("")}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <FieldDescription>Leave empty to continue until you pause monitoring.</FieldDescription>
    </Field>
  );
}
