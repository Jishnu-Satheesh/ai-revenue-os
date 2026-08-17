import {
  invalidateAfterCommit,
  isCancelled,
  nowIso,
  parseMemoryTaskPayload,
  type MemoryWorkerDependencies,
} from "@/workflows/memory/contracts";

export type ExpireItemsOutcome =
  | { outcome: "cancelled"; skipped: 0 }
  | { outcome: "succeeded"; skipped: number };

/** Marks only newly ineligible rows skipped; freshness remains a derived read-time property. */
export async function runExpireItems(
  input: unknown,
  dependencies: MemoryWorkerDependencies,
): Promise<ExpireItemsOutcome> {
  const payload = parseMemoryTaskPayload("memory.expire-items", input);
  if (await isCancelled(payload, dependencies)) return { outcome: "cancelled", skipped: 0 };

  const skipped = await dependencies.repository.skipExpiredOrSuperseded({
    organizationId: payload.organizationId,
    now: nowIso(dependencies),
  });
  await invalidateAfterCommit(payload.organizationId, dependencies);
  return { outcome: "succeeded", skipped };
}
