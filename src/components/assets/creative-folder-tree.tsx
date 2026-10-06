"use client";

import { FolderPlus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CreativeHistoryFolderView } from "@/components/assets/asset-query-options";

/**
 * Where a design lives, and the one control that changes it.
 *
 * `"all"` and `"uncategorized"` are not folders — they are views over the
 * same designs — so they are kept out of `folderId` entirely rather than
 * encoded as a sentinel UUID a caller could confuse with a real one.
 *
 * Below `md`, the tree collapses into a `Select`: the visual contract asks
 * for this explicitly, and a vertical list of folders is the first thing to
 * lose to a 320px viewport.
 */
export type CreativeFolderSelection = { kind: "all" } | { kind: "uncategorized" } | { kind: "folder"; folderId: string };

export function folderSelectionValue(selection: CreativeFolderSelection): string {
  return selection.kind === "folder" ? selection.folderId : selection.kind;
}

export function folderSelectionFromValue(value: string): CreativeFolderSelection {
  if (value === "all") return { kind: "all" };
  if (value === "uncategorized") return { kind: "uncategorized" };
  return { kind: "folder", folderId: value };
}

type CreativeFolderTreeProps = {
  folders: readonly CreativeHistoryFolderView[];
  selection: CreativeFolderSelection;
  onSelect: (selection: CreativeFolderSelection) => void;
  /** False for a viewer: folder creation is a library-management act. */
  canManage: boolean;
  onCreateFolder: (input: { name: string; parentFolderId: string | null }) => void;
  creatingFolder?: boolean;
};

function NewFolderDialog({
  topLevelFolders,
  onCreateFolder,
  creatingFolder,
}: Readonly<{
  topLevelFolders: readonly CreativeHistoryFolderView[];
  onCreateFolder: (input: { name: string; parentFolderId: string | null }) => void;
  creatingFolder: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentFolderId, setParentFolderId] = useState<string>("__none__");
  const [missingName, setMissingName] = useState(false);

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setMissingName(true);
      return;
    }
    onCreateFolder({
      name: trimmed,
      parentFolderId: parentFolderId === "__none__" ? null : parentFolderId,
    });
    setName("");
    setParentFolderId("__none__");
    setMissingName(false);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <FolderPlus className="size-4" />
          New folder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Folders go one level deep. Choose a top-level folder to nest this one inside it, or
            leave it top-level.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-folder-name">Name</Label>
            <Input
              id="new-folder-name"
              dir="auto"
              value={name}
              maxLength={160}
              onChange={(event) => {
                setName(event.target.value);
                setMissingName(false);
              }}
              placeholder="Ramadan campaign"
            />
            {missingName ? (
              <p role="alert" className="text-sm text-destructive">
                Give the folder a name.
              </p>
            ) : null}
          </div>
          {topLevelFolders.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-folder-parent">Nest inside (optional)</Label>
              <Select value={parentFolderId} onValueChange={setParentFolderId}>
                <SelectTrigger id="new-folder-parent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Top level</SelectItem>
                  {topLevelFolders.map((folder) => (
                    <SelectItem key={folder.folderId} value={folder.folderId}>
                      <span dir="auto">{folder.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={submit} disabled={creatingFolder}>
            Create folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreativeFolderTree({
  folders,
  selection,
  onSelect,
  canManage,
  onCreateFolder,
  creatingFolder = false,
}: CreativeFolderTreeProps) {
  const live = folders.filter((folder) => folder.archivedAt === null);
  const topLevel = live.filter((folder) => folder.parentFolderId === null);
  const childrenOf = (parentId: string) =>
    live.filter((folder) => folder.parentFolderId === parentId);

  const entries: { selection: CreativeFolderSelection; label: string; indent: boolean }[] = [
    { selection: { kind: "all" }, label: "All designs", indent: false },
    { selection: { kind: "uncategorized" }, label: "Uncategorized", indent: false },
    ...topLevel.flatMap((folder) => [
      { selection: { kind: "folder" as const, folderId: folder.folderId }, label: folder.name, indent: false },
      ...childrenOf(folder.folderId).map((child) => ({
        selection: { kind: "folder" as const, folderId: child.folderId },
        label: child.name,
        indent: true,
      })),
    ]),
  ];

  const current = folderSelectionValue(selection);

  return (
    <div className="flex flex-col gap-3">
      {/* Narrow screens: the tree collapses into a single control. */}
      {/*
        The split is `lg`, not `md`, on purpose. Tailwind breakpoints measure
        the viewport, but this tree sits inside the AppShell, whose expanded
        sidebar takes roughly 245px. At a 768px viewport a side-by-side split
        leaves the design grid about 290px — a single card beside a mostly
        empty column. Below `lg` the folders collapse into the dropdown above
        instead. Measure against the shell's real content width, not the
        window's.
      */}
      <div className="lg:hidden">
        <Select value={current} onValueChange={(value) => onSelect(folderSelectionFromValue(value))}>
          <SelectTrigger aria-label="Folder">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entries.map((entry) => (
              <SelectItem
                key={folderSelectionValue(entry.selection)}
                value={folderSelectionValue(entry.selection)}
              >
                <span dir="auto">
                  {entry.indent ? "  " : ""}
                  {entry.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop and up: a vertical folder list. */}
      <nav aria-label="Folders" className="hidden w-full flex-col gap-0.5 lg:flex lg:w-56 lg:shrink-0">
        <ul className="flex flex-col gap-0.5">
          {entries.map((entry) => {
            const value = folderSelectionValue(entry.selection);
            const active = value === current;
            return (
              <li key={value}>
                <button
                  type="button"
                  aria-current={active}
                  onClick={() => onSelect(entry.selection)}
                  className={
                    "w-full truncate rounded-md px-3 py-2 text-left text-sm " +
                    (entry.indent ? "pl-7 " : "") +
                    (active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  <span dir="auto">{entry.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {canManage ? (
        <NewFolderDialog
          topLevelFolders={topLevel}
          onCreateFolder={onCreateFolder}
          creatingFolder={creatingFolder}
        />
      ) : null}
    </div>
  );
}
