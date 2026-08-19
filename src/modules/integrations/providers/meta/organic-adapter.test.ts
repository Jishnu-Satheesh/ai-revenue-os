import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The SDK, replaced by a recorder.
 *
 * The adapter is meant to drive Meta's own `IGUser` and `IGMedia` models, so
 * the test asserts which SDK edge it reached for and with what — not which URL
 * it built. Each model method records its call and resolves; the scripted
 * outcome comes from `guard`, which is where this platform's rules live.
 */
const recorded: { edge: string; params: Record<string, unknown> }[] = [];

vi.mock("facebook-nodejs-business-sdk", () => {
  class Recorder {
    constructor(public id: string) {}
    async createMedia(_fields: string[], params: Record<string, unknown>) {
      recorded.push({ edge: "media", params });
      return {};
    }
    async createMediaPublish(_fields: string[], params: Record<string, unknown>) {
      recorded.push({ edge: "media_publish", params });
      return {};
    }
    async get(fields: string[]) {
      recorded.push({ edge: "status", params: { fields } });
      return {};
    }
  }
  return { IGUser: Recorder, IGMedia: Recorder, FacebookAdsApi: class {} };
});

import { createMetaOrganicAdapter } from "@/modules/integrations/providers/meta/organic-adapter";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

function request(overrides: Record<string, unknown> = {}) {
  return {
    igUserId: "17841400000000000",
    imageUrl: "https://cdn.test/a.jpg",
    caption: "Weekend table",
    placement: "feed_image" as const,
    mimeType: "image/jpeg",
    ...overrides,
  };
}

const ok = (data: unknown) => ({ outcome: "succeeded" as const, data });
const failed = (code: string) => ({
  outcome: "failed" as const,
  status: 400,
  failureCode: code,
  retryable: false,
});
const unknown = { outcome: "unknown" as const, reason: "timeout" as const };

function adapter(
  handlers: { create?: unknown; status?: unknown[] | unknown; publish?: unknown },
  overrides: {
    request?: Record<string, unknown>;
    toolKey?: "meta.publish_image" | "meta.publish_story";
  } = {},
) {
  recorded.length = 0;
  const statuses = Array.isArray(handlers.status) ? [...handlers.status] : null;

  return createMetaOrganicAdapter(overrides.toolKey ?? "meta.publish_image", {
    client: {
      api: {} as never,
      guard: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
        await run();
        const edge = recorded.at(-1)?.edge;
        if (edge === "media") return handlers.create;
        if (edge === "media_publish") return handlers.publish;
        return statuses ? (statuses.shift() ?? handlers.status) : handlers.status;
      }),
    } as never,
    loadRequest: async () => request(overrides.request) as never,
    sleep: async () => {},
    now: () => new Date("2026-08-19T10:00:00.000Z"),
  });
}

function invoke(a: ReturnType<typeof adapter>) {
  return a.invoke({
    organizationId: ORG,
    actionRunId: RUN,
    idempotencyKey: "idem-abcdefgh",
    signal: new AbortController().signal,
  });
}

describe("the SDK's own models carry the calls", () => {
  it("creates the container through IGUser.createMedia", async () => {
    await invoke(
      adapter({
        create: ok({ id: "c1" }),
        status: ok({ status_code: "FINISHED" }),
        publish: ok({ id: "m1" }),
      }),
    );

    expect(recorded.map((call) => call.edge)).toEqual(["media", "status", "media_publish"]);
  });

  it("asks the container only for the field it needs", async () => {
    await invoke(adapter({ create: ok({ id: "c1" }), status: ok({ status_code: "ERROR" }) }));

    expect(recorded.find((call) => call.edge === "status")?.params).toEqual({
      fields: ["status_code"],
    });
  });

  it("publishes by creation id rather than by rebuilding a path", async () => {
    await invoke(
      adapter({
        create: ok({ id: "container-7" }),
        status: ok({ status_code: "FINISHED" }),
        publish: ok({ id: "m1" }),
      }),
    );

    expect(recorded.find((call) => call.edge === "media_publish")?.params).toEqual({
      creation_id: "container-7",
    });
  });
});

describe("publishing an image takes three calls, and each can fail differently", () => {
  it("creates a container, waits for it, then publishes", async () => {
    const result = await invoke(
      adapter({
        create: ok({ id: "container-1" }),
        status: ok({ status_code: "FINISHED" }),
        publish: ok({ id: "17841_media_9" }),
      }),
    );

    expect(result).toMatchObject({
      status: "succeeded",
      externalReference: "17841_media_9",
      providerStatus: "PUBLISHED",
    });
  });

  it("keeps polling while the container is still processing", async () => {
    const result = await invoke(
      adapter({
        create: ok({ id: "container-1" }),
        status: [ok({ status_code: "IN_PROGRESS" }), ok({ status_code: "FINISHED" })],
        publish: ok({ id: "media-9" }),
      }),
    );

    expect(result).toMatchObject({ status: "succeeded" });
  });

  it("records the container alongside the published id", async () => {
    const result = await invoke(
      adapter({
        create: ok({ id: "container-1" }),
        status: ok({ status_code: "FINISHED" }),
        publish: ok({ id: "media-9" }),
      }),
    );

    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.normalized).toMatchObject({ containerId: "container-1" });
  });
});

describe("provider constraints are enforced before anything is created", () => {
  it("refuses a non-JPEG image without creating a container", async () => {
    // Discovering this from a provider error would leave a container behind
    // for an image that can never publish.
    const result = await invoke(
      adapter({ create: ok({ id: "unused" }) }, { request: { mimeType: "image/png" } }),
    );

    expect(result).toEqual({ status: "failed", failureCode: "meta.image_must_be_jpeg" });
    expect(recorded).toEqual([]);
  });

  it("sends the stories media type for a story placement", async () => {
    await invoke(
      adapter(
        {
          create: ok({ id: "c1" }),
          status: ok({ status_code: "FINISHED" }),
          publish: ok({ id: "m1" }),
        },
        { request: { placement: "image_story" }, toolKey: "meta.publish_story" },
      ),
    );

    expect(recorded.find((call) => call.edge === "media")?.params).toMatchObject({
      media_type: "STORIES",
    });
  });
});

describe("ambiguity is reported with the container that can resolve it", () => {
  it("carries the container id when publishing times out", async () => {
    // The container's own status says whether the post went out, so this is
    // recoverable. Without the id it would be permanently unresolvable.
    const result = await invoke(
      adapter({
        create: ok({ id: "container-7" }),
        status: ok({ status_code: "FINISHED" }),
        publish: unknown,
      }),
    );

    expect(result).toEqual({ status: "unknown", failureCode: "meta.publish_unknown:container-7" });
  });

  it("is unknown with no container when the container itself may not exist", async () => {
    const result = await invoke(adapter({ create: unknown }));

    expect(result).toEqual({ status: "unknown", failureCode: "meta.container_create_unknown" });
  });

  it("reports success rather than republishing an already-published container", async () => {
    // Publishing again would duplicate the post.
    const result = await invoke(
      adapter({ create: ok({ id: "c9" }), status: ok({ status_code: "PUBLISHED" }) }),
    );

    expect(result).toMatchObject({ status: "succeeded", externalReference: "c9" });
    expect(recorded.some((call) => call.edge === "media_publish")).toBe(false);
  });

  it("hands a container still processing after the ceiling to reconciliation", async () => {
    const result = await invoke(
      adapter({ create: ok({ id: "c5" }), status: ok({ status_code: "IN_PROGRESS" }) }),
    );

    expect(result).toMatchObject({
      status: "unknown",
      failureCode: "meta.container_still_processing:c5",
    });
  });

  it("treats an unreadable status as unknown, never as a failure", async () => {
    // A status we could not read says nothing about whether the post exists.
    const result = await invoke(adapter({ create: ok({ id: "c3" }), status: failed("meta.500") }));

    expect(result).toMatchObject({ status: "unknown" });
  });
});

describe("a container that will never publish fails cleanly", () => {
  it("fails on a container error", async () => {
    const result = await invoke(
      adapter({ create: ok({ id: "c1" }), status: ok({ status_code: "ERROR" }) }),
    );

    expect(result).toEqual({ status: "failed", failureCode: "meta.container_error" });
  });

  it("fails on a container that expired unpublished", async () => {
    const result = await invoke(
      adapter({ create: ok({ id: "c1" }), status: ok({ status_code: "EXPIRED" }) }),
    );

    expect(result).toEqual({ status: "failed", failureCode: "meta.container_expired" });
  });

  it("fails cleanly when container creation is refused", async () => {
    const result = await invoke(adapter({ create: failed("meta.400.OAuthException.190") }));

    expect(result).toEqual({ status: "failed", failureCode: "meta.400.OAuthException.190" });
  });
});
