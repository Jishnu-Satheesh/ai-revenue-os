// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  getOrganization: vi.fn(),
  listReferences: vi.fn(),
  listSubjects: vi.fn(),
  signBrandAssetPreviews: vi.fn(),
  lastWorkspaceProps: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));

vi.mock("@/domain/organizations/repository", () => ({
  getOrganization: mocks.getOrganization,
}));

vi.mock("@/components/layout/route-context", () => ({ RegisterRouteLabel: () => null }));

vi.mock("@/modules/campaigns/application/asset-library-service", () => ({
  createAssetLibraryService: () => ({
    list: (...args: unknown[]) => mocks.listReferences(...args),
  }),
}));

vi.mock("@/modules/campaigns/infrastructure/asset-library-repository", () => ({
  createAssetLibraryRepository: () => ({}),
  signBrandAssetPreviews: (...args: unknown[]) => mocks.signBrandAssetPreviews(...args),
}));

vi.mock("@/modules/campaigns/infrastructure/subject-repository", () => ({
  createSubjectRepository: () => ({
    list: (...args: unknown[]) => mocks.listSubjects(...args),
  }),
}));

vi.mock("@/components/assets/asset-workspace", () => ({
  AssetWorkspace: (props: Record<string, unknown>) => {
    mocks.lastWorkspaceProps = props;
    return <div data-testid="asset-workspace" />;
  },
}));

import AssetsPage from "@/app/(platform)/organizations/[organizationId]/assets/page";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";

function pageProps() {
  return { params: Promise.resolve({ organizationId: ORGANIZATION }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lastWorkspaceProps = null;
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: {},
  });
  mocks.getOrganization.mockResolvedValue({
    id: ORGANIZATION,
    name: "Al Noor Kitchen",
    default_timezone: "Asia/Dubai",
  });
  mocks.listReferences.mockResolvedValue([]);
  mocks.listSubjects.mockResolvedValue([]);
  mocks.signBrandAssetPreviews.mockResolvedValue({});
});

afterEach(() => cleanup());

describe("AssetsPage", () => {
  it("mounts AssetWorkspace with this member's exact permissions", async () => {
    const page = await AssetsPage(pageProps());
    render(page);

    expect(screen.getByTestId("asset-workspace")).toBeTruthy();
    expect(mocks.lastWorkspaceProps).toMatchObject({
      organizationId: ORGANIZATION,
      timeZone: "Asia/Dubai",
      canManageAssets: true,
      canReviewAssets: true,
      canManageSubjects: true,
      canConfirmSubjects: false,
    });
  });

  it("gives a viewer read-only booleans, never a control the API would refuse", async () => {
    mocks.getOrganizationContext.mockResolvedValueOnce({
      organizationId: ORGANIZATION,
      user: { id: "user-2" },
      membership: { role: "viewer" },
      supabase: {},
    });

    const page = await AssetsPage(pageProps());
    render(page);

    expect(mocks.lastWorkspaceProps).toMatchObject({
      canManageAssets: false,
      canReviewAssets: false,
      canManageSubjects: false,
      canConfirmSubjects: false,
    });
  });

  it("signs a real preview for every reference instead of the old hard-coded null", async () => {
    mocks.listReferences.mockResolvedValueOnce([
      {
        brandAssetId: "asset-1",
        brandAssetVersionId: "version-1",
        label: "Kingfish curry",
        assetRole: "product",
        conditioningRoles: ["subject"],
        tags: [],
        scripts: [],
        ownership: "owned",
        archivedAt: null,
        version: 1,
        storagePath: "org/asset-1/version-1/source.jpg",
        currentVerdict: null,
        currentReasonCodes: [],
        currentReviewedAt: null,
      },
    ]);
    mocks.signBrandAssetPreviews.mockResolvedValueOnce({
      "org/asset-1/version-1/source.jpg": "https://signed.example/preview.jpg",
    });

    const page = await AssetsPage(pageProps());
    render(page);

    expect(mocks.signBrandAssetPreviews).toHaveBeenCalledWith(
      {},
      ["org/asset-1/version-1/source.jpg"],
      { organizationId: ORGANIZATION },
    );
    const references = mocks.lastWorkspaceProps?.references as Array<{ previewUrl: string | null }>;
    expect(references[0].previewUrl).toBe("https://signed.example/preview.jpg");
  });

  it("degrades a preview that failed to sign to null rather than a broken path", async () => {
    mocks.listReferences.mockResolvedValueOnce([
      {
        brandAssetId: "asset-1",
        brandAssetVersionId: "version-1",
        label: "Kingfish curry",
        assetRole: "product",
        conditioningRoles: ["subject"],
        tags: [],
        scripts: [],
        ownership: "owned",
        archivedAt: null,
        version: 1,
        storagePath: "org/asset-1/version-1/source.jpg",
        currentVerdict: null,
        currentReasonCodes: [],
        currentReviewedAt: null,
      },
    ]);
    mocks.signBrandAssetPreviews.mockResolvedValueOnce({});

    const page = await AssetsPage(pageProps());
    render(page);

    const references = mocks.lastWorkspaceProps?.references as Array<{ previewUrl: string | null }>;
    expect(references[0].previewUrl).toBeNull();
  });

  it("does not read Campaign output on this page any more — Creative History replaces it", async () => {
    const page = await AssetsPage(pageProps());
    render(page);

    expect(mocks.lastWorkspaceProps).not.toHaveProperty("campaignOutput");
  });
});
