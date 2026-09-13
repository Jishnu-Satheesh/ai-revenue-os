// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CreativeFolderTree,
  folderSelectionFromValue,
  folderSelectionValue,
} from "@/components/assets/creative-folder-tree";
import type { CreativeHistoryFolderView } from "@/components/assets/asset-query-options";

afterEach(cleanup);

function folder(overrides: Partial<CreativeHistoryFolderView> = {}): CreativeHistoryFolderView {
  return {
    folderId: "folder-1",
    parentFolderId: null,
    name: "Ramadan campaign",
    defaultMetadata: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("folder selection encoding", () => {
  it("round-trips all, uncategorized, and a real folder id", () => {
    expect(folderSelectionFromValue("all")).toEqual({ kind: "all" });
    expect(folderSelectionFromValue("uncategorized")).toEqual({ kind: "uncategorized" });
    expect(folderSelectionFromValue("folder-1")).toEqual({ kind: "folder", folderId: "folder-1" });
    expect(folderSelectionValue({ kind: "folder", folderId: "folder-1" })).toBe("folder-1");
  });
});

describe("the folder list", () => {
  it("always offers All designs and Uncategorized alongside saved folders", () => {
    render(
      <CreativeFolderTree
        folders={[folder()]}
        selection={{ kind: "all" }}
        onSelect={vi.fn()}
        canManage={false}
        onCreateFolder={vi.fn()}
      />,
    );

    const nav = screen.getByRole("navigation", { name: /folders/i });
    expect(within(nav).getByText("All designs")).toBeTruthy();
    expect(within(nav).getByText("Uncategorized")).toBeTruthy();
    expect(within(nav).getByText("Ramadan campaign")).toBeTruthy();
  });

  it("calls onSelect with the exact folder chosen", () => {
    const onSelect = vi.fn();
    render(
      <CreativeFolderTree
        folders={[folder()]}
        selection={{ kind: "all" }}
        onSelect={onSelect}
        canManage={false}
        onCreateFolder={vi.fn()}
      />,
    );

    const nav = screen.getByRole("navigation", { name: /folders/i });
    fireEvent.click(within(nav).getByText("Ramadan campaign"));

    expect(onSelect).toHaveBeenCalledWith({ kind: "folder", folderId: "folder-1" });
  });

  it("hides an archived folder from the list", () => {
    render(
      <CreativeFolderTree
        folders={[folder({ archivedAt: "2026-01-01T00:00:00Z" })]}
        selection={{ kind: "all" }}
        onSelect={vi.fn()}
        canManage={false}
        onCreateFolder={vi.fn()}
      />,
    );

    expect(screen.queryByText("Ramadan campaign")).toBeNull();
  });
});

describe("new folder is a management act", () => {
  it("does not offer New folder to a role that cannot manage the library", () => {
    render(
      <CreativeFolderTree
        folders={[]}
        selection={{ kind: "all" }}
        onSelect={vi.fn()}
        canManage={false}
        onCreateFolder={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /new folder/i })).toBeNull();
  });

  it("creates a top-level folder with the typed name", () => {
    const onCreateFolder = vi.fn();
    render(
      <CreativeFolderTree
        folders={[]}
        selection={{ kind: "all" }}
        onSelect={vi.fn()}
        canManage
        onCreateFolder={onCreateFolder}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /new folder/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Brand references" } });
    fireEvent.click(screen.getByRole("button", { name: /create folder/i }));

    expect(onCreateFolder).toHaveBeenCalledWith({ name: "Brand references", parentFolderId: null });
  });

  it("will not create a folder with no name", () => {
    const onCreateFolder = vi.fn();
    render(
      <CreativeFolderTree
        folders={[]}
        selection={{ kind: "all" }}
        onSelect={vi.fn()}
        canManage
        onCreateFolder={onCreateFolder}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /new folder/i }));
    fireEvent.click(screen.getByRole("button", { name: /create folder/i }));

    expect(onCreateFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/name/i);
  });
});
