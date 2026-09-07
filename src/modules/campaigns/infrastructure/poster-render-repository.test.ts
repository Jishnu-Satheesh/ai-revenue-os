import { describe, expect, it } from "vitest";

import { createPosterRenderStore } from "@/modules/campaigns/infrastructure/poster-render-repository";
import type { PosterRenderRecord } from "@/workflows/campaigns/render-poster";

const ORGANIZATION_ID = "3f1d5e2a-0000-4000-8000-000000000001";

function record(overrides: Partial<PosterRenderRecord> = {}): PosterRenderRecord {
  return {
    organizationId: ORGANIZATION_ID,
    campaignId: "3f1d5e2a-0000-4000-8000-000000000002",
    bundleVersionId: "3f1d5e2a-0000-4000-8000-000000000003",
    plateAssetId: "3f1d5e2a-0000-4000-8000-000000000004",
    plateGenerationRunId: null,
    templateKey: "worker_probe",
    templateVersion: 1,
    script: "Latn",
    textValues: { caption: "Kerala fish curry" },
    fontManifest: { digest: "a".repeat(64) },
    renderDigest: "b".repeat(64),
    state: "rendered",
    refusalCode: null,
    refusalDetail: null,
    outputStoragePath: "org/campaign/version/posters/b.png",
    outputContentHash: "c".repeat(64),
    outputMimeType: "image/png",
    outputWidthPx: 600,
    outputHeightPx: 400,
    ...overrides,
  };
}

function persistence(result: { data: unknown; error: { message?: string } | null }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      async rpc(name: "record_campaign_poster_render", args: Record<string, unknown>) {
        calls.push({ name, args });
        return result;
      },
    },
  };
}

describe("createPosterRenderStore", () => {
  it("sends the render under the organization the RPC checks", async () => {
    const { client, calls } = persistence({
      data: {
        render_id: "3f1d5e2a-0000-4000-8000-00000000000a",
        state: "rendered",
        replayed: false,
      },
      error: null,
    });

    await createPosterRenderStore(client).record(record());

    expect(calls[0].name).toBe("record_campaign_poster_render");
    expect(calls[0].args.target_organization_id).toBe(ORGANIZATION_ID);
    const input = calls[0].args.input_render as Record<string, unknown>;
    // The RPC compares this against the argument before doing anything else.
    expect(input.organization_id).toBe(ORGANIZATION_ID);
    expect(input.template_key).toBe("worker_probe");
    expect(input.output_content_hash).toBe("c".repeat(64));
  });

  it("reports a replay so the worker does not count it as new work", async () => {
    const { client } = persistence({
      data: {
        render_id: "3f1d5e2a-0000-4000-8000-00000000000a",
        state: "rendered",
        replayed: true,
      },
      error: null,
    });

    const stored = await createPosterRenderStore(client).record(record());

    expect(stored).toEqual({
      renderId: "3f1d5e2a-0000-4000-8000-00000000000a",
      state: "rendered",
      replayed: true,
    });
  });

  it("omits the output fields a refusal must not carry", async () => {
    const { client, calls } = persistence({
      data: {
        render_id: "3f1d5e2a-0000-4000-8000-00000000000a",
        state: "refused",
        replayed: false,
      },
      error: null,
    });

    await createPosterRenderStore(client).record(
      record({
        state: "refused",
        refusalCode: "glyph_not_covered",
        refusalDetail: { script: "Mlym" },
        outputStoragePath: null,
        outputContentHash: null,
        outputMimeType: null,
        outputWidthPx: null,
        outputHeightPx: null,
      }),
    );

    const input = calls[0].args.input_render as Record<string, unknown>;
    expect(input.refusal_code).toBe("glyph_not_covered");
    expect(input.output_storage_path).toBeNull();
    expect(input.output_content_hash).toBeNull();
  });

  /**
   * A JSON null is not an SQL null, and the difference is load-bearing here.
   *
   * The RPC reads `refusal_detail` with `->` rather than `->>`, so an explicit
   * `null` in the payload arrives as JSONB `null` -- a real value whose
   * `jsonb_typeof` is `'null'`. The column allows SQL NULL or an object and
   * refuses that, so every successful render was rejected at the last step with
   * a constraint violation the worker could only report as "could not be
   * recorded". The key has to be absent, not null.
   */
  it("omits refusal detail entirely rather than sending a JSON null", async () => {
    const { client, calls } = persistence({
      data: {
        render_id: "3f1d5e2a-0000-4000-8000-00000000000a",
        state: "rendered",
        replayed: false,
      },
      error: null,
    });

    await createPosterRenderStore(client).record(record());

    const input = calls[0].args.input_render as Record<string, unknown>;
    expect(Object.hasOwn(input, "refusal_detail")).toBe(false);
  });

  it("still sends refusal detail when there is one to send", async () => {
    const { client, calls } = persistence({
      data: {
        render_id: "3f1d5e2a-0000-4000-8000-00000000000a",
        state: "refused",
        replayed: false,
      },
      error: null,
    });

    await createPosterRenderStore(client).record(
      record({
        state: "refused",
        refusalCode: "glyph_not_covered",
        refusalDetail: { script: "Mlym" },
        outputStoragePath: null,
        outputContentHash: null,
        outputMimeType: null,
        outputWidthPx: null,
        outputHeightPx: null,
      }),
    );

    const input = calls[0].args.input_render as Record<string, unknown>;
    expect(input.refusal_detail).toEqual({ script: "Mlym" });
  });

  /**
   * A lost render is better than a render the table describes wrongly. The
   * digest is deterministic, so the same request can simply be made again.
   */
  it("throws rather than inventing a result when the database refuses", async () => {
    const { client } = persistence({
      data: null,
      error: { message: "campaign_poster_render_conflict" },
    });

    await expect(createPosterRenderStore(client).record(record())).rejects.toThrow();
  });

  it("throws when the database returns a shape it does not recognise", async () => {
    const { client } = persistence({ data: { unexpected: true }, error: null });

    await expect(createPosterRenderStore(client).record(record())).rejects.toThrow();
  });
});
