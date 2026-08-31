"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArchiveIcon,
  CirclePlusIcon,
  PencilIcon,
  ShieldCheckIcon,
  TagsIcon,
  WaypointsIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMoney } from "@/components/analysis/format";
import type { ChannelsOverviewRow } from "@/modules/analysis/application/channels-overview";
import type {
  ChannelSourceAliasRow,
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

const categories = [
  ["marketplace", "Marketplace"],
  ["owned_digital", "Owned digital"],
  ["physical", "Physical"],
  ["reseller", "Reseller"],
  ["other", "Other"],
] as const;

type Category = OrganizationChannelRow["category"];
type BranchMappingStatus = OrganizationChannelBranchRow["status"];
type AliasSourceScope = ChannelSourceAliasRow["source_scope"];

const aliasSourceScopes = [
  ["manual", "Manual label"],
  ["report_package", "Report package"],
  ["onboarding", "Onboarding"],
  ["normalized_metric", "Normalized metric"],
  ["economics_entry", "Economics entry"],
  ["cost_rate", "Cost rate"],
] as const satisfies ReadonlyArray<readonly [AliasSourceScope, string]>;

function labelForCategory(category: Category) {
  return categories.find(([value]) => value === category)?.[1] ?? "Other";
}

type DirectoryFilter = "all" | "measured" | "attention" | "archived";

function isMeasured(row: ChannelsOverviewRow | undefined) {
  return row?.band.state === "complete";
}

function matchesDirectoryFilter({
  filter,
  channel,
  analysis,
  workspaceEnabled,
}: {
  filter: DirectoryFilter;
  channel: OrganizationChannelRow;
  analysis: ChannelsOverviewRow | undefined;
  workspaceEnabled: boolean;
}) {
  if (filter === "all") return true;
  if (filter === "archived") return channel.status === "archived";
  if (filter === "measured") return channel.status === "active" && isMeasured(analysis);
  return channel.status === "active" && workspaceEnabled && !isMeasured(analysis);
}

function countMappingsByChannel(mappings: readonly OrganizationChannelBranchRow[]) {
  const counts = new Map<string, { total: number; historical: number }>();

  for (const mapping of mappings) {
    const current = counts.get(mapping.channel_id) ?? { total: 0, historical: 0 };
    counts.set(mapping.channel_id, {
      total: current.total + 1,
      historical: current.historical + (mapping.status === "inactive" ? 1 : 0),
    });
  }

  return counts;
}

function countAliasesByChannel(aliases: readonly ChannelSourceAliasRow[]) {
  const counts = new Map<string, number>();

  for (const alias of aliases) {
    counts.set(alias.channel_id, (counts.get(alias.channel_id) ?? 0) + 1);
  }

  return counts;
}

function ChannelAnalysisSummary({
  analysis,
  workspaceEnabled,
}: {
  analysis: ChannelsOverviewRow | undefined;
  workspaceEnabled: boolean;
}) {
  if (!workspaceEnabled) {
    return (
      <div className="grid gap-1">
        <Badge className="w-fit" variant="outline">
          Analysis not enabled
        </Badge>
        <p className="text-sm text-muted-foreground">
          Connect governed reporting to measure this channel.
        </p>
      </div>
    );
  }

  if (analysis?.band.state === "complete" && analysis.band.earned && analysis.band.potential) {
    return (
      <div className="grid gap-1">
        <Badge className="w-fit" variant="default">
          Measured
        </Badge>
        <p className="text-lg font-semibold tracking-tight text-primary">
          {formatMoney(analysis.band.earned.minorUnits, analysis.band.earned.currency)} earned
        </p>
        <p className="text-sm text-muted-foreground">
          {formatMoney(analysis.band.potential.minorUnits, analysis.band.potential.currency)}{" "}
          potential
          {analysis.band.lost
            ? ` · ${formatMoney(analysis.band.lost.minorUnits, analysis.band.lost.currency)} loss`
            : null}
        </p>
      </div>
    );
  }

  if (analysis?.band.state === "revenue_only" && analysis.band.potential) {
    return (
      <div className="grid gap-1">
        <Badge className="w-fit" variant="secondary">
          Revenue reported
        </Badge>
        <p className="text-lg font-semibold tracking-tight">
          {formatMoney(analysis.band.potential.minorUnits, analysis.band.potential.currency)}{" "}
          revenue
        </p>
        <p className="text-sm text-muted-foreground">Loss not recorded for this window.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <Badge className="w-fit" variant="outline">
        Needs analysis
      </Badge>
      <p className="text-sm text-muted-foreground">
        No completed analysis for the selected reporting window.
      </p>
    </div>
  );
}

function ChannelForm({
  organizationId,
  channel,
  onComplete,
}: {
  organizationId: string;
  channel?: OrganizationChannelRow;
  onComplete: () => void;
}) {
  const [category, setCategory] = useState<Category>(channel?.category ?? "marketplace");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = channel
      ? {
          displayName: String(form.get("displayName") ?? ""),
          category,
          templateKey: String(form.get("templateKey") ?? "").trim() || null,
        }
      : {
          key: String(form.get("key") ?? ""),
          displayName: String(form.get("displayName") ?? ""),
          category,
          templateKey: String(form.get("templateKey") ?? "").trim() || null,
        };
    setPending(true);
    setError(null);
    const response = await fetch(
      channel
        ? `/api/organizations/${organizationId}/channels/${channel.id}`
        : `/api/organizations/${organizationId}/channels`,
      {
        method: channel ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "The channel could not be saved. Please try again.");
      setPending(false);
      return;
    }
    onComplete();
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <FieldGroup>
        {!channel ? (
          <Field>
            <FieldLabel htmlFor="channel-key">Stable key</FieldLabel>
            <Input
              id="channel-key"
              name="key"
              required
              placeholder="e.g. talabat or smile.easy-eats"
            />
            <FieldDescription>
              Lower-case identity used for safe records and imports.
            </FieldDescription>
          </Field>
        ) : (
          <Field>
            <FieldLabel>Stable key</FieldLabel>
            <Input value={channel.key} readOnly aria-readonly />
            <FieldDescription>This identity is intentionally immutable.</FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="channel-name">Channel name</FieldLabel>
          <Input
            id="channel-name"
            name="displayName"
            required
            defaultValue={channel?.display_name}
          />
        </Field>
        <Field>
          <FieldLabel>Category</FieldLabel>
          <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {categories.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="template-key">Optional provider hint</FieldLabel>
          <Input id="template-key" name="templateKey" defaultValue={channel?.template_key ?? ""} />
          <FieldDescription>
            A hint helps recognize report vocabulary. It never creates a connection, credential, or
            campaign permission.
          </FieldDescription>
        </Field>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Channel was not saved</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : channel ? "Save channel" : "Create channel"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ChannelDialog({
  organizationId,
  channel,
  onComplete,
}: {
  organizationId: string;
  channel?: OrganizationChannelRow;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(channel);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm">
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button>
            <CirclePlusIcon data-icon="inline-start" />
            Add channel
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit channel" : "Add a channel"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Rename or categorize this organization-owned business channel."
              : "Create a business channel first; connect a provider separately in Integration Hub."}
          </DialogDescription>
        </DialogHeader>
        <ChannelForm
          organizationId={organizationId}
          channel={channel}
          onComplete={() => {
            setOpen(false);
            onComplete();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function responseMessage(body: unknown, fallback: string) {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return fallback;
}

/**
 * The setup surface for one channel: identity, branch mappings and source
 * labels, and archive. These used to be dialogs over the register grid, which
 * had nowhere to put them; a channel with its own page has room for sections.
 *
 * `canManage` gates identity edits and archive; `canMapBranches` gates
 * mappings and source labels. Missing either renders that part read-only
 * rather than hiding it, so every member keeps visibility into how a channel
 * is configured.
 */
export function ChannelSetupPanel({
  organizationId,
  channel,
  branches,
  branchMappings,
  aliases,
  canManage,
  canMapBranches,
}: {
  organizationId: string;
  channel: OrganizationChannelRow;
  branches?: readonly OrganizationBranchRow[];
  branchMappings?: readonly OrganizationChannelBranchRow[];
  aliases?: readonly ChannelSourceAliasRow[];
  canManage: boolean;
  canMapBranches?: boolean;
}) {
  const router = useRouter();
  const availableBranches = branches ?? [];
  const channelMappings = (branchMappings ?? []).filter(
    (mapping) => mapping.channel_id === channel.id,
  );
  const channelAliases = (aliases ?? []).filter((alias) => alias.channel_id === channel.id);
  const currentMapping = channelMappings.find((mapping) =>
    availableBranches.some((branch) => branch.id === mapping.branch_id),
  );

  const [branchId, setBranchId] = useState(
    currentMapping?.branch_id ?? availableBranches[0]?.id ?? "",
  );
  const [applicability, setApplicability] = useState<BranchMappingStatus>(
    currentMapping?.status ?? "active",
  );
  const [sourceScope, setSourceScope] = useState<AliasSourceScope>("manual");
  const [pending, setPending] = useState<"branch" | "alias" | "archive" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveBranchMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId) return;
    const form = new FormData(event.currentTarget);
    setPending("branch");
    setError(null);
    const response = await fetch(
      `/api/organizations/${organizationId}/channels/${channel.id}/branches`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          applicability,
          effectiveFrom: String(form.get("effectiveFrom") ?? "") || null,
          effectiveTo: String(form.get("effectiveTo") ?? "") || null,
        }),
      },
    );
    if (!response.ok) {
      setError(
        responseMessage(
          await response.json().catch(() => null),
          "The branch mapping could not be saved. Please try again.",
        ),
      );
      setPending(null);
      return;
    }
    setPending(null);
    router.refresh();
  }

  async function saveAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending("alias");
    setError(null);
    const response = await fetch(
      `/api/organizations/${organizationId}/channels/${channel.id}/aliases`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alias: String(form.get("alias") ?? ""),
          sourceScope,
          effectiveFrom: String(form.get("effectiveFrom") ?? "") || null,
          effectiveTo: String(form.get("effectiveTo") ?? "") || null,
        }),
      },
    );
    if (!response.ok) {
      setError(
        responseMessage(
          await response.json().catch(() => null),
          "The source label could not be saved. Please try again.",
        ),
      );
      setPending(null);
      return;
    }
    setPending(null);
    router.refresh();
  }

  async function toggleArchive() {
    setPending("archive");
    setError(null);
    const response = await fetch(`/api/organizations/${organizationId}/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: channel.status === "active" ? "archived" : "active" }),
    });
    if (!response.ok) {
      setError(
        responseMessage(
          await response.json().catch(() => null),
          "The channel status could not be changed. Please try again.",
        ),
      );
      setPending(null);
      return;
    }
    setPending(null);
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3" aria-labelledby={`channel-identity-${channel.id}`}>
        <div>
          <h3 id={`channel-identity-${channel.id}`} className="font-medium">
            Channel identity
          </h3>
          <p className="text-sm text-muted-foreground">
            The name, category, and provider hint used across reporting. Never a credential or a
            campaign permission.
          </p>
        </div>
        {canManage ? (
          <div className="rounded-lg border p-4">
            <ChannelForm
              organizationId={organizationId}
              channel={channel}
              onComplete={() => router.refresh()}
            />
          </div>
        ) : (
          <div className="grid gap-2 rounded-lg border px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Display name</span>
              <span>{channel.display_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Stable key</span>
              <span>{channel.key}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Category</span>
              <span>{labelForCategory(channel.category)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Provider hint</span>
              <span>{channel.template_key ?? "None"}</span>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby={`branch-mappings-${channel.id}`}>
        <div>
          <h3 id={`branch-mappings-${channel.id}`} className="font-medium">
            Branch applicability
          </h3>
          <p className="text-sm text-muted-foreground">
            Use inactive when a channel no longer applies to an outlet; its prior evidence stays
            intact.
          </p>
        </div>
        {channelMappings.length > 0 ? (
          <div className="grid gap-2">
            {channelMappings.map((mapping) => {
              const branch = availableBranches.find((item) => item.id === mapping.branch_id);
              return (
                <div
                  key={mapping.id}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                >
                  <span>{branch?.name ?? "Historical outlet"}</span>
                  <Badge variant={mapping.status === "active" ? "outline" : "secondary"}>
                    {mapping.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            No outlet mappings yet.
          </p>
        )}
        {canMapBranches ? (
          availableBranches.length > 0 ? (
            <form className="grid gap-3 rounded-lg border p-4" onSubmit={saveBranchMapping}>
              <FieldGroup>
                <Field>
                  <FieldLabel>Outlet</FieldLabel>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose an outlet" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availableBranches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Applicability</FieldLabel>
                  <Select
                    value={applicability}
                    onValueChange={(value) => setApplicability(value as BranchMappingStatus)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`mapping-from-${channel.id}`}>Effective from</FieldLabel>
                    <Input id={`mapping-from-${channel.id}`} name="effectiveFrom" type="date" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`mapping-to-${channel.id}`}>Effective to</FieldLabel>
                    <Input id={`mapping-to-${channel.id}`} name="effectiveTo" type="date" />
                  </Field>
                </div>
              </FieldGroup>
              <div className="flex justify-end">
                <Button type="submit" disabled={pending !== null}>
                  {pending === "branch" ? "Saving…" : "Save outlet mapping"}
                </Button>
              </div>
            </form>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              Add an active branch in organization settings before mapping this channel.
            </p>
          )
        ) : null}
      </section>

      <section className="grid gap-3" aria-labelledby={`source-labels-${channel.id}`}>
        <div>
          <h3 id={`source-labels-${channel.id}`} className="font-medium">
            Source labels
          </h3>
          <p className="text-sm text-muted-foreground">
            Add exact labels seen in onboarding, imports, or reports so the platform can match
            evidence to this channel safely.
          </p>
        </div>
        {channelAliases.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {channelAliases.map((alias) => (
              <Badge key={alias.id} variant="secondary">
                <TagsIcon data-icon="inline-start" />
                {alias.alias} · {alias.source_scope.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            No source labels yet.
          </p>
        )}
        {canMapBranches ? (
          <form className="grid gap-3 rounded-lg border p-4" onSubmit={saveAlias}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`alias-${channel.id}`}>Exact source label</FieldLabel>
                <Input
                  id={`alias-${channel.id}`}
                  name="alias"
                  required
                  placeholder="e.g. Smile (Easy Eats)"
                />
              </Field>
              <Field>
                <FieldLabel>Where did this label come from?</FieldLabel>
                <Select
                  value={sourceScope}
                  onValueChange={(value) => setSourceScope(value as AliasSourceScope)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {aliasSourceScopes.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`alias-from-${channel.id}`}>Effective from</FieldLabel>
                  <Input id={`alias-from-${channel.id}`} name="effectiveFrom" type="date" />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`alias-to-${channel.id}`}>Effective to</FieldLabel>
                  <Input id={`alias-to-${channel.id}`} name="effectiveTo" type="date" />
                </Field>
              </div>
            </FieldGroup>
            <div className="flex justify-end">
              <Button type="submit" disabled={pending !== null}>
                {pending === "alias" ? "Saving…" : "Save source label"}
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="grid gap-3" aria-labelledby={`channel-archive-${channel.id}`}>
        <div>
          <h3 id={`channel-archive-${channel.id}`} className="font-medium">
            {canManage
              ? channel.status === "active"
                ? "Archive channel"
                : "Restore channel"
              : "Channel status"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? channel.status === "active"
                ? "Archiving keeps every mapping, source label, and historical evidence intact; it only stops the channel from accepting new activity."
                : "Restoring returns this channel to active use with its history unchanged."
              : "Only a channel manager can archive or restore this channel."}
          </p>
        </div>
        {canManage ? (
          <div>
            <Button variant="outline" size="sm" onClick={toggleArchive} disabled={pending !== null}>
              <ArchiveIcon data-icon="inline-start" />
              {pending === "archive"
                ? "Saving…"
                : channel.status === "active"
                  ? "Archive channel"
                  : "Restore channel"}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 rounded-lg border px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span>{channel.status === "active" ? "Active" : "Archived"}</span>
            </div>
          </div>
        )}
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Setup change was not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function ChannelsManagement({
  organizationId,
  organizationName,
  channels,
  branchMappings,
  aliases,
  canManage,
  workspaceEnabled,
  analysisRows,
  portfolio,
}: {
  organizationId: string;
  organizationName: string;
  channels: readonly OrganizationChannelRow[];
  // Mapping setup now lives on the channel's own page (`ChannelSetupPanel`),
  // so the page-level register only reports its existing mapping state.
  branches?: readonly OrganizationBranchRow[];
  branchMappings?: readonly OrganizationChannelBranchRow[];
  aliases?: readonly ChannelSourceAliasRow[];
  canManage: boolean;
  canMapBranches?: boolean;
  /** Whether governed channel analysis is on for this organization. */
  workspaceEnabled?: boolean;
  /** A row for each channel in the selected governed reporting window. */
  analysisRows?: readonly ChannelsOverviewRow[];
  /** Server-rendered portfolio outcome and comparison visualisation. */
  portfolio?: ReactNode;
}) {
  const router = useRouter();
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>("all");
  const availableMappings = branchMappings ?? [];
  const availableAliases = aliases ?? [];
  const analysisEnabled = workspaceEnabled ?? false;
  const analysisByChannel = new Map((analysisRows ?? []).map((row) => [row.channelId, row]));
  const mappingCounts = countMappingsByChannel(availableMappings);
  const aliasCounts = countAliasesByChannel(availableAliases);
  const visibleChannels = channels.filter((channel) =>
    matchesDirectoryFilter({
      filter: directoryFilter,
      channel,
      analysis: analysisByChannel.get(channel.id),
      workspaceEnabled: analysisEnabled,
    }),
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <div className="flex flex-col justify-between gap-4 border-b pb-5 md:flex-row md:items-start">
        <div className="flex items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-xs">
            <WaypointsIcon />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-primary">Channel portfolio</p>
            <h1 className="text-3xl font-semibold tracking-tight">Channels</h1>
            <p className="text-sm text-muted-foreground">
              {organizationName} · business identities that keep marketplace reporting, economics,
              and evidence comparable.
            </p>
          </div>
        </div>
        {canManage ? (
          <ChannelDialog organizationId={organizationId} onComplete={() => router.refresh()} />
        ) : null}
      </div>

      {portfolio ? <div className="flex flex-col gap-6">{portfolio}</div> : null}

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Channel identity is separate from provider access</AlertTitle>
        <AlertDescription>
          Adding Talabat, Noon, a website, or an offline shop does not create credentials, grant
          marketplace access, or allow campaigns to run.
        </AlertDescription>
      </Alert>

      <section className="grid gap-5" aria-labelledby="channel-directory-heading">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="grid gap-1">
            <p className="text-sm font-medium text-primary">03 · Channel directory</p>
            <h2 id="channel-directory-heading" className="text-2xl font-semibold tracking-tight">
              Channel directory
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Inspect each business identity with its exact reporting state, mapping coverage, and
              evidence link.
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={directoryFilter}
            onValueChange={(value) => {
              if (value) setDirectoryFilter(value as DirectoryFilter);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Filter channel directory"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="measured">Measured</ToggleGroupItem>
            <ToggleGroupItem value="attention">Needs attention</ToggleGroupItem>
            <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {channels.length === 0 ? (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WaypointsIcon />
              </EmptyMedia>
              <EmptyTitle>No channels yet</EmptyTitle>
              <EmptyDescription>
                Start with the business surfaces that matter to this organization, then map their
                report labels and branches.
              </EmptyDescription>
            </EmptyHeader>
            {canManage ? (
              <EmptyContent>
                <ChannelDialog
                  organizationId={organizationId}
                  onComplete={() => router.refresh()}
                />
              </EmptyContent>
            ) : null}
          </Empty>
        ) : visibleChannels.length === 0 ? (
          <Empty className="min-h-52 border">
            <EmptyHeader>
              <EmptyTitle>No channels match this view</EmptyTitle>
              <EmptyDescription>
                Choose another filter to see the rest of the portfolio.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden" size="sm">
            <CardContent className="p-0">
              <div aria-label="Organization channels" className="divide-y">
                {visibleChannels.map((channel) => {
                  const channelMappings = mappingCounts.get(channel.id) ?? {
                    total: 0,
                    historical: 0,
                  };
                  const channelAliasCount = aliasCounts.get(channel.id) ?? 0;

                  return (
                    <article
                      key={channel.id}
                      className={
                        channel.status === "archived"
                          ? "grid gap-5 px-4 py-5 opacity-70 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)_auto] lg:items-center"
                          : "grid gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)_auto] lg:items-center"
                      }
                    >
                      <div className="grid gap-3">
                        <div className="grid gap-1">
                          <h3 className="font-semibold tracking-tight">{channel.display_name}</h3>
                          <p className="text-sm text-muted-foreground">{channel.key}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{labelForCategory(channel.category)}</Badge>
                          <Badge variant={channel.status === "active" ? "outline" : "secondary"}>
                            {channel.status}
                          </Badge>
                          {channel.template_key ? (
                            <Badge variant="outline">Hint: {channel.template_key}</Badge>
                          ) : null}
                          <Badge variant="outline">
                            {channelMappings.total} outlet{channelMappings.total === 1 ? "" : "s"}
                          </Badge>
                          {channelMappings.historical > 0 ? (
                            <Badge variant="secondary">
                              {channelMappings.historical} historical
                            </Badge>
                          ) : null}
                          <Badge variant="outline">
                            {channelAliasCount} label{channelAliasCount === 1 ? "" : "s"}
                          </Badge>
                        </div>
                      </div>

                      <ChannelAnalysisSummary
                        analysis={analysisByChannel.get(channel.id)}
                        workspaceEnabled={analysisEnabled}
                      />

                      <div className="flex items-center gap-2 lg:justify-end">
                        {canManage ? (
                          <ChannelDialog
                            organizationId={organizationId}
                            channel={channel}
                            onComplete={() => router.refresh()}
                          />
                        ) : null}
                        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                          <Link href={`/organizations/${organizationId}/channels/${channel.id}`}>
                            Open channel
                          </Link>
                        </Button>
                        {channel.status === "archived" ? (
                          <ArchiveIcon aria-label="Archived" />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
