// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetUpload, type UploadOutcome } from "@/components/assets/asset-upload";

afterEach(cleanup);

function outcome(overrides: Partial<UploadOutcome> = {}): UploadOutcome {
  return { fileName: "curry.jpg", state: "uploaded", message: null, ...overrides };
}

describe("ownership is asked, and the safe answer is the default", () => {
  it("starts on 'a reference we admire' rather than claiming ownership", () => {
    render(<AssetUpload outcomes={[]} onUpload={vi.fn()} />);

    const admired = screen.getByRole("radio", { name: /a reference we admire/i });
    const owned = screen.getByRole("radio", { name: /this is our own work/i });

    expect(admired.getAttribute("data-state")).toBe("checked");
    expect(owned.getAttribute("data-state")).toBe("unchecked");
  });

  it("explains that only our own work may be copied exactly", () => {
    render(<AssetUpload outcomes={[]} onUpload={vi.fn()} />);

    expect(screen.getByText(/only our own work may be copied exactly/i)).toBeTruthy();
  });

  it("sends the ownership the operator actually chose", () => {
    const onUpload = vi.fn();
    render(<AssetUpload outcomes={[]} onUpload={onUpload} />);

    fireEvent.click(screen.getByRole("radio", { name: /this is our own work/i }));
    fireEvent.change(screen.getByLabelText(/what is this/i), {
      target: { value: "Kingfish curry" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add to library/i }));

    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ ownership: "owned", label: "Kingfish curry" }),
    );
  });
});

describe("a batch reports each file on its own", () => {
  it("shows every file's outcome, so one failure does not hide four successes", () => {
    render(
      <AssetUpload
        outcomes={[
          outcome({ fileName: "one.jpg" }),
          outcome({ fileName: "two.png", state: "failed", message: "That file is not an image." }),
          outcome({ fileName: "three.webp", state: "uploading" }),
        ]}
        onUpload={vi.fn()}
      />,
    );

    expect(screen.getByText("one.jpg")).toBeTruthy();
    expect(screen.getByText("two.png")).toBeTruthy();
    expect(screen.getByText("three.webp")).toBeTruthy();
    expect(screen.getByText("That file is not an image.")).toBeTruthy();
  });

  it("names the failure rather than showing a bare failed state", () => {
    render(
      <AssetUpload
        outcomes={[outcome({ state: "failed", message: "That file is larger than 10 MB." })]}
        onUpload={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/larger than 10 MB/);
  });
});

describe("what upload refuses to do", () => {
  it("will not submit without a label, because an unnamed reference cannot be found again", () => {
    const onUpload = vi.fn();
    render(<AssetUpload outcomes={[]} onUpload={onUpload} />);

    fireEvent.click(screen.getByRole("button", { name: /add to library/i }));

    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/name/i);
  });
});
