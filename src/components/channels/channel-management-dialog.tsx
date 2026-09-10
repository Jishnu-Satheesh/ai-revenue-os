"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { ChannelIcon } from "@/components/channels/channel-icons";
import {
  CHANNEL_IDENTITY_ERROR,
  CHANNEL_STATUS_ERROR,
  useChannelIdentityMutation,
  useChannelStatusMutation,
} from "@/components/channels/channel-mutations";
import styles from "@/components/channels/channels-landing.module.css";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { channelCreateInputSchema, channelUpdateInputSchema } from "@/domain/channels/types";
import type {
  ChannelSourceAliasRow,
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

/**
 * Task 6 — D04 create, D05 manage/viewer identity + status, D06
 * archive/restore confirmation (plan §3/§5, visual contract D00/D04–D06).
 *
 * `channel:null` means create, never a failed lookup. Identity Save stays
 * distinct from mapping/label saves (D07/D08 forms arrive in Task 7; this
 * file builds only their Collapsible shells with live counts plus the saved
 * read-only summary). Every write goes through the validated mutation hooks
 * and reports back via `onSaved` (`router.refresh()` in the parent) — the
 * dialog never patches portfolio money optimistically and never navigates.
 */

export type ChannelManagementDialogProps = {
  organizationId: string;
  channel: OrganizationChannelRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: readonly OrganizationBranchRow[];
  branchMappings: readonly OrganizationChannelBranchRow[];
  aliases: readonly ChannelSourceAliasRow[];
  canManage: boolean;
  canMapBranches?: boolean;
  onSaved: () => void;
};

type ChannelCategory = OrganizationChannelRow["category"];

const CHANNEL_CATEGORIES: ReadonlyArray<{ value: ChannelCategory; label: string }> = [
  { value: "marketplace", label: "Marketplace" },
  { value: "owned_digital", label: "Owned digital" },
  { value: "physical", label: "Physical" },
  { value: "reseller", label: "Reseller" },
  { value: "other", label: "Other" },
];

const ALIAS_SOURCE_SCOPES: ReadonlyArray<{
  value: ChannelSourceAliasRow["source_scope"];
  label: string;
}> = [
  { value: "manual", label: "Manual label" },
  { value: "report_package", label: "Report package" },
  { value: "onboarding", label: "Onboarding" },
  { value: "normalized_metric", label: "Normalized metric" },
  { value: "economics_entry", label: "Economics entry" },
  { value: "cost_rate", label: "Cost rate" },
];

function labelForCategory(category: ChannelCategory): string {
  return CHANNEL_CATEGORIES.find((entry) => entry.value === category)?.label ?? "Other";
}

function labelForScope(scope: ChannelSourceAliasRow["source_scope"]): string {
  return ALIAS_SOURCE_SCOPES.find((entry) => entry.value === scope)?.label ?? scope;
}

/** First Zod message per field, keyed by the schema property name. */
function toFieldErrors(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  return fields;
}

function dialogContentClass(): string {
  return `${styles.theme} max-h-[90svh] max-w-[calc(100vw-28px)] overflow-y-auto sm:max-w-[520px]`;
}

function DialogCloseButton() {
  return (
    <DialogClose asChild>
      <Button variant="ghost" size="icon" className="size-[38px]" aria-label="Close dialog">
        <ChannelIcon name="close" />
      </Button>
    </DialogClose>
  );
}

function CreateChannelDialog({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channel: OrganizationChannelRow) => void;
}) {
  const identity = useChannelIdentityMutation({ organizationId, channelId: null });
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ChannelCategory>("marketplace");
  const [keyText, setKeyText] = useState("");
  const [hint, setHint] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (serverError) serverErrorRef.current?.focus();
  }, [serverError]);

  const pending = identity.isPending;

  function requestClose(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = channelCreateInputSchema.safeParse({
      key: keyText,
      displayName: name,
      category,
      templateKey: hint.trim() === "" ? null : hint,
    });
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setServerError(null);
    try {
      const created = await identity.mutateAsync(parsed.data);
      toast.success("Channel created.");
      onCreated(created);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : CHANNEL_IDENTITY_ERROR);
    }
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        className={dialogContentClass()}
      >
        <DialogHeader className="flex-row items-center justify-between border-b pb-4">
          <div className="grid gap-1">
            <DialogTitle>Add a channel</DialogTitle>
            <DialogDescription>Add a sales channel to your business directory.</DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>

        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="channel-create-name">Channel name</FieldLabel>
              <Input
                id="channel-create-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Online store"
                autoComplete="off"
              />
              {fieldErrors.displayName ? (
                <FieldError errors={[{ message: fieldErrors.displayName }]} />
              ) : null}
            </Field>

            <Field>
              <FieldLabel>Category</FieldLabel>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as ChannelCategory)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent className={styles.theme}>
                  <SelectGroup>
                    {CHANNEL_CATEGORIES.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fieldErrors.category ? (
                <FieldError errors={[{ message: fieldErrors.category }]} />
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="channel-create-key">Stable key</FieldLabel>
              <Input
                id="channel-create-key"
                value={keyText}
                onChange={(event) => setKeyText(event.target.value)}
                placeholder="e.g. online-store"
                autoComplete="off"
              />
              <FieldDescription>
                A permanent identifier for reports and imports. Use lower-case letters, numbers,
                dots or hyphens.
              </FieldDescription>
              {fieldErrors.key ? <FieldError errors={[{ message: fieldErrors.key }]} /> : null}
            </Field>

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={`${styles.disclosureTrigger} w-full justify-between`}
                >
                  <span>Advanced identity settings</span>
                  <ChevronDown aria-hidden="true" className={styles.disclosureChevron} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Field>
                  <FieldLabel htmlFor="channel-create-hint">Optional provider hint</FieldLabel>
                  <Input
                    id="channel-create-hint"
                    value={hint}
                    onChange={(event) => setHint(event.target.value)}
                    autoComplete="off"
                  />
                  <FieldDescription>
                    A hint helps recognise reports. It does not create a provider connection.
                  </FieldDescription>
                  {fieldErrors.templateKey ? (
                    <FieldError errors={[{ message: fieldErrors.templateKey }]} />
                  ) : null}
                </Field>
              </CollapsibleContent>
            </Collapsible>

            <p className="text-sm text-muted-foreground">
              Create this channel first, then add location mappings and report labels.
            </p>

            <Alert>
              <AlertDescription>
                Adding a channel records its identity. Provider connections are managed in
                Integration Hub.
              </AlertDescription>
            </Alert>

            {serverError ? (
              <Alert variant="destructive">
                <AlertTitle ref={serverErrorRef} tabIndex={-1}>
                  Channel was not saved
                </AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>

          <DialogFooter className="mt-[22px] border-t pt-[18px]">
            <Button
              type="button"
              variant="outline"
              onClick={() => requestClose(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Spinner />
                  Creating…
                </>
              ) : (
                "Create channel"
              )}
            </Button>
          </DialogFooter>
        </form>
        {pending ? (
          <p aria-live="polite" className="sr-only">
            Creating…
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReadonlyIdentity({ channel }: { channel: OrganizationChannelRow }) {
  const rows: Array<[string, string]> = [
    ["Display name", channel.display_name],
    ["Stable key", channel.key],
    ["Category", labelForCategory(channel.category)],
    ["Provider hint", channel.template_key ?? "None"],
  ];
  return (
    <dl className="grid gap-2 rounded-lg border px-3 py-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditableIdentityForm({
  baseline,
  mutation,
  onIdentitySaved,
  writePending,
}: {
  baseline: OrganizationChannelRow;
  mutation: ReturnType<typeof useChannelIdentityMutation>;
  onIdentitySaved: (saved: OrganizationChannelRow) => void;
  writePending: boolean;
}) {
  const [name, setName] = useState(baseline.display_name);
  const [category, setCategory] = useState<ChannelCategory>(baseline.category);
  const [hint, setHint] = useState(baseline.template_key ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (serverError) serverErrorRef.current?.focus();
  }, [serverError]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = channelUpdateInputSchema.safeParse({
      displayName: name,
      category,
      templateKey: hint.trim() === "" ? null : hint,
    });
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setServerError(null);
    try {
      const saved = await mutation.mutateAsync(parsed.data);
      onIdentitySaved(saved);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : CHANNEL_IDENTITY_ERROR);
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`channel-identity-name-${baseline.id}`}>Channel name</FieldLabel>
          <Input
            id={`channel-identity-name-${baseline.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Online store"
            autoComplete="off"
          />
          {fieldErrors.displayName ? (
            <FieldError errors={[{ message: fieldErrors.displayName }]} />
          ) : null}
        </Field>

        <Field>
          <FieldLabel>Category</FieldLabel>
          <Select value={category} onValueChange={(value) => setCategory(value as ChannelCategory)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent className={styles.theme}>
              <SelectGroup>
                {CHANNEL_CATEGORIES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {fieldErrors.category ? (
            <FieldError errors={[{ message: fieldErrors.category }]} />
          ) : null}
        </Field>

        <Field>
          <FieldLabel>Stable key</FieldLabel>
          <Input value={baseline.key} readOnly aria-readonly="true" />
          <FieldDescription>This identity is permanent.</FieldDescription>
        </Field>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={`${styles.disclosureTrigger} w-full justify-between`}
            >
              <span>Advanced identity settings</span>
              <ChevronDown aria-hidden="true" className={styles.disclosureChevron} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Field>
              <FieldLabel htmlFor={`channel-identity-hint-${baseline.id}`}>
                Optional provider hint
              </FieldLabel>
              <Input
                id={`channel-identity-hint-${baseline.id}`}
                value={hint}
                onChange={(event) => setHint(event.target.value)}
                autoComplete="off"
              />
              <FieldDescription>
                A hint helps recognise reports. It does not create a provider connection.
              </FieldDescription>
              {fieldErrors.templateKey ? (
                <FieldError errors={[{ message: fieldErrors.templateKey }]} />
              ) : null}
            </Field>
          </CollapsibleContent>
        </Collapsible>

        {serverError ? (
          <Alert variant="destructive">
            <AlertTitle ref={serverErrorRef} tabIndex={-1}>
              Channel was not saved
            </AlertTitle>
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>

      <div className="mt-[22px] flex justify-end gap-2 border-t pt-[18px]">
        <Button type="submit" disabled={writePending}>
          {mutation.isPending ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            "Save channel"
          )}
        </Button>
      </div>
    </form>
  );
}

function locationsSummary(mappings: readonly OrganizationChannelBranchRow[]): string {
  if (mappings.length === 0) return "Organization-wide";
  const active = new Set(
    mappings.filter((mapping) => mapping.status === "active").map((mapping) => mapping.branch_id),
  ).size;
  const historical = mappings.filter((mapping) => mapping.status === "inactive").length;
  const head =
    active === 0 ? "No active mappings" : `${active} mapped location${active === 1 ? "" : "s"}`;
  return historical > 0 ? `${head} · ${historical} historical` : head;
}

function StatusConfirmDialog({
  channel,
  action,
  open,
  onOpenChange,
  mutation,
  statusTriggerRef,
  onStatusSaved,
}: {
  channel: OrganizationChannelRow;
  action: "archive" | "restore";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mutation: ReturnType<typeof useChannelStatusMutation>;
  statusTriggerRef: RefObject<HTMLButtonElement | null>;
  onStatusSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const pending = mutation.isPending;
  const archiving = action === "archive";

  function requestClose(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  async function confirm() {
    setError(null);
    try {
      await mutation.mutateAsync({ status: archiving ? "archived" : "active" });
      toast.success(archiving ? "Channel archived." : "Channel restored.");
      onStatusSaved();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : CHANNEL_STATUS_ERROR);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={requestClose}>
      <AlertDialogContent
        className={styles.theme}
        onCloseAutoFocus={(event) => {
          // Radix restores focus to whatever was focused before the
          // confirmation opened; the contract pins it to the status trigger
          // that started this flow instead. On success both dialogs close, so
          // the trigger unmounts right after and focus falls back to the page.
          event.preventDefault();
          statusTriggerRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{archiving ? "Archive channel?" : "Restore channel?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {archiving ? (
              <>
                <span className="block">
                  {channel.display_name} will move to Archived. Its history and report labels remain
                  available.
                </span>
                <span className="mt-2 block">
                  Archived channels are excluded from the active portfolio.
                </span>
              </>
            ) : (
              <span className="block">
                {channel.display_name} will return to the active directory with its history intact.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Channel status was not changed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button type="button" onClick={confirm} disabled={pending}>
            {pending ? (
              <>
                <Spinner />
                {archiving ? "Archiving…" : "Restoring…"}
              </>
            ) : archiving ? (
              "Archive"
            ) : (
              "Restore"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ManageChannelDialog({
  organizationId,
  channel,
  open,
  onOpenChange,
  branches,
  branchMappings,
  aliases,
  canManage,
  canMapBranches,
  onSaved,
}: {
  organizationId: string;
  channel: OrganizationChannelRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: readonly OrganizationBranchRow[];
  branchMappings: readonly OrganizationChannelBranchRow[];
  aliases: readonly ChannelSourceAliasRow[];
  canManage: boolean;
  canMapBranches?: boolean;
  onSaved: () => void;
}) {
  const identity = useChannelIdentityMutation({ organizationId, channelId: channel.id });
  const status = useChannelStatusMutation({ organizationId, channelId: channel.id });
  const [identityBaseline, setIdentityBaseline] = useState(channel);
  const [identityRev, setIdentityRev] = useState(0);
  const [confirmAction, setConfirmAction] = useState<"archive" | "restore" | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null);

  const writePending = identity.isPending || status.isPending;
  const archived = channel.status === "archived";

  const channelMappings = branchMappings.filter((mapping) => mapping.channel_id === channel.id);
  const channelAliases = aliases.filter((alias) => alias.channel_id === channel.id);

  function requestClose(next: boolean) {
    if (!next && writePending) return;
    onOpenChange(next);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            if (writePending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (writePending) event.preventDefault();
          }}
          className={dialogContentClass()}
        >
          <DialogHeader className="flex-row items-center justify-between border-b pb-4">
            <div className="grid gap-1">
              <DialogTitle>
                {canManage || canMapBranches ? `Manage ${channel.display_name}` : "Channel details"}
              </DialogTitle>
              <DialogDescription>
                {canManage
                  ? "Update the channel identity and its reporting labels."
                  : "Channel identity and reporting configuration."}
              </DialogDescription>
            </div>
            <DialogCloseButton />
          </DialogHeader>

          <div className="grid gap-5">
            {canManage ? (
              <EditableIdentityForm
                key={`${channel.id}:${identityRev}`}
                baseline={identityBaseline}
                mutation={identity}
                writePending={writePending}
                onIdentitySaved={(saved) => {
                  setIdentityBaseline(saved);
                  setIdentityRev((rev) => rev + 1);
                  toast.success("Channel saved.");
                  onSaved();
                }}
              />
            ) : (
              <ReadonlyIdentity channel={channel} />
            )}

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={`${styles.disclosureTrigger} w-full justify-between`}
                >
                  <span>
                    Locations{" "}
                    <span className={styles.disclosureCount}>
                      {channelMappings.filter((mapping) => mapping.status === "active").length}
                    </span>
                  </span>
                  <ChevronDown aria-hidden="true" className={styles.disclosureChevron} />
                </Button>
              </CollapsibleTrigger>
              <p className="pt-1 text-sm text-muted-foreground">
                {locationsSummary(channelMappings)}
              </p>
              <CollapsibleContent>
                <ul className="grid gap-2 pt-2">
                  {channelMappings.length === 0 ? (
                    <li className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                      No location mappings yet. This channel is configured organization-wide.
                    </li>
                  ) : (
                    channelMappings.map((mapping) => {
                      const branch = branches.find((item) => item.id === mapping.branch_id);
                      return (
                        <li
                          key={mapping.id}
                          className="grid gap-1 rounded-lg border px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-medium">
                              {branch?.name ?? "Historical location"}
                            </span>
                            <span className="text-muted-foreground">
                              {mapping.status === "active" ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-muted-foreground">
                            <span>Effective from</span>
                            <span>{mapping.effective_from ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-muted-foreground">
                            <span>Effective to</span>
                            <span>{mapping.effective_to ?? "—"}</span>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={`${styles.disclosureTrigger} w-full justify-between`}
                >
                  <span>
                    Report labels{" "}
                    <span className={styles.disclosureCount}>{channelAliases.length}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className={styles.disclosureChevron} />
                </Button>
              </CollapsibleTrigger>
              <p className="pt-1 text-sm text-muted-foreground">
                {channelAliases.length === 0
                  ? "No report labels yet."
                  : channelAliases.map((alias) => alias.alias).join(", ")}
              </p>
              <CollapsibleContent>
                <ul className="grid gap-2 pt-2">
                  {channelAliases.length === 0 ? (
                    <li className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                      No report labels yet.
                    </li>
                  ) : (
                    channelAliases.map((alias) => (
                      <li key={alias.id} className="grid gap-1 rounded-lg border px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-medium">{alias.alias}</span>
                          <span className="text-muted-foreground">
                            {labelForScope(alias.source_scope)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-muted-foreground">
                          <span>Effective from</span>
                          <span>{alias.effective_from ?? "—"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-muted-foreground">
                          <span>Effective to</span>
                          <span>{alias.effective_to ?? "—"}</span>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </CollapsibleContent>
            </Collapsible>

            <div className="border-t pt-4">
              {canManage ? (
                <Button
                  ref={statusTriggerRef}
                  type="button"
                  variant="outline"
                  disabled={writePending}
                  onClick={() => setConfirmAction(archived ? "restore" : "archive")}
                >
                  {archived ? "Restore channel" : "Archive channel"}
                </Button>
              ) : (
                <p className="text-sm">
                  <span className="text-muted-foreground">Status: </span>
                  {archived ? "Archived" : "Active"}
                </p>
              )}
            </div>
          </div>
          {writePending ? (
            <p aria-live="polite" className="sr-only">
              Saving…
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      {confirmAction ? (
        <StatusConfirmDialog
          channel={channel}
          action={confirmAction}
          open={confirmAction !== null}
          onOpenChange={(next) => {
            if (!next) setConfirmAction(null);
          }}
          mutation={status}
          statusTriggerRef={statusTriggerRef}
          onStatusSaved={() => {
            setConfirmAction(null);
            onSaved();
            onOpenChange(false);
          }}
        />
      ) : null}
    </>
  );
}

export function ChannelManagementDialog({
  organizationId,
  channel,
  open,
  onOpenChange,
  branches,
  branchMappings,
  aliases,
  canManage,
  canMapBranches,
  onSaved,
}: ChannelManagementDialogProps) {
  const [created, setCreated] = useState<OrganizationChannelRow | null>(null);

  // Closing unmounts the Radix content, but the created record must not leak
  // into the next create session when the parent keeps this mounted.
  function handleOpenChange(next: boolean) {
    if (!next) setCreated(null);
    onOpenChange(next);
  }

  const active = created ?? channel;
  if (active === null) {
    return (
      <CreateChannelDialog
        organizationId={organizationId}
        open={open}
        onOpenChange={handleOpenChange}
        onCreated={(createdChannel) => {
          setCreated(createdChannel);
          onSaved();
        }}
      />
    );
  }
  return (
    <ManageChannelDialog
      key={active.id}
      organizationId={organizationId}
      channel={active}
      open={open}
      onOpenChange={handleOpenChange}
      branches={branches}
      branchMappings={branchMappings}
      aliases={aliases}
      canManage={canManage}
      canMapBranches={canMapBranches}
      onSaved={onSaved}
    />
  );
}
