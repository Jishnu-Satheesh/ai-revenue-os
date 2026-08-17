"use client";

import { useState } from "react";
import Link from "next/link";
import { Receipt, TriangleAlert } from "lucide-react";

import { ChannelMarginTable } from "@/components/economics/channel-margin-table";
import { MarginWaterfall } from "@/components/economics/margin-waterfall";
import { TrustPanel } from "@/components/economics/trust-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  EconomicsView,
  EconomicsWindowPreset,
} from "@/modules/economics/application/read-model";

/**
 * The channel economics operator view.
 *
 * Answers the three questions in `specs/012` section 7 in order — except when
 * nothing is priced, where the order inverts. On a fresh client every channel
 * is a ceiling or a reported figure, and opening with a table they cannot act
 * on wastes the only screen that could tell them what to do about it, so the
 * task list leads instead. Section 11 asks for exactly that.
 */
export function ChannelEconomicsClient({
  view,
  organizationName,
  costStructureHref,
  onWindowChange,
}: {
  view: EconomicsView;
  organizationName: string;
  costStructureHref: string;
  onWindowChange: (preset: EconomicsWindowPreset) => void;
}) {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(
    view.breakdown?.channel ?? null,
  );

  const { rollup, breakdown } = view;
  const currency = rollup.currency ?? "";
  const selected = rollup.channels.find((channel) => channel.channel === selectedChannel);
  const showBreakdown = Boolean(breakdown && selected && selected.marginSource === "derived");
  // Nothing derived anywhere means no waterfall is possible for any channel, so
  // the page has nothing to offer between the table and the task list.
  const trustLeads = rollup.channels.length > 0 && !rollup.hasAnyDerivedChannel;

  if (rollup.channels.length === 0) {
    return (
      <Card>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Receipt />
              </EmptyMedia>
              <EmptyTitle>No trade recorded in this window</EmptyTitle>
              <EmptyDescription>
                Channel economics are computed from imported revenue. Once an import lands, every
                day it covers is priced and appears here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const trustSection = (
    <Section
      question="What would I have to fix to trust this"
      title="Data quality"
      description="Each unresolved cost, and what it would take to close it."
    >
      <TrustPanel
        gaps={view.gaps}
        coverage={view.coverage}
        catalogAvailable={view.catalogAvailable}
        costStructureHref={costStructureHref}
      />
    </Section>
  );

  return (
    <div className="flex flex-col gap-8">
      <PeriodControl window={view.window} onWindowChange={onWindowChange} />

      {trustLeads ? (
        <>
          <Alert className="bg-primary/5">
            <AlertTitle>These margins are your own reported figures</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>
                {organizationName} reports a contribution margin on every order, and that figure is
                measured and usable. What it cannot answer is what is eating the margin, because no
                variable cost has been priced yet.
              </span>
              <Button asChild size="sm">
                <Link href={costStructureHref}>Price your costs</Link>
              </Button>
            </AlertDescription>
          </Alert>
          {trustSection}
        </>
      ) : null}

      <DisagreementAlert channels={rollup.channels} currency={currency} href={costStructureHref} />

      <Section
        question="Which channel actually makes money"
        title="Contribution margin by channel"
        description={`${organizationName} · after every variable cost that has been priced.`}
      >
        <ChannelMarginTable
          channels={rollup.channels}
          currency={currency}
          selectedChannel={selectedChannel}
          onSelectChannel={setSelectedChannel}
        />
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          An indicative margin is a ceiling, not a figure, and is excluded from decisions.
        </p>
      </Section>

      {showBreakdown && breakdown && selected && selected.grade !== "indicative" ? (
        <Section
          question="What is eating the margin"
          title={`${selected.channel ?? "All channels"} · component breakdown`}
          description="Gross revenue down to contribution, one row per registered cost."
        >
          <MarginWaterfall
            channel={selected.channel}
            components={breakdown.components}
            grossRevenueMinor={selected.grossRevenueMinor}
            contributionMarginMinor={selected.contributionMarginMinor}
            grade={selected.grade}
            currency={currency}
          />
        </Section>
      ) : (
        <Section
          question="What is eating the margin"
          title="Component breakdown"
          description="Available once a channel's margin is derived from its costs."
        >
          <Empty className="border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Receipt />
              </EmptyMedia>
              <EmptyTitle>No component breakdown yet</EmptyTitle>
              <EmptyDescription>
                A reported margin is measured but never decomposed. Price your costs and the
                breakdown appears here.
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild variant="outline" size="sm">
              <Link href={costStructureHref}>Price your costs</Link>
            </Button>
          </Empty>
        </Section>
      )}

      {trustLeads ? null : trustSection}
    </div>
  );
}

function Section({
  question,
  title,
  description,
  children,
}: {
  question: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {question}
      </span>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

const PRESETS: readonly { value: EconomicsWindowPreset; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

function PeriodControl({
  window,
  onWindowChange,
}: {
  window: EconomicsView["window"];
  onWindowChange: (preset: EconomicsWindowPreset) => void;
}) {
  const format = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: window.timeZone,
    }).format(date);

  // The end is exclusive, so the last day shown is the one before it.
  const lastDay = new Date(window.rangeEndExclusive.getTime() - 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {format(window.rangeStart)} – {format(lastDay)} · {window.timeZone}
      </p>
      {/* Tabs rather than a button group, matching the Integration Hub. There
          is no TabsContent: the window is a server concern, so selecting one
          navigates and the page re-renders with different rows. */}
      <Tabs
        value={window.preset}
        onValueChange={(value) => value && onWindowChange(value as EconomicsWindowPreset)}
      >
        <TabsList aria-label="Reporting period">
          {PRESETS.map((preset) => (
            <TabsTrigger key={preset.value} value={preset.value}>
              {preset.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

/**
 * Says the derived figures and the client's own export do not agree.
 *
 * Above the table rather than below it. specs/012 section 4.4.1 requires the
 * disagreement to be raised, and a reader who reaches the margin column before
 * learning it is contradicted has already taken the number at face value.
 *
 * It deliberately does not adjudicate. Either the rates are wrong or the export
 * is, and the platform cannot tell which — saying so plainly is more useful
 * than picking a side, and picking one would be the silent reconciliation the
 * spec forbids.
 */
function DisagreementAlert({
  channels,
  currency,
  href,
}: {
  channels: EconomicsView["rollup"]["channels"];
  currency: string;
  href: string;
}) {
  const disagreeing = channels.filter((channel) => channel.disagreement);
  if (disagreeing.length === 0) return null;

  const widest = disagreeing.reduce((worst, channel) =>
    Math.abs(channel.disagreement!.differenceMinor) > Math.abs(worst.disagreement!.differenceMinor)
      ? channel
      : worst,
  );
  const gap = widest.disagreement!;
  const points = gap.differencePoints;

  return (
    <Alert>
      <TriangleAlert />
      <AlertTitle>These margins do not match the figures your export reports</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          {disagreeing.length === 1
            ? `On ${widest.channel ?? "all channels"}, `
            : `Across ${disagreeing.length} channels, the widest gap is on ${widest.channel ?? "all channels"}: `}
          the costs recorded here produce a margin {gap.differenceMinor > 0 ? "higher" : "lower"}{" "}
          than the one reported, by{" "}
          <span className="font-medium text-foreground">
            {formatMoney(Math.abs(gap.differenceMinor), currency)}
          </span>
          {points === null ? null : (
            <>
              {" "}
              over {gap.periodCount} {gap.periodCount === 1 ? "day" : "days"} — about{" "}
              <span className="font-medium text-foreground">
                {Math.abs(points).toFixed(1)} points
              </span>{" "}
              of revenue
            </>
          )}
          . Either a rate here is wrong or the export is, and only you can say which.
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>Review your costs</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: currency || "AED",
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}
