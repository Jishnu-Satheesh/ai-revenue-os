"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  completeBrandAssetVersion,
  completeCreativeVersion,
  createCreativeFolder,
  createSubjectProfile,
  creativeHistoryFoldersQueryOptions,
  creativeHistoryIntakeQueryOptions,
  creativeHistoryItemsQueryOptions,
  invalidateCreativeHistoryQueries,
  newClientUploadId,
  reserveBrandAsset,
  reserveCreativeItem,
  uploadCreativeBytes,
  type CreativeHistoryReservation,
} from "@/components/assets/asset-query-options";
import type {
  BrandAssetReservation,
  CreativeHistoryFolderView,
  CreativeHistoryItemView,
} from "@/components/assets/asset-query-options";
import {
  AssetUpload,
  type AssetUploadOutcome,
} from "@/components/assets/asset-upload";
import { AssetLibraryGrid, type LibraryReference } from "@/components/assets/asset-library-grid";
import { AssetReviewForm, type AssetReviewSubmission } from "@/components/assets/asset-review-form";
import { BrandGuidelinesPanel } from "@/components/assets/brand-guidelines-panel";
import {
  creativeHistoryRefusalLabel,
  creativeHistoryRightsChoice,
  creativeTypeLabel,
  ownershipChoice,
} from "@/components/assets/asset-vocabulary";
import {
  CreativeFolderTree,
  folderSelectionFromValue,
  folderSelectionValue,
  type CreativeFolderSelection,
} from "@/components/assets/creative-folder-tree";
import { CreativeHistoryGrid } from "@/components/assets/creative-history-grid";
import { CreativeHistoryInspector } from "@/components/assets/creative-history-inspector";
import { SubjectList, type SubjectRow } from "@/components/assets/subject-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_OWNERSHIPS, type AssetOwnership } from "@/domain/campaigns/asset-library";
import { ImageOff } from "lucide-react";

/**
 * The Asset Library workspace: three purpose tabs, not one long page.
 *
 * Creative History uses Task 2's new upload/review API — a design has folders,
 * versions, rights, and a verdict that belongs to exact bytes. Products &
 * Subjects and Brand Kit reuse the existing brand-asset reference API, per the
 * binding decision that Task 2's work is scoped to Creative History only.
 *
 * Table/grid/search/filter/tab state lives in the URL (`tab`, `folder`,
 * `verdict`, `search`, `asset`) so a link can be shared; no preview URL,
 * customer payload, or unsaved text ever goes into it.
 *
 * Every mutation path here is gated twice: the control that starts it does
 * not render for a role that lacks the permission, and the function that
 * would actually call the network re-checks the same boolean before doing
 * anything. A prototype build of this surface hid a button for a viewer but
 * left its dialog-open handler reachable — a real hole, not a cosmetic one —
 * so nothing in this file relies on "the button was hidden" as its only
 * defense. Real enforcement is still the server's permission check; this is
 * defense in depth against exactly the failure mode the prototype hit.
 */

type Tab = "history" | "products" | "brand" | "brand-guidelines";
const TABS: readonly Tab[] = ["history", "products", "brand", "brand-guidelines"];
type Verdict = "all" | "approved" | "rejected" | "unreviewed";
const VERDICTS: readonly Verdict[] = ["all", "approved", "rejected", "unreviewed"];
const CREATIVE_TYPES = ["poster", "flyer", "social_post", "story", "carousel", "banner"] as const;
const RIGHTS_STATUSES = ["owned", "licensed", "permission_confirmed"] as const;
const BRAND_ASSET_BUCKET = "brand-assets";
// Stable references so a still-loading query's fallback does not itself
// defeat memoization further down by handing out a new empty array every
// render.
const EMPTY_FOLDERS: readonly CreativeHistoryFolderView[] = [];
const EMPTY_ITEMS: readonly CreativeHistoryItemView[] = [];

function fileBaseName(file: File): string {
  const withoutExtension = file.name.replace(/\.[^./]+$/, "");
  return withoutExtension.trim().length > 0 ? withoutExtension : file.name;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.length > 0 ? slug : `subject-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Creative History upload
// ---------------------------------------------------------------------------

type CreativeHistoryUploadFields = {
  label: string;
  creativeType: (typeof CREATIVE_TYPES)[number];
  folderId: string | null;
  rightsStatus: (typeof RIGHTS_STATUSES)[number];
  rightsHolder: string;
  reservation?: CreativeHistoryReservation;
};

function CreativeHistoryUploadDialog({
  organizationId,
  canManage,
  folders,
  defaultFolderId,
  onSettled,
}: Readonly<{
  organizationId: string;
  canManage: boolean;
  folders: readonly { folderId: string; name: string }[];
  defaultFolderId: string | null;
  onSettled: () => void;
}>) {
  const intake = useQuery(creativeHistoryIntakeQueryOptions({ organizationId }));
  const accept = (intake.data?.intake.allowedMimeTypes ?? ["image/jpeg", "image/png", "image/webp"]).join(",");
  const maxBytes = intake.data?.intake.maxBytes ?? 15 * 1024 * 1024;

  async function run(input: {
    file: File;
    fields: CreativeHistoryUploadFields;
    signal: AbortSignal;
    onStage: (stage: "uploading" | "processing") => void;
    patchFields: (patch: Partial<CreativeHistoryUploadFields>) => void;
  }): Promise<AssetUploadOutcome> {
    if (!canManage) {
      return { status: "refused", message: "Uploading needs the manage permission." };
    }
    let reservation = input.fields.reservation ?? null;
    if (!reservation) {
      input.onStage("uploading");
      reservation = await reserveCreativeItem(
        organizationId,
        {
          label: input.fields.label.trim() || fileBaseName(input.file),
          creativeType: input.fields.creativeType,
          folderId: input.fields.folderId,
          rights: {
            status: input.fields.rightsStatus,
            confirmedAt: new Date().toISOString(),
            ...(input.fields.rightsHolder.trim() ? { holder: input.fields.rightsHolder.trim() } : {}),
          },
          clientUploadId: newClientUploadId(),
        },
        { signal: input.signal },
      );
      input.patchFields({ reservation });
    }

    const transferred = await uploadCreativeBytes({
      bucket: reservation.bucket,
      storagePath: reservation.storagePath,
      file: input.file,
    });
    if (!transferred.ok) {
      return { status: "refused", message: transferred.message };
    }

    input.onStage("processing");
    const outcome = await completeCreativeVersion(
      organizationId,
      reservation.itemId,
      reservation.versionId,
      { signal: input.signal },
    );
    if (outcome.status === "usable") {
      return {
        status: "usable",
        message: outcome.replayed ? "Already uploaded." : "Uploaded — needs review.",
      };
    }
    if (outcome.status === "conflict") {
      return { status: "conflict", message: creativeHistoryRefusalLabel(outcome.reason, outcome.message) };
    }
    return { status: "refused", message: creativeHistoryRefusalLabel(outcome.reason, outcome.message) };
  }

  return (
    <AssetUpload<CreativeHistoryUploadFields>
      accept={accept}
      maxBytes={maxBytes}
      defaultFields={(file) => ({
        label: fileBaseName(file),
        creativeType: "poster",
        folderId: defaultFolderId,
        rightsStatus: "owned",
        rightsHolder: "",
      })}
      run={run}
      onSettled={onSettled}
      submitLabel="Upload designs"
      disabled={!canManage}
      disabledReason="Uploading designs needs the manage permission. You can review what is already here."
      renderFields={({ fields, onChange, disabled, fieldId }) => (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={fieldId("name")} className="text-xs">Name</Label>
            <Input
              id={fieldId("name")}
              dir="auto"
              value={fields.label}
              disabled={disabled}
              onChange={(event) => onChange({ ...fields, label: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={fieldId("type")} className="text-xs">Type</Label>
            <Select
              value={fields.creativeType}
              onValueChange={(value) => onChange({ ...fields, creativeType: value as CreativeHistoryUploadFields["creativeType"] })}
              disabled={disabled}
            >
              <SelectTrigger id={fieldId("type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREATIVE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {creativeTypeLabel(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={fieldId("folder")} className="text-xs">Folder</Label>
            <Select
              value={fields.folderId ?? "__none__"}
              onValueChange={(value) => onChange({ ...fields, folderId: value === "__none__" ? null : value })}
              disabled={disabled}
            >
              <SelectTrigger id={fieldId("folder")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Uncategorized</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.folderId} value={folder.folderId}>
                    <span dir="auto">{folder.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={fieldId("rights")} className="text-xs">Rights</Label>
            <Select
              value={fields.rightsStatus}
              onValueChange={(value) => onChange({ ...fields, rightsStatus: value as CreativeHistoryUploadFields["rightsStatus"] })}
              disabled={disabled}
            >
              <SelectTrigger id={fieldId("rights")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RIGHTS_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {creativeHistoryRightsChoice(status).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Brand-asset reference upload (Products & Subjects, Brand Kit)
// ---------------------------------------------------------------------------

type BrandAssetUploadFields = {
  label: string;
  assetRole: "logo" | "product" | "venue" | "team" | "other";
  ownership: AssetOwnership;
  reservation?: BrandAssetReservation;
};

/**
 * What an uploaded reference is, in the operator's words.
 *
 * `logo` is the one that changes behaviour rather than only filing: it is
 * classified `brand_mark`, which is what makes it selectable as the
 * organization's logo. It had no label here at all, so had it ever been
 * offered it would have read "Other".
 */
const ASSET_ROLE_LABELS: Readonly<Record<BrandAssetUploadFields["assetRole"], string>> = {
  logo: "Logo",
  product: "Product",
  venue: "Venue",
  team: "Team",
  other: "Other",
};

const UPLOADABLE_ASSET_ROLES = ["logo", "product", "venue", "team", "other"] as const;

function BrandAssetUploadDialog({
  organizationId,
  canManage,
  defaultAssetRole,
  onSettled,
}: Readonly<{
  organizationId: string;
  canManage: boolean;
  /**
   * What the open tab suggests, never what it imposes. The type used to be
   * pinned by the tab and the control hidden, so on Brand Kit the only visible
   * question was ownership — a Products & Subjects question — while the upload
   * was silently filed as a logo.
   */
  defaultAssetRole: BrandAssetUploadFields["assetRole"];
  onSettled: () => void;
}>) {
  async function run(input: {
    file: File;
    fields: BrandAssetUploadFields;
    signal: AbortSignal;
    onStage: (stage: "uploading" | "processing") => void;
    patchFields: (patch: Partial<BrandAssetUploadFields>) => void;
  }): Promise<AssetUploadOutcome> {
    if (!canManage) {
      return { status: "refused", message: "Uploading needs the manage permission." };
    }
    let reservation = input.fields.reservation ?? null;
    if (!reservation) {
      input.onStage("uploading");
      // A brand-mark upload is classified as our own logo; everything else
      // defaults to "the thing itself" — both are real conditioning roles
      // this library already understands, not invented ones.
      const conditioningRoles = input.fields.assetRole === "logo" ? ["brand_mark"] : ["subject"];
      reservation = await reserveBrandAsset(
        organizationId,
        {
          label: input.fields.label.trim() || fileBaseName(input.file),
          assetRole: input.fields.assetRole,
          classification: {
            conditioningRoles,
            tags: [],
            scripts: [],
            ownership: input.fields.ownership,
          },
        },
        { signal: input.signal },
      );
      input.patchFields({ reservation });
    }

    const transferred = await uploadCreativeBytes({
      bucket: BRAND_ASSET_BUCKET,
      storagePath: reservation.storagePath,
      file: input.file,
    });
    if (!transferred.ok) {
      return { status: "refused", message: transferred.message };
    }

    input.onStage("processing");
    const outcome = await completeBrandAssetVersion(
      organizationId,
      reservation.brandAssetId,
      reservation.versionId,
      { signal: input.signal },
    );
    if (outcome.status === "usable") return { status: "usable", message: "Uploaded — needs review." };
    return { status: "refused", message: outcome.message };
  }

  return (
    <AssetUpload<BrandAssetUploadFields>
      accept="image/jpeg,image/png,image/webp"
      maxBytes={15 * 1024 * 1024}
      defaultFields={(file) => ({
        label: fileBaseName(file),
        assetRole: defaultAssetRole,
        ownership: "third_party",
      })}
      run={run}
      onSettled={onSettled}
      submitLabel="Upload"
      disabled={!canManage}
      disabledReason="Uploading needs the manage permission. You can review what is already here."
      renderFields={({ fields, onChange, disabled, fieldId }) => (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={fieldId("name")} className="text-xs">Name</Label>
            <Input
              id={fieldId("name")}
              dir="auto"
              value={fields.label}
              disabled={disabled}
              onChange={(event) => onChange({ ...fields, label: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={fieldId("type")} className="text-xs">
              Type
            </Label>
            <Select
              value={fields.assetRole}
              onValueChange={(value) =>
                onChange({ ...fields, assetRole: value as BrandAssetUploadFields["assetRole"] })
              }
              disabled={disabled}
            >
              <SelectTrigger id={fieldId("type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UPLOADABLE_ASSET_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ASSET_ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fields.assetRole === "logo" ? (
              <p className="text-xs text-muted-foreground">
                Filed as your brand mark, so it can be set as your logo once reviewed.
              </p>
            ) : null}
          </div>
          <div className="col-span-full flex flex-col gap-1.5">
            <RadioGroup
              value={fields.ownership}
              onValueChange={(value) => onChange({ ...fields, ownership: value as AssetOwnership })}
              disabled={disabled}
            >
              {ASSET_OWNERSHIPS.map((option) => {
                const choice = ownershipChoice(option);
                const optionId = fieldId(`ownership-${option}`);
                return (
                  <div key={option} className="flex items-start gap-2">
                    <RadioGroupItem value={option} id={optionId} className="mt-0.5" />
                    <Label htmlFor={optionId} className="text-xs font-normal">
                      {choice.label}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </div>
        </div>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Add-subject entry point
// ---------------------------------------------------------------------------

function AddSubjectDialog({
  organizationId,
  onCreated,
}: Readonly<{ organizationId: string; onCreated: () => void }>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    try {
      await createSubjectProfile(organizationId, {
        name: trimmed,
        slug: slugify(trimmed),
        description: description.trim().length > 0 ? description.trim() : null,
      });
      toast.success("Subject added as a draft. Confirm it once its photo and description are right.");
      setName("");
      setDescription("");
      setOpen(false);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The subject could not be added.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Add subject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a subject</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-subject-name">What is this?</Label>
            <Input
              id="new-subject-name"
              dir="auto"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              placeholder="Kingfish curry"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-subject-description">Description (optional)</Label>
            <Textarea
              id="new-subject-description"
              dir="auto"
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <Button type="button" onClick={() => void submit()} disabled={pending || name.trim().length === 0}>
            Add as draft
          </Button>
          <p className="text-xs text-muted-foreground">
            A draft is not used for generation until an owner or admin confirms it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------

type AssetWorkspaceProps = {
  organizationId: string;
  timeZone: string;
  references: readonly LibraryReference[];
  subjects: readonly SubjectRow[];
  /** False for a role that may manage subjects but not approve one. */
  canConfirmSubjects: boolean;
  canManageSubjects: boolean;
  canManageAssets: boolean;
  canReviewAssets: boolean;
  /** `brand.manage`, which sits above the operator line. */
  canManageBrand: boolean;
};

export function AssetWorkspace({
  organizationId,
  timeZone,
  references,
  subjects,
  canConfirmSubjects,
  canManageSubjects,
  canManageAssets,
  canReviewAssets,
  canManageBrand,
}: AssetWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const tab: Tab = TABS.includes(searchParams.get("tab") as Tab) ? (searchParams.get("tab") as Tab) : "history";
  // What the upload dialog should offer first. Brand Guidelines sends people
  // to Brand Kit for a mark, so both tabs start on Logo — but the type stays
  // the operator's choice, not the tab's decision.
  const logoUpload = tab === "brand" || tab === "brand-guidelines";
  const folderSelection: CreativeFolderSelection = folderSelectionFromValue(searchParams.get("folder") ?? "all");
  const verdict: Verdict = VERDICTS.includes(searchParams.get("verdict") as Verdict)
    ? (searchParams.get("verdict") as Verdict)
    : "all";
  const search = searchParams.get("search") ?? "";
  const selectedAssetId = searchParams.get("asset");

  function setParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value.length === 0) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const foldersQuery = useQuery(creativeHistoryFoldersQueryOptions({ organizationId }));
  const itemsQuery = useQuery(
    creativeHistoryItemsQueryOptions({ organizationId, filters: { includeArchived: true } }),
  );
  const folders = foldersQuery.data ?? EMPTY_FOLDERS;
  const items = itemsQuery.data ?? EMPTY_ITEMS;

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((item) => {
        if (folderSelection.kind === "folder" && item.folderId !== folderSelection.folderId) return false;
        if (folderSelection.kind === "uncategorized" && item.folderId !== null) return false;
        const itemVerdict = item.currentVersion?.review?.verdict ?? null;
        if (verdict === "approved" && itemVerdict !== "approved") return false;
        if (verdict === "rejected" && itemVerdict !== "rejected") return false;
        if (verdict === "unreviewed" && itemVerdict !== null) return false;
        if (needle.length > 0 && !item.label.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [items, folderSelection, verdict, search]);

  const filtersActive = folderSelection.kind !== "all" || verdict !== "all" || search.trim().length > 0;

  async function send(path: string, method: string, body: unknown) {
    setFailure(null);
    setPending(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setFailure(payload?.error?.message ?? "That did not go through. Nothing was changed.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const referencesForTab = (roles: readonly string[]) =>
    references.filter((reference) => roles.includes(reference.assetRole));

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {failure === null ? null : (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {failure}
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Asset Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your designs, products and brand.</p>
        </div>
        {canManageAssets ? (
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button type="button">
                <Upload className="size-4" />
                Upload assets
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {tab === "history" ? "Upload designs" : "Upload an image"}
                </DialogTitle>
              </DialogHeader>
              {tab === "history" ? (
                <CreativeHistoryUploadDialog
                  organizationId={organizationId}
                  canManage={canManageAssets}
                  folders={folders}
                  defaultFolderId={folderSelection.kind === "folder" ? folderSelection.folderId : null}
                  onSettled={() => void invalidateCreativeHistoryQueries(queryClient, organizationId)}
                />
              ) : (
                <BrandAssetUploadDialog
                  organizationId={organizationId}
                  canManage={canManageAssets}
                  defaultAssetRole={logoUpload ? "logo" : "product"}
                  onSettled={() => router.refresh()}
                />
              )}
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value === "history" ? null : value })}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="history" className="shrink-0">
            Creative History
          </TabsTrigger>
          <TabsTrigger value="products" className="shrink-0">
            Products &amp; Subjects
          </TabsTrigger>
          <TabsTrigger value="brand" className="shrink-0">
            Brand Kit
          </TabsTrigger>
          <TabsTrigger value="brand-guidelines" className="shrink-0">
            Brand Guidelines
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="flex flex-col gap-4 lg:flex-row">
          <CreativeFolderTree
            folders={folders}
            selection={folderSelection}
            onSelect={(next) => setParams({ folder: folderSelectionValue(next) === "all" ? null : folderSelectionValue(next) })}
            canManage={canManageAssets}
            onCreateFolder={(input) => {
              createCreativeFolder(organizationId, { ...input, defaultMetadata: null })
                .then(() => {
                  toast.success("Folder created.");
                  void invalidateCreativeHistoryQueries(queryClient, organizationId);
                })
                .catch((error) =>
                  toast.error(error instanceof Error ? error.message : "The folder could not be created."),
                );
            }}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(event) => setParams({ search: event.target.value || null })}
                placeholder="Search"
                className="w-full sm:w-56"
                aria-label="Search designs"
              />
              <div role="tablist" aria-label="Verdict" className="flex flex-wrap gap-1">
                {VERDICTS.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    role="tab"
                    aria-selected={verdict === option}
                    variant={verdict === option ? "default" : "outline"}
                    onClick={() => setParams({ verdict: option === "all" ? null : option })}
                  >
                    {option === "all" ? "All" : option === "approved" ? "Approved" : option === "rejected" ? "Rejected" : "Unreviewed"}
                  </Button>
                ))}
              </div>
              {filtersActive ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setParams({ folder: null, verdict: null, search: null })}
                >
                  Clear filters
                </Button>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">{filteredItems.length} shown</span>
            </div>

            {itemsQuery.isError ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                  <h3 className="text-lg font-semibold">Couldn&apos;t load Creative History</h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    The design list didn&apos;t respond. Nothing shown elsewhere has been lost.
                  </p>
                  <Button type="button" onClick={() => itemsQuery.refetch()}>
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <CreativeHistoryGrid
                items={filteredItems}
                onSelect={(itemId) => setParams({ asset: itemId })}
                selectedItemId={selectedAssetId}
                onReloadPreviews={() => itemsQuery.refetch()}
                timeZone={timeZone}
                emptyState={
                  items.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ImageOff />
                        </EmptyMedia>
                        <EmptyTitle>No designs yet</EmptyTitle>
                        <EmptyDescription>
                          Upload a past design to start building this client&apos;s Creative History.
                        </EmptyDescription>
                      </EmptyHeader>
                      {canManageAssets ? (
                        <EmptyContent>
                          <Button type="button" onClick={() => setUploadOpen(true)}>
                            Upload designs
                          </Button>
                        </EmptyContent>
                      ) : null}
                    </Empty>
                  ) : (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>No matches</EmptyTitle>
                        <EmptyDescription>No design matches these filters.</EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setParams({ folder: null, verdict: null, search: null })}
                        >
                          Clear filters
                        </Button>
                      </EmptyContent>
                    </Empty>
                  )
                }
              />
            )}
          </div>

          <CreativeHistoryInspector
            organizationId={organizationId}
            itemId={selectedAssetId}
            onClose={() => setParams({ asset: null })}
            canReview={canReviewAssets}
            canManage={canManageAssets}
            timeZone={timeZone}
          />
        </TabsContent>

        <TabsContent value="products" className="flex flex-col gap-6">
          <AssetLibraryGrid
            references={referencesForTab(["product", "venue", "team", "other"])}
            renderActions={
              canReviewAssets
                ? (reference) => (
                    <AssetReviewForm
                      subjectKind="brand_asset_version"
                      subjectId={reference.brandAssetVersionId}
                      pending={pending}
                      onSubmit={(submission: AssetReviewSubmission) => void send("/assets/reviews", "POST", submission)}
                    />
                  )
                : undefined
            }
          />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Subjects</h3>
              {canManageSubjects ? (
                <AddSubjectDialog organizationId={organizationId} onCreated={() => router.refresh()} />
              ) : null}
            </div>
            <SubjectList
              subjects={subjects}
              canConfirm={canConfirmSubjects}
              pending={pending}
              onConfirm={(subjectId) => void send(`/subjects/${subjectId}`, "PATCH", { action: "confirm" })}
            />
          </div>
        </TabsContent>

        <TabsContent value="brand">
          <AssetLibraryGrid
            references={referencesForTab(["logo"])}
            renderActions={
              canReviewAssets
                ? (reference) => (
                    <AssetReviewForm
                      subjectKind="brand_asset_version"
                      subjectId={reference.brandAssetVersionId}
                      pending={pending}
                      onSubmit={(submission: AssetReviewSubmission) => void send("/assets/reviews", "POST", submission)}
                    />
                  )
                : undefined
            }
          />
        </TabsContent>

        <TabsContent value="brand-guidelines">
          <BrandGuidelinesPanel
            organizationId={organizationId}
            canManage={canManageBrand}
            references={references}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
