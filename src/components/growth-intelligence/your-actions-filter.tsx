"use client";

import { Button } from "@/components/ui/button";
import {
  YOUR_ACTION_FILTERS,
  type YourActionFilter,
} from "@/modules/growth-intelligence/application/read-model";

const FILTER_LABELS: Record<YourActionFilter, string> = {
  all: "All",
  planned: "Planned",
  acknowledged: "Acknowledged",
  snoozed: "Snoozed",
  dismissed: "Dismissed",
};

/**
 * Decision filter for the Your actions tab. Single-select pills; the active
 * pill reads as primary so the current slice is obvious at a glance.
 */
export function YourActionsFilter({
  value,
  onChange,
}: {
  value: YourActionFilter;
  onChange: (filter: YourActionFilter) => void;
}) {
  return (
    <div role="group" aria-label="Filter actions by decision" className="flex flex-wrap gap-2">
      {YOUR_ACTION_FILTERS.map((filter) => {
        const active = filter === value;
        return (
          <Button
            key={filter}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            onClick={() => onChange(filter)}
          >
            {FILTER_LABELS[filter]}
          </Button>
        );
      })}
    </div>
  );
}
