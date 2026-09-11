import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AssetHomeRecord } from "@/modules/campaigns/application/home-preview-types";
import {
  readHomeLogo,
  readHomePosterAssets,
  readHomeReferenceAssets,
} from "@/modules/campaigns/infrastructure/home-asset-reader";
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
  inFilters: { column: string; values: readonly unknown[] }[];
  notFilters: { column: string; operator: string; value: unknown }[];
  nullChecks: { column: string; value: null }[];
  orders: { column: string; ascending: boolean }[];
  limitValue: number | null;
};

type Seed = {
  posterRenders: Record<string, unknown>[];
  campaigns: Record<string, unknown>[];
  brandAssets: Record<string, unknown>[];
  brandAssetVersions: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  errors: Partial<Record<string, unknown>>;
};

function seed(overrides: Partial<Seed> = {}): Seed {
  return {
    posterRenders: [],
    campaigns: [],
    brandAssets: [],
    brandAssetVersions: [],
    reviews: [],
    errors: {},
    ...overrides,
  };
}

/**
 * A query spy shaped like the persistence port: every chained call is recorded
 * only once the query is awaited, so limits, ordering, and the bounded `.in`
 * are captured whole.
 */
class FakeHomeAssetQuery {
  private columns = "";
  private filters: RecordedCall["filters"] = [];
  private inFilters: RecordedCall["inFilters"] = [];
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

  eq(column: string, value: string | boolean): this {
    this.filters.push({ column, value });
    return this;
  }

  in(column: string, values: readonly string[]): this {
    this.inFilters.push({ column, values });
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
      inFilters: this.inFilters.map((filter) => ({ ...filter, values: [...filter.values] })),
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
      this.inFilters.every((filter) => filter.values.includes(row[filter.column])),
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
    campaign_poster_renders: fixture.posterRenders,
    campaigns: fixture.campaigns,
    organization_brand_assets: fixture.brandAssets,
    organization_brand_asset_versions: fixture.brandAssetVersions,
    creative_asset_reviews: fixture.reviews,
  };
  return {
    calls,
    source: {
      from: (table: string) => ({
        select: (columns: string) =>
          new FakeHomeAssetQuery(
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
  const from = vi.fn((_bucket: string) => ({ createSignedUrls }));
  const source = {
    storage: { from },
  } as unknown as HomePreviewStorage;
  return { source, createSignedUrls, from };
}

const baseInput = {
  organizationId: ORGANIZATION_ID,
  now: NOW,
  correlationId: CORRELATION_ID,
};

function posterRender(
  renderSeed: number,
  campaignSeed: number,
  renderedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: uuid(renderSeed),
    organization_id: ORGANIZATION_ID,
    campaign_id: uuid(campaignSeed),
    bundle_version_id: uuid(500 + renderSeed),
    template_key: "feed_image_v1",
    script: "Latn",
    state: "rendered",
    output_storage_path: `${ORGANIZATION_ID}/poster-${renderSeed}.png`,
    output_width_px: 1080,
    output_height_px: 1350,
    rendered_at: renderedAt,
    ...overrides,
  };
}

function campaignRow(
  campaignSeed: number,
  title: string,
  organizationId: string = ORGANIZATION_ID,
): Record<string, unknown> {
  return { id: uuid(campaignSeed), organization_id: organizationId, title };
}

function brandAsset(
  assetSeed: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: uuid(assetSeed),
    organization_id: ORGANIZATION_ID,
    label: `Reference ${assetSeed}`,
    asset_role: "product",
    archived_at: null,
    created_at: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

function brandVersion(
  versionSeed: number,
  assetSeed: number,
  createdAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: uuid(versionSeed),
    organization_id: ORGANIZATION_ID,
    brand_asset_id: uuid(assetSeed),
    version: 1,
    is_usable: true,
    storage_path: `${ORGANIZATION_ID}/ref-${versionSeed}.png`,
    mime_type: "image/png",
    width_px: 800,
    height_px: 600,
    created_at: createdAt,
    ...overrides,
  };
}

function brandReview(
  reviewSeed: number,
  subjectSeed: number,
  verdict: "approved" | "rejected",
  reviewedAt: string,
  subjectKind = "brand_asset_version",
): Record<string, unknown> {
  return {
    id: uuid(reviewSeed),
    organization_id: ORGANIZATION_ID,
    subject_id: uuid(subjectSeed),
    subject_kind: subjectKind,
    verdict,
    reviewed_at: reviewedAt,
  };
}

/**
 * Task 4's documented merge rule, repeated here only to pin the contract both
 * readers must satisfy: up to four posters plus up to four references, newest
 * recorded first, composite id breaking ties, four slots total.
 */
function mergeGallery(
  posters: readonly AssetHomeRecord[],
  references: readonly AssetHomeRecord[],
): AssetHomeRecord[] {
  return [...posters, ...references]
    .sort((left, right) => {
      if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? 1 : -1;
      return left.id < right.id ? -1 : 1;
    })
    .slice(0, 4);
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
  vi.spyOn(logger, "warn").mockImplementation(() => undefined);
});

describe("home poster gallery reader", () => {
  it("reads four rendered posters with one bounded parent lookup and exact query shapes", async () => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z"),
        posterRender(2, 102, "2026-09-11T09:02:00.000Z"),
        posterRender(3, 103, "2026-09-11T09:04:00.000Z"),
        posterRender(4, 104, "2026-09-11T09:06:00.000Z"),
      ],
      campaigns: [
        campaignRow(101, "Harbour lunch rush"),
        campaignRow(102, "Weekend family feast"),
        campaignRow(103, "Late-night delivery"),
        campaignRow(104, "Festive sharing platter"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomePosterAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toHaveLength(4);
    expect(records.map((record) => record.recordedAt)).toEqual([
      "2026-09-11T09:06:00.000Z",
      "2026-09-11T09:04:00.000Z",
      "2026-09-11T09:02:00.000Z",
      "2026-09-11T09:00:00.000Z",
    ]);
    const [first] = records;
    expect(first?.id).toBe(`poster:${uuid(4)}`);
    expect(first?.sourceKind).toBe("poster_render");
    expect(first?.label).toBe("Festive sharing platter · feed_image_v1 · Latn");
    expect(first?.sourceLabel).toBe("Finished poster render");
    expect(first?.reviewLabel).toBe("Review not recorded");
    expect(first?.reviewState).toBe("unreviewed");
    expect(first?.sourceHref).toBe(
      `/organizations/${ORGANIZATION_ID}/campaigns/${uuid(104)}?version=${uuid(504)}`,
    );
    expect(first?.image).toMatchObject({ width: 1080, height: 1350 });

    const posterCall = db.calls.find((call) => call.table === "campaign_poster_renders");
    expect(posterCall?.limitValue).toBe(4);
    expect(posterCall?.orders).toEqual([
      { column: "rendered_at", ascending: false },
      { column: "id", ascending: false },
    ]);
    expect(posterCall?.filters).toContainEqual({
      column: "organization_id",
      value: ORGANIZATION_ID,
    });
    expect(posterCall?.filters).toContainEqual({ column: "state", value: "rendered" });
    expect(posterCall?.notFilters).toContainEqual({
      column: "output_storage_path",
      operator: "is",
      value: null,
    });

    const parentCalls = db.calls.filter((call) => call.table === "campaigns");
    expect(parentCalls).toHaveLength(1);
    expect(parentCalls[0]?.inFilters).toHaveLength(1);
    // Bounded: at most four parent ids in the single lookup.
    expect(parentCalls[0]?.inFilters[0]?.values).toHaveLength(4);

    // One batch signing in the campaign-assets bucket before any merge.
    expect(store.from).toHaveBeenCalledTimes(1);
    expect(store.from).toHaveBeenCalledWith("campaign-assets");
    expect(store.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(store.createSignedUrls.mock.calls[0]?.[0]).toHaveLength(4);
    // Posters never consult the review ledger.
    expect(db.calls.some((call) => call.table === "creative_asset_reviews")).toBe(false);
  });

  it("breaks rendered_at ties by id descending", async () => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z"),
        posterRender(2, 102, "2026-09-11T09:00:00.000Z"),
      ],
      campaigns: [campaignRow(101, "First campaign"), campaignRow(102, "Second campaign")],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomePosterAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records.map((record) => record.id)).toEqual([`poster:${uuid(2)}`, `poster:${uuid(1)}`]);
  });

  it("omits the poster whose parent campaign is missing without leaking its title or path", async () => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z"),
        posterRender(2, 102, "2026-09-11T09:02:00.000Z"),
      ],
      campaigns: [campaignRow(101, "Harbour lunch rush")],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomePosterAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.label).toContain("Harbour lunch rush");
    // The orphaned candidate is never signed and never surfaces.
    expect(store.createSignedUrls.mock.calls[0]?.[0]).toEqual([
      `${ORGANIZATION_ID}/poster-1.png`,
    ]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("poster-2.png");
    expect(serialized).not.toContain(uuid(102));
    const logged = vi.mocked(logger.error).mock.calls.map((call) => JSON.stringify(call));
    expect(logged.some((entry) => entry.includes("organization_home.preview_failed"))).toBe(true);
    expect(logged.some((entry) => entry.includes("posters:"))).toBe(true);
  });

  it("keeps posters at Review not recorded even with plate reviews and verification payloads present", async () => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z", {
          text_values: { headline: "Lunch rush" },
          verification: { digest_match: true },
        }),
      ],
      campaigns: [campaignRow(101, "Harbour lunch rush")],
      // A plate-style review for the render plus an unrelated brand review:
      // neither may move a poster off "Review not recorded".
      reviews: [
        {
          id: uuid(301),
          organization_id: ORGANIZATION_ID,
          subject_id: uuid(1),
          subject_kind: "campaign_asset",
          verdict: "approved",
          reviewed_at: "2026-09-11T10:00:00.000Z",
        },
        brandReview(302, 901, "rejected", "2026-09-11T10:30:00.000Z"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomePosterAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.reviewLabel).toBe("Review not recorded");
    expect(records[0]?.reviewState).toBe("unreviewed");
    expect(db.calls.some((call) => call.table === "creative_asset_reviews")).toBe(false);
  });

  it("fails the source on a foreign-tenant poster row without signing anything", async () => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z", {
          organization_id: OTHER_ORGANIZATION_ID,
        }),
      ],
    });
    const db = database(fixture, ["campaign_poster_renders"]);
    const store = storage();

    await expect(
      readHomePosterAssets({ database: db.source as never, storage: store.source, ...baseInput }),
    ).rejects.toThrow(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign prefix", `${OTHER_ORGANIZATION_ID}/poster-1.png`],
    ["traversal segments", `${ORGANIZATION_ID}/../${OTHER_ORGANIZATION_ID}/evil.png`],
  ])("fails the source on a %s path without signing anything", async (_case, path) => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z", { output_storage_path: path }),
      ],
      campaigns: [campaignRow(101, "Harbour lunch rush")],
    });
    const db = database(fixture);
    const store = storage();

    // A correct-org row naming another tenant's bytes is corruption, not a blank
    // tile: the source fails before anything reaches the signer.
    await expect(
      readHomePosterAssets({ database: db.source as never, storage: store.source, ...baseInput }),
    ).rejects.toThrow(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("fails the source when the parent lookup returns a foreign-tenant row", async () => {
    const fixture = seed({
      posterRenders: [posterRender(1, 101, "2026-09-11T09:00:00.000Z")],
      campaigns: [campaignRow(101, "Someone else's campaign", OTHER_ORGANIZATION_ID)],
    });
    const db = database(fixture, ["campaigns"]);
    const store = storage();

    await expect(
      readHomePosterAssets({ database: db.source as never, storage: store.source, ...baseInput }),
    ).rejects.toThrow(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("degrades to ready metadata with a null image when signing fails", async () => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z"),
        posterRender(2, 102, "2026-09-11T09:02:00.000Z"),
      ],
      campaigns: [campaignRow(101, "Harbour lunch rush"), campaignRow(102, "Weekend feast")],
    });

    const globalFailure = database(fixture);
    const globalStore = storage(() => ({ data: null, error: { message: "signing down" } }));
    const globalRecords = await readHomePosterAssets({
      database: globalFailure.source as never,
      storage: globalStore.source,
      ...baseInput,
    });
    expect(globalRecords).toHaveLength(2);
    expect(globalRecords.every((record) => record.image === null)).toBe(true);
    // Ready metadata survives: no raw storage error reaches the DTO.
    expect(JSON.stringify(globalRecords)).not.toContain("signing down");

    const partialFailure = database(fixture);
    const partialStore = storage((paths) => ({
      data: paths
        .filter((path) => path.endsWith("poster-1.png"))
        .map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
      error: null,
    }));
    const partialRecords = await readHomePosterAssets({
      database: partialFailure.source as never,
      storage: partialStore.source,
      ...baseInput,
    });
    const byId = new Map(partialRecords.map((record) => [record.id, record]));
    expect(byId.get(`poster:${uuid(1)}`)?.image).not.toBeNull();
    expect(byId.get(`poster:${uuid(2)}`)?.image).toBeNull();
  });
});

describe("home reference gallery reader", () => {
  it("reads four recent references with bounded version and review lookups", async () => {
    const fixture = seed({
      brandAssets: [
        brandAsset(401, { created_at: "2026-09-11T09:00:00.000Z" }),
        brandAsset(402, { created_at: "2026-09-11T09:01:00.000Z" }),
        brandAsset(403, { created_at: "2026-09-11T09:02:00.000Z" }),
        brandAsset(404, { created_at: "2026-09-11T09:03:00.000Z" }),
      ],
      brandAssetVersions: [
        // Version timestamps deliberately differ from parent timestamps: the
        // record carries the version date, never the parent date.
        brandVersion(201, 401, "2026-09-10T09:00:00.000Z"),
        brandVersion(202, 402, "2026-09-10T09:01:00.000Z"),
        brandVersion(203, 403, "2026-09-10T09:02:00.000Z"),
        brandVersion(204, 404, "2026-09-10T09:03:00.000Z"),
      ],
      reviews: [
        brandReview(301, 201, "approved", "2026-09-10T10:00:00.000Z"),
        brandReview(302, 202, "approved", "2026-09-10T10:01:00.000Z"),
        brandReview(303, 203, "approved", "2026-09-10T10:02:00.000Z"),
        brandReview(304, 204, "approved", "2026-09-10T10:03:00.000Z"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toHaveLength(4);
    const [first] = records;
    expect(first?.id).toBe(`reference:${uuid(204)}`);
    expect(first?.sourceKind).toBe("brand_reference");
    expect(first?.label).toBe("Reference 404");
    expect(first?.sourceLabel).toBe("Brand reference");
    expect(first?.reviewLabel).toBe("Approved reference");
    expect(first?.reviewState).toBe("approved");
    // Source-specific timestamp: the selected version date, not the parent's.
    expect(first?.recordedAt).toBe("2026-09-10T09:03:00.000Z");
    expect(first?.sourceHref).toBe(`/organizations/${ORGANIZATION_ID}/assets`);
    expect(first?.image).toMatchObject({ width: 800, height: 600 });

    const parentCall = db.calls.find((call) => call.table === "organization_brand_assets");
    expect(parentCall?.limitValue).toBe(4);
    expect(parentCall?.nullChecks).toContainEqual({ column: "archived_at", value: null });
    expect(parentCall?.orders).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);

    const versionCalls = db.calls.filter(
      (call) => call.table === "organization_brand_asset_versions",
    );
    expect(versionCalls).toHaveLength(4);
    for (const call of versionCalls) {
      expect(call.limitValue).toBe(1);
      expect(call.orders).toEqual([
        { column: "version", ascending: false },
        { column: "id", ascending: false },
      ]);
      expect(call.filters).toContainEqual({ column: "is_usable", value: true });
    }

    const reviewCalls = db.calls.filter((call) => call.table === "creative_asset_reviews");
    expect(reviewCalls).toHaveLength(4);
    for (const call of reviewCalls) {
      expect(call.limitValue).toBe(1);
      // The exact review sort the asset library uses: newest verdict wins.
      expect(call.orders).toEqual([
        { column: "reviewed_at", ascending: false },
        { column: "id", ascending: false },
      ]);
      expect(call.filters).toContainEqual({ column: "subject_kind", value: "brand_asset_version" });
    }

    // One batch signing in the brand-assets bucket.
    expect(store.from).toHaveBeenCalledTimes(1);
    expect(store.from).toHaveBeenCalledWith("brand-assets");
    expect(store.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(store.createSignedUrls.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it("excludes archived parents", async () => {
    const fixture = seed({
      brandAssets: [
        brandAsset(401, { created_at: "2026-09-11T09:05:00.000Z", archived_at: "2026-09-11T10:00:00.000Z" }),
        brandAsset(402, { created_at: "2026-09-11T09:01:00.000Z" }),
      ],
      brandAssetVersions: [
        brandVersion(201, 401, "2026-09-10T09:00:00.000Z"),
        brandVersion(202, 402, "2026-09-10T09:01:00.000Z"),
      ],
      reviews: [
        brandReview(301, 201, "approved", "2026-09-10T10:00:00.000Z"),
        brandReview(302, 202, "approved", "2026-09-10T10:01:00.000Z"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records.map((record) => record.label)).toEqual(["Reference 402"]);
  });

  it("omits parents with no usable version without failing the source", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401), brandAsset(402)],
      brandAssetVersions: [
        brandVersion(201, 401, "2026-09-10T09:00:00.000Z", { is_usable: false }),
        brandVersion(202, 402, "2026-09-10T09:01:00.000Z", { is_usable: true }),
      ],
      reviews: [brandReview(302, 202, "approved", "2026-09-10T10:01:00.000Z")],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records.map((record) => record.id)).toEqual([`reference:${uuid(202)}`]);
    // The unusable candidate's bytes are never signed.
    expect(store.createSignedUrls.mock.calls[0]?.[0]).toEqual([`${ORGANIZATION_ID}/ref-202.png`]);
  });

  it("returns ready empty when the only parent has no usable version", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401)],
      brandAssetVersions: [],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toEqual([]);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("omits the latest-rejected reference even when an older approval exists, without signing it", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401), brandAsset(402)],
      brandAssetVersions: [
        brandVersion(201, 401, "2026-09-10T09:00:00.000Z"),
        brandVersion(202, 402, "2026-09-10T09:01:00.000Z"),
      ],
      reviews: [
        brandReview(301, 201, "approved", "2026-09-10T10:00:00.000Z"),
        brandReview(303, 201, "rejected", "2026-09-10T11:00:00.000Z"),
        brandReview(302, 202, "approved", "2026-09-10T10:01:00.000Z"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    // The newest verdict is a rejection, so the older approval cannot rescue it.
    expect(records.map((record) => record.id)).toEqual([`reference:${uuid(202)}`]);
    expect(store.createSignedUrls.mock.calls[0]?.[0]).toEqual([`${ORGANIZATION_ID}/ref-202.png`]);
  });

  it("never falls back to a previously approved version after the current one is rejected", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401)],
      brandAssetVersions: [
        brandVersion(201, 401, "2026-09-09T09:00:00.000Z", { version: 1 }),
        brandVersion(202, 401, "2026-09-10T09:00:00.000Z", { version: 2 }),
      ],
      reviews: [
        brandReview(301, 201, "approved", "2026-09-09T10:00:00.000Z"),
        brandReview(302, 202, "rejected", "2026-09-10T10:00:00.000Z"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    // Only the latest usable version is ever read: its rejection omits the parent,
    // and the older approved version is not consulted as a replacement.
    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toEqual([]);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("labels a missing review Unreviewed without manufacturing a review row", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401)],
      brandAssetVersions: [brandVersion(201, 401, "2026-09-10T09:00:00.000Z")],
      reviews: [],
    });
    const db = database(fixture);
    const store = storage();

    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.reviewLabel).toBe("Unreviewed reference");
    expect(records[0]?.reviewState).toBe("unreviewed");
    // Only the latest-verdict read ran: no approved-first fallback query.
    expect(db.calls.filter((call) => call.table === "creative_asset_reviews")).toHaveLength(1);
  });

  it("fails the source on a version row linked to another parent", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401)],
      brandAssetVersions: [
        brandVersion(201, 402, "2026-09-10T09:00:00.000Z", { is_usable: true }),
      ],
      reviews: [],
    });
    const db = database(fixture, ["organization_brand_asset_versions"]);
    const store = storage();

    await expect(
      readHomeReferenceAssets({
        database: db.source as never,
        storage: store.source,
        ...baseInput,
      }),
    ).rejects.toThrow(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("degrades to ready metadata with a null image when reference signing fails", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401)],
      brandAssetVersions: [brandVersion(201, 401, "2026-09-10T09:00:00.000Z")],
      reviews: [brandReview(301, 201, "approved", "2026-09-10T10:00:00.000Z")],
    });
    const db = database(fixture);
    const store = storage(() => ({ data: null, error: { message: "signing down" } }));

    const records = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.image).toBeNull();
    expect(records[0]?.label).toBe("Reference 401");
    expect(JSON.stringify(records)).not.toContain("signing down");
  });
});

describe("gallery merge contract", () => {
  it("takes four across both sources by recordedAt DESC then composite id ASC with at most eight signatures", async () => {
    const fixture = seed({
      posterRenders: [
        posterRender(1, 101, "2026-09-11T09:00:00.000Z"),
        posterRender(2, 102, "2026-09-11T09:02:00.000Z"),
        posterRender(3, 103, "2026-09-11T09:04:00.000Z"),
        posterRender(4, 104, "2026-09-11T09:05:00.000Z"),
      ],
      campaigns: [
        campaignRow(101, "Harbour lunch rush"),
        campaignRow(102, "Weekend family feast"),
        campaignRow(103, "Late-night delivery"),
        campaignRow(104, "Festive sharing platter"),
      ],
      brandAssets: [
        brandAsset(401, { created_at: "2026-09-01T08:00:00.000Z" }),
        brandAsset(402, { created_at: "2026-09-01T08:01:00.000Z" }),
        brandAsset(403, { created_at: "2026-09-01T08:02:00.000Z" }),
        brandAsset(404, { created_at: "2026-09-01T08:03:00.000Z" }),
      ],
      brandAssetVersions: [
        brandVersion(201, 401, "2026-09-11T09:01:00.000Z"),
        brandVersion(202, 402, "2026-09-11T09:03:00.000Z"),
        // Ties with poster 4 below: the poster composite id sorts first.
        brandVersion(203, 403, "2026-09-11T09:05:00.000Z"),
        brandVersion(204, 404, "2026-09-11T08:00:00.000Z"),
      ],
      reviews: [
        brandReview(301, 201, "approved", "2026-09-11T09:30:00.000Z"),
        brandReview(302, 202, "approved", "2026-09-11T09:31:00.000Z"),
        brandReview(303, 203, "approved", "2026-09-11T09:32:00.000Z"),
        brandReview(304, 204, "approved", "2026-09-11T09:33:00.000Z"),
      ],
    });
    const db = database(fixture);
    // One shared storage spy across both readers: the bound is global.
    const store = storage();

    const posters = await readHomePosterAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });
    const references = await readHomeReferenceAssets({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });
    expect(posters).toHaveLength(4);
    expect(references).toHaveLength(4);

    const merged = mergeGallery(posters, references);
    expect(merged.map((record) => record.id)).toEqual([
      `poster:${uuid(4)}`,
      `reference:${uuid(203)}`,
      `poster:${uuid(3)}`,
      `reference:${uuid(202)}`,
    ]);

    // The signing bound both readers share: one batch per bucket, eight paths max.
    const buckets = store.from.mock.calls.map((call) => call[0]).sort();
    expect(buckets).toEqual(["brand-assets", "campaign-assets"]);
    const signedPaths = store.createSignedUrls.mock.calls.flatMap((call) => call[0] ?? []);
    expect(signedPaths).toHaveLength(8);
  });
});

describe("home logo reader", () => {
  it("returns null when no logo parent exists", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401, { asset_role: "product" })],
      brandAssetVersions: [brandVersion(201, 401, "2026-09-10T09:00:00.000Z")],
      reviews: [brandReview(301, 201, "approved", "2026-09-10T10:00:00.000Z")],
    });
    const db = database(fixture);
    const store = storage();

    const logo = await readHomeLogo({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(logo).toBeNull();
    expect(store.createSignedUrls).not.toHaveBeenCalled();
    expect(db.calls.some((call) => call.table === "brand_context")).toBe(false);
  });

  it("returns null when two active logos make the choice ambiguous", async () => {
    const fixture = seed({
      brandAssets: [
        brandAsset(401, { asset_role: "logo", label: "Primary logo" }),
        brandAsset(402, { asset_role: "logo", label: "Alternate logo" }),
      ],
      brandAssetVersions: [
        brandVersion(201, 401, "2026-09-10T09:00:00.000Z"),
        brandVersion(202, 402, "2026-09-10T09:01:00.000Z"),
      ],
      reviews: [
        brandReview(301, 201, "approved", "2026-09-10T10:00:00.000Z"),
        brandReview(302, 202, "approved", "2026-09-10T10:01:00.000Z"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    const logo = await readHomeLogo({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(logo).toBeNull();
    const logoCall = db.calls.find((call) => call.table === "organization_brand_assets");
    expect(logoCall?.limitValue).toBe(2);
    expect(logoCall?.filters).toContainEqual({ column: "asset_role", value: "logo" });
    expect(logoCall?.orders).toEqual([{ column: "id", ascending: true }]);
    // Ambiguity is not a setup error and signs nothing.
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });

  it("ignores archived logos when counting candidates", async () => {
    const fixture = seed({
      brandAssets: [
        brandAsset(401, {
          asset_role: "logo",
          label: "Retired logo",
          archived_at: "2026-09-11T10:00:00.000Z",
        }),
        brandAsset(402, { asset_role: "logo", label: "Current logo" }),
      ],
      brandAssetVersions: [brandVersion(202, 402, "2026-09-10T09:01:00.000Z")],
      reviews: [brandReview(302, 202, "approved", "2026-09-10T10:01:00.000Z")],
    });
    const db = database(fixture);
    const store = storage();

    const logo = await readHomeLogo({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(logo).not.toBeNull();
    expect(logo?.alt).toBe("Current logo");
  });

  it("returns the signed logo only for the current approved usable version", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401, { asset_role: "logo", label: "House mark" })],
      brandAssetVersions: [
        brandVersion(201, 401, "2026-09-09T09:00:00.000Z", { version: 1 }),
        brandVersion(202, 401, "2026-09-10T09:00:00.000Z", { version: 2 }),
      ],
      reviews: [
        brandReview(301, 201, "approved", "2026-09-09T10:00:00.000Z"),
        brandReview(302, 202, "approved", "2026-09-10T10:00:00.000Z"),
      ],
    });
    const db = database(fixture);
    const store = storage();

    const logo = await readHomeLogo({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(logo).toMatchObject({
      url: `https://signed.example/${ORGANIZATION_ID}/ref-202.png`,
      alt: "House mark",
      width: 800,
      height: 600,
      expiresAt: "2026-09-11T12:10:00.000Z",
    });
    expect(store.from).toHaveBeenCalledWith("brand-assets");
    expect(store.createSignedUrls.mock.calls[0]?.[0]).toEqual([
      `${ORGANIZATION_ID}/ref-202.png`,
    ]);
  });

  it("returns null for rejected or unreviewed current versions without signing", async () => {
    const rejectedFixture = seed({
      brandAssets: [brandAsset(401, { asset_role: "logo" })],
      brandAssetVersions: [brandVersion(201, 401, "2026-09-10T09:00:00.000Z")],
      reviews: [brandReview(301, 201, "rejected", "2026-09-10T10:00:00.000Z")],
    });
    const rejectedDb = database(rejectedFixture);
    const rejectedStore = storage();
    await expect(
      readHomeLogo({ database: rejectedDb.source as never, storage: rejectedStore.source, ...baseInput }),
    ).resolves.toBeNull();
    expect(rejectedStore.createSignedUrls).not.toHaveBeenCalled();

    const unreviewedFixture = seed({
      brandAssets: [brandAsset(401, { asset_role: "logo" })],
      brandAssetVersions: [brandVersion(201, 401, "2026-09-10T09:00:00.000Z")],
      reviews: [],
    });
    const unreviewedDb = database(unreviewedFixture);
    const unreviewedStore = storage();
    await expect(
      readHomeLogo({
        database: unreviewedDb.source as never,
        storage: unreviewedStore.source,
        ...baseInput,
      }),
    ).resolves.toBeNull();
    expect(unreviewedStore.createSignedUrls).not.toHaveBeenCalled();
  });

  it("returns null when signing fails, and never synthesizes a logo", async () => {
    const fixture = seed({
      brandAssets: [brandAsset(401, { asset_role: "logo", label: "House mark" })],
      brandAssetVersions: [brandVersion(201, 401, "2026-09-10T09:00:00.000Z")],
      reviews: [brandReview(301, 201, "approved", "2026-09-10T10:00:00.000Z")],
    });
    const db = database(fixture);
    const store = storage(() => ({ data: null, error: { message: "signing down" } }));

    const logo = await readHomeLogo({
      database: db.source as never,
      storage: store.source,
      ...baseInput,
    });

    expect(logo).toBeNull();
    expect(db.calls.some((call) => call.table === "brand_context")).toBe(false);
  });
});

describe("home asset reader input validation", () => {
  it("rejects a non-UUID organization for the poster and reference readers", async () => {
    const db = database(seed());
    const store = storage();

    await expect(
      readHomePosterAssets({
        database: db.source as never,
        storage: store.source,
        organizationId: "not-a-uuid",
        now: NOW,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      readHomeReferenceAssets({
        database: db.source as never,
        storage: store.source,
        organizationId: "not-a-uuid",
        now: NOW,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toThrow(DomainError);
    expect(store.createSignedUrls).not.toHaveBeenCalled();
  });
});
