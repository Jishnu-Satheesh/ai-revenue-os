"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { ItemChainDialog } from "@/components/memory/item-chain-dialog";
import { ProvenanceBadges } from "@/components/memory/provenance-badges";
import {
  invalidateMemoryQueries,
  memoryBasePath,
  memoryRequest,
  useIdempotencyKey,
} from "@/components/memory/query-options";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { hasMemoryPermission } from "@/domain/memory/permissions";
import type { Freshness, Sensitivity, VerificationState } from "@/domain/memory/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { MemoryItemView } from "@/modules/memory/application/service";

function renderFactValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}

/**
 * The proposed side of a fact proposal. The current Digital Twin value is
 * deliberately absent: no authenticated read available to the browser returns
 * it, and the item detail route carries only the proposal. Naming the gap is
 * the honest option; rendering a placeholder beside a real proposed value would
 * read as a comparison that was never made.
 */
function FactComparison({ item }: { item: MemoryItemView }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-md border p-2.5">
        <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Proposed value
        </p>
        <pre className="mt-1 text-xs break-words whitespace-pre-wrap">
          {renderFactValue(item.proposedFactValue)}
        </pre>
      </div>
      <div className="rounded-md border border-dashed p-2.5">
        <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Current value
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          The current value is not available in this view. Confirming writes the proposed value into
          the Digital Twin.
        </p>
      </div>
    </div>
  );
}

function RejectProposal({
  onReject,
  isPending,
}: {
  onReject: (reason: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          Reject proposal
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject this proposal?</AlertDialogTitle>
          <AlertDialogDescription>
            The proposal is kept and marked rejected, with your reason recorded against it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="reject-reason">Reason</FieldLabel>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
          />
          <FieldDescription>Stored on the rejection record.</FieldDescription>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Keep for review</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              if (reason.trim().length === 0) {
                setError("A rejection must say why.");
                return;
              }
              setError(null);
              onReject(reason.trim());
              setOpen(false);
            }}
          >
            {isPending ? <Spinner className="size-3" /> : null}
            Reject proposal
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OverrideConfirmation({
  onOverride,
  isPending,
}: {
  onOverride: () => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs">
          Override verification
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm without source verification?</AlertDialogTitle>
          <AlertDialogDescription>
            This records a confirmation the source never made. The fact is promoted on your
            authority alone and the override is attributed to you in the audit trail.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            disabled={isPending}
            onClick={() => {
              onOverride();
              setOpen(false);
            }}
          >
            {isPending ? <Spinner className="size-3" /> : null}
            Confirm without verification
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProposalRow({
  organizationId,
  item,
  role,
  ceiling,
}: {
  organizationId: string;
  item: MemoryItemView;
  role: OrganizationRole;
  ceiling: Sensitivity;
}) {
  const queryClient = useQueryClient();
  const canPromote = hasMemoryPermission(role, "memory.promote_fact");
  const canVerify = hasMemoryPermission(role, "memory.verify");
  const isFactProposal = Boolean(item.proposedFactKey);

  // One key per distinct decision, held across retries: a confirm whose
  // response was lost must replay rather than be refused as no longer pending.
  const confirmKey = useIdempotencyKey();
  const rejectKey = useIdempotencyKey();

  const confirm = useMutation({
    mutationFn: async (overrideVerified: boolean) => {
      const payload = { itemId: item.id, overrideVerified };
      return memoryRequest<unknown>(
        `${memoryBasePath(organizationId)}/proposals/${item.id}/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            overrideVerified,
            idempotencyKey: confirmKey.keyFor(payload),
          }),
        },
      );
    },
    onSuccess: async () => {
      // The row disappears only because the next authenticated read no longer
      // returns it, never because the browser assumed the write succeeded.
      confirmKey.reset();
      await invalidateMemoryQueries(queryClient, organizationId);
      toast.success("Proposal confirmed.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The proposal could not be confirmed."),
  });

  const reject = useMutation({
    mutationFn: async (reason: string) =>
      memoryRequest<unknown>(`${memoryBasePath(organizationId)}/proposals/${item.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason,
          idempotencyKey: rejectKey.keyFor({ itemId: item.id, reason }),
        }),
      }),
    onSuccess: async () => {
      rejectKey.reset();
      await invalidateMemoryQueries(queryClient, organizationId);
      toast.success("Proposal rejected.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The proposal could not be rejected."),
  });

  const isPending = confirm.isPending || reject.isPending;

  return (
    <Card className="gap-0 py-0 shadow-sm">
      <CardContent
        role="group"
        aria-label={isFactProposal ? "Fact proposal" : "Memory proposal"}
        className="space-y-2.5 px-4 py-3.5"
      >
        <div className="space-y-2">
          <h4 className="text-sm leading-snug font-semibold break-words">{item.title}</h4>
          <ProvenanceBadges
            verificationState={item.verificationState as VerificationState}
            freshness={item.freshness as Freshness}
            sensitivity={item.sensitivity}
            origin={item.origin}
            sourceTier={item.sourceTier}
            sourceSystem={item.sourceSystem}
            confidence={item.confidence}
            embeddingStatus={item.embeddingStatus}
          />
        </div>

        {isFactProposal ? (
          <div className="space-y-2">
            <p className="font-mono text-xs break-all">{item.proposedFactKey}</p>
            <FactComparison item={item} />
          </div>
        ) : item.body ? (
          <p className="text-sm text-muted-foreground">{item.body}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-2.5">
          <ItemChainDialog
            organizationId={organizationId}
            item={item}
            role={role}
            ceiling={ceiling}
          />
          {canVerify ? <RejectProposal onReject={reject.mutate} isPending={isPending} /> : null}
          {canPromote ? (
            <>
              <OverrideConfirmation
                onOverride={() => confirm.mutate(true)}
                isPending={isPending}
              />
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={() => confirm.mutate(false)}
              >
                {confirm.isPending ? <Spinner className="size-3" /> : null}
                Confirm proposal
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ReviewTab({
  organizationId,
  reviewQueue,
  role,
  ceiling,
}: {
  organizationId: string;
  reviewQueue: readonly MemoryItemView[];
  role: OrganizationRole;
  ceiling: Sensitivity;
}) {
  if (reviewQueue.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>Nothing is waiting for review</EmptyTitle>
          <EmptyDescription>
            Proposals from integrations and models appear here for a person to confirm or reject
            before they become trusted memory.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {reviewQueue.map((item) => (
        <ProposalRow
          key={item.id}
          organizationId={organizationId}
          item={item}
          role={role}
          ceiling={ceiling}
        />
      ))}
    </div>
  );
}
