"use client";

import { CircleCheck, CircleSlash, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { IntegrationCapabilityReadModel } from "@/modules/integrations/application/read-model";

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
}: Readonly<{ capabilities: readonly IntegrationCapabilityReadModel[] }>) {
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
    <TooltipProvider>
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
                  {grant.definition
                    ? `${grant.definition.character} · ${grant.definition.effect} · ${grant.maturity}`
                    : `Definition unavailable · ${grant.maturity}`}
                  {" · adapter v"}
                  {grant.derived_from_adapter_version}
                </span>
                <span className="text-xs text-muted-foreground">
                  Scopes:{" "}
                  {grant.definition?.requiredScopes.length
                    ? grant.definition.requiredScopes.join(", ")
                    : "none"}
                </span>
                {grant.restriction_codes.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Restrictions:{" "}
                    {grant.restriction_codes.map((restrictionCode, index) => (
                      <code key={restrictionCode}>
                        {index > 0 ? ", " : ""}
                        {restrictionCode}
                      </code>
                    ))}
                  </span>
                ) : null}
                {grant.recoveryActions.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Recovery: {grant.recoveryActions.join(" ")}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={presentation.variant}>
                  <Icon aria-hidden="true" />
                  {presentation.label}
                </Badge>
                {grant.reason_codes.length > 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs text-muted-foreground underline decoration-dotted"
                      >
                        Why?
                      </Button>
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
    </TooltipProvider>
  );
}
