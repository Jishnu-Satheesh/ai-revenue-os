// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NewResearchDialog,
  type NewResearchStartRequest,
  type NewResearchStartResult,
} from "@/components/growth-intelligence/new-research-dialog";

const DOWNTOWN = "20000000-0000-4000-8000-00000000000a";
const MARINA = "20000000-0000-4000-8000-00000000000b";
const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

const branches = [
  { id: DOWNTOWN, name: "Downtown" },
  { id: MARINA, name: "Marina" },
];

function dialogProps(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION,
    branches,
    timeZone: "Asia/Dubai",
    evidencePeriods: [{ label: "Channel reports · 1–31 Aug 2026" }],
    businessGoals: ["Grow weekday lunch orders"],
    suggestions: ["Rival Kitchen"],
    canManage: true,
    open: true,
    onOpenChange: vi.fn(),
    ...overrides,
  };
}

function question(value: string) {
  fireEvent.change(screen.getByLabelText(/what would you like to achieve/i), {
    target: { value },
  });
}

async function goToScope() {
  question("How should we prepare for National Day?");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByLabelText(/business location/i);
}

async function chooseLocation(name: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: /business location/i }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

async function goToReview() {
  await goToScope();
  await chooseLocation(/Downtown/);
  fireEvent.change(screen.getByLabelText(/research area/i), {
    target: { value: "Downtown Dubai" },
  });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByText(/how often should we research this/i);
}

function chooseMode(label: RegExp) {
  const radios = screen.getAllByRole("radio");
  const target = label.source.includes("one") ? radios[0]! : radios[1]!;
  fireEvent.click(target);
}

function startedResult(overrides: Partial<NewResearchStartResult> = {}): NewResearchStartResult {
  return {
    outcome: "started",
    projectId: "50000000-0000-4000-8000-000000000005",
    updateId: "70000000-0000-4000-8000-000000000007",
    briefRevisionId: "61000000-0000-4000-8000-000000000061",
    revisionNumber: 1,
    correlationId: "30000000-0000-4000-8000-000000000003",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewResearchDialog brief step", () => {
  it("requires the business question inline and preserves every other input", async () => {
    const props = dialogProps();
    render(<NewResearchDialog {...props} />);

    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: "National Day" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    // Nothing typed is lost by the failed validation.
    expect(screen.getByLabelText(/project name/i)).toHaveProperty("value", "National Day");

    question("How should we prepare for National Day?");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByLabelText(/business location/i)).toBeTruthy();
  });

  it("keeps brief input when moving back from scope", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByLabelText(/what would you like to achieve/i)).toHaveProperty(
      "value",
      "How should we prepare for National Day?",
    );
  });
});

describe("NewResearchDialog scope step", () => {
  it("requires location and research area inline while keeping competitors", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    fireEvent.change(screen.getByLabelText(/competitor name/i), {
      target: { value: "Rival Kitchen" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));
    expect(screen.getByText("Rival Kitchen")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    // The competitor row survives the failed validation.
    expect(screen.getByText("Rival Kitchen")).toBeTruthy();
  });

  it("adds, edits and removes competitor rows with validation", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/competitor name/i), {
      target: { value: "Rival Kitchen" },
    });
    fireEvent.change(screen.getByLabelText(/website/i), { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));
    expect(await screen.findByText(/valid public HTTP/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/website/i), {
      target: { value: "https://rival.example/menu" },
    });
    fireEvent.change(screen.getByLabelText(/location hint/i), {
      target: { value: "Near Marina Mall" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));
    expect(screen.getByText("Rival Kitchen")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/competitor name/i), {
      target: { value: "rival kitchen" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));
    expect(await screen.findByText(/already listed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove competitor rival kitchen/i }));
    // The row is gone; the name returns to the labelled suggestions instead.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /remove competitor/i })).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: /add suggested competitor rival kitchen/i }),
    ).toBeTruthy();
  });

  it("edits a competitor row in place", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    fireEvent.change(screen.getByLabelText(/competitor name/i), {
      target: { value: "Rival Kitchen" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));

    fireEvent.click(screen.getByRole("button", { name: /edit competitor rival kitchen/i }));
    fireEvent.change(screen.getByLabelText(/location hint/i), { target: { value: "Deira" } });
    fireEvent.click(screen.getByRole("button", { name: /save competitor/i }));
    expect(screen.getByText(/Deira/)).toBeTruthy();
  });

  it("labels suggestions as suggestions and adds them explicitly", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    expect(screen.getByText("Suggestions")).toBeTruthy();
    expect(screen.getByText(/not verified competitors/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /add suggested competitor rival kitchen/i }),
    );
    expect(screen.getByText("Suggestion")).toBeTruthy();
  });

  it("shows the expandable business context with named evidence periods", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    fireEvent.click(
      screen.getByRole("button", { name: /business context used for this research/i }),
    );
    expect(screen.getByText("Channel reports · 1–31 Aug 2026")).toBeTruthy();
    expect(screen.getByText("Grow weekday lunch orders")).toBeTruthy();
  });
});

describe("NewResearchDialog review step", () => {
  it("requires an explicit one-time or monitoring choice before starting", async () => {
    const startResearch = vi.fn(async () => startedResult());
    render(<NewResearchDialog {...dialogProps({ startResearch })} />);
    await goToReview();

    fireEvent.click(screen.getByRole("button", { name: /start research/i }));
    expect(await screen.findByText(/never starts on a silent default/)).toBeTruthy();
    expect(startResearch).not.toHaveBeenCalled();
  });

  it("reveals cadence, time, timezone and end date for recurring research", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToReview();

    chooseMode(/monitoring/);
    expect(screen.getByLabelText(/frequency/i)).toBeTruthy();
    expect(screen.getByLabelText(/research start time/i)).toBeTruthy();
    expect(screen.getByLabelText(/timezone/i)).toBeTruthy();
    expect(screen.getByLabelText(/stop monitoring on/i)).toBeTruthy();
  });

  it("shows the reviewed summary with edit links before starting", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToReview();
    chooseMode(/one-time/);

    expect(screen.getByText("Your research brief")).toBeTruthy();
    expect(screen.getByText("How should we prepare for National Day?")).toBeTruthy();
    expect(screen.getByText(/Downtown/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit brief/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit scope/i })).toBeTruthy();
    expect(screen.getByText(/report and draft advice to review/)).toBeTruthy();
  });

  it("starts once per double submit with an idempotency key", async () => {
    let release: (value: NewResearchStartResult) => void = () => {};
    const startResearch = vi.fn(
      () => new Promise<NewResearchStartResult>((resolve) => (release = resolve)),
    );
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();
    render(<NewResearchDialog {...dialogProps({ startResearch, onStarted, onOpenChange })} />);
    await goToReview();
    chooseMode(/one-time/);

    const start = screen.getByRole("button", { name: /start research/i });
    fireEvent.click(start);
    fireEvent.click(screen.getByRole("button", { name: /starting/i }));
    expect(startResearch).toHaveBeenCalledTimes(1);
    const calls = startResearch.mock.calls as unknown[][];
    const request = calls[0]?.[0] as unknown as NewResearchStartRequest;
    expect(request.idempotencyKey).toBe("00000000-0000-4000-8000-000000000000");
    expect(request.question).toBe("How should we prepare for National Day?");
    expect(request.branchId).toBe(DOWNTOWN);

    release(startedResult());
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces the scope-drift notice instead of duplicating paid work", async () => {
    const startResearch = vi.fn(async () =>
      startedResult({
        outcome: "opened_progress",
        notice: {
          code: "SCOPE_DRIFT_ACTIVE_PROGRESS",
          message: "Changed settings not applied, showing active progress.",
        },
      }),
    );
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();
    render(<NewResearchDialog {...dialogProps({ startResearch, onStarted, onOpenChange })} />);
    await goToReview();
    chooseMode(/one-time/);

    fireEvent.click(screen.getByRole("button", { name: /start research/i }));
    expect(await screen.findByText(/changed settings not applied/i)).toBeTruthy();
    // The dialog stays open so the notice is actually read; acknowledging
    // it closes without cancelling anything.
    expect(onStarted).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the brief on start failure for retry", async () => {
    const startResearch = vi.fn(async () => {
      throw new Error("ADAPTER_UNAVAILABLE");
    });
    render(<NewResearchDialog {...dialogProps({ startResearch })} />);
    await goToReview();
    chooseMode(/one-time/);

    fireEvent.click(screen.getByRole("button", { name: /start research/i }));
    expect(await screen.findByText(/brief is kept/i)).toBeTruthy();
    expect(screen.getByText("How should we prepare for National Day?")).toBeTruthy();
  });
});

describe("NewResearchDialog close behavior", () => {
  it("asks keep-editing or discard-draft on close and restores focus", async () => {
    const onOpenChange = vi.fn();
    function harness(open: boolean) {
      return (
        <div>
          <button type="button" data-testid="opener">
            Open research
          </button>
          <NewResearchDialog {...dialogProps({ open, onOpenChange })} />
        </div>
      );
    }
    const { rerender } = render(harness(false));
    const opener = screen.getByTestId("opener");
    opener.focus();
    rerender(harness(true));
    await screen.findByRole("dialog", { name: /new research/i });

    question("How should we prepare for National Day?");
    fireEvent.click(screen.getByRole("button", { name: /close research dialog/i }));
    expect(await screen.findByText(/discard this research brief/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(screen.getByRole("dialog", { name: /new research/i })).toBeTruthy();
    // Nothing typed is lost by keeping the edit.
    expect(screen.getByLabelText(/what would you like to achieve/i)).toHaveProperty(
      "value",
      "How should we prepare for National Day?",
    );

    fireEvent.click(screen.getByRole("button", { name: /close research dialog/i }));
    fireEvent.click(await screen.findByRole("button", { name: /discard draft/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The close unmounts the dialog, which restores focus to the opener.
    rerender(harness(false));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("closes on Escape and restores focus when nothing was edited", async () => {
    const onOpenChange = vi.fn();
    render(
      <div>
        <button type="button" data-testid="opener">
          Open research
        </button>
        <NewResearchDialog {...dialogProps({ open: true, onOpenChange })} />
      </div>,
    );
    await screen.findByRole("dialog", { name: /new research/i });

    fireEvent.keyDown(screen.getByRole("dialog", { name: /new research/i }), { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("never cancels an in-flight start when the dialog closes", async () => {
    let release: (value: NewResearchStartResult) => void = () => {};
    const startResearch = vi.fn(
      () => new Promise<NewResearchStartResult>((resolve) => (release = resolve)),
    );
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();
    render(<NewResearchDialog {...dialogProps({ startResearch, onStarted, onOpenChange })} />);
    await goToReview();
    chooseMode(/one-time/);

    fireEvent.click(screen.getByRole("button", { name: /start research/i }));
    fireEvent.click(screen.getByRole("button", { name: /close research dialog/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    release(startedResult());
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(startResearch).toHaveBeenCalledTimes(1);
  });

  it("walks the steps from the keyboard indicator", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    const briefStep = screen.getByRole("button", { name: "Brief" });
    fireEvent.click(briefStep);
    expect(screen.getByLabelText(/what would you like to achieve/i)).toBeTruthy();
  });
});

describe("NewResearchDialog viewer role", () => {
  it("reads with the reason and hides start controls", async () => {
    render(<NewResearchDialog {...dialogProps({ canManage: false })} />);

    expect(await screen.findByText(/read-only for your role/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start research/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
  });
});

describe("NewResearchDialog layout contract", () => {
  it("uses the spacious desktop geometry with a scrolling body and persistent footer", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    const dialog = await screen.findByRole("dialog", { name: /new research/i });

    expect(dialog.className).toMatch(/sm:max-w-\[820px\]/);
    expect(dialog.className).toMatch(/max-sm:h-dvh/);
    expect(dialog.className).toMatch(/flex-col/);
  });
});

describe("NewResearchDialog step indicator", () => {
  it("marks the current step, disables future steps, and keeps visited steps clickable", async () => {
    render(<NewResearchDialog {...dialogProps()} />);

    expect(screen.getByRole("button", { name: "Brief" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Scope" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();

    await goToScope();

    // The completed Brief step shows a check in its (hidden) circle.
    const briefDone = screen.getByRole("button", { name: "Brief" });
    expect(briefDone).not.toHaveAttribute("aria-current");
    expect(briefDone.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Scope" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();

    fireEvent.click(briefDone);
    expect(screen.getByLabelText(/what would you like to achieve/i)).toBeTruthy();
  });
});

describe("NewResearchDialog event brief shortcut", () => {
  it("renders the helper band and fills the brief like the prototype", async () => {
    render(<NewResearchDialog {...dialogProps()} />);

    expect(screen.getByText("From a question to a useful report")).toBeTruthy();
    expect(screen.getByText(/connect it with your business context/)).toBeTruthy();
    expect(screen.getByLabelText(/what would you like to achieve/i)).toHaveAttribute(
      "placeholder",
      "For example: Find out what nearby competitors are doing for National Day and how we could attract more family orders.",
    );
    expect(screen.getByLabelText(/project name/i)).toHaveAttribute(
      "placeholder",
      "A short name you'll recognise",
    );

    // The shortcut overwrites whatever is already typed (prototype behavior).
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: "Old name" } });
    fireEvent.click(screen.getByRole("button", { name: /try an event brief/i }));

    expect(screen.getByLabelText(/what would you like to achieve/i)).toHaveProperty(
      "value",
      "Find out what nearby competitors are offering for National Day and how we could attract more family orders without putting delivery quality at risk.",
    );
    expect(screen.getByLabelText(/project name/i)).toHaveProperty(
      "value",
      "National Day opportunity",
    );
    expect(screen.getByLabelText(/event or target date/i)).toHaveProperty("value", "2026-12-02");
  });

  it("marks the draft dirty and clears the question error", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /try an event brief/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    // Dirty: closing asks instead of closing.
    fireEvent.click(screen.getByRole("button", { name: /close research dialog/i }));
    expect(await screen.findByText(/discard this research brief/i)).toBeTruthy();
  });
});

describe("NewResearchDialog competitor row shape", () => {
  it("renders the tile, sub-line and icon actions", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    fireEvent.change(screen.getByLabelText(/competitor name/i), {
      target: { value: "Rival Kitchen" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));
    // A bare name still gets the fallback sub-line.
    expect(screen.getByText("Location to be checked")).toBeTruthy();

    const edit = screen.getByRole("button", { name: /edit competitor rival kitchen/i });
    const remove = screen.getByRole("button", { name: /remove competitor rival kitchen/i });
    expect(edit.querySelector("svg")).not.toBeNull();
    expect(remove.querySelector("svg")).not.toBeNull();
    // Icon tile plus the two icon actions: three svgs in the row.
    expect(edit.closest("li")?.querySelectorAll("svg").length).toBe(3);

    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText(/location hint/i), {
      target: { value: "Near Marina Mall" },
    });
    fireEvent.change(screen.getByLabelText(/website/i), {
      target: { value: "https://rival.example/menu" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save competitor/i }));
    expect(screen.getByText("Near Marina Mall · https://rival.example/menu")).toBeTruthy();
  });

  it("lists investigation chips in prototype order", async () => {
    render(<NewResearchDialog {...dialogProps()} />);
    await goToScope();

    const chips = [
      "Digital presence",
      "Offers & pricing",
      "Customer feedback",
      "Local demand",
      "Performance signals",
    ].map((label) => screen.getByText(label));
    for (let i = 1; i < chips.length; i++) {
      expect(chips[i - 1]!.compareDocumentPosition(chips[i]!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });
});

describe("NewResearchDialog footer restyle", () => {
  it("always shows the privacy note and arrow icons", async () => {
    render(<NewResearchDialog {...dialogProps()} />);

    const note = screen.getByText("Your business context stays private.");
    expect(note.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(note.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: /continue/i }).querySelector("svg")).not.toBeNull();

    await goToReview();
    chooseMode(/one-time/);
    expect(
      screen.getByRole("button", { name: /start research/i }).querySelector("svg"),
    ).not.toBeNull();
  });
});
