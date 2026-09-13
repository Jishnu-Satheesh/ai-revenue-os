// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/organizations/org-1/assets",
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  storageUpload: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: mocks.replace, refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// `uploadCreativeBytes` talks to Supabase Storage directly through the
// browser client, never through this app's own API — so the transfer step
// of a truthfulness test has to mock this module rather than `fetch`.
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: mocks.storageUpload }) },
  }),
}));

import { AssetWorkspace } from "@/components/assets/asset-workspace";
import type { LibraryReference } from "@/components/assets/asset-library-grid";
import type { SubjectRow } from "@/components/assets/subject-list";

beforeEach(() => {
  mocks.storageUpload.mockReset();
  mocks.storageUpload.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  mocks.searchParams = new URLSearchParams();
  mocks.replace.mockClear();
});

function mockEmptyCreativeHistory() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/assets/creative-history/folders")) {
      return new Response(JSON.stringify({ folders: [] }), { status: 200 });
    }
    if (url.includes("/assets/creative-history/items")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.includes("/assets/creative-history/intake")) {
      return new Response(
        JSON.stringify({
          intake: {
            bucket: "creative-assets",
            allowedMimeTypes: ["image/png"],
            maxBytes: 1000,
            minWidthPx: 1,
            minHeightPx: 1,
            maxWidthPx: 1,
            maxHeightPx: 1,
            clientValidationIsAdvisory: true,
          },
          reviewReasons: [],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

const RESERVATION_ITEM_ID = "77777777-7777-4777-8777-777777777777";
const RESERVATION_VERSION_ID = "88888888-8888-4888-8888-888888888888";

/**
 * Same reads as `mockEmptyCreativeHistory`, plus the reserve step of a real
 * upload (`POST .../items`) and a caller-supplied finalize step
 * (`POST .../complete`), so a test can drive the actual reserve → transfer →
 * finalize sequence `CreativeHistoryUploadDialog.run` runs, not just the
 * generic `AssetUpload` mechanics `asset-upload.test.tsx` already covers.
 */
function mockCreativeHistoryUploadFlow(
  completeHandler: () => Response | Promise<Response>,
) {
  let completeCalls = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/assets/creative-history/folders")) {
      return new Response(JSON.stringify({ folders: [] }), { status: 200 });
    }
    if (url.endsWith("/assets/creative-history/items") && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          itemId: RESERVATION_ITEM_ID,
          versionId: RESERVATION_VERSION_ID,
          version: 1,
          clientUploadId: "client-upload-1",
          uploadIntentId: "intent-1",
          bucket: "creative-assets",
          storagePath: `org-1/${RESERVATION_ITEM_ID}/v1`,
          intake: {
            bucket: "creative-assets",
            allowedMimeTypes: ["image/png"],
            maxBytes: 1000,
            minWidthPx: 1,
            minHeightPx: 1,
            maxWidthPx: 10000,
            maxHeightPx: 10000,
            clientValidationIsAdvisory: true,
          },
        }),
        { status: 201 },
      );
    }
    if (url.includes("/complete")) {
      completeCalls += 1;
      return completeHandler();
    }
    if (url.includes("/assets/creative-history/items")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.includes("/assets/creative-history/intake")) {
      return new Response(
        JSON.stringify({
          intake: {
            bucket: "creative-assets",
            allowedMimeTypes: ["image/png"],
            maxBytes: 1000,
            minWidthPx: 1,
            minHeightPx: 1,
            maxWidthPx: 10000,
            maxHeightPx: 10000,
            clientValidationIsAdvisory: true,
          },
          reviewReasons: [],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  return { fetchSpy, completeCallCount: () => completeCalls };
}

function uploadFile(): File {
  return new File([new Uint8Array(10)], "poster.png", { type: "image/png" });
}

function chooseUploadFile() {
  const dropzone = screen.getByRole("button", { name: /choose files or drop them here/i });
  const input = dropzone.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [uploadFile()] } });
}

function renderWorkspace(overrides: {
  canManageAssets?: boolean;
  canReviewAssets?: boolean;
  references?: readonly LibraryReference[];
  subjects?: readonly SubjectRow[];
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetWorkspace
        organizationId="org-1"
        timeZone="Asia/Dubai"
        references={overrides.references ?? []}
        subjects={overrides.subjects ?? []}
        canConfirmSubjects={false}
        canManageSubjects={overrides.canManageAssets ?? false}
        canManageAssets={overrides.canManageAssets ?? false}
        canReviewAssets={overrides.canReviewAssets ?? false}
      />
    </QueryClientProvider>,
  );
}

describe("the three purpose tabs replace References / Campaign output / Dishes", () => {
  it("shows exactly Creative History, Products & Subjects, and Brand Kit", () => {
    mockEmptyCreativeHistory();
    renderWorkspace();

    expect(screen.getByRole("tab", { name: "Creative History" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /products & subjects/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Brand Kit" })).toBeTruthy();
    expect(screen.queryByText("Dishes")).toBeNull();
    expect(screen.queryByText("Campaign output")).toBeNull();
  });
});

describe("viewer role: upload is absent, not merely disabled", () => {
  it("renders no Upload assets control for a role without asset.manage", () => {
    mockEmptyCreativeHistory();
    renderWorkspace({ canManageAssets: false });

    expect(screen.queryByRole("button", { name: /upload assets/i })).toBeNull();
  });

  it("offers Upload assets to a role with asset.manage, and it opens the real upload dialog", async () => {
    mockEmptyCreativeHistory();
    renderWorkspace({ canManageAssets: true });

    fireEvent.click(screen.getByRole("button", { name: /upload assets/i }));

    expect(await screen.findByRole("heading", { name: /upload designs/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /choose files or drop them here/i })).toBeTruthy();
  });
});

describe("shareable URL state", () => {
  it("opens on the tab named in the URL", () => {
    mocks.searchParams = new URLSearchParams("tab=brand");
    mockEmptyCreativeHistory();
    renderWorkspace();

    const brandTab = screen.getByRole("tab", { name: "Brand Kit" });
    expect(brandTab.getAttribute("aria-selected")).toBe("true");
  });

  it("writes a search term into the URL rather than only local state", () => {
    mockEmptyCreativeHistory();
    renderWorkspace();

    fireEvent.change(screen.getByLabelText(/search designs/i), { target: { value: "combo" } });

    expect(mocks.replace).toHaveBeenCalledWith(expect.stringContaining("search=combo"), expect.anything());
  });
});

describe("empty Creative History", () => {
  it("names the empty state and offers Upload for a manager", async () => {
    mockEmptyCreativeHistory();
    renderWorkspace({ canManageAssets: true });

    expect(await screen.findByText("No designs yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /upload designs/i })).toBeTruthy();
  });
});

describe("Products & Subjects", () => {
  it("offers Add subject to a role holding subject.manage", () => {
    // Landed on directly via the shareable URL, rather than clicking the tab
    // trigger interactively — the mocked router below does not feed back into
    // a reactive `useSearchParams`, so an interactive tab switch would not
    // actually change which panel is controlled-active in this harness.
    mocks.searchParams = new URLSearchParams("tab=products");
    mockEmptyCreativeHistory();
    renderWorkspace({ canManageAssets: true });

    expect(screen.getByRole("button", { name: /add subject/i })).toBeTruthy();
  });
});

/**
 * The real reserve → transfer → finalize sequence `CreativeHistoryUploadDialog.run`
 * runs, exercised through the mounted dialog rather than by calling `run`
 * directly (it is not exported — the workspace is the real integration
 * point). Each case here is one of the failure modes Task 3's brief names
 * explicitly: a refused finalize outcome, a lost response, an expired
 * upload URL, and a retry that must not re-reserve. None may ever render
 * "Uploaded" for these inputs.
 */
describe("Creative History upload: bytes transferred is not the same as usable", () => {
  it("renders the real refusal reason from finalize, never a false success", async () => {
    mockCreativeHistoryUploadFlow(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "refused",
            itemId: RESERVATION_ITEM_ID,
            versionId: RESERVATION_VERSION_ID,
            reason: "corrupt_image",
            message: "That file could not be read as an image.",
          }),
          { status: 422 },
        ),
      ),
    );
    renderWorkspace({ canManageAssets: true });

    fireEvent.click(screen.getByRole("button", { name: /upload assets/i }));
    await screen.findByRole("heading", { name: /upload designs/i });
    chooseUploadFile();
    fireEvent.click(screen.getByRole("button", { name: /^upload designs$/i }));

    // `creativeHistoryRefusalLabel` renders the canned, reason-coded copy
    // for a known reason rather than echoing the server's raw message —
    // still a real refusal, never a false success.
    await waitFor(() =>
      expect(screen.getByText(/image could not be read/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/^uploaded/i)).toBeNull();
    expect(mocks.storageUpload).toHaveBeenCalledTimes(1);
  });

  it("renders a refusal, not success, when the finalize response is lost to a network error", async () => {
    mockCreativeHistoryUploadFlow(() => Promise.reject(new TypeError("Failed to fetch")));
    renderWorkspace({ canManageAssets: true });

    fireEvent.click(screen.getByRole("button", { name: /upload assets/i }));
    await screen.findByRole("heading", { name: /upload designs/i });
    chooseUploadFile();
    fireEvent.click(screen.getByRole("button", { name: /^upload designs$/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/^uploaded/i)).toBeNull();
  });

  it("never calls finalize, and shows a plain transfer refusal rather than a raw storage error, when the upload URL has expired", async () => {
    // Supabase Storage's own error text is a raw, sometimes Postgres-shaped
    // message (this exact string was seen live against staging for a
    // different transfer failure — an RLS refusal on retry, fixed by the
    // `20260913110000` migration). `uploadCreativeBytes` deliberately never
    // echoes it to the user; this expired-signature case is stood in for by
    // the same raw-message shape to prove that generic wording holds
    // regardless of which internal reason Storage gives.
    mocks.storageUpload.mockResolvedValue({
      error: { message: "The signature is invalid or has expired" },
    });
    const { completeCallCount } = mockCreativeHistoryUploadFlow(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "usable" }), { status: 201 })),
    );
    renderWorkspace({ canManageAssets: true });

    fireEvent.click(screen.getByRole("button", { name: /upload assets/i }));
    await screen.findByRole("heading", { name: /upload designs/i });
    chooseUploadFile();
    fireEvent.click(screen.getByRole("button", { name: /^upload designs$/i }));

    await waitFor(() => expect(screen.getByText(/could not be sent/i)).toBeTruthy());
    expect(screen.queryByText(/signature is invalid/i)).toBeNull();
    expect(completeCallCount()).toBe(0);
  });

  it("retries a lost response by reusing the same reservation, never reserving twice", async () => {
    let attempt = 0;
    const { fetchSpy } = mockCreativeHistoryUploadFlow(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "usable",
            itemId: RESERVATION_ITEM_ID,
            versionId: RESERVATION_VERSION_ID,
            replayed: false,
            contentHash: "hash",
            mimeType: "image/png",
            byteSize: 10,
            widthPx: 100,
            heightPx: 100,
            uploadState: "needs_review",
          }),
          { status: 201 },
        ),
      );
    });
    renderWorkspace({ canManageAssets: true });

    fireEvent.click(screen.getByRole("button", { name: /upload assets/i }));
    await screen.findByRole("heading", { name: /upload designs/i });
    chooseUploadFile();
    fireEvent.click(screen.getByRole("button", { name: /^upload designs$/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /retry failed/i }));
    await waitFor(() => expect(screen.getByText(/needs review/i)).toBeTruthy());

    const reserveCalls = fetchSpy.mock.calls.filter(([input, init]) => {
      const url = String(input);
      return url.endsWith("/assets/creative-history/items") && (init as RequestInit | undefined)?.method === "POST";
    });
    expect(reserveCalls).toHaveLength(1);
    expect(mocks.storageUpload).toHaveBeenCalledTimes(2);
  });
});
