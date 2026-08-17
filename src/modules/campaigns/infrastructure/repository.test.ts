import { describe, expect, it, vi } from "vitest";

import { validManifest } from "@/domain/campaigns/test-manifest";
import {
  createCampaignReadRepository,
  createCampaignVersionWriter,
  type CampaignPersistence,
} from "@/modules/campaigns/infrastructure/repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "e0000000-0000-4000-8000-000000000001";

/** A chainable query stub that records the filters the repository applied. */
function queryStub(
  rows: readonly Record<string, unknown>[],
  error: { code?: string } | null = null,
) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "order", "limit", "is"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error });
  return { builder, calls };
}

function persistenceFor(
  rows: readonly Record<string, unknown>[],
  error: { code?: string } | null = null,
) {
  const stub = queryStub(rows, error);
  const select = vi.fn(() => stub.builder);
  const persistence = {
    from: vi.fn(() => ({ select })),
    rpc: vi.fn(),
  } as unknown as CampaignPersistence;
  return { persistence, select, calls: stub.calls };
}

const CAMPAIGN_ROW = {
  id: CAMPAIGN_ID,
  organization_id: ORGANIZATION_ID,
  title: "Weekday lunch",
  source_kind: "manual_brief",
  brief_id: "b0000000-0000-4000-8000-000000000001",
  opportunity_id: null,
  state: "draft",
  created_at: "2026-08-15 10:00:00+00",
  updated_at: "2026-08-15 10:00:00+00",
};

describe("campaign read repository", () => {
  it("scopes every campaign read to the organization", async () => {
    const { persistence, calls } = persistenceFor([CAMPAIGN_ROW]);

    await createCampaignReadRepository(persistence).listCampaigns(ORGANIZATION_ID);

    expect(calls).toContainEqual({ method: "eq", args: ["organization_id", ORGANIZATION_ID] });
  });

  it("normalizes Postgres timestamps to strict UTC", async () => {
    const { persistence } = persistenceFor([CAMPAIGN_ROW]);

    const [campaign] =
      await createCampaignReadRepository(persistence).listCampaigns(ORGANIZATION_ID);

    expect(campaign?.createdAt).toBe("2026-08-15T10:00:00.000Z");
  });

  it("refuses an empty organization rather than reading every tenant", async () => {
    const { persistence } = persistenceFor([CAMPAIGN_ROW]);

    await expect(createCampaignReadRepository(persistence).listCampaigns("")).rejects.toThrow(
      /could not be loaded/,
    );
  });

  it("reports one safe message for a refused read", async () => {
    const { persistence } = persistenceFor([], { code: "42501" });

    await expect(
      createCampaignReadRepository(persistence).listCampaigns(ORGANIZATION_ID),
    ).rejects.toThrow(/could not be loaded or saved/);
  });

  it("returns null for a campaign the reader cannot see", async () => {
    const { persistence } = persistenceFor([]);

    const campaign = await createCampaignReadRepository(persistence).getCampaign(
      ORGANIZATION_ID,
      CAMPAIGN_ID,
    );

    expect(campaign).toBeNull();
  });

  it("asks the database for the live approval rather than filtering in memory", async () => {
    const { persistence, calls } = persistenceFor([]);

    await createCampaignReadRepository(persistence).getLiveApproval(ORGANIZATION_ID, CAMPAIGN_ID);

    expect(calls).toContainEqual({ method: "is", args: ["revoked_at", null] });
  });
});

describe("campaign review writes", () => {
  it("passes the attestation through the security-definer RPC", async () => {
    const rpc = vi.fn(async () => ({ data: "attestation-1", error: null }));
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;

    const id = await createCampaignReadRepository(persistence).recordAttestation({
      organizationId: ORGANIZATION_ID,
      bundleVersionId: "f0000000-0000-4000-8000-000000000001",
      bundleDigest: "a".repeat(64),
      statement: "I reviewed every image.",
    });

    expect(id).toBe("attestation-1");
    expect(rpc).toHaveBeenCalledWith("record_campaign_visual_attestation", {
      target_organization_id: ORGANIZATION_ID,
      target_bundle_version_id: "f0000000-0000-4000-8000-000000000001",
      input_digest: "a".repeat(64),
      input_statement: "I reviewed every image.",
    });
  });

  it("refuses an attestation whose digest is not a SHA-256 value", async () => {
    const persistence = { from: vi.fn(), rpc: vi.fn() } as unknown as CampaignPersistence;

    await expect(
      createCampaignReadRepository(persistence).recordAttestation({
        organizationId: ORGANIZATION_ID,
        bundleVersionId: "f0000000-0000-4000-8000-000000000001",
        bundleDigest: "not-a-digest",
        statement: "I reviewed every image.",
      }),
    ).rejects.toThrow();
  });

  it("refuses an approval that authorizes no actions", async () => {
    const rpc = vi.fn();
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;

    await expect(
      createCampaignReadRepository(persistence).approve({
        organizationId: ORGANIZATION_ID,
        bundleVersionId: "f0000000-0000-4000-8000-000000000001",
        bundleDigest: "a".repeat(64),
        attestationId: "d0000000-0000-4000-8000-000000000001",
        expiresAt: "2027-01-01T00:00:00.000Z",
        capabilityGrantVersions: {},
        policyVersionIds: [],
        actionKeys: [],
        totalSpendCeiling: null,
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("campaign version writer", () => {
  function writerInput(overrides: Record<string, unknown> = {}) {
    const manifest = validManifest();
    return {
      organizationId: ORGANIZATION_ID,
      campaignId: manifest.campaignId,
      sourceSnapshotId: SNAPSHOT_ID,
      digest: "a".repeat(64),
      manifest,
      assetStoragePaths: Object.fromEntries(
        manifest.assets.map((asset) => [asset.id, `${ORGANIZATION_ID}/c/v/${asset.id}.png`]),
      ),
      ...overrides,
    };
  }

  it("lets the database assign the version number under its own lock", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        bundle_version_id: "f0000000-0000-4000-8000-000000000001",
        version: 1,
        parent_version_id: null,
        revoked_approval_count: 0,
      },
      error: null,
    }));
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;

    const result = await createCampaignVersionWriter(persistence).createVersion(
      writerInput() as never,
    );

    expect(result.version).toBe(1);
    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(args.input_bundle).not.toHaveProperty("version");
  });

  it("reports how many approvals the new version invalidated", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        bundle_version_id: "f0000000-0000-4000-8000-000000000002",
        version: 2,
        parent_version_id: "f0000000-0000-4000-8000-000000000001",
        revoked_approval_count: 1,
      },
      error: null,
    }));
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;

    const result = await createCampaignVersionWriter(persistence).createVersion(
      writerInput() as never,
    );

    expect(result).toMatchObject({
      parentVersionId: "f0000000-0000-4000-8000-000000000001",
      revokedApprovalCount: 1,
    });
  });

  it("refuses to publish when an asset has no storage path", async () => {
    const rpc = vi.fn();
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;
    const input = writerInput();
    delete (input.assetStoragePaths as Record<string, string>)[
      (input.manifest as ReturnType<typeof validManifest>).assets[0]!.id
    ];

    await expect(
      createCampaignVersionWriter(persistence).createVersion(input as never),
    ).rejects.toThrow(/could not be loaded or saved/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a storage path for an asset the manifest does not carry", async () => {
    const rpc = vi.fn();
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;
    const input = writerInput();
    (input.assetStoragePaths as Record<string, string>)["a0000000-0000-4000-8000-000000000099"] =
      `${ORGANIZATION_ID}/c/v/stray.png`;

    await expect(
      createCampaignVersionWriter(persistence).createVersion(input as never),
    ).rejects.toThrow(/could not be loaded or saved/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends each asset with the storage path it was validated against", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        bundle_version_id: "f0000000-0000-4000-8000-000000000001",
        version: 1,
        parent_version_id: null,
        revoked_approval_count: 0,
      },
      error: null,
    }));
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;
    const input = writerInput();

    await createCampaignVersionWriter(persistence).createVersion(input as never);

    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    const assets = args.input_bundle.assets as { id: string; storagePath: string }[];
    expect(assets.every((asset) => asset.storagePath.startsWith(ORGANIZATION_ID))).toBe(true);
  });

  it("refuses a manifest that fails the domain contract before touching the database", async () => {
    const rpc = vi.fn();
    const persistence = { from: vi.fn(), rpc } as unknown as CampaignPersistence;
    const input = writerInput();
    (input.manifest as ReturnType<typeof validManifest>).objective = "";

    await expect(
      createCampaignVersionWriter(persistence).createVersion(input as never),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
