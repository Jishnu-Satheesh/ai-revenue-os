"use client";

import { useState, type FormEvent } from "react";
import {
  ArchiveIcon,
  CirclePlusIcon,
  MapPinIcon,
  PencilIcon,
  ShieldCheckIcon,
  TagsIcon,
  WaypointsIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function ChannelMappingsDialog({
  organizationId,
  channel,
  branches,
  mappings,
  aliases,
  onComplete,
}: {
  organizationId: string;
  channel: OrganizationChannelRow;
  branches: readonly OrganizationBranchRow[];
  mappings: readonly OrganizationChannelBranchRow[];
  aliases: readonly ChannelSourceAliasRow[];
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [applicability, setApplicability] = useState<BranchMappingStatus>("active");
  const [sourceScope, setSourceScope] = useState<AliasSourceScope>("manual");
  const [pending, setPending] = useState<"branch" | "alias" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channelMappings = mappings.filter((mapping) => mapping.channel_id === channel.id);
  const channelAliases = aliases.filter((alias) => alias.channel_id === channel.id);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const currentMapping = channelMappings.find((mapping) =>
        branches.some((branch) => branch.id === mapping.branch_id),
      );
      if (currentMapping) {
        setBranchId(currentMapping.branch_id);
        setApplicability(currentMapping.status);
      }
      setError(null);
    }
    setOpen(nextOpen);
  }

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
    setOpen(false);
    onComplete();
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
    setOpen(false);
    onComplete();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MapPinIcon data-icon="inline-start" />
          Manage mappings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(44rem,calc(100vh-2rem))] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mappings for {channel.display_name}</DialogTitle>
          <DialogDescription>
            Match this business channel to applicable outlets and the labels that appear in source
            reports. These mappings never create provider access.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6">
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
                  const branch = branches.find((item) => item.id === mapping.branch_id);
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
            {branches.length > 0 ? (
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
                          {branches.map((branch) => (
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
            )}
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
          </section>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Mapping was not saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ChannelsManagement({
  organizationId,
  organizationName,
  channels,
  branches,
  branchMappings,
  aliases,
  canManage,
  canMapBranches = false,
}: {
  organizationId: string;
  organizationName: string;
  channels: readonly OrganizationChannelRow[];
  branches?: readonly OrganizationBranchRow[];
  branchMappings?: readonly OrganizationChannelBranchRow[];
  aliases?: readonly ChannelSourceAliasRow[];
  canManage: boolean;
  canMapBranches?: boolean;
}) {
  const router = useRouter();
  const activeChannels = channels.filter((channel) => channel.status === "active");
  const archivedChannels = channels.length - activeChannels.length;
  const availableBranches = branches ?? [];
  const availableMappings = branchMappings ?? [];
  const availableAliases = aliases ?? [];

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

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Channel identity is separate from provider access</AlertTitle>
        <AlertDescription>
          Adding Talabat, Noon, a website, or an offline shop does not create credentials, grant
          marketplace access, or allow campaigns to run.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Active channels</CardDescription>
            <CardTitle className="text-2xl">{activeChannels.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Ready to be mapped to branches and source aliases.
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Archived history</CardDescription>
            <CardTitle className="text-2xl">{archivedChannels}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Historical channel evidence is retained, never deleted.
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Report trust</CardDescription>
            <CardTitle className="text-2xl">Not assessed</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Trust status appears after the first governed report package.
          </CardContent>
        </Card>
      </div>

      {channels.length === 0 ? (
        <Empty className="min-h-72">
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
              <ChannelDialog organizationId={organizationId} onComplete={() => router.refresh()} />
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <section
          aria-label="Organization channels"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {channels.map((channel) => (
            <Card
              key={channel.id}
              className={channel.status === "archived" ? "opacity-70" : undefined}
            >
              <CardHeader>
                <CardTitle>{channel.display_name}</CardTitle>
                <CardDescription>{channel.key}</CardDescription>
                <CardAction>
                  <div className="flex items-center gap-1">
                    {canMapBranches ? (
                      <ChannelMappingsDialog
                        organizationId={organizationId}
                        channel={channel}
                        branches={availableBranches}
                        mappings={availableMappings}
                        aliases={availableAliases}
                        onComplete={() => router.refresh()}
                      />
                    ) : null}
                    {canManage ? (
                      <ChannelDialog
                        organizationId={organizationId}
                        channel={channel}
                        onComplete={() => router.refresh()}
                      />
                    ) : null}
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge variant="secondary">{labelForCategory(channel.category)}</Badge>
                <Badge variant={channel.status === "active" ? "outline" : "secondary"}>
                  {channel.status}
                </Badge>
                {channel.template_key ? (
                  <Badge variant="outline">Hint: {channel.template_key}</Badge>
                ) : null}
                <Badge variant="outline">
                  {availableMappings.filter((mapping) => mapping.channel_id === channel.id).length} outlet
                  {availableMappings.filter((mapping) => mapping.channel_id === channel.id).length === 1
                    ? ""
                    : "s"}
                </Badge>
                {availableMappings.some(
                  (mapping) => mapping.channel_id === channel.id && mapping.status === "inactive",
                ) ? (
                  <Badge variant="secondary">
                    {availableMappings.filter(
                      (mapping) => mapping.channel_id === channel.id && mapping.status === "inactive",
                    ).length} historical
                  </Badge>
                ) : null}
                <Badge variant="outline">
                  {availableAliases.filter((alias) => alias.channel_id === channel.id).length} label
                  {availableAliases.filter((alias) => alias.channel_id === channel.id).length === 1
                    ? ""
                    : "s"}
                </Badge>
              </CardContent>
              <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
                <span>Evidence and financial reports are governed separately.</span>
                {channel.status === "archived" ? <ArchiveIcon aria-label="Archived" /> : null}
              </CardFooter>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
