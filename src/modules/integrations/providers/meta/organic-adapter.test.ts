import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

/** Drives the three calls by the path they use. */
function client(handlers: { create?: unknown; status?: unknown[] | unknown; publish?: unknown }) {
  const statuses = Array.isArray(handlers.status) ? [...handlers.status] : null;
  return {
    request: vi.fn(async (arg: unknown) => {
      const { path, method } = arg as { path: string[]; method: string };
      if (method === "POST" && path[1] === "media") return handlers.create;
      if (method === "POST" && path[1] === "media_publish") return handlers.publish;
      if (statuses) return statuses.shift() ?? handlers.status;
      return handlers.status;
    }),
  };
}

function adapter(
  handlers: Parameters<typeof client>[0],
  overrides: { request?: Record<string, unknown> } = {},
) {
  return createMetaOrganicAdapter("meta.publish_image", {
    client: client(handlers) as never,
    loadRequest: async () => request(overrides.request) as never,
    sleep: async () => {},
    now: () => new Date("2026-08-19T10:00:00.000Z"),
  });
}

const ok = (data: unknown) => ({ outcome: "succeeded" as const, data });
const failed = (code: string) => ({
  outcome: "failed" as const,
  status: 400,
  failureCode: code,
  retryable: false,
});
const unknown = { outcome: "unknown" as const, reason: "timeout" as const };

function invoke(a: ReturnType<typeof adapter>) {
  return a.invoke({
    organizationId: ORG,
    actionRunId: RUN,
    idempotencyKey: "idem-abcdefgh",
    signal: new AbortController().signal,
  });
}

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
    const a = adapter({ create: ok({ id: "unused" }) }, { request: { mimeType: "image/png" } });
    const result = await invoke(a);

    expect(result).toEqual({ status: "failed", failureCode: "meta.image_must_be_jpeg" });
  });

  it("sends the stories media type for a story placement", async () => {
    const spy = client({
      create: ok({ id: "c1" }),
      status: ok({ status_code: "FINISHED" }),
      publish: ok({ id: "m1" }),
    });
    const a = createMetaOrganicAdapter("meta.publish_story", {
      client: spy as never,
      loadRequest: async () => request({ placement: "image_story" }) as never,
      sleep: async () => {},
    });
    await invoke(a);

    const createCall = spy.request.mock.calls.find(
      ([arg]) => (arg as { path: string[] }).path[1] === "media",
    );
    expect((createCall?.[0] as { params: Record<string, unknown> }).params).toMatchObject({
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

    expect(result).toEqual({
      status: "unknown",
      failureCode: "meta.publish_unknown:container-7",
    });
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
