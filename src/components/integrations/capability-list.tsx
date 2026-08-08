"use client";

import { CircleCheck, CircleSlash, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { IntegrationCapabilityGrantRow } from "@/modules/integrations/application/ports";

const availabilityPresentation = {
  available: { label: "Available", icon: CircleCheck, variant: "secondary" as const },
  blocked: { label: "Blocked", icon: ShieldAlert, variant: "destructive" as const },
  disabled: { label: "Disabled", icon: CircleSlash, variant: "outline" as const },
};

/** Turns a stable reason code into a sentence without inventing new policy. */
function describeReason(reasonCode: string): string {
  return reasonCode.replace(/_/g, " ");
}

export function CapabilityList({
  capabilities,
}: Readonly<{ capabilities: readonly IntegrationCapabilityGrantRow[] }>) {
  if (capabilities.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No capabilities derived yet</EmptyTitle>
          <EmptyDescription>
            Capabilities appear after a connection test and a branch mapping succeed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul aria-label="Capability grants" className="flex flex-col gap-2">
      {capabilities.map((grant) => {
        const presentation = availabilityPresentation[grant.availability];
        const Icon = presentation.icon;
        return (
          <li
            key={grant.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-sm font-medium">{grant.capability_key}</span>
              <span className="text-xs text-muted-foreground">
                {grant.maturity} · adapter v{grant.derived_from_adapter_version}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={presentation.variant}>
                <Icon aria-hidden="true" />
                {presentation.label}
              </Badge>
              {grant.reason_codes.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground underline decoration-dotted">
                      Why?
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {grant.reason_codes.map(describeReason).join(", ")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
