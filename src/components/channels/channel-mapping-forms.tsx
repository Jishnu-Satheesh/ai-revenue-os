"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Tags } from "lucide-react";

import {
  CHANNEL_LABEL_ERROR,
  CHANNEL_MAPPING_ERROR,
  useChannelLocationMutation,
  useChannelReportLabelMutation,
} from "@/components/channels/channel-mutations";
import styles from "@/components/channels/channels-landing.module.css";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { channelAliasInputSchema, channelBranchMappingInputSchema } from "@/domain/channels/types";
import type {
  ChannelSourceAliasRow,
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
} from "@/modules/channels/application/ports";

/**
 * Task 7 — D07 location mapping + D08 report-label forms (plan §3/§5, visual
 * contract D07/D08).
 *
 * Each form owns its saved list and its own draft/Save. Writes go through the
 * existing mutation hooks (one PUT per mapping, one POST per label,
 * `retry:false` there) and report back via `onSaved` (`router.refresh()` in
 * the parent) — the forms never patch portfolio money optimistically and the
 * dialog stays open so a second section can still be saved. A denied server
 * response surfaces its public message and always overrides what the UI
 * permission props assumed.
 */

type MappingApplicability = OrganizationChannelBranchRow["status"];
type AliasSourceScope = ChannelSourceAliasRow["source_scope"];

const ALIAS_SOURCE_SCOPES: ReadonlyArray<{ value: AliasSourceScope; label: string }> = [
  { value: "manual", label: "Manual label" },
  { value: "report_package", label: "Report package" },
  { value: "onboarding", label: "Onboarding" },
  { value: "normalized_metric", label: "Normalized metric" },
  { value: "economics_entry", label: "Economics entry" },
  { value: "cost_rate", label: "Cost rate" },
];

function labelForAliasScope(scope: AliasSourceScope): string {
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

function hasEffectiveToIssue(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>;
}) {
  return error.issues.some((issue) => String(issue.path[0] ?? "") === "effectiveTo");
}

function MappingSavedList({
  branches,
  mappings,
}: {
  branches: readonly OrganizationBranchRow[];
  mappings: readonly OrganizationChannelBranchRow[];
}) {
  if (mappings.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        No location mappings yet. This channel is configured organization-wide.
      </p>
    );
  }
  const hasActive = mappings.some((mapping) => mapping.status === "active");
  return (
    <div className="grid gap-2">
      {hasActive ? null : <p className="text-sm text-muted-foreground">No active mappings</p>}
      <ul className="grid gap-2">
        {mappings.map((mapping) => {
          const branch = branches.find((item) => item.id === mapping.branch_id);
          const active = mapping.status === "active";
          const bounded = mapping.effective_from !== null || mapping.effective_to !== null;
          return (
            <li key={mapping.id} className="grid gap-1 rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{branch?.name ?? "Historical location"}</span>
                <Badge variant={active ? "outline" : "secondary"}>
                  {active ? "Active" : "Inactive"}
                </Badge>
              </div>
              {bounded ? (
                <>
                  <div className="flex items-center justify-between gap-4 text-muted-foreground">
                    <span>Effective from</span>
                    <span>{mapping.effective_from ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-muted-foreground">
                    <span>Effective to</span>
                    <span>{mapping.effective_to ?? "—"}</span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">No date limits</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type ChannelLocationFormProps = {
  organizationId: string;
  channelId: string;
  /** Full snapshot branches; the Outlet choices filter to active ones only. */
  branches: readonly OrganizationBranchRow[];
  /** This channel's mappings, active history included. */
  mappings: readonly OrganizationChannelBranchRow[];
  canMap: boolean;
  /** Another section is writing; this Save stays disabled meanwhile. */
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onSaved: () => void;
};

/** Draft for one outlet: the saved status/dates when mapped, else active + open dates. */
function draftForBranch(
  branchId: string,
  mappings: readonly OrganizationChannelBranchRow[],
): { applicability: MappingApplicability; from: string; to: string } {
  const existing = mappings.find((mapping) => mapping.branch_id === branchId);
  if (existing) {
    return {
      applicability: existing.status,
      from: existing.effective_from ?? "",
      to: existing.effective_to ?? "",
    };
  }
  return { applicability: "active", from: "", to: "" };
}

export function ChannelLocationForm({
  organizationId,
  channelId,
  branches,
  mappings,
  canMap,
  disabled = false,
  onPendingChange,
  onSaved,
}: ChannelLocationFormProps) {
  const mutation = useChannelLocationMutation({ organizationId, channelId });
  const activeBranches = branches.filter((branch) => branch.is_active);
  const initialBranchId = activeBranches[0]?.id ?? "";
  const initialDraft = draftForBranch(initialBranchId, mappings);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [applicability, setApplicability] = useState<MappingApplicability>(
    initialDraft.applicability,
  );
  const [from, setFrom] = useState(initialDraft.from);
  const [to, setTo] = useState(initialDraft.to);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const pending = mutation.isPending;

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  useEffect(() => {
    if (serverError) serverErrorRef.current?.focus();
  }, [serverError]);

  function selectBranch(next: string) {
    setBranchId(next);
    const draft = draftForBranch(next, mappings);
    setApplicability(draft.applicability);
    setFrom(draft.from);
    setTo(draft.to);
    setFieldErrors({});
    setServerError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || disabled) return;
    const parsed = channelBranchMappingInputSchema.safeParse({
      branchId,
      applicability,
      effectiveFrom: from === "" ? null : from,
      effectiveTo: to === "" ? null : to,
    });
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      if (hasEffectiveToIssue(parsed.error)) toRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setServerError(null);
    try {
      await mutation.mutateAsync(parsed.data);
      onSaved();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : CHANNEL_MAPPING_ERROR);
    }
  }

  const outletId = `channel-mapping-outlet-${channelId}`;
  const applicabilityId = `channel-mapping-applicability-${channelId}`;

  return (
    <div className="grid gap-3 pt-2">
      <MappingSavedList branches={branches} mappings={mappings} />
      {canMap ? (
        activeBranches.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Add an active branch in organization settings before mapping this channel.
          </p>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={outletId}>Outlet</FieldLabel>
                <Select value={branchId} onValueChange={selectBranch}>
                  <SelectTrigger id={outletId} aria-label="Outlet" className="w-full">
                    <SelectValue placeholder="Choose an outlet" />
                  </SelectTrigger>
                  <SelectContent className={styles.theme}>
                    <SelectGroup>
                      {activeBranches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldErrors.branchId ? (
                  <FieldError errors={[{ message: fieldErrors.branchId }]} />
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor={applicabilityId}>Applicability</FieldLabel>
                <Select
                  value={applicability}
                  onValueChange={(value) => setApplicability(value as MappingApplicability)}
                >
                  <SelectTrigger id={applicabilityId} aria-label="Applicability" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={styles.theme}>
                    <SelectGroup>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldErrors.applicability ? (
                  <FieldError errors={[{ message: fieldErrors.applicability }]} />
                ) : null}
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`channel-mapping-from-${channelId}`}>
                    Effective from
                  </FieldLabel>
                  <Input
                    id={`channel-mapping-from-${channelId}`}
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    autoComplete="off"
                  />
                  {fieldErrors.effectiveFrom ? (
                    <FieldError errors={[{ message: fieldErrors.effectiveFrom }]} />
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`channel-mapping-to-${channelId}`}>Effective to</FieldLabel>
                  <Input
                    id={`channel-mapping-to-${channelId}`}
                    ref={toRef}
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    autoComplete="off"
                  />
                  {fieldErrors.effectiveTo ? (
                    <FieldError errors={[{ message: fieldErrors.effectiveTo }]} />
                  ) : null}
                </Field>
              </div>
            </FieldGroup>

            {serverError ? (
              <Alert variant="destructive">
                <AlertTitle ref={serverErrorRef} tabIndex={-1}>
                  Location mapping was not saved
                </AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end">
              <Button type="submit" disabled={pending || disabled}>
                {pending ? (
                  <>
                    <Spinner />
                    Saving…
                  </>
                ) : (
                  "Save location mapping"
                )}
              </Button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}

function AliasSavedList({ aliases }: { aliases: readonly ChannelSourceAliasRow[] }) {
  if (aliases.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        No report labels yet.
      </p>
    );
  }
  return (
    <ul className="grid gap-2">
      {aliases.map((alias) => (
        <li key={alias.id} className="grid gap-1 rounded-lg border px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <Tags aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="break-words">{alias.alias}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {labelForAliasScope(alias.source_scope)}
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
      ))}
    </ul>
  );
}

export type ChannelReportLabelFormProps = {
  organizationId: string;
  channelId: string;
  /** This channel's saved labels; each is one exact alias, never split. */
  aliases: readonly ChannelSourceAliasRow[];
  canMap: boolean;
  /** Another section is writing; this Save stays disabled meanwhile. */
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onSaved: () => void;
};

export function ChannelReportLabelForm({
  organizationId,
  channelId,
  aliases,
  canMap,
  disabled = false,
  onPendingChange,
  onSaved,
}: ChannelReportLabelFormProps) {
  const mutation = useChannelReportLabelMutation({ organizationId, channelId });
  const [aliasText, setAliasText] = useState("");
  const [sourceScope, setSourceScope] = useState<AliasSourceScope>("manual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const pending = mutation.isPending;

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  useEffect(() => {
    if (serverError) serverErrorRef.current?.focus();
  }, [serverError]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || disabled) return;
    const parsed = channelAliasInputSchema.safeParse({
      alias: aliasText,
      sourceScope,
      effectiveFrom: from === "" ? null : from,
      effectiveTo: to === "" ? null : to,
    });
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      if (hasEffectiveToIssue(parsed.error)) toRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setServerError(null);
    try {
      await mutation.mutateAsync(parsed.data);
      // Only the submitted label clears, and only after the validated
      // response; scope and dates stay so a second label is cheap to add.
      // A conflict or failure retains every input for correction.
      setAliasText("");
      onSaved();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : CHANNEL_LABEL_ERROR);
    }
  }

  const scopeId = `channel-alias-scope-${channelId}`;

  return (
    <div className="grid gap-3 pt-2">
      <AliasSavedList aliases={aliases} />
      {canMap ? (
        <form onSubmit={submit} className="grid gap-3">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`channel-alias-text-${channelId}`}>
                Exact report label
              </FieldLabel>
              <Input
                id={`channel-alias-text-${channelId}`}
                value={aliasText}
                onChange={(event) => setAliasText(event.target.value)}
                placeholder="e.g. Website orders"
                autoComplete="off"
              />
              {fieldErrors.alias ? <FieldError errors={[{ message: fieldErrors.alias }]} /> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor={scopeId}>Where did this label come from?</FieldLabel>
              <Select
                value={sourceScope}
                onValueChange={(value) => setSourceScope(value as AliasSourceScope)}
              >
                <SelectTrigger
                  id={scopeId}
                  aria-label="Where did this label come from?"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={styles.theme}>
                  <SelectGroup>
                    {ALIAS_SOURCE_SCOPES.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fieldErrors.sourceScope ? (
                <FieldError errors={[{ message: fieldErrors.sourceScope }]} />
              ) : null}
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`channel-alias-from-${channelId}`}>Effective from</FieldLabel>
                <Input
                  id={`channel-alias-from-${channelId}`}
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  autoComplete="off"
                />
                {fieldErrors.effectiveFrom ? (
                  <FieldError errors={[{ message: fieldErrors.effectiveFrom }]} />
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={`channel-alias-to-${channelId}`}>Effective to</FieldLabel>
                <Input
                  id={`channel-alias-to-${channelId}`}
                  ref={toRef}
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  autoComplete="off"
                />
                {fieldErrors.effectiveTo ? (
                  <FieldError errors={[{ message: fieldErrors.effectiveTo }]} />
                ) : null}
              </Field>
            </div>
          </FieldGroup>

          {serverError ? (
            <Alert variant="destructive">
              <AlertTitle ref={serverErrorRef} tabIndex={-1}>
                Report label was not saved
              </AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending || disabled}>
              {pending ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : (
                "Save report label"
              )}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
