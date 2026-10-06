import { describe, expect, it } from "vitest";

import {
  fetchPublicHttp,
  normalizePublicCitationUrl,
  type PinnedPeerTransport,
  type PublicAddressResolver,
} from "@/modules/growth-intelligence/infrastructure/research/safe-public-http";

function resolver(
  records: Record<string, Array<{ address: string; family: 4 | 6 }>>,
): PublicAddressResolver {
  return {
    resolve(hostname) {
      return Promise.resolve(records[hostname] ?? []);
    },
  };
}

function transport(response: {
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
  connectedAddress?: string;
}): PinnedPeerTransport {
  return {
    request(request) {
      return Promise.resolve({
        status: response.status ?? 200,
        headers: response.headers ?? {},
        body: byteStream(response.body ?? new Uint8Array([1])),
        connectedAddress: response.connectedAddress ?? request.resolvedAddresses[0]!.address,
      });
    },
  };
}

async function* byteStream(body: Uint8Array): AsyncGenerator<Uint8Array> {
  yield body;
}

describe("fetchPublicHttp", () => {
  it.each([
    ["http://127.0.0.1/internal", "UNSAFE_HOST"],
    ["http://10.0.0.8/internal", "UNSAFE_HOST"],
    ["http://169.254.169.254/latest/meta-data", "UNSAFE_HOST"],
    ["http://[::1]/internal", "UNSAFE_HOST"],
    ["http://[fe80::1]/internal", "UNSAFE_HOST"],
    ["https://user:pass@example.com/private", "UNSAFE_URL"],
    ["ftp://example.com/file", "UNSAFE_URL"],
    ["https://example.com:8443/admin", "UNSAFE_PORT"],
  ])("rejects %s with the safe code %s", async (url, code) => {
    await expect(
      fetchPublicHttp({
        url,
        resolver: resolver({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
        transport: transport({}),
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects a public hostname resolving to a private address", async () => {
    await expect(
      fetchPublicHttp({
        url: "https://example.com/news",
        resolver: resolver({ "example.com": [{ address: "10.0.0.8", family: 4 }] }),
        transport: transport({}),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_ADDRESS" });
  });

  it("rejects a public hostname resolving to an IPv6 link-local address", async () => {
    await expect(
      fetchPublicHttp({
        url: "https://example.com/news",
        resolver: resolver({ "example.com": [{ address: "fe80::1", family: 6 }] }),
        transport: transport({}),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_ADDRESS" });
  });

  it("rejects an IPv4-compatible IPv6 loopback address", async () => {
    await expect(
      fetchPublicHttp({
        url: "https://example.com/news",
        resolver: resolver({ "example.com": [{ address: "::127.0.0.1", family: 6 }] }),
        transport: transport({}),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_ADDRESS" });
  });

  it("rejects DNS rebinding when the transport peer was not one of the resolved public addresses", async () => {
    await expect(
      fetchPublicHttp({
        url: "https://example.com/news",
        resolver: resolver({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
        transport: transport({ connectedAddress: "10.0.0.8" }),
      }),
    ).rejects.toMatchObject({ code: "PEER_MISMATCH" });
  });

  it("revalidates a redirect target and rejects an internal redirect", async () => {
    await expect(
      fetchPublicHttp({
        url: "https://example.com/start",
        resolver: resolver({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
        transport: transport({
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_HOST" });
  });

  it("refuses a body above the bounded byte ceiling", async () => {
    await expect(
      fetchPublicHttp({
        url: "https://example.com/news",
        maxResponseBytes: 1,
        resolver: resolver({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
        transport: transport({ body: new Uint8Array([1, 2]) }),
      }),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it("passes a hard byte ceiling and abort signal to the pinned transport", async () => {
    let request: Parameters<PinnedPeerTransport["request"]>[0] | null = null;
    const pinnedTransport: PinnedPeerTransport = {
      request(input) {
        request = input;
        return Promise.resolve({
          status: 200,
          headers: {},
          body: byteStream(new Uint8Array([1])),
          connectedAddress: input.resolvedAddresses[0]!.address,
        });
      },
    };

    await fetchPublicHttp({
      url: "https://example.com/news",
      maxResponseBytes: 123,
      timeoutMs: 456,
      resolver: resolver({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
      transport: pinnedTransport,
    });

    expect(request).toEqual(
      expect.objectContaining({
        maxResponseBytes: 123,
        timeoutMs: 456,
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("aborts a transport that does not settle before the request deadline", async () => {
    const stalledTransport: PinnedPeerTransport = {
      request() {
        return new Promise(() => undefined);
      },
    };

    await expect(
      fetchPublicHttp({
        url: "https://example.com/news",
        timeoutMs: 1,
        resolver: resolver({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
        transport: stalledTransport,
      }),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
  });
});

describe("normalizePublicCitationUrl", () => {
  it("canonicalizes a safe citation without fetching it", () => {
    expect(normalizePublicCitationUrl("HTTPS://Guide.Example:443/News#today")).toBe(
      "https://guide.example/News",
    );
    expect(normalizePublicCitationUrl("http://guide.example:80/plain")).toBe(
      "http://guide.example/plain",
    );
  });

  it.each([
    ["https://user:pass@example.com/private", "UNSAFE_URL"],
    ["ftp://example.com/file", "UNSAFE_URL"],
    ["https://example.com:8443/admin", "UNSAFE_PORT"],
    ["http://203.0.113.7/news", "UNSAFE_HOST"],
    ["http://[::1]/news", "UNSAFE_HOST"],
    ["not a url", "UNSAFE_URL"],
  ])("rejects %s with the safe code %s", (url, code) => {
    expect(() => normalizePublicCitationUrl(url)).toThrow(expect.objectContaining({ code }));
  });
});
