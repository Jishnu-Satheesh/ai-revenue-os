"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  DayPicker,
  getDefaultClassNames,
  type CaptionLabelProps,
  type DayButtonProps,
} from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * The date-grid primitive, wrapping `react-day-picker`. Class names follow the
 * same conventions as `select.tsx`: rounded-lg surfaces, `border-input`,
 * `focus-visible:ring-3 focus-visible:ring-ring/50`, and disabled days that use
 * the real `disabled` attribute rather than a greyed-out look with no
 * assistive-technology meaning.
 *
 * Registry-installed by `shadcn add calendar` where the registry is reachable;
 * hand-written here because it was not (see `window-range-picker.tsx`'s task
 * brief), matching the shape the registry's own template produces.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-2.5", className)}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("flex flex-col gap-3", defaultClassNames.months),
        month: cn("flex flex-col gap-3", defaultClassNames.month),
        nav: cn("flex items-center justify-between", defaultClassNames.nav),
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "absolute left-1 z-10",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "absolute right-1 z-10",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex h-8 items-center justify-center text-sm font-medium",
          defaultClassNames.month_caption,
        ),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "w-8 text-center text-xs font-normal text-muted-foreground",
          defaultClassNames.weekday,
        ),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        day: cn(
          "relative w-8 p-0 text-center text-sm [&:first-child[data-selected=true]_button]:rounded-l-lg [&:last-child[data-selected=true]_button]:rounded-r-lg",
          defaultClassNames.day,
        ),
        range_start: cn("rounded-l-lg bg-accent", defaultClassNames.range_start),
        range_middle: cn("rounded-none bg-accent/50", defaultClassNames.range_middle),
        range_end: cn("rounded-r-lg bg-accent", defaultClassNames.range_end),
        today: cn("font-semibold text-primary", defaultClassNames.today),
        outside: cn("text-muted-foreground/50", defaultClassNames.outside),
        disabled: cn("text-muted-foreground/30 line-through", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) => {
          const Icon = orientation === "left" ? ChevronLeftIcon : ChevronRightIcon;
          return <Icon className={cn("size-4", chevronClassName)} {...chevronProps} />;
        },
        DayButton: CalendarDayButton,
        CaptionLabel: CalendarCaptionLabel,
      }}
      {...props}
    />
  );
}

/**
 * `DayPicker` hard-codes `role="status"` onto its own caption label to
 * announce month navigation. Left as-is, that collides with the one other
 * `role="status"` this workspace ever renders inside this control -- the
 * grain-mismatch warning -- and a query for "the status region" would find
 * two. The announcement itself is still made: `aria-live` alone is enough
 * for assistive technology, no `role` required.
 */
function CalendarCaptionLabel({ role: _role, ...props }: CaptionLabelProps) {
  return <span {...props} />;
}

/**
 * `YYYY-MM-DD`, matching the local-date form every date on this control is
 * keyed by -- never `toLocaleDateString()`, whose output shifts with the
 * viewer's locale and would be the one stray date format in a control built
 * specifically so no locale can move a boundary.
 */
function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function CalendarDayButton({ className, day, modifiers, ...props }: DayButtonProps) {
  return (
    <button
      type="button"
      data-day={isoDate(day.date)}
      data-selected={modifiers.selected || modifiers.range_start || modifiers.range_end}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg text-sm outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected=true]:font-semibold",
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
