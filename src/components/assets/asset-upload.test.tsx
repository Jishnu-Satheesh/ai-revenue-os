// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetUpload, type AssetUploadOutcome, type AssetUploadRunner } from "@/components/assets/asset-upload";

afterEach(cleanup);

type Fields = { note: string };

function file(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function setup(run: AssetUploadRunner<Fields>) {
  return render(
    <AssetUpload<Fields>
      accept="image/png"
      maxBytes={1024}
      defaultFields={() => ({ note: "" })}
      renderFields={() => null}
      run={run}
      submitLabel="Upload designs"
    />,
  );
}

function chooseFiles(files: File[]) {
  const dropzone = screen.getByRole("button", { name: /choose files or drop them here/i });
  const input = dropzone.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("a batch reports each file on its own", () => {
  it("shows every file by its own name, so duplicate names never collide", async () => {
    const run = vi.fn(async () => ({ status: "usable" }) as AssetUploadOutcome);
    setup(run);

    chooseFiles([file("poster.png"), file("poster.png")]);

    expect(screen.getAllByText("poster.png")).toHaveLength(2);
  });

  it("uploads every queued file and shows its own outcome", async () => {
    const run = vi.fn(async ({ file: uploaded }) =>
      uploaded.name === "bad.png"
        ? ({ status: "refused", message: "That file is not an image." } as AssetUploadOutcome)
        : ({ status: "usable" } as AssetUploadOutcome),
    );
    setup(run);

    chooseFiles([file("good.png"), file("bad.png")]);
    fireEvent.click(screen.getByRole("button", { name: /upload designs/i }));

    await waitFor(() => expect(screen.getByText("That file is not an image.")).toBeTruthy());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("names a refusal rather than showing a bare failed state", async () => {
    const run = vi.fn(async () => ({ status: "refused", message: "The file is empty." }) as AssetUploadOutcome);
    setup(run);

    chooseFiles([file("empty.png")]);
    fireEvent.click(screen.getByRole("button", { name: /upload designs/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/file is empty/i));
  });
});

describe("retry touches only the failed members", () => {
  it("does not retry a file that already succeeded", async () => {
    const run = vi
      .fn<AssetUploadRunner<Fields>>()
      .mockResolvedValueOnce({ status: "usable" })
      .mockResolvedValueOnce({ status: "refused", message: "Try again." })
      .mockResolvedValueOnce({ status: "usable" });
    setup(run);

    chooseFiles([file("ok.png"), file("bad.png")]);
    fireEvent.click(screen.getByRole("button", { name: /upload designs/i }));
    await waitFor(() => expect(screen.getByText("Try again.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /retry failed/i }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(3));

    // The already-succeeded file was never asked to run a second time: only
    // one retry call happened for the two initial calls.
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("never offers retry for a conflict, because that slot's bytes are final", async () => {
    const run = vi.fn(async () => ({ status: "conflict", message: "A different file is now at this slot." }) as AssetUploadOutcome);
    setup(run);

    chooseFiles([file("changed.png")]);
    fireEvent.click(screen.getByRole("button", { name: /upload designs/i }));

    await waitFor(() => expect(screen.getByText(/different file is now at this slot/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /retry failed/i })).toBeNull();
  });
});

describe("cancel and remove", () => {
  it("removes a queued file before it starts, with no call to run", () => {
    const run = vi.fn();
    setup(run as unknown as AssetUploadRunner<Fields>);

    chooseFiles([file("poster.png")]);
    fireEvent.click(screen.getByRole("button", { name: /remove poster.png/i }));

    expect(screen.queryByText("poster.png")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("a disabled uploader explains why, rather than offering a dead control", () => {
  it("shows the reason instead of a file picker", () => {
    render(
      <AssetUpload<Fields>
        accept="image/png"
        maxBytes={1024}
        defaultFields={() => ({ note: "" })}
        renderFields={() => null}
        run={vi.fn()}
        disabled
        disabledReason="Uploading needs the manage permission."
      />,
    );

    expect(screen.getByText(/needs the manage permission/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /choose files or drop them here/i })).toBeNull();
  });
});
