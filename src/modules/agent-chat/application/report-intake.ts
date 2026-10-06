import { z } from "zod";

/** The human declaration that makes a digest meaningful for reuse. */
export const agentReportScopeSchema = z.object({
  channelId: z.string().uuid(),
  branchId: z.string().uuid(),
  reportType: z.string().trim().min(2).max(120).regex(/^[\p{L}\p{N} ._/-]+$/u),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
}).strict().refine((scope) => scope.periodEnd >= scope.periodStart, {
  path: ["periodEnd"],
  message: "Period end must not precede period start.",
});

export type AgentReportScope = z.output<typeof agentReportScopeSchema>;

export type PriorReportIdentity = AgentReportScope & {
  id: string;
  digest: string | null;
  verificationPending?: boolean;
};

export type ReportAttachmentClassification =
  | { kind: "metadata_required" }
  | { kind: "exact_duplicate"; packageId: string }
  | { kind: "duplicate_verification_pending"; packageId: string }
  | { kind: "correction_required"; priorPackageId: string }
  | { kind: "new" };

function equalScope(left: AgentReportScope, right: AgentReportScope): boolean {
  return left.channelId === right.channelId &&
    left.branchId === right.branchId &&
    left.reportType === right.reportType &&
    left.periodStart === right.periodStart &&
    left.periodEnd === right.periodEnd &&
    left.currency === right.currency;
}

export function classifyReportAttachment(input: {
  digest: string;
  scope: AgentReportScope | null;
  priorPackages: readonly PriorReportIdentity[];
}): ReportAttachmentClassification {
  if (!input.scope) return { kind: "metadata_required" };
  const sameScope = input.priorPackages.filter((prior) => equalScope(prior, input.scope!));
  const exact = sameScope.find((prior) => prior.digest === input.digest);
  if (exact) return { kind: exact.verificationPending ? "duplicate_verification_pending" : "exact_duplicate", packageId: exact.id };
  // A package without a verified digest cannot be proven reusable. Let a
  // person resolve the same-scope collision instead of silently replacing it.
  const changed = sameScope[0];
  if (changed) return { kind: "correction_required", priorPackageId: changed.id };
  return { kind: "new" };
}
