"use client";

import { useState } from "react";
import {
  Building2,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  ClipboardCheck,
  FileKey,
  Flag,
  Landmark,
  ListChecks,
  Pencil,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { OverviewEditor } from "@/components/organizations/overview-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import type { getOverviewPermissions } from "@/modules/organizations/application/overview";

type Permissions = ReturnType<typeof getOverviewPermissions>;
type SectionKey =
  | "identity"
  | "branches"
  | "profile"
  | "facts"
  | "goals"
  | "constraints"
  | "policies";

type TwinSection = {
  key: SectionKey;
  label: string;
  summary: string;
  complete: boolean;
  icon: typeof Landmark;
  content: React.ReactNode;
};

export function DigitalTwinWorkspace({
  organizationId,
  snapshot,
  permissions,
}: Readonly<{
  organizationId: string;
  snapshot: DigitalTwinSnapshot;
  permissions: Permissions;
}>) {
  return (
    <div className="flex flex-col gap-6">
      <CurrentDigitalTwinData snapshot={snapshot} />
      <OrganizationManagement
        organizationId={organizationId}
        snapshot={snapshot}
        permissions={permissions}
      />
    </div>
  );
}

export function CurrentDigitalTwinData({ snapshot }: { snapshot: DigitalTwinSnapshot }) {
  const sections = buildSections(snapshot);
  return (
    <Card id="digital-twin-data">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Current Digital Twin Data</CardTitle>
          <CardDescription>
            The facts, goals, and guardrails currently available to the platform.
          </CardDescription>
        </div>
        <Badge variant="outline">
          <Sparkles />
          Source aware
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sections.map((section, index) => (
          <div key={section.key}>
            {index > 0 ? <Separator className="mb-2" /> : null}
            <TwinSectionRow section={section} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function OrganizationManagement({
  organizationId,
  snapshot,
  permissions,
}: Readonly<{
  organizationId: string;
  snapshot: DigitalTwinSnapshot;
  permissions: Permissions;
}>) {
  const [managementOpen, setManagementOpen] = useState(false);
  if (!permissions.canManageCore) return null;

  return (
    <Collapsible
      open={managementOpen}
      onOpenChange={setManagementOpen}
      id="organization-management"
    >
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle>Organization management</CardTitle>
            <CardDescription>
              Update the Digital Twin without interrupting the client-facing briefing.
            </CardDescription>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="outline">
              <Pencil data-icon="inline-start" />
              {managementOpen ? "Close organization management" : "Open organization management"}
              <ChevronDown
                data-icon="inline-end"
                className={cn("transition-transform", managementOpen && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <OverviewEditor
              organizationId={organizationId}
              snapshot={snapshot}
              canManagePolicies={permissions.canManagePolicies}
              canManageLifecycle={permissions.canManageLifecycle}
            />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function TwinSectionRow({ section }: { section: TwinSection }) {
  const Icon = section.icon;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="group h-auto w-full justify-start px-2 py-3 text-left">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{section.label}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {section.summary}
            </span>
          </span>
          <Badge variant={section.complete ? "outline" : "secondary"}>
            {section.complete ? (
              <CircleCheck aria-hidden="true" />
            ) : (
              <CircleDashed aria-hidden="true" />
            )}
            {section.complete ? "Available" : "Needs input"}
          </Badge>
          <ChevronDown
            data-icon="inline-end"
            className="transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-2 pb-4 pl-13 text-sm">{section.content}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function buildSections(snapshot: DigitalTwinSnapshot): TwinSection[] {
  const organization = snapshot.organization;
  return [
    {
      key: "identity",
      label: "Identity",
      summary: `${organization.industry} · ${organization.country_code} · ${organization.base_currency}`,
      complete: Boolean(organization.name && organization.industry),
      icon: Landmark,
      content: (
        <DescriptionList
          rows={[
            ["Organization", organization.name],
            ["Industry", organization.industry],
            ["Industry pack", organization.industry_pack_slug],
            ["Timezone", organization.default_timezone],
            ["Currency", organization.base_currency],
          ]}
        />
      ),
    },
    {
      key: "branches",
      label: "Branches",
      summary: organization.branchless_confirmed
        ? "Branchless operation confirmed"
        : `${snapshot.branches.length} configured`,
      complete: organization.branchless_confirmed || snapshot.branches.length > 0,
      icon: Building2,
      content:
        snapshot.branches.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {snapshot.branches.map((branch) => (
              <li key={branch.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{branch.name}</span>
                  <Badge variant="outline">{branch.kind}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {branch.timezone} · {branch.currency} · {branch.is_active ? "Active" : "Inactive"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {organization.branchless_confirmed
              ? "The organization has explicitly confirmed that it does not operate branches."
              : "No branch is configured and branchless operation has not been confirmed."}
          </p>
        ),
    },
    {
      key: "profile",
      label: "Business profile",
      summary: snapshot.profile?.business_model ?? "No business model recorded",
      complete: Boolean(snapshot.profile?.business_model || snapshot.profile?.value_proposition),
      icon: ClipboardCheck,
      content: snapshot.profile ? (
        <DescriptionList
          rows={[
            ["Business model", snapshot.profile.business_model ?? "Not recorded"],
            ["Value proposition", snapshot.profile.value_proposition ?? "Not recorded"],
            ["Languages", snapshot.profile.languages.join(", ") || "Not recorded"],
            ["Source", snapshot.profile.source],
            ["Updated", formatInstant(snapshot.profile.updated_at, organization.default_timezone)],
          ]}
        />
      ) : (
        <p className="text-muted-foreground">No business profile has been recorded.</p>
      ),
    },
    {
      key: "facts",
      label: "Facts",
      summary: `${snapshot.facts.length} source-aware fact${snapshot.facts.length === 1 ? "" : "s"}`,
      complete: snapshot.facts.length > 0,
      icon: FileKey,
      content:
        snapshot.facts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {snapshot.facts.slice(0, 8).map((fact) => (
              <li key={fact.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{readableKey(fact.fact_key)}</span>
                  <Badge variant={fact.status === "verified" ? "outline" : "secondary"}>
                    {fact.status}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{displayValue(fact.value)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Source: {fact.source}
                  {fact.last_verified_at
                    ? ` · verified ${formatInstant(fact.last_verified_at, organization.default_timezone)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No source-aware facts have been recorded.</p>
        ),
    },
    {
      key: "goals",
      label: "Goals",
      summary: `${snapshot.goals.length} measurable goal${snapshot.goals.length === 1 ? "" : "s"}`,
      complete: snapshot.goals.length > 0,
      icon: Flag,
      content:
        snapshot.goals.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {snapshot.goals.slice(0, 8).map((goal) => (
              <li key={goal.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{goal.name}</span>
                  <Badge variant="outline">Priority {goal.priority}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {goal.metric}: {goal.target_value} {goal.unit} · baseline {goal.baseline_status}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No measurable goal has been recorded.</p>
        ),
    },
    {
      key: "constraints",
      label: "Constraints",
      summary: `${snapshot.constraints.length} active limit${snapshot.constraints.length === 1 ? "" : "s"}`,
      complete: snapshot.constraints.length > 0,
      icon: ListChecks,
      content:
        snapshot.constraints.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {snapshot.constraints.slice(0, 8).map((constraint) => (
              <li key={constraint.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{constraint.name}</span>
                  <Badge variant={constraint.severity === "hard" ? "secondary" : "outline"}>
                    {constraint.severity}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {constraint.constraint_type} · {displayValue(constraint.value)} · source{" "}
                  {constraint.source}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No active operating constraint has been recorded.</p>
        ),
    },
    {
      key: "policies",
      label: "Policies",
      summary: `${snapshot.policies.length} active polic${snapshot.policies.length === 1 ? "y" : "ies"}`,
      complete: snapshot.policies.some((policy) => policy.policy_type === "access"),
      icon: ShieldCheck,
      content:
        snapshot.policies.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {snapshot.policies.slice(0, 8).map((policy) => (
              <li key={policy.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{policy.name}</span>
                  <Badge variant="outline">{readableKey(policy.mode)}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {readableKey(policy.policy_type)} · version {policy.version}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No active governance policy has been recorded.</p>
        ),
    },
  ];
}

function DescriptionList({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </dt>
          <dd className="mt-1">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function readableKey(value: string): string {
  return value
    .split(/[_.-]/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null || value === undefined) return "Not recorded";
  return JSON.stringify(value);
}

function formatInstant(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}
