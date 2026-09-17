// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PosterStudio } from "@/components/campaigns/studio/poster-studio";
import type { PosterLayout } from "@/domain/campaigns/poster-template";
import type {
  PosterStudioOffer,
  PosterStudioRender,
  PosterStudioView,
} from "@/modules/campaigns/application/poster-studio-view";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c1000000-0000-4000-8000-000000000001";
const DIRECTION_ID = "d1000000-0000-4000-8000-000000000001";

beforeEach(() => {
  const measureText = vi.fn((text: string) => {
    const size = Number(/^(\d+(?:\.\d+)?)px/.exec(context.font)?.[1] ?? 0);
    return { width: text.length * 0.5 * size };
  });
  const context = { font: "", measureText } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as RenderingContext,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
});

const layout: PosterLayout = {
  safeArea: { topPx: 40, rightPx: 40, bottomPx: 40, leftPx: 40 },
  logoSlot: null,
  plateCropFocus: "center",
  textBoxes: [
    {
      slot: "caption",
      xPx: 100,
      yPx: 100,
      widthPx: 880,
      heightPx: 300,
      maxLines: 3,
      minFontSizePx: 24,
      maxFontSizePx: 72,
      fontSizeStepPx: 8,
      lineHeightRatio: 1.2,
      alignment: "start",
      required: true,
    },
  ],
};

function offer(): PosterStudioOffer {
  return {
    directionId: DIRECTION_ID,
    templateKey: "core_feed_centred",
    templateVersion: 1,
    channel: "instagram",
    placement: "feed_image",
    canvasWidthPx: 1080,
    canvasHeightPx: 1080,
    availability: { available: true },
    slots: [
      { slot: "caption", value: "Feed the whole family", source: "copy.hook", governed: true },
      { slot: "body", value: null, reason: "no_governed_source" },
      { slot: "footer", value: "Order now", source: "copy.callToAction", governed: true },
      { slot: "extra", value: null, reason: "not_supplied" },
    ],
    layout,
    copyIndex: 0,
    copy: {
      hook: "Feed the whole family",
      caption: "A long social caption that never reaches a poster.",
      callToAction: "Order now",
      timingRationale: "Weekends are when families order.",
    },
  };
}

function view(overrides: Partial<PosterStudioView> = {}): PosterStudioView {
  return {
    campaignId: CAMPAIGN_ID,
    bundleVersionId: "b1000000-0000-4000-8000-000000000001",
    version: 3,
    digest: "a".repeat(64),
    objective: "Lift weekend family orders.",
    measurement: {
      primaryMetricKey: "contribution.incremental_gross_profit",
      outcomeWindowDays: 7,
      baselineSource: "ledger",
    },
    scripts: ["Latn", "Mlym"],
    hasPosterPlan: true,
    directions: [
      {
        id: DIRECTION_ID,
        name: "Evidence-led",
        kind: "evidence_led",
        plateAssetKey: "plate-1",
        rationale: "Family-size orders have been flat for five weeks.",
        softConventionDepartures: [],
      },
    ],
    offers: [offer()],
    renders: [],
    unreadableTemplates: [],
    ...overrides,
  };
}

function renderStudio(
  overrides: Partial<PosterStudioView> = {},
  renderPreviews: Readonly<Record<string, string>> = {},
) {
  return render(
    <PosterStudio
      view={view(overrides)}
      plates={[
        {
          assetKey: "plate-1",
          assetId: "a1000000-0000-4000-8000-000000000001",
          previewUrl: "https://example.test/plate.png",
          widthPx: 1080,
          heightPx: 1080,
        },
      ]}
      renderPreviews={renderPreviews}
      organizationId={ORGANIZATION_ID}
      campaignId={CAMPAIGN_ID}
      canRender
      canEdit
    />,
  );
}

const RENDER_ID = "d0000000-0000-4000-8000-000000000001";

function renderedRender(overrides: Partial<PosterStudioRender> = {}): PosterStudioRender {
  return {
    id: RENDER_ID,
    templateKey: "core_feed_centred",
    templateVersion: 1,
    script: "Latn",
    state: "rendered",
    renderDigest: "c".repeat(64),
    textValues: { caption: "Feed the whole family" },
    refusalCode: null,
    verification: {},
    outputStoragePath: `${ORGANIZATION_ID}/${CAMPAIGN_ID}/posters/${"c".repeat(64)}.png`,
    outputWidthPx: 1080,
    outputHeightPx: 1080,
    renderedAt: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

function headline() {
  return screen.getByLabelText("Headline") as HTMLInputElement;
}

describe("saving and rendering are offered as the separate acts they are", () => {
  it("offers a render while the approved words are untouched", () => {
    renderStudio();

    expect(screen.getByRole("button", { name: /render this poster/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("offers a save instead once the approved words change", () => {
    renderStudio();
    fireEvent.change(headline(), { target: { value: "Feed everyone" } });

    // Not both at once. An edit creates a new version, and rendering the one
    // being edited would draw words that are about to be superseded.
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /render this poster/i })).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("treats the free line as a render parameter, not an edit to the copy", () => {
    renderStudio();
    fireEvent.change(screen.getByLabelText("Free line"), { target: { value: "Open until 11pm" } });

    // The free line belongs to the poster, so there is still nothing to save.
    expect(screen.getByRole("button", { name: /render this poster/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });
});

describe("undo is useful rather than per-keystroke", () => {
  it("coalesces a burst of typing into one step back", () => {
    renderStudio();

    // Four changes in one burst, to one field.
    for (const value of ["Feed", "Feed the", "Feed the whole", "Feed everyone"]) {
      fireEvent.change(headline(), { target: { value } });
    }

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    // One click returns to the approved text, not to "Feed the whole".
    expect(headline().value).toBe("Feed the whole family");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("keeps the approved text reachable however much is typed", () => {
    renderStudio();
    fireEvent.change(headline(), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(headline().value).toBe("Feed the whole family");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("discards the redo branch once editing resumes", () => {
    renderStudio();
    fireEvent.change(headline(), { target: { value: "First attempt" } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    fireEvent.change(headline(), { target: { value: "Second attempt" } });

    // Redo would otherwise jump to a draft that never followed from this one.
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(headline().value).toBe("Second attempt");
  });
});

describe("the language and the words are checked against each other", () => {
  it("warns before a render is spent, and offers the language that would work", () => {
    renderStudio();
    fireEvent.change(headline(), { target: { value: "ഞങ്ങളുടെ നെയ്മീൻ കറി" } });

    expect(screen.getByText(/not written in the language you have chosen/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /draw it in/i })).toBeInTheDocument();
  });

  it("says so instead when the poster plan does not carry that language", () => {
    renderStudio({ scripts: ["Latn"] });
    fireEvent.change(headline(), { target: { value: "ഞങ്ങളുടെ നെയ്മീൻ കറി" } });

    expect(screen.queryByRole("button", { name: /draw it in/i })).not.toBeInTheDocument();
    expect(screen.getByText(/does not list/i)).toBeInTheDocument();
  });

  it("stays silent when the words and the language agree", () => {
    renderStudio();

    expect(
      screen.queryByText(/not written in the language you have chosen/i),
    ).not.toBeInTheDocument();
  });
});

describe("the offer line is never an input", () => {
  it("shows why rather than letting somebody type a discount onto the artwork", () => {
    renderStudio();

    expect(screen.getByText("Nothing in the approved campaign supplies one.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Offer line")).not.toBeInTheDocument();
  });
});

describe("saving and rendering name the version they were read against", () => {
  it("saves against the viewed version's id and digest", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json(
        {
          bundleVersionId: "b2000000-0000-4000-8000-000000000001",
          version: 4,
          digest: "b".repeat(64),
          changeCount: 1,
          invalidatesApproval: false,
        },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    renderStudio();
    fireEvent.change(headline(), { target: { value: "Feed everyone" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/api/organizations/${ORGANIZATION_ID}/campaigns/${CAMPAIGN_ID}/edits`);
    const body = JSON.parse(init.body as string) as {
      baseVersionId: string;
      baseDigest: string;
    };
    expect(body.baseVersionId).toBe("b1000000-0000-4000-8000-000000000001");
    expect(body.baseDigest).toBe("a".repeat(64));
  });

  it("renders against the viewed version's id and digest", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ workerId: "worker-1" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchSpy);
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /render this poster/i }));

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`/api/organizations/${ORGANIZATION_ID}/campaigns/${CAMPAIGN_ID}/renders`);
    const body = JSON.parse(init.body as string) as {
      bundleVersionId: string;
      bundleDigest: string;
    };
    expect(body.bundleVersionId).toBe("b1000000-0000-4000-8000-000000000001");
    expect(body.bundleDigest).toBe("a".repeat(64));
  });
});

describe("a stale base is a surface, not a toast", () => {
  it("keeps the typing on screen and quotes the server's reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: "This proposal changed since you read it. Reload and try again.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderStudio();
    fireEvent.change(headline(), { target: { value: "Feed everyone" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(
      await screen.findByText("This version changed while you were editing"),
    ).toBeInTheDocument();
    expect(screen.getByText(/This proposal changed since you read it/)).toBeInTheDocument();
    // Nothing was saved and nothing was retargeted: the words stay where they
    // were typed so they can be copied forward.
    expect(headline().value).toBe("Feed everyone");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("an expired preview is said to be expired", () => {
  it("says the finished poster is kept when its link could not be signed", () => {
    renderStudio({ renders: [renderedRender()] });

    expect(screen.getByText(/its viewing link could not be signed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /before \/ after/i })).not.toBeInTheDocument();
  });

  it("offers before / after and no warning once the link is signed", () => {
    renderStudio({ renders: [renderedRender()] }, { [RENDER_ID]: "https://example.test/r.png" });

    expect(screen.getByRole("button", { name: /before \/ after/i })).toBeInTheDocument();
    expect(screen.queryByText(/its viewing link could not be signed/i)).not.toBeInTheDocument();
  });
});
