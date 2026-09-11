import { beforeEach, describe, expect, it, vi } from "vitest";

import { validManifest } from "@/domain/campaigns/test-manifest";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  BundleVersionDetail,
  CampaignSummary,
  GenerationRunSnapshot,
} from "@/modules/campaigns/application/ports";
import { readHomeCampaigns } from "@/modules/campaigns/infrastructure/home-campaign-reader";
import type { HomePreviewStorage } from "@/modules/campaigns/infrastructure/home-preview-storage";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-11T12:00:00.000Z";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

type RecordedCall = {
  table: string;
  columns: string;
  filters: { column: string; value: unknown }[];
  notFilters: { column: string; operator: string; value: unknown }[];
  nullChecks: { column: string; value: null }[];
  orders: { column: string; ascending: boolean }[];
  limitValue: number | null;
};

type Seed = {
  campaigns: Record<string, unknown>[];
  versions: Record<string, unknown>[];
  posters: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  errors: Partial<Record<string, unknown>>;
};

function seed(overrides: Partial<Seed> = {}): Seed {
  return {
    campaigns: [],
    versions: [],
    posters: [],
    assets: [],
    reviews: [],
    errors: {},
    ...overrides,
  };
}

/**
 * A query spy shaped like the persistence port: every chained call is recorded
 * only once the query is awaited, so limits and ordering are captured whole.
 */
class FakeHomeQuery {
  private columns = "";
  private filters: RecordedCall["filters"] = [];
  private notFilters: RecordedCall["notFilters"] = [];
  private nullChecks: RecordedCall["nullChecks"] = [];
  private orders: RecordedCall["orders"] = [];
  private limitValue: number | null = null;

  constructor(
    private readonly rows: Record<string, unknown>[],
    private readonly table: string,
    private readonly calls: RecordedCall[],
    private readonly tableError: unknown,
    /**
     * When true the seed rows are returned as-is, simulating a persistence
     * layer that handed back a row the filters should have excluded. That is
     * exactly the corruption the reader's tenant/linkage checks must catch.
     */
    private readonly passthrough: boolean = false,
  ) {}

  select(columns: string): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: string): this {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options: { ascending: boolean }): this {
    this.orders.push({ column, ascending: options.ascending });
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  is(column: string, value: null): this {
    this.nullChecks.push({ column, value });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.notFilters.push({ column, operator, value });
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: (value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    this.calls.push({
      table: this.table,
      columns: this.columns,
      filters: [...this.filters],
      notFilters: [...this.notFilters],
      nullChecks: [...this.nullChecks],
      orders: [...this.orders],
      limitValue: this.limitValue,
    });
    if (this.tableError !== undefined) {
      return { data: null, error: this.tableError };
    }
    if (this.passthrough) {
      return { data: [...this.rows], error: null };
    }
    let rows = this.rows.filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
    rows = rows.filter((row) =>
      this.notFilters.every((filter) => {
        if (filter.operator === "is" && filter.value === null) return row[filter.column] != null;
        return row[filter.column] !== filter.value;
      }),
    );
    rows = rows.filter((row) => this.nullChecks.every((check) => row[check.column] == null));
    if (this.orders.length > 0) {
      rows = [...rows].sort((left, right) => {
        for (const order of this.orders) {
          const a = left[order.column];
          const b = right[order.column];
          if (a === b) continue;
          if (a == null) return 1;
          if (b == null) return -1;
          return (a < b ? -1 : 1) * (order.ascending ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);
    return { data: rows, error: null };
  }
}

function database(fixture: Seed, passthroughTables: readonly string[] = []) {
  const calls: RecordedCall[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    campaigns: fixture.campaigns,
    campaign_bundle_versions: fixture.versions,
    campaign_poster_renders: fixture.posters,
    campaign_assets: fixture.assets,
    creative_asset_reviews: fixture.reviews,
  };
  return {
    calls,
    source: {
      from: (table: string) => ({
        select: (columns: string) =>
          new FakeHomeQuery(
            tables[table] ?? [],
            table,
            calls,
            (fixture.errors as Record<string, unknown>)[table],
            passthroughTables.includes(table),
          ).select(columns),
      }),
    },
  };
}

function storage(
  handler: (paths: string[]) => {
    data: { path: string | null; signedUrl: string }[] | null;
    error: unknown;
  } = (paths) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
    error: null,
  }),
) {
  const createSignedUrls = vi.fn(async (paths: string[]) => handler(paths));
  const source = {
    storage: { from: () => ({ createSignedUrls }) },
  } as unknown as HomePreviewStorage;
  return { source, createSignedUrls };
}

function campaignSummary(id: string, overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    title: `Campaign ${id.slice(-4)}`,
    sourceKind: "manual_brief",
    briefId: null,
    opportunityId: null,
    state: "ready_for_review",
    createdAt: "2026-09-10T09:00:00.000Z",
    updatedAt: "2026-09-11T09:30:00.000Z",
    ...overrides,
  };
}

function versionDetail(
  id: string,
  campaignId: string,
  overrides: Partial<BundleVersionDetail> = {},
): BundleVersionDetail {
  const manifest = validManifest();
  return {
    id,
    campaignId,
    version: 1,
    parentVersionId: null,
    sourceSnapshotId: uuid(900),
    digest: "a".repeat(64),
    generationProfile: manifest.generationProfile,
    executionMode: manifest.executionMode,
    createdAt: "2026-09-11T09:30:00.000Z",
    manifest,
    ...overrides,
  };
}

function readPort(
  options: {
    campaigns?: Map<string, CampaignSummary>;
    versions?: Map<string, BundleVersionDetail>;
    runs?: Map<string, GenerationRunSnapshot | null>;
  } = {},
) {
  const campaigns = options.campaigns ?? new Map<string, CampaignSummary>();
  const versions = options.versions ?? new Map<string, BundleVersionDetail>();
  const runs = options.runs ?? new Map<string, GenerationRunSnapshot | null>();
  return {
    getCampaign: vi.fn(async (_organizationId: string, campaignId: string) => {
      return campaigns.get(campaignId) ?? null;
    }),
    getVersion: vi.fn(async (_organizationId: string, versionId: string) => {
      return versions.get(versionId) ?? null;
    }),
    latestGenerationRun: vi.fn(async (_organizationId: string, campaignId: string) => {
      return runs.get(campaignId) ?? null;
    }),
  };
}

/** One campaign with a current version and no artwork rows. */
function bareCampaign(campaignId: string, versionId: string) {
  return {
    fixture: seed({
      campaigns: [{ id: campaignId, organization_id: ORGANIZATION_ID }],
      versions: [{ id: versionId, organization_id: ORGANIZATION_ID, campaign_id: campaignId }],
    }),
    port: readPort({
      campaigns: new Map([[campaignId, campaignSummary(campaignId)]]),
      versions: new Map([[versionId, versionDetail(versionId, campaignId)]]),
    }),
  };
}

function posterRow(options: {
  id: string;
  campaignId: string;
  versionId: string;
  path: string;
  organizationId?: string;
}) {
  return {
    id: options.id,
    organization_id: options.organizationId ?? ORGANIZATION_ID,
    campaign_id: options.campaignId,
    bundle_version_id: options.versionId,
    state: "rendered",
    output_storage_path: options.path,
    output_width_px: 1080,
    output_height_px: 1080,
    rendered_at: "2026-09-11T10:00:00.000Z",
  };
}

function assetRow(options: {
  id: string;
  versionId: string;
  path: string;
  organizationId?: string;
}) {
  return {
    id: options.id,
    organization_id: options.organizationId ?? ORGANIZATION_ID,
    bundle_version_id: options.versionId,
    asset_key: uuid(700),
    storage_path: options.path,
    width_px: 1024,
    height_px: 1024,
    mime_type: "image/png",
    created_at: "2026-09-11T10:00:00.000Z",
  };
}

function reviewRow(options: { id: string; subjectId: string; verdict: "approved" | "rejected" }) {
  return {
    id: options.id,
    organization_id: ORGANIZATION_ID,
    subject_id: options.subjectId,
    subject_kind: "campaign_asset",
    verdict: options.verdict,
    reviewed_at: "2026-09-11T10:30:00.000Z",
  };
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
  vi.spyOn(logger, "warn").mockImplementation(() => undefined);
});

describe("bounded campaign reads", () => {
  it("reads three campaigns with a limit on the first query and every later one", async () => {
    const campaignIds = Array.from({ length: 100 }, (_, index) => uuid(100 + index));
    const fixture = seed({
      campaigns: campaignIds.map((id) => ({ id, organization_id: ORGANIZATION_ID })),
      versions: campaignIds.map((campaignId, index) => ({
        id: uuid(1000 + index),
        organization_id: ORGANIZATION_ID,
        campaign_id: campaignId,
      })),
    });
    const port = readPort({
      campaigns: new Map(campaignIds.map((id) => [id, campaignSummary(id)])),
      versions: new Map(
        campaignIds.map((campaignId, index) => [
          uuid(1000 + index),
          versionDetail(uuid(1000 + index), campaignId),
        ]),
      ),
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(records).toHaveLength(3);
    const [first, ...rest] = db.calls;
    expect(first?.table).toBe("campaigns");
    expect(first?.limitValue).toBe(3);
    expect(first?.orders).toEqual([
      { column: "updated_at", ascending: false },
      { column: "id", ascending: false },
    ]);
    // Bounded shapes, not just the final length: every later read is one row.
    for (const call of rest) expect(call.limitValue).toBe(1);
    // One id query plus at most seven metadata queries per campaign.
    expect(db.calls.length).toBeLessThanOrEqual(1 + 3 * 7);
  });

  it("fails the source when the campaign id query is refused", async () => {
    const db = database(seed({ errors: { campaigns: { code: "42501" } } }));
    const store = storage();

    await expect(
      readHomeCampaigns({
        database: db.source as never,
        read: readPort(),
        storage: store.source,
        organizationId: ORGANIZATION_ID,
        now: NOW,
        correlationId: CORRELATION_ID,
        canReadArtwork: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant campaign row instead of showing it", async () => {
    const campaignId = uuid(1);
    // Passthrough simulates the row slipping past the filter: the reader's
    // own tenant check is what must refuse it, never silently drop it.
    const db = database(
      seed({ campaigns: [{ id: campaignId, organization_id: OTHER_ORGANIZATION_ID }] }),
      ["campaigns"],
    );
    const store = storage();
    const port = readPort({
      campaigns: new Map([
        [campaignId, campaignSummary(campaignId, { organizationId: OTHER_ORGANIZATION_ID })],
      ]),
    });

    await expect(
      readHomeCampaigns({
        database: db.source as never,
        read: port,
        storage: store.source,
        organizationId: ORGANIZATION_ID,
        now: NOW,
        correlationId: CORRELATION_ID,
        canReadArtwork: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects an invalid campaign id from the id query", async () => {
    const db = database(
      seed({ campaigns: [{ id: "not-a-uuid", organization_id: ORGANIZATION_ID }] }),
    );
    const store = storage();

    await expect(
      readHomeCampaigns({
        database: db.source as never,
        read: readPort(),
        storage: store.source,
        organizationId: ORGANIZATION_ID,
        now: NOW,
        correlationId: CORRELATION_ID,
        canReadArtwork: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects a version row linked to another campaign", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const db = database(
      seed({
        campaigns: [{ id: campaignId, organization_id: ORGANIZATION_ID }],
        versions: [{ id: versionId, organization_id: ORGANIZATION_ID, campaign_id: uuid(3) }],
      }),
      ["campaign_bundle_versions"],
    );
    const store = storage();
    const port = readPort({
      campaigns: new Map([[campaignId, campaignSummary(campaignId)]]),
      versions: new Map([[versionId, versionDetail(versionId, uuid(3))]]),
    });

    await expect(
      readHomeCampaigns({
        database: db.source as never,
        read: port,
        storage: store.source,
        organizationId: ORGANIZATION_ID,
        now: NOW,
        correlationId: CORRELATION_ID,
        canReadArtwork: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects an unknown campaign state instead of rendering it", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const db = database(
      seed({
        campaigns: [{ id: campaignId, organization_id: ORGANIZATION_ID }],
        versions: [{ id: versionId, organization_id: ORGANIZATION_ID, campaign_id: campaignId }],
      }),
    );
    const store = storage();
    const port = readPort({
      campaigns: new Map([[campaignId, campaignSummary(campaignId, { state: "flying" })]]),
      versions: new Map([[versionId, versionDetail(versionId, campaignId)]]),
    });

    await expect(
      readHomeCampaigns({
        database: db.source as never,
        read: port,
        storage: store.source,
        organizationId: ORGANIZATION_ID,
        now: NOW,
        correlationId: CORRELATION_ID,
        canReadArtwork: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("fails rather than fabricating when a selected campaign disappears", async () => {
    const campaignId = uuid(1);
    const db = database(
      seed({ campaigns: [{ id: campaignId, organization_id: ORGANIZATION_ID }] }),
    );
    const store = storage();

    const error = await readHomeCampaigns({
      database: db.source as never,
      read: readPort(),
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DomainError);
    // A domain-safe message carries no tenant row, id, or storage detail.
    expect(String((error as Error).message)).not.toContain(campaignId);
  });

  it("fails rather than substituting when a selected version disappears", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const db = database(
      seed({
        campaigns: [{ id: campaignId, organization_id: ORGANIZATION_ID }],
        versions: [{ id: versionId, organization_id: ORGANIZATION_ID, campaign_id: campaignId }],
      }),
    );
    const store = storage();
    const port = readPort({ campaigns: new Map([[campaignId, campaignSummary(campaignId)]]) });

    await expect(
      readHomeCampaigns({
        database: db.source as never,
        read: port,
        storage: store.source,
        organizationId: ORGANIZATION_ID,
        now: NOW,
        correlationId: CORRELATION_ID,
        canReadArtwork: true,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("campaigns still waiting on their first proposal", () => {
  it("reads an expired lease as stalled with no cover and no open link", async () => {
    const campaignId = uuid(1);
    const db = database(
      seed({ campaigns: [{ id: campaignId, organization_id: ORGANIZATION_ID }] }),
    );
    const store = storage();
    const port = readPort({
      campaigns: new Map([[campaignId, campaignSummary(campaignId)]]),
      runs: new Map([
        [
          campaignId,
          {
            status: "claimed",
            failureCode: null,
            leaseExpiresAt: "2026-09-11T11:00:00.000Z",
          },
        ],
      ]),
    });

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(port.latestGenerationRun).toHaveBeenCalledWith(ORGANIZATION_ID, campaignId);
    expect(record?.item.generation.status).toBe("stalled");
    expect(record?.item.openable).toBe(false);
    expect(record?.item.awaitingFirstVersion).toBe(true);
    expect(record?.cover).toBeNull();
    expect(record?.coverLabel).toBeNull();
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("reads a live lease as still generating", async () => {
    const campaignId = uuid(1);
    const db = database(
      seed({ campaigns: [{ id: campaignId, organization_id: ORGANIZATION_ID }] }),
    );
    const store = storage();
    const port = readPort({
      campaigns: new Map([[campaignId, campaignSummary(campaignId)]]),
      runs: new Map([
        [
          campaignId,
          {
            status: "claimed",
            failureCode: null,
            leaseExpiresAt: "2026-09-11T13:00:00.000Z",
          },
        ],
      ]),
    });

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(record?.item.generation.status).toBe("generating");
    expect(record?.item.openable).toBe(false);
    expect(record?.cover).toBeNull();
  });
});

describe("cover selection stays pinned to the selected version", () => {
  it("covers with the current version's render, never another version's", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const otherVersionId = uuid(3);
    const currentPath = `${ORGANIZATION_ID}/current.png`;
    const otherPath = `${ORGANIZATION_ID}/other.png`;
    const { fixture, port } = bareCampaign(campaignId, versionId);
    fixture.posters = [
      posterRow({ id: uuid(10), campaignId, versionId, path: currentPath }),
      posterRow({ id: uuid(11), campaignId, versionId: otherVersionId, path: otherPath }),
    ];
    const db = database(fixture);
    const store = storage();

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    const [signedPaths] = store.createSignedUrls.mock.calls[0] as unknown as [string[]];
    expect(signedPaths).toEqual([currentPath]);
    expect(record?.cover?.url).toBe(`https://signed.example/${currentPath}`);
    expect(record?.coverLabel).toBe("Finished render");
  });

  it("returns no cover and signs nothing when the generated image was rejected", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const assetId = uuid(4);
    const { fixture, port } = bareCampaign(campaignId, versionId);
    fixture.assets = [
      assetRow({ id: assetId, versionId, path: `${ORGANIZATION_ID}/rejected.png` }),
    ];
    fixture.reviews = [reviewRow({ id: uuid(5), subjectId: assetId, verdict: "rejected" })];
    const db = database(fixture);
    const store = storage();

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(record?.item.title).toBe(`Campaign ${campaignId.slice(-4)}`);
    expect(record?.cover).toBeNull();
    expect(record?.coverLabel).toBeNull();
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("covers an unreviewed generated image as a campaign image", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const assetId = uuid(4);
    const assetPath = `${ORGANIZATION_ID}/generated.png`;
    const { fixture, port } = bareCampaign(campaignId, versionId);
    fixture.assets = [assetRow({ id: assetId, versionId, path: assetPath })];
    const db = database(fixture);
    const store = storage();

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(record?.cover?.url).toBe(`https://signed.example/${assetPath}`);
    expect(record?.coverLabel).toBe("Campaign image");
  });

  it("never hands one campaign's cover to another", async () => {
    const firstId = uuid(1);
    const firstVersion = uuid(2);
    const secondId = uuid(3);
    const secondVersion = uuid(4);
    const firstPath = `${ORGANIZATION_ID}/first.png`;
    const secondPath = `${ORGANIZATION_ID}/second.png`;
    const fixture = seed({
      campaigns: [
        { id: firstId, organization_id: ORGANIZATION_ID },
        { id: secondId, organization_id: ORGANIZATION_ID },
      ],
      versions: [
        { id: firstVersion, organization_id: ORGANIZATION_ID, campaign_id: firstId },
        { id: secondVersion, organization_id: ORGANIZATION_ID, campaign_id: secondId },
      ],
      posters: [
        posterRow({ id: uuid(10), campaignId: firstId, versionId: firstVersion, path: firstPath }),
        posterRow({
          id: uuid(11),
          campaignId: secondId,
          versionId: secondVersion,
          path: secondPath,
        }),
      ],
    });
    const port = readPort({
      campaigns: new Map([
        [firstId, campaignSummary(firstId)],
        [secondId, campaignSummary(secondId)],
      ]),
      versions: new Map([
        [firstVersion, versionDetail(firstVersion, firstId)],
        [secondVersion, versionDetail(secondVersion, secondId)],
      ]),
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(records).toHaveLength(2);
    const urls = records.map((record) => record.cover?.url).sort();
    expect(urls).toEqual(
      [`https://signed.example/${firstPath}`, `https://signed.example/${secondPath}`].sort(),
    );
    const allSigned = store.createSignedUrls.mock.calls.flat() as unknown as string[][];
    expect(JSON.stringify(allSigned)).not.toContain("undefined");
  });
});

describe("cover failures degrade the picture, never the text", () => {
  it("keeps the campaign ready when the poster read is refused", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const { fixture, port } = bareCampaign(campaignId, versionId);
    fixture.errors = { campaign_poster_renders: { code: "42501" } };
    const db = database(fixture);
    const store = storage();

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(record?.item.title).toBe(`Campaign ${campaignId.slice(-4)}`);
    expect(record?.cover).toBeNull();
    expect(record?.coverLabel).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "organization_home.preview_failed",
      expect.objectContaining({ organizationId: ORGANIZATION_ID, correlationId: CORRELATION_ID }),
    );
  });

  it("keeps the campaign ready when signing is refused, without logging the url", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const { fixture, port } = bareCampaign(campaignId, versionId);
    fixture.posters = [
      posterRow({ id: uuid(10), campaignId, versionId, path: `${ORGANIZATION_ID}/a.png` }),
    ];
    const db = database(fixture);
    const store = storage(() => ({ data: null, error: { message: "denied" } }));

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: true,
    });

    expect(record?.item.title).toBe(`Campaign ${campaignId.slice(-4)}`);
    expect(record?.cover).toBeNull();
    const logged = vi.mocked(logger.error).mock.calls.map((call) => JSON.stringify(call));
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain("https://signed.example");
      expect(line).not.toContain(`${ORGANIZATION_ID}/a.png`);
    }
  });

  it("skips every cover, review and signing call when artwork cannot be read", async () => {
    const campaignId = uuid(1);
    const versionId = uuid(2);
    const { fixture, port } = bareCampaign(campaignId, versionId);
    fixture.posters = [
      posterRow({ id: uuid(10), campaignId, versionId, path: `${ORGANIZATION_ID}/a.png` }),
    ];
    const db = database(fixture);
    const store = storage();

    const [record] = await readHomeCampaigns({
      database: db.source as never,
      read: port,
      storage: store.source,
      organizationId: ORGANIZATION_ID,
      now: NOW,
      correlationId: CORRELATION_ID,
      canReadArtwork: false,
    });

    expect(record?.item.title).toBe(`Campaign ${campaignId.slice(-4)}`);
    expect(record?.item.objective).toBe(validManifest().objective);
    expect(record?.cover).toBeNull();
    expect(db.calls.map((call) => call.table)).not.toContain("campaign_poster_renders");
    expect(db.calls.map((call) => call.table)).not.toContain("campaign_assets");
    expect(db.calls.map((call) => call.table)).not.toContain("creative_asset_reviews");
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });
});
