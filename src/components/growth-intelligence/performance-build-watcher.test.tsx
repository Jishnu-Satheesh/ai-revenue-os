// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { PerformanceBuildWatcher } from "@/components/growth-intelligence/performance-build-watcher";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

afterEach(() => {
  cleanup();
  refresh.mockClear();
  vi.unstubAllGlobals();
});

function state(value: string) {
  return { ok: true, json: async () => ({ state: value }) } as Response;
}

function watch() {
  render(
    <PerformanceBuildWatcher
      organizationId={ORGANIZATION}
      from="2026-01-01"
      to="2026-03-31"
      channelIds={["ch-1"]}
      pollMs={10}
    />,
  );
}

describe("PerformanceBuildWatcher", () => {
  it("refreshes onto the card once every channel has something to read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(state("ready")));

    watch();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("refreshes onto the honest note when nothing is left to wait for", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(state("failed")));

    watch();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps watching through a dropped poll instead of refreshing early", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("dropped"))
      .mockResolvedValue(state("building"));
    vi.stubGlobal("fetch", fetchMock);

    watch();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(refresh).not.toHaveBeenCalled();
  });
});
