import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  Database,
  FileQuestion,
  Lightbulb,
  Megaphone,
  ShieldAlert,
  Sparkles,
  Building2,
  Settings2,
} from "lucide-react";

import { ChannelEconomicsOverview } from "@/components/organizations/channel-economics-overview";
import {
  CurrentDigitalTwinData,
  OrganizationManagement,
} from "@/components/organizations/digital-twin-workspace";
import { HealthStatusBadge } from "@/components/integrations/health-status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  findDemoCampaign,
  findDemoExecution,
  formatMinor,
  type DemoCampaignSummary,
} from "@/modules/campaigns/demo/fixtures";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import type {
  DigitalTwinReadiness,
  getOverviewPermissions,
  OverviewActionItem,
  OverviewEconomics,
  OverviewIntegration,
  StrategicBriefingItem,
} from "@/modules/organizations/application/overview";

type Permissions = ReturnType<typeof getOverviewPermissions>;
type EconomicsResult = { status: "ready"; data: OverviewEconomics } | { status: "failed" };
type IntegrationResult =
  | { status: "disabled" }
  | { status: "failed" }
  | { status: "ready"; data: OverviewIntegration };

export function OrganizationIntelligenceCockpit({
  snapshot,
  readiness,
  permissions,
  reportingWindow,
  economics,
  integration,
  campaigns,
  briefing,
  actions,
}: Readonly<{
  snapshot: DigitalTwinSnapshot;
  readiness: DigitalTwinReadiness;
  permissions: Permissions;
  reportingWindow: OverviewEconomics["window"];
  economics: EconomicsResult;
  integration: IntegrationResult;
  campaigns: readonly DemoCampaignSummary[];
  briefing: readonly StrategicBriefingItem[];
  actions: readonly OverviewActionItem[];
}>) {
  const organization = snapshot.organization;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Building2 aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">{organization.name}</h1>
              <StatusBadge
                label={
                  organization.status === "draft_onboarding"
                    ? "Draft onboarding"
                    : organization.status
                }
                tone={organization.status === "active" ? "success" : "warning"}
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Intelligence cockpit · {formatWindow(reportingWindow)} · {reportingWindow.timeZone}
            </p>
          </div>
        </div>
        {permissions.canManageCore ? (
          <Button variant="outline">
            <Settings2 data-icon="inline-start" />
            <Link href="#organization-management">Manage organization</Link>
          </Button>
        ) : null}
      </header>

      {/* <ReadinessStrip readiness={readiness} canManage={permissions.canManageCore} /> */}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-12 lg:items-start">
        <div className="order-1 min-w-0 lg:col-span-4 lg:col-start-9 lg:row-start-1">
          <ActionRequired actions={actions} />
        </div>
        <div className="order-2 min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-1">
          <StrategicBriefing briefing={briefing} />
        </div>
        <div className="order-3 min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-2">
          <ChannelEconomicsOverview organizationId={organization.id} result={economics} />
        </div>
        {integration.status === "disabled" ? null : (
          <div className="order-4 min-w-0 lg:col-span-4 lg:col-start-9 lg:row-start-2">
            <IntegrationHealth
              organizationId={organization.id}
              result={integration}
              timeZone={organization.default_timezone}
            />
          </div>
        )}
        <div className="order-5 min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-3">
          <CurrentDigitalTwinData snapshot={snapshot} />
        </div>
        <div className="order-6 min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-4">
          <CampaignIdeas
            organizationId={organization.id}
            campaigns={campaigns}
            timeZone={organization.default_timezone}
          />
        </div>
        <div className="order-7 min-w-0 lg:col-span-4 lg:col-start-9 lg:row-start-3">
          <RecentActivity snapshot={snapshot} />
        </div>
        {permissions.canManageCore ? (
          <div className="order-8 min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-5">
            <OrganizationManagement
              organizationId={organization.id}
              snapshot={snapshot}
              permissions={permissions}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReadinessStrip({
  readiness,
  canManage,
}: {
  readiness: DigitalTwinReadiness;
  canManage: boolean;
}) {
  return (
    <Card className="bg-primary/[0.03]">
      <CardContent className="grid gap-5 px-5 lg:grid-cols-[14rem_1fr_auto] lg:items-center">
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <span className="text-4xl font-semibold tabular-nums">{readiness.percentage}%</span>
            <span className="pb-1 text-sm font-medium text-muted-foreground">
              Digital Twin readiness
            </span>
          </div>
          <Progress
            value={readiness.percentage}
            aria-label={`Digital Twin readiness: ${readiness.percentage}%, ${readiness.groundedCount} of ${readiness.totalCount} sections grounded`}
          />
          <p className="text-xs text-muted-foreground">
            {readiness.groundedCount} of {readiness.totalCount} sections grounded
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {readiness.sections.map((section) => (
            <li
              key={section.key}
              className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-2 ring-1 ring-foreground/10"
            >
              {section.complete ? (
                <CheckCircle2 className="shrink-0 text-success" aria-hidden="true" />
              ) : (
                <CircleDashed className="shrink-0 text-warning" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{section.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {section.complete ? "Grounded" : "Needs input"}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" size="sm">
          <Link href={canManage ? "#organization-management" : "#digital-twin-data"}>
            {canManage ? "Manage" : "View"} data foundation
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function StrategicBriefing({ briefing }: { briefing: readonly StrategicBriefingItem[] }) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary" />
            <CardTitle className="font-semibold text-xl">Strategic Briefing</CardTitle>
          </div>
          <CardDescription>
            What the current evidence supports—and what it does not.
          </CardDescription>
        </div>
        <Badge variant="outline">
          <Bot />
          Evidence briefing
        </Badge>
      </CardHeader>
      <CardContent>
        {briefing.length === 0 ? (
          <Empty className="min-h-32 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sparkles />
              </EmptyMedia>
              <EmptyTitle>No supported briefing yet</EmptyTitle>
              <EmptyDescription>
                More structured evidence is needed before the cockpit can summarize it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="flex flex-col gap-3">
            {briefing.map((item) => (
              <li key={item.kind} className="rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {item.kind === "foundation" ? (
                      <Database />
                    ) : item.kind === "economics" ? (
                      <Lightbulb />
                    ) : (
                      <Activity />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.conclusion}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.evidence}</p>
                    <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0">
                      <Link href={item.href}>Inspect evidence</Link>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ActionRequired({ actions }: { actions: readonly OverviewActionItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Required</CardTitle>
        <CardDescription>Highest-priority gaps in current platform evidence.</CardDescription>
      </CardHeader>
      <CardContent>
        {actions.length === 0 ? (
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <CheckCircle2 className="shrink-0 text-success" />
            <div>
              <p className="font-medium">No blocking issue is visible</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This reflects current platform data, not a promise that the business itself is
                healthy.
              </p>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {actions.map((action) => (
              <li key={`${action.kind}:${action.title}`} className="rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  {action.kind === "foundation" ? (
                    <ShieldAlert className="shrink-0 text-warning" />
                  ) : (
                    <CircleAlert className="shrink-0 text-warning" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{action.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{action.impact}</p>
                    {action.href && action.actionLabel ? (
                      <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0">
                        <Link href={action.href}>{action.actionLabel}</Link>
                      </Button>
                    ) : (
                      <Badge variant="outline" className="mt-2">
                        Read only
                      </Badge>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationHealth({
  organizationId,
  result,
  timeZone,
}: {
  organizationId: string;
  result: Exclude<IntegrationResult, { status: "disabled" }>;
  timeZone: string;
}) {
  const href = `/organizations/${organizationId}/integrations`;
  if (result.status === "failed") {
    return (
      <Card id="integration-health">
        <CardHeader>
          <CardTitle>Integration Health</CardTitle>
          <CardDescription>Connection state and evidence freshness.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Integration health is temporarily unavailable</AlertTitle>
            <AlertDescription>
              The rest of the organization overview remains current.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" size="sm">
            <Link href={href}>Manage connections</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const integration = result.data;
  return (
    <Card id="integration-health">
      <CardHeader>
        <CardTitle>Integration Health</CardTitle>
        <CardDescription>
          {integration.healthyConnections} of {integration.totalConnections} connections healthy
        </CardDescription>
      </CardHeader>
      <CardContent>
        {integration.connections.length === 0 ? (
          <Empty className="min-h-32 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Activity />
              </EmptyMedia>
              <EmptyTitle>No connections yet</EmptyTitle>
              <EmptyDescription>
                Connect or import a source in the Integration Hub.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {integration.connections.map((connection) => (
              <li key={connection.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{connection.accountLabel}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {readableKey(connection.providerKey)}
                    </p>
                  </div>
                  <HealthStatusBadge state={connection.state} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{connection.explanation}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last successful sync:{" "}
                  {formatOptionalInstant(connection.lastSuccessfulSyncAt, timeZone)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>Manage connections</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function CampaignIdeas({
  organizationId,
  campaigns,
  timeZone,
}: {
  organizationId: string;
  campaigns: readonly DemoCampaignSummary[];
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Strategic Campaign Ideas</CardTitle>
          <CardDescription>Three recent proposals ready for a closer look.</CardDescription>
        </div>
        <Badge variant="secondary">Preview data</Badge>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Collapsible>
                <div className="rounded-lg border">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="group h-auto w-full justify-start px-4 py-3 text-left"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Megaphone />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{campaign.title}</span>
                        <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                          {campaign.sourceLabel} · {campaign.channels.join(" · ")}
                        </span>
                        <Badge variant="outline" className="mt-1.5 sm:hidden">
                          {readableKey(campaign.lifecycle)}
                        </Badge>
                      </span>
                      <Badge variant="outline" className="hidden sm:inline-flex">
                        {readableKey(campaign.lifecycle)}
                      </Badge>
                      <ChevronDown
                        data-icon="inline-end"
                        className="transition-transform group-data-[state=open]:rotate-180"
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex flex-col gap-3 border-t px-4 py-4">
                      <p>{campaign.objective}</p>
                      <dl className="grid gap-3 text-sm sm:grid-cols-3">
                        <CampaignDatum
                          label="Spend ceiling"
                          value={formatMinor(campaign.spendCeiling)}
                        />
                        <CampaignDatum
                          label="Blocked actions"
                          value={String(campaign.blockerCount)}
                        />
                        <CampaignDatum
                          label="Updated"
                          value={formatInstant(campaign.updatedAt, timeZone)}
                        />
                      </dl>
                      <Button asChild variant="outline" size="sm" className="self-start">
                        <Link href={campaignHref(organizationId, campaign.id)}>
                          {hasCampaignDetail(campaign.id) ? "Review idea" : "Open campaigns"}{" "}
                          <ArrowUpRight data-icon="inline-end" />
                        </Link>
                      </Button>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function hasCampaignDetail(campaignId: string): boolean {
  return Boolean(findDemoCampaign(campaignId) || findDemoExecution(campaignId));
}

function campaignHref(organizationId: string, campaignId: string): string {
  const campaignsHref = `/organizations/${organizationId}/campaigns`;
  return hasCampaignDetail(campaignId) ? `${campaignsHref}/${campaignId}` : campaignsHref;
}

function CampaignDatum({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}

function RecentActivity({ snapshot }: { snapshot: DigitalTwinSnapshot }) {
  const recent = snapshot.auditEvents.slice(0, 3);
  const timeZone = snapshot.organization.default_timezone;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Authoritative Digital Twin changes.</CardDescription>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <Empty className="min-h-32 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileQuestion />
              </EmptyMedia>
              <EmptyTitle>No audit events yet</EmptyTitle>
              <EmptyDescription>Governed changes will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="flex flex-col gap-3">
            {recent.map((event) => (
              <li key={event.id} className="rounded-lg border p-3">
                <p className="font-medium">{readableKey(event.event_name)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {readableKey(event.entity_type)} · actor {event.actor_type}
                </p>
                <time
                  className="mt-1 block text-xs text-muted-foreground"
                  dateTime={event.occurred_at}
                >
                  {formatInstant(event.occurred_at, timeZone)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
      {snapshot.auditEvents.length > 0 ? (
        <CardFooter>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                View full audit timeline
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Audit timeline</DialogTitle>
                <DialogDescription>
                  Sensitive organization changes with actor and entity scope.
                </DialogDescription>
              </DialogHeader>
              <ol className="flex flex-col gap-2">
                {snapshot.auditEvents.map((event) => (
                  <li key={event.id} className="rounded-lg border p-3">
                    <p className="font-medium">{readableKey(event.event_name)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {readableKey(event.entity_type)} · actor {event.actor_type} ·{" "}
                      {formatInstant(event.occurred_at, timeZone)}
                    </p>
                  </li>
                ))}
              </ol>
            </DialogContent>
          </Dialog>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function formatWindow(window: OverviewEconomics["window"]): string {
  const end = new Date(new Date(window.rangeEndExclusive).getTime() - 1);
  return `${formatDate(window.rangeStart, window.timeZone)} – ${formatDate(end.toISOString(), window.timeZone)}`;
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}

function formatInstant(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(value));
}

function formatOptionalInstant(value: string | null, timeZone: string): string {
  return value ? formatInstant(value, timeZone) : "Not yet available";
}

function readableKey(value: string): string {
  return value
    .split(/[_.-]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
