// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubjectList, type SubjectRow } from "@/components/assets/subject-list";

afterEach(cleanup);

function subject(overrides: Partial<SubjectRow> = {}): SubjectRow {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    name: "Kerala fish curry",
    description: "Kingfish in a brick-red tamarind and coconut gravy.",
    namesByScript: { Latn: "Kerala fish curry", Mlym: "കേരള മീൻ കറി" },
    tags: ["fish curry"],
    state: "draft",
    archivedAt: null,
    ...overrides,
  };
}

describe("the empty state", () => {
  it("names the next action rather than describing subjects", () => {
    render(<SubjectList subjects={[]} canConfirm onConfirm={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /no dishes described yet/i })).toBeTruthy();
    expect(screen.getByText(/describe one dish/i)).toBeTruthy();
  });
});

describe("a draft is not usable and says so", () => {
  it("states plainly that a draft will not be drawn", () => {
    render(<SubjectList subjects={[subject()]} canConfirm onConfirm={vi.fn()} />);

    expect(screen.getByText(/not used for generation until it is confirmed/i)).toBeTruthy();
  });

  it("marks a confirmed subject as ready", () => {
    render(
      <SubjectList subjects={[subject({ state: "confirmed" })]} canConfirm onConfirm={vi.fn()} />,
    );

    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^confirm$/i })).toBeNull();
  });
});

describe("confirming is the privileged act, and the interface admits it", () => {
  it("offers confirm to a role that holds it", () => {
    const onConfirm = vi.fn();
    render(<SubjectList subjects={[subject()]} canConfirm onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(onConfirm).toHaveBeenCalledWith("50000000-0000-4000-8000-000000000001");
  });

  it("does not offer a button that would be refused, and says who can", () => {
    render(<SubjectList subjects={[subject()]} canConfirm={false} onConfirm={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /^confirm$/i })).toBeNull();
    expect(screen.getByText(/an owner or admin/i)).toBeTruthy();
  });
});

describe("names in more than one script", () => {
  it("shows each script's name and lets it choose its own direction", () => {
    render(
      <SubjectList
        subjects={[
          subject({
            namesByScript: { Mlym: "കേരള മീൻ കറി", Arab: "كاري السمك" },
          }),
        ]}
        canConfirm
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("കേരള മീൻ കറി").getAttribute("dir")).toBe("auto");
    expect(screen.getByText("كاري السمك").getAttribute("dir")).toBe("auto");
  });
});
