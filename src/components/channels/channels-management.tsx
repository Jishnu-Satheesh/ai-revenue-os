"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArchiveIcon, TagsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ChannelIcon } from "@/components/channels/channel-icons";
import { AboutChannelSetupDialog } from "@/components/channels/channel-coverage-dialog";
import { ChannelManagementDialog } from "@/components/channels/channel-management-dialog";
import { ChannelsDirectory } from "@/components/channels/channels-directory";
import { ChannelsRollup } from "@/components/channels/channels-rollup";
import type { ChannelsLandingAnalysis } from "@/components/channels/channels-presentation";
import { buildChannelsPortfolioPresentation } from "@/components/channels/channels-presentation";
import styles from "@/components/channels/channels-landing.module.css";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
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
  channels,
  branches,
  branchMappings,
  aliases,
  canManage,
  canMapBranches,
  analysis,
  onAdd: onAddProp,
  onAboutSetup: onAboutSetupProp,
  onManage: onManageProp,
}: {
  organizationId: string;
  // Retained for the management dialogs; the V01 title no longer names the
  // organization in its subtitle.
  organizationName: string;
  channels: readonly OrganizationChannelRow[];
  // Branch and alias snapshots feed the Tasks 6-7 management dialogs; the
  // directory reads only the mapping configuration from `branchMappings`.
  branches?: readonly OrganizationBranchRow[];
  branchMappings?: readonly OrganizationChannelBranchRow[];
  aliases?: readonly ChannelSourceAliasRow[];
  canManage: boolean;
  canMapBranches?: boolean;
  /** One coherent analysis state from the page: disabled, unavailable, or ready. */
  analysis: ChannelsLandingAnalysis;
  /**
   * Task 6 hook point for the create dialog (D04). Add emits here and builds
   * no dialog itself, so this slice never ships a half-wired create form.
   */
  onAdd?: () => void;
  /**
   * Task 4 seam for the About channel setup dialog (D03), same pattern as
   * `onAdd`: when provided, the directory header link emits here and the
   * caller owns the dialog. Without it, Management opens its own read-only
   * D03, so the link always lands somewhere useful.
   */
  onAboutSetup?: () => void;
  /**
   * Task 6 seam for the manage dialog (D05): the directory ellipsis emits
   * the channel ID here and builds no dialog itself.
   */
  onManage?: (channelId: string) => void;
}) {
  const [aboutSetupOpen, setAboutSetupOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const router = useRouter();
  const portfolio =
    analysis.state === "ready" ? buildChannelsPortfolioPresentation(analysis.view) : null;

  // Task 6 — the D05 manage target resolves live from the snapshot, so a
  // refresh that drops the selected channel (removed from the allowed set)
  // closes the dialog with a safe message instead of editing a ghost row.
  // Selection follows props via render-phase adjustment (the documented
  // pattern for prop-driven resets); the toast stays in an effect because
  // notifying is a side effect, not render output.
  const [prevChannels, setPrevChannels] = useState(channels);
  const [missingToast, setMissingToast] = useState(false);
  if (prevChannels !== channels) {
    setPrevChannels(channels);
    if (manageId !== null && !channels.some((channel) => channel.id === manageId)) {
      setManageId(null);
      setMissingToast(true);
    } else if (missingToast) {
      setMissingToast(false);
    }
  }
  const manageChannel =
    manageId !== null ? (channels.find((channel) => channel.id === manageId) ?? null) : null;
  useEffect(() => {
    if (missingToast) toast.info("Channel is no longer available.");
  }, [missingToast]);

  const handleAdd = onAddProp ?? (() => setCreateOpen(true));
  const handleManage = onManageProp ?? ((channelId: string) => setManageId(channelId));
  const handleAboutSetup = onAboutSetupProp ?? (() => setAboutSetupOpen(true));
  const handleSaved = () => router.refresh();

  return (
    <div className={`${styles.root} flex min-h-0 w-full flex-1 flex-col gap-6`}>
      <div className="flex items-center justify-between gap-4 max-[650px]:items-start">
        <div>
          <h1 className={styles.title}>Channels</h1>
          <p className={styles.subtitle}>See what each channel brings to your business.</p>
        </div>
        {canManage ? (
          <Button onClick={() => handleAdd()} className={styles.control}>
            <ChannelIcon name="plus" />
            Add channel
          </Button>
        ) : null}
      </div>

      <ChannelsRollup organizationId={organizationId} analysis={analysis} />

      {analysis.state === "disabled" ? (
        <p className="text-sm text-muted-foreground">
          Analysis is not enabled for this organization.
        </p>
      ) : null}

      <ChannelsDirectory
        organizationId={organizationId}
        channels={channels}
        branchMappings={branchMappings ?? []}
        analysis={analysis}
        portfolio={portfolio}
        canManage={canManage}
        canMapBranches={canMapBranches}
        onManage={handleManage}
        onAdd={handleAdd}
        onAboutSetup={handleAboutSetup}
      />

      <AboutChannelSetupDialog
        organizationId={organizationId}
        open={aboutSetupOpen}
        onOpenChange={setAboutSetupOpen}
      />

      {createOpen ? (
        <ChannelManagementDialog
          organizationId={organizationId}
          channel={null}
          open={createOpen}
          onOpenChange={(next) => {
            if (!next) setCreateOpen(false);
          }}
          branches={branches ?? []}
          branchMappings={branchMappings ?? []}
          aliases={aliases ?? []}
          canManage={canManage}
          canMapBranches={canMapBranches}
          onSaved={handleSaved}
        />
      ) : null}

      {manageChannel !== null ? (
        <ChannelManagementDialog
          organizationId={organizationId}
          channel={manageChannel}
          open
          onOpenChange={(next) => {
            if (!next) setManageId(null);
          }}
          branches={branches ?? []}
          branchMappings={branchMappings ?? []}
          aliases={aliases ?? []}
          canManage={canManage}
          canMapBranches={canMapBranches}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
