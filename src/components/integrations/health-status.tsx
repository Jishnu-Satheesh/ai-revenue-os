import {
  AlertTriangle,
  CircleCheck,
  CircleSlash,
  Clock,
  History,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

type Connection = IntegrationHubSnapshot["connections"][number];
export type OperatorHealthState = Connection["health"]["state"];

/**
 * Health is communicated by an icon, a word, and a sentence. Colour is only
 * ever a reinforcement, so the same meaning survives greyscale, high contrast,
 * and screen-reader output.
 */
const healthPresentation: Readonly<
  Record<
    OperatorHealthState,
    {
      label: string;
      icon: LucideIcon;
      variant: "default" | "secondary" | "destructive" | "outline";
    }
  >
> = {
  healthy: { label: "Healthy", icon: CircleCheck, variant: "secondary" },
  pending: { label: "Pending", icon: Clock, variant: "outline" },
  degraded: { label: "Degraded", icon: AlertTriangle, variant: "destructive" },
  stale: { label: "Stale", icon: History, variant: "destructive" },
  revoked: { label: "Revoked", icon: CircleSlash, variant: "destructive" },
};

export const actionRequiredStates: readonly OperatorHealthState[] = [
  "degraded",
  "stale",
  "revoked",
];

export function isActionRequired(state: OperatorHealthState): boolean {
  return actionRequiredStates.includes(state);
}

export function healthLabel(state: OperatorHealthState): string {
  return healthPresentation[state].label;
}

export function HealthStatusBadge({
  state,
  className,
}: Readonly<{ state: OperatorHealthState; className?: string }>) {
  const { label, icon: Icon, variant } = healthPresentation[state];

  return (
    <Badge variant={variant} data-testid="connection-health-status" className={cn(className)}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

const runStatusLabels: Readonly<Record<string, string>> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  partially_succeeded: "Partially succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function runStatusLabel(status: string): string {
  return runStatusLabels[status] ?? status;
}

/** Renders an ISO instant deterministically in the organization's timezone. */
export function formatInstant(value: string | null | undefined, timeZone = "UTC"): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(parsed);
  } catch {
    return "—";
  }
}
