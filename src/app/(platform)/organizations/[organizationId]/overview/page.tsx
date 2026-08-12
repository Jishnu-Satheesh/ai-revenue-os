import { CheckCircle2, Clock3, Database, FileQuestion, ShieldCheck, Sparkles } from "lucide-react";

import { OverviewEditor } from "@/components/organizations/overview-editor";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { getDigitalTwin } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function OverviewPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const snapshot = await getDigitalTwin(context.supabase, context.organizationId);
  const physicalBranchRequired = snapshot.organization.industry.toLowerCase() === "restaurant";
  const sections = [
    {
      label: "Identity",
      complete: Boolean(snapshot.organization.name && snapshot.organization.industry),
      detail: `${snapshot.organization.industry} · ${snapshot.organization.base_currency}`,
    },
    {
      label: "Branches",
      complete:
        snapshot.organization.branchless_confirmed ||
        !physicalBranchRequired ||
        snapshot.branches.some((branch) => branch.kind === "physical" && branch.is_active),
      detail: snapshot.organization.branchless_confirmed
        ? "Branchless confirmed"
        : `${snapshot.branches.length} configured`,
    },
    {
      label: "Business profile",
      complete: Boolean(snapshot.profile?.business_model || snapshot.profile?.value_proposition),
      detail: snapshot.profile?.source ?? "Missing",
    },
    {
      label: "Facts",
      complete: snapshot.facts.length > 0,
      detail: `${snapshot.facts.length} source-aware facts`,
    },
    {
      label: "Goals",
      complete: snapshot.goals.length > 0,
      detail: `${snapshot.goals.length} measurable goals`,
    },
    {
      label: "Policies",
      complete: snapshot.policies.some((policy) => policy.policy_type === "access"),
      detail: `${snapshot.policies.length} active policies`,
    },
  ];
  const completeCount = sections.filter((section) => section.complete).length;
  const readiness = Math.round((completeCount / sections.length) * 100);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          {/* Nothing sits above an organization now: the sidebar and the
              switcher are the way out. */}
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Database />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-3xl font-semibold tracking-tight">
                  {snapshot.organization.name}
                </h2>
                <StatusBadge
                  label={
                    snapshot.organization.status === "draft_onboarding"
                      ? "Draft onboarding"
                      : snapshot.organization.status
                  }
                  tone={snapshot.organization.status === "active" ? "success" : "warning"}
                />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                /{snapshot.organization.slug} · {snapshot.organization.industry_pack_slug} pack ·
                scope: organization
              </p>
            </div>
          </div>
        </div>
        <div className="w-full max-w-xs text-left lg:text-right">
          <p className="text-sm font-medium text-accent">Digital Twin readiness</p>
          <p className="mt-1 text-3xl font-semibold">{readiness}%</p>
          <Progress
            value={readiness}
            aria-label={`Digital Twin readiness: ${readiness}%`}
            className="mt-2"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {completeCount} of {sections.length} sections grounded
          </p>
        </div>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Card key={section.label} className="py-4">
            <CardContent className="px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {section.complete ? (
                    <CheckCircle2 className="text-success" />
                  ) : (
                    <Clock3 className="text-warning" />
                  )}
                  <p className="text-sm font-semibold">{section.label}</p>
                </div>
                <StatusBadge
                  label={section.complete ? "Grounded" : "Needs input"}
                  tone={section.complete ? "success" : "warning"}
                />
              </div>
              <p className="mt-2 truncate text-xs text-muted-foreground">{section.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      <Alert className="border-accent/20 bg-accent/5">
        <Sparkles />
        <AlertTitle>Trust comes before automation</AlertTitle>
        <AlertDescription>
          Every fact below carries a source and verification state. Missing information stays
          visible instead of being guessed.
        </AlertDescription>
      </Alert>
      <OverviewEditor organizationId={context.organizationId} snapshot={snapshot} />
      <Card>
        <CardHeader className="flex-row items-start justify-between border-b">
          <div>
            <CardTitle>Audit timeline</CardTitle>
            <CardDescription className="mt-1">
              Sensitive changes are recorded with actor and entity scope.
            </CardDescription>
          </div>
          <ShieldCheck className="text-accent" />
        </CardHeader>
        <CardContent className="p-0">
          {snapshot.auditEvents.length === 0 ? (
            <Empty className="min-h-36 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileQuestion />
                </EmptyMedia>
                <EmptyTitle className="text-base">No audit events yet</EmptyTitle>
                <EmptyDescription>Changes to this Digital Twin will appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol className="divide-y divide-border">
              {snapshot.auditEvents.slice(0, 12).map((event) => (
                <li
                  key={event.id}
                  className={cn(
                    "flex flex-col gap-1 px-5 py-3",
                    "sm:flex-row sm:items-center sm:justify-between",
                  )}
                >
                  <div>
                    <p className="text-sm font-medium">{event.event_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.entity_type} · actor {event.actor_type}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground" dateTime={event.occurred_at}>
                    {new Date(event.occurred_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
