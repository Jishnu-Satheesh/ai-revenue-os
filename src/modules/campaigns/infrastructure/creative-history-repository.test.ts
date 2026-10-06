import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCreativeHistoryRepository,
  type CreativeHistoryPersistence,
} from "@/modules/campaigns/infrastructure/creative-history-repository";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "10000000-0000-4000-8000-0000000000ff";
const ITEM_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const FOLDER_ID = "40000000-0000-4000-8000-000000000001";
const REVIEW_ID = "60000000-0000-4000-8000-000000000001";
const REVIEWER_ID = "70000000-0000-4000-8000-000000000001";

const METADATA = {
  subjectTags: ["biryani"],
  occasionTags: ["eid"],
  channels: ["instagram"],
  formats: ["square"],
  markets: ["ae"],
  languages: ["en"],
  objectives: ["awareness"],
  styleTags: ["warm"],
};

type TableResult = { data: unknown; error: { code?: string; message?: string } | null };

const rpc = vi.fn();
let tables: Record<string, TableResult>;
let selectedColumns: Record<string, string>;
let filters: { table: string; column: string; value: unknown }[];

function folderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FOLDER_ID,
    organization_id: ORGANIZATION_ID,
    parent_folder_id: null,
    name: "Ramadan",
    default_metadata: {},
    archived_at: null,
    ...overrides,
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    organization_id: ORGANIZATION_ID,
    folder_id: null,
    label: "Eid family poster",
    creative_type: "poster",
    source_kind: "historical_upload",
    rights: { status: "owned" },
    confirmed_metadata: null,
    proposed_metadata: null,
    archived_at: null,
    created_at: "2026-09-10 09:00:00+00",
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    organization_id: ORGANIZATION_ID,
    creative_item_id: ITEM_ID,
    version: 1,
    storage_path: `${ORGANIZATION_ID}/creative-history/intent/source`,
    source_poster_render_id: null,
    content_hash: null,
    mime_type: null,
    byte_size: null,
    width_px: null,
    height_px: null,
    is_usable: false,
    finalized_at: null,
    created_at: "2026-09-10 09:00:00+00",
    ...overrides,
  };
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REVIEW_ID,
    organization_id: ORGANIZATION_ID,
    creative_item_version_id: VERSION_ID,
    verdict: "approved",
    reason_codes: [],
    note: null,
    reviewed_at: "2026-09-11 09:00:00+00",
    reviewed_by: REVIEWER_ID,
    ...overrides,
  };
}

function persistence(): CreativeHistoryPersistence {
  return {
    from(table) {
      const query = {
        select(columns: string) {
          selectedColumns[table] = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push({ table, column, value });
          return query;
        },
        async order() {
          return tables[table] ?? { data: [], error: null };
        },
      };
      return query;
    },
    rpc,
  };
}

function repository() {
  return createCreativeHistoryRepository(persistence());
}

beforeEach(() => {
  rpc.mockReset();
  selectedColumns = {};
  filters = [];
  tables = {
    creative_folders: { data: [folderRow()], error: null },
    creative_items: { data: [itemRow()], error: null },
    creative_item_versions: { data: [versionRow()], error: null },
    creative_item_reviews: { data: [], error: null },
    creative_review_reasons: { data: [], error: null },
  };
});

describe("reading the library", () => {
  it("scopes every read to the caller's organization", async () => {
    await repository().listItems({ organizationId: ORGANIZATION_ID, includeArchived: false });

    for (const table of ["creative_items", "creative_item_versions", "creative_item_reviews"]) {
      expect(filters).toContainEqual({
        table,
        column: "organization_id",
        value: ORGANIZATION_ID,
      });
    }
  });

  it("refuses to hand back a row belonging to another tenant, even if RLS let it through", async () => {
    tables.creative_items = {
      data: [itemRow({ organization_id: OTHER_ORGANIZATION_ID })],
      error: null,
    };

    await expect(
      repository().listItems({ organizationId: ORGANIZATION_ID, includeArchived: false }),
    ).rejects.toThrow(/could not be read/i);
  });

  it("fails loudly when a selected column disappears, rather than reading it as undefined", async () => {
    const withoutPath: Record<string, unknown> = { ...versionRow() };
    delete withoutPath.storage_path;
    tables.creative_item_versions = { data: [withoutPath], error: null };

    await expect(
      repository().listItems({ organizationId: ORGANIZATION_ID, includeArchived: false }),
    ).rejects.toThrow(/could not be read/i);
  });

  it("normalizes stored timestamps to UTC", async () => {
    const [item] = await repository().listItems({
      organizationId: ORGANIZATION_ID,
      includeArchived: false,
    });

    expect(item.createdAt).toBe("2026-09-10T09:00:00.000Z");
  });

  it("hides archived designs unless they are asked for", async () => {
    tables.creative_items = {
      data: [itemRow(), itemRow({ id: "20000000-0000-4000-8000-000000000009", archived_at: "2026-09-12 00:00:00+00" })],
      error: null,
    };

    const hidden = await repository().listItems({
      organizationId: ORGANIZATION_ID,
      includeArchived: false,
    });
    const shown = await repository().listItems({
      organizationId: ORGANIZATION_ID,
      includeArchived: true,
    });

    expect(hidden).toHaveLength(1);
    expect(shown).toHaveLength(2);
  });

  it("attaches each verdict to the version it was recorded against", async () => {
    tables.creative_item_reviews = { data: [reviewRow()], error: null };

    const [item] = await repository().listItems({
      organizationId: ORGANIZATION_ID,
      includeArchived: false,
    });

    expect(item.reviews).toEqual([
      expect.objectContaining({ versionId: VERSION_ID, verdict: "approved" }),
    ]);
  });

  it("treats an empty metadata object as nothing described yet", async () => {
    const [folder] = await repository().listFolders(ORGANIZATION_ID);
    expect(folder.defaultMetadata).toBeNull();
  });

  it("parses real metadata through the domain schema", async () => {
    tables.creative_folders = { data: [folderRow({ default_metadata: METADATA })], error: null };

    const [folder] = await repository().listFolders(ORGANIZATION_ID);
    expect(folder.defaultMetadata).toEqual(METADATA);
  });

  it("raises rather than silently calling drifted metadata 'none'", async () => {
    tables.creative_items = {
      data: [itemRow({ confirmed_metadata: { subject_tags: ["biryani"] } })],
      error: null,
    };

    await expect(
      repository().listItems({ organizationId: ORGANIZATION_ID, includeArchived: false }),
    ).rejects.toThrow(/could not be read/i);
  });

  it("returns nothing for a design this tenant cannot see, rather than refusing", async () => {
    tables.creative_items = { data: [], error: null };

    await expect(
      repository().readItem({ organizationId: ORGANIZATION_ID, itemId: ITEM_ID }),
    ).resolves.toBeNull();
  });
});

describe("writing through governed functions", () => {
  it("creates a folder through the RPC and echoes the tenant it was told", async () => {
    rpc.mockResolvedValue({ data: { folder_id: FOLDER_ID }, error: null });

    const result = await repository().createFolder({
      organizationId: ORGANIZATION_ID,
      name: "Ramadan",
      parentFolderId: null,
      defaultMetadata: null,
    });

    expect(result).toEqual({ folderId: FOLDER_ID });
    expect(rpc).toHaveBeenCalledWith("create_creative_folder", {
      target_organization_id: ORGANIZATION_ID,
      input_folder: {
        organization_id: ORGANIZATION_ID,
        name: "Ramadan",
        parent_folder_id: null,
        default_metadata: {},
      },
    });
  });

  it("reserves the next version through the RPC, never by inserting a row", async () => {
    rpc.mockResolvedValue({
      data: {
        item_id: ITEM_ID,
        version_id: VERSION_ID,
        version: 2,
        storage_path: `${ORGANIZATION_ID}/creative-history/intent/source`,
      },
      error: null,
    });

    const result = await repository().reserveVersion({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      storagePath: `${ORGANIZATION_ID}/creative-history/intent/source`,
    });

    expect(result.version).toBe(2);
    expect(rpc.mock.calls[0][0]).toBe("reserve_creative_item_version");
  });

  it("sends only the measurements it read out of the stored bytes when finalizing", async () => {
    rpc.mockResolvedValue({ data: { version_id: VERSION_ID }, error: null });

    await repository().finalizeVersion({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      contentHash: "a".repeat(64),
      mimeType: "image/png",
      byteSize: 1_000,
      widthPx: 800,
      heightPx: 800,
    });

    expect(rpc).toHaveBeenCalledWith("finalize_creative_item_version", {
      target_organization_id: ORGANIZATION_ID,
      input_version: {
        organization_id: ORGANIZATION_ID,
        version_id: VERSION_ID,
        content_hash: "a".repeat(64),
        mime_type: "image/png",
        byte_size: 1_000,
        width_px: 800,
        height_px: 800,
      },
    });
  });

  it("leaves the proposal alone when only the confirmed answer changes", async () => {
    rpc.mockResolvedValue({
      data: { item_id: ITEM_ID, metadata_confirmed: true, updated_at: "2026-09-12 09:00:00+00" },
      error: null,
    });

    await repository().writeMetadata({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      confirmedMetadata: METADATA,
    });

    const payload = rpc.mock.calls[0][1].input_metadata as Record<string, unknown>;
    expect(payload).toHaveProperty("confirmed_metadata");
    expect(payload).not.toHaveProperty("proposed_metadata");
  });

  it("turns a permission refusal into an authorization error, not a crash", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "creative_item_version_reserve_forbidden" },
    });

    await expect(
      repository().reserveVersion({
        organizationId: ORGANIZATION_ID,
        itemId: ITEM_ID,
        storagePath: `${ORGANIZATION_ID}/creative-history/intent/source`,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("reports an archived or missing design as unavailable rather than as forbidden", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "creative_item_not_found_or_archived" },
    });

    await expect(
      repository().archiveItem({ organizationId: ORGANIZATION_ID, itemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("explains a rejected review reason the registry does not know", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23503", message: "creative_item_review_reason_not_found" },
    });

    await expect(
      repository().recordReview({
        organizationId: ORGANIZATION_ID,
        versionId: VERSION_ID,
        verdict: "rejected",
        reasonCodes: ["invented"],
        note: null,
      }),
    ).rejects.toThrow(/governed rejection reason/i);
  });

  it("refuses an RPC answer that does not have the shape it promised", async () => {
    rpc.mockResolvedValue({ data: { folder_id: "not-a-uuid" }, error: null });

    await expect(
      repository().createFolder({
        organizationId: ORGANIZATION_ID,
        name: "Ramadan",
        parentFolderId: null,
        defaultMetadata: null,
      }),
    ).rejects.toThrow(/could not be read or changed/i);
  });
});
