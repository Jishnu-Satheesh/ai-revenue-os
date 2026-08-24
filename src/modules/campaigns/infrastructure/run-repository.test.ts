import { describe, expect, it, vi } from "vitest";

import {
  createCampaignRunDispatcher,
  createCampaignRunStore,
  type CampaignRunPersistence,
} from "@/modules/campaigns/infrastructure/run-repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "e0000000-0000-4000-8000-000000000002";
const RUN_ID = "e0000000-0000-4000-8000-000000000001";
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "d0000000-0000-4000-8000-000000000009";
const CORRELATION_ID = "d0000000-0000-4000-8000-000000000001";

function persistenceReturning(data: unknown, error: { code?: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { persistence: { rpc } as unknown as CampaignRunPersistence, rpc };
}

const ENQUEUE_INPUT = {
  organizationId: ORGANIZATION_ID,
  campaignId: CAMPAIGN_ID,
  sourceSnapshotId: SNAPSHOT_ID,
  kind: "generate" as const,
  idempotencyKey: "idem-key-12345678",
  correlationId: CORRELATION_ID,
};

describe("run dispatcher", () => {
  it("enqueues through the RPC and reports the run id", async () => {
    const { persistence, rpc } = persistenceReturning({
      run_id: RUN_ID,
      status: "queued",
      replayed: false,
    });

    const result = await createCampaignRunDispatcher(persistence).enqueue(ENQUEUE_INPUT);

    expect(result).toEqual({ runId: RUN_ID, replayed: false });
    expect(rpc).toHaveBeenCalledWith(
      "enqueue_campaign_generation_run",
      expect.objectContaining({ target_organization_id: ORGANIZATION_ID }),
    );
  });

  it("sends a request digest so the database can spot a reused key", async () => {
    const { persistence, rpc } = persistenceReturning({
      run_id: RUN_ID,
      status: "queued",
      replayed: false,
    });

    await createCampaignRunDispatcher(persistence).enqueue(ENQUEUE_INPUT);

    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(args.input_run.request_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives a revision a different digest from a generation of the same campaign", async () => {
    const { persistence, rpc } = persistenceReturning({
      run_id: RUN_ID,
      status: "queued",
      replayed: false,
    });
    const dispatcher = createCampaignRunDispatcher(persistence);

    await dispatcher.enqueue(ENQUEUE_INPUT);
    await dispatcher.enqueue({
      ...ENQUEUE_INPUT,
      kind: "revise",
      baseVersionId: VERSION_ID,
      baseDigest: "a".repeat(64),
    });

    const first = rpc.mock.calls[0] as unknown as [string, Record<string, Record<string, unknown>>];
    const second = rpc.mock.calls[1] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(first[1].input_run.request_digest).not.toBe(second[1].input_run.request_digest);
  });

  it("reports a replay rather than pretending a second run was created", async () => {
    const { persistence } = persistenceReturning({
      run_id: RUN_ID,
      status: "queued",
      replayed: true,
    });

    const result = await createCampaignRunDispatcher(persistence).enqueue(ENQUEUE_INPUT);

    expect(result.replayed).toBe(true);
  });

  it("refuses an empty organization rather than enqueuing unscoped work", async () => {
    const { persistence, rpc } = persistenceReturning(null);

    await expect(
      createCampaignRunDispatcher(persistence).enqueue({ ...ENQUEUE_INPUT, organizationId: "" }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports one safe message when the write is refused", async () => {
    const { persistence } = persistenceReturning(null, { code: "42501" });

    await expect(createCampaignRunDispatcher(persistence).enqueue(ENQUEUE_INPUT)).rejects.toThrow(
      /could not be read or written/,
    );
  });

  it("refuses a response that does not match the contract", async () => {
    const { persistence } = persistenceReturning({ run_id: "not-a-uuid" });

    await expect(createCampaignRunDispatcher(persistence).enqueue(ENQUEUE_INPUT)).rejects.toThrow();
  });

  it("has no way to complete or fail a run", () => {
    const { persistence } = persistenceReturning(null);
    const dispatcher = createCampaignRunDispatcher(persistence);

    expect(Object.keys(dispatcher)).toEqual(["enqueue"]);
  });
});

describe("run store", () => {
  it("maps a successful claim into the workflow's shape", async () => {
    const { persistence } = persistenceReturning({
      outcome: "claimed",
      claim_token: CLAIM_TOKEN,
      attempt: 1,
      campaign_id: CAMPAIGN_ID,
      source_snapshot_id: SNAPSHOT_ID,
      kind: "generate",
      base_version_id: null,
      base_digest: null,
      correlation_id: CORRELATION_ID,
    });

    const claim = await createCampaignRunStore(persistence).claim({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      leaseSeconds: 300,
    });

    expect(claim).toMatchObject({
      outcome: "claimed",
      claimToken: CLAIM_TOKEN,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
    });
  });

  it("accepts a variants claim and carries the persisted size into the workflow", async () => {
    const { persistence } = persistenceReturning({
      outcome: "claimed",
      claim_token: CLAIM_TOKEN,
      attempt: 1,
      campaign_id: CAMPAIGN_ID,
      source_snapshot_id: SNAPSHOT_ID,
      kind: "variants",
      base_version_id: VERSION_ID,
      base_digest: "a".repeat(64),
      correlation_id: CORRELATION_ID,
      variants_per_direction: 4,
    });

    const claim = await createCampaignRunStore(persistence).claim({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      leaseSeconds: 300,
    });

    expect(claim).toMatchObject({
      outcome: "claimed",
      kind: "variants",
      variantsPerDirection: 4,
    });
  });

  it("passes an already-claimed run straight through", async () => {
    const { persistence } = persistenceReturning({ outcome: "already_claimed" });

    const claim = await createCampaignRunStore(persistence).claim({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      leaseSeconds: 300,
    });

    expect(claim).toEqual({ outcome: "already_claimed" });
  });

  it("carries a finished run's outcome back for replay", async () => {
    const { persistence } = persistenceReturning({
      outcome: "already_finished",
      status: "succeeded",
      result_version_id: VERSION_ID,
      failure_code: null,
    });

    const claim = await createCampaignRunStore(persistence).claim({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      leaseSeconds: 300,
    });

    expect(claim).toMatchObject({
      outcome: "already_finished",
      status: "succeeded",
      resultVersionId: VERSION_ID,
    });
  });

  it("sends the claim token on completion, which is what fences a stale worker", async () => {
    const { persistence, rpc } = persistenceReturning(null);

    await createCampaignRunStore(persistence).complete({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
      resultVersionId: VERSION_ID,
      costMinor: 1_500,
    });

    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(args.input_completion.claim_token).toBe(CLAIM_TOKEN);
    expect(args.input_completion.result_version_id).toBe(VERSION_ID);
  });

  it("sends the claim token on failure too", async () => {
    const { persistence, rpc } = persistenceReturning(null);

    await createCampaignRunStore(persistence).fail({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
      failureCode: "validation_failed",
      costMinor: null,
    });

    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(args.input_failure.claim_token).toBe(CLAIM_TOKEN);
    expect(args.input_failure.cost_minor).toBeNull();
  });

  it("cancels without a claim token, because cancellation is not the worker's act", async () => {
    const { persistence, rpc } = persistenceReturning(null);

    await createCampaignRunStore(persistence).cancel({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
    });

    const [name, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(name).toBe("cancel_campaign_generation_run");
    expect(args.input_cancel).not.toHaveProperty("claim_token");
  });

  it("reports one safe message when a lifecycle write is refused", async () => {
    const { persistence } = persistenceReturning(null, { code: "42501" });

    await expect(
      createCampaignRunStore(persistence).complete({
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
        claimToken: CLAIM_TOKEN,
        resultVersionId: VERSION_ID,
        costMinor: null,
      }),
    ).rejects.toThrow(/could not be read or written/);
  });

  it("refuses a claim response that does not match the contract", async () => {
    const { persistence } = persistenceReturning({ outcome: "something_else" });

    await expect(
      createCampaignRunStore(persistence).claim({
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
        leaseSeconds: 300,
      }),
    ).rejects.toThrow();
  });
});
