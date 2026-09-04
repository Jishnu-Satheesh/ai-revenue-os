"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RecognisedFamily } from "@/components/integrations/report-intake-mapping";
import { describeMetrics } from "@/domain/reports/provider-library/copy";

/**
 * The one screen standing between an upload and a durable, unattended
 * permission. See ADR 0046.
 *
 * Everything below it -- profiling, recognising the structure, this screen --
 * happens once per report per organization. Clicking Approve here does not
 * approve the file sitting in this upload. It authorises every future upload
 * of this exact column structure, to this channel, to be read the same way
 * without anyone being asked again, until an owner or admin revokes it. Four
 * repeated approvals collapsed into this one, so this one has to say what it
 * covers as plainly as the four together used to: which report, which
 * figures, and that the grant is standing and revocable rather than a
 * one-file yes.
 *
 * `report.contract_approve` is owner/admin only. An operator who reaches this
 * screen holds `report.upload` and `report.retry` but not that, so they are
 * shown what happens next -- who acts, and that it only has to happen once --
 * rather than a permission error with no path forward.
 */
export function ReportAdmissionApproval({
  organizationId,
  packageId,
  family,
  canApprove,
  onAdmitted,
}: Readonly<{
  organizationId: string;
  packageId: string;
  family: RecognisedFamily;
  canApprove: boolean;
  onAdmitted: () => void;
}>) {
  const admit = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/organizations/${organizationId}/report-packages/${packageId}/admission`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Library on both halves, keyed by the family the recognition
          // endpoint already matched. No idempotency key: the route derives
          // all five of its own from the package id, deliberately, so this
          // one click cannot become five differently-keyed requests. See the
          // Task 10 addendum.
          body: JSON.stringify({
            contract: { source: "library", providerDefinitionKey: family.key },
            projection: { source: "library", providerDefinitionKey: family.key },
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message ?? "This report could not be admitted. Try again.");
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success("This report is admitted. Every future upload of it reads through unattended.");
      onAdmitted();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "This report could not be admitted."),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {family.provider} · {family.reportType.replaceAll("_", " ")}
        </p>
        <Badge variant="outline" className="text-emerald-700">
          <CheckCircle2 className="mr-1 size-3" /> Known report
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{family.summary}</p>
      <div className="rounded-md border p-3">
        <p className="text-sm font-medium">This will read {describeMetrics(family.reads)}.</p>
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            Approving does not approve just this file. It grants a standing permission for this
            channel: every future upload of this report is read the same way automatically,
            without asking again, until an owner or admin revokes it.
          </span>
        </p>
      </div>
      {canApprove ? (
        <Button disabled={admit.isPending} onClick={() => admit.mutate()}>
          {admit.isPending ? "Admitting…" : "Approve — applies to every future upload"}
        </Button>
      ) : (
        <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          This report has not been admitted for this organization yet. An owner or admin needs to
          approve it once — after that, every future upload of it goes straight through.
        </p>
      )}
    </div>
  );
}
