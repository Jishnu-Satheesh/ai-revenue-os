import { CircleAlert, Clock3, Plus, Sparkles } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-medium text-accent">Friday, 7 August 2026</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Good morning, operator.</h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            A calm view of what needs attention across your client portfolio.
          </p>
        </div>
        <Button asChild>
          <Link href="/organizations/new">
            <Plus data-icon="inline-start" />
            Create organization
          </Link>
        </Button>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="gap-0">
            <div className="flex items-center justify-between gap-3">
              <CardDescription>Organizations</CardDescription>
              <StatusBadge label="Foundation" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">0</p>
            <p className="mt-1 text-sm text-muted-foreground">No clients onboarded yet</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-0">
            <CardDescription>Opportunities requiring review</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">—</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Recommendations appear after onboarding
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-0">
            <CardDescription>Execution health</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">Ready</p>
            <p className="mt-1 text-sm text-muted-foreground">No workflows have run</p>
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between border-b">
            <div>
              <CardTitle>What needs attention</CardTitle>
              <CardDescription className="mt-1">
                Prioritized by impact, confidence, and urgency.
              </CardDescription>
            </div>
            <Sparkles className="text-accent" />
          </CardHeader>
          <CardContent className="p-0">
            <Empty className="min-h-64 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleAlert />
                </EmptyMedia>
                <EmptyTitle className="text-base">Your opportunity feed is clear</EmptyTitle>
                <EmptyDescription className="max-w-sm">
                  Onboard an organization to start building a trustworthy Digital Twin and finding
                  measurable opportunities.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Decision timeline</CardTitle>
            <CardDescription className="mt-1">
              Signals, decisions, approvals, and outcomes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Empty className="min-h-64 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="default">
                  <Clock3 className="text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle className="text-base">No activity yet</EmptyTitle>
                <EmptyDescription>
                  Important changes will appear here with their evidence and scope.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
