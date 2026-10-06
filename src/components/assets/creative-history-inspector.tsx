"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  creativeHistoryEligibilityLabel,
  creativeHistoryRefusalLabel,
  creativeHistoryRightsChoice,
  creativeHistoryUploadStateLabel,
  creativeTypeLabel,
  reviewReasonLabel,
} from "@/components/assets/asset-vocabulary";
import {
  completeCreativeVersion,
  confirmCreativeMetadata,
  creativeHistoryIntakeQueryOptions,
  creativeHistoryItemQueryOptions,
  invalidateCreativeHistoryQueries,
  reviewCreativeVersion,
  type CreativeHistoryMetadata,
} from "@/components/assets/asset-query-options";
import { archiveCreativeItem } from "@/components/assets/asset-query-options";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  CREATIVE_REVIEW_REASON_CODES,
  type CreativeReviewReasonCode,
} from "@/domain/campaigns/asset-library";

/**
 * The exact-version inspector.
 *
 * Two rules this file exists to hold the line on:
 *
 * A verdict belongs to a version, not a folder or a design name — every
 * review action here names `currentVersion.versionId` explicitly, never the
 * item, so approving v2 can never be read back as having approved v1.
 *
 * The review and archive controls are gated at the function that performs the
 * mutation, not only at whether the button is rendered. A prototype build of
 * this exact surface hid the button for a viewer but left the dialog-open
 * handler reachable, which is a real hole: anything wired only to a hidden
 * control is one keyboard shortcut or stray click away from firing anyway.
 * `submitReview` and `submitArchive` below both re-check the permission
 * booleans themselves before calling the network, so there is no path from a
 * rendered-but-inert control to a mutation the server would have to refuse.
 */

const METADATA_FIELDS: ReadonlyArray<{ key: keyof CreativeHistoryMetadata; label: string }> = [
  { key: "subjectTags", label: "Subject" },
  { key: "occasionTags", label: "Occasion" },
  { key: "channels", label: "Channels" },
  { key: "formats", label: "Formats" },
  { key: "markets", label: "Markets" },
  { key: "languages", label: "Languages" },
  { key: "objectives", label: "Objectives" },
  { key: "styleTags", label: "Style" },
];

function emptyMetadata(): CreativeHistoryMetadata {
  return {
    subjectTags: [],
    occasionTags: [],
    channels: [],
    formats: [],
    markets: [],
    languages: [],
    objectives: [],
    styleTags: [],
  };
}

function metadataToDraft(metadata: CreativeHistoryMetadata | null): Record<string, string> {
  const source = metadata ?? emptyMetadata();
  return Object.fromEntries(
    METADATA_FIELDS.map((field) => [field.key, source[field.key].join(", ")]),
  );
}

function draftToMetadata(draft: Record<string, string>): CreativeHistoryMetadata {
  const base = emptyMetadata();
  for (const field of METADATA_FIELDS) {
    const raw = draft[field.key] ?? "";
    base[field.key] = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }
  return base;
}

function MetadataList({ label, metadata }: { label: string; metadata: CreativeHistoryMetadata | null }) {
  if (metadata === null) return null;
  const populated = METADATA_FIELDS.filter((field) => metadata[field.key].length > 0);
  if (populated.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-1">
        {populated.map((field) => (
          <p key={field.key} className="text-xs">
            <span className="text-muted-foreground">{field.label}: </span>
            <span dir="auto">{metadata[field.key].join(", ")}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

type CreativeHistoryInspectorProps = {
  organizationId: string;
  itemId: string | null;
  onClose: () => void;
  /** Server-checked. Gates both the control and the submit function itself. */
  canReview: boolean;
  canManage: boolean;
  timeZone: string;
};

export function CreativeHistoryInspector({
  organizationId,
  itemId,
  onClose,
  canReview,
  canManage,
  timeZone,
}: CreativeHistoryInspectorProps) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reasonCodes, setReasonCodes] = useState<readonly CreativeReviewReasonCode[]>([]);
  const [note, setNote] = useState("");
  const [missingReason, setMissingReason] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<Record<string, string>>({});
  const [previewExpired, setPreviewExpired] = useState(false);

  const itemQuery = useQuery(creativeHistoryItemQueryOptions({ organizationId, itemId }));
  const intakeQuery = useQuery(creativeHistoryIntakeQueryOptions({ organizationId }));
  const item = itemQuery.data ?? null;

  /**
   * Resets the local review/edit UI when a different design opens, and
   * seeds the metadata draft once that design's data has loaded — both done
   * during render (the documented "adjust state when a prop changes"
   * pattern), not inside a `useEffect`, which would set state synchronously
   * after commit and trigger an extra render for exactly this purpose.
   */
  const [resetForItemId, setResetForItemId] = useState(itemId);
  if (itemId !== resetForItemId) {
    setResetForItemId(itemId);
    setRejecting(false);
    setReasonCodes([]);
    setNote("");
    setMissingReason(false);
    setEditingMetadata(false);
    setPreviewExpired(false);
  }

  const [metadataDraftItemId, setMetadataDraftItemId] = useState<string | null>(null);
  if (item !== null && item.itemId !== metadataDraftItemId) {
    setMetadataDraftItemId(item.itemId);
    setMetadataDraft(metadataToDraft(item.confirmedMetadata));
  }

  const invalidate = () => {
    void invalidateCreativeHistoryQueries(queryClient, organizationId);
  };

  const review = useMutation({
    mutationFn: (input: {
      versionId: string;
      verdict: "approved" | "rejected";
      reasonCodes: readonly string[];
      note: string | null;
    }) => reviewCreativeVersion(organizationId, item!.itemId, input),
    onSuccess: () => {
      toast.success("Review recorded.");
      setRejecting(false);
      setReasonCodes([]);
      setNote("");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The review could not be saved."),
  });

  const archive = useMutation({
    mutationFn: () => archiveCreativeItem(organizationId, item!.itemId),
    onSuccess: () => {
      toast.success("Design archived. Its history stays readable.");
      invalidate();
      onClose();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The design could not be archived."),
  });

  const confirmMetadata = useMutation({
    mutationFn: (metadata: CreativeHistoryMetadata) =>
      confirmCreativeMetadata(organizationId, item!.itemId, metadata),
    onSuccess: () => {
      toast.success("Description confirmed.");
      setEditingMetadata(false);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The description could not be saved."),
  });

  const retryFinalize = useMutation({
    mutationFn: () => completeCreativeVersion(organizationId, item!.itemId, item!.pendingVersion!.versionId),
    onSuccess: (outcome) => {
      if (outcome.status === "usable") {
        toast.success("The file finished processing.");
      } else if (outcome.status === "conflict") {
        toast.error(creativeHistoryRefusalLabel(outcome.reason, outcome.message));
      } else {
        toast.error(creativeHistoryRefusalLabel(outcome.reason, outcome.message));
      }
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That could not be retried."),
  });

  /**
   * Re-checks `canReview` itself, rather than trusting that the button that
   * called it could only exist when the permission was already true. See the
   * file header — this is the exact hole a viewer-role gate on the control
   * alone would leave open.
   */
  function submitReview(verdict: "approved" | "rejected") {
    if (!canReview) {
      toast.error("Reviewing designs needs the review permission.");
      return;
    }
    if (!item?.currentVersion) return;
    if (verdict === "rejected" && reasonCodes.length === 0) {
      setMissingReason(true);
      return;
    }
    const trimmed = note.trim();
    review.mutate({
      versionId: item.currentVersion.versionId,
      verdict,
      reasonCodes: verdict === "approved" ? [] : reasonCodes,
      note: trimmed.length === 0 ? null : trimmed,
    });
  }

  function submitArchive() {
    if (!canManage) {
      toast.error("Archiving needs the manage permission.");
      return;
    }
    archive.mutate();
  }

  function submitMetadata() {
    if (!canManage) {
      toast.error("Confirming a description needs the manage permission.");
      return;
    }
    confirmMetadata.mutate(draftToMetadata(metadataDraft));
  }

  function toggleReason(code: CreativeReviewReasonCode) {
    setMissingReason(false);
    setReasonCodes((current) =>
      current.includes(code) ? current.filter((held) => held !== code) : [...current, code],
    );
  }

  return (
    <Sheet open={itemId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {item === null ? (
          <div className="flex h-full items-center justify-center p-6">
            {itemQuery.isPending ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : itemQuery.isError ? (
              <p className="text-sm text-destructive" role="alert">
                This design could not be opened.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle dir="auto">{item.label}</SheetTitle>
              <SheetDescription>
                {creativeTypeLabel(item.creativeType)} · {creativeHistoryEligibilityLabel(item.eligibility)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 pb-6">
              {/* Large contained preview, upright, label outside the creative. */}
              {item.currentVersion?.previewUrl && !previewExpired ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, time-boxed URL
                <img
                  src={item.currentVersion.previewUrl}
                  alt={item.label}
                  className="max-h-80 w-full rounded-md bg-muted object-contain"
                  onError={() => setPreviewExpired(true)}
                />
              ) : (
                <div className="flex h-52 w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground">
                  {item.pendingVersion ? (
                    <>
                      <Loader2 className="size-6 animate-spin" />
                      <span className="text-xs">{creativeHistoryUploadStateLabel(item.uploadState)}</span>
                    </>
                  ) : (
                    <>
                      <ImageOff className="size-6" />
                      <span className="text-xs">
                        {previewExpired ? "Preview expired" : "No preview available"}
                      </span>
                    </>
                  )}
                </div>
              )}

              {item.pendingVersion && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={retryFinalize.isPending}
                  onClick={() => retryFinalize.mutate()}
                >
                  {retryFinalize.isPending ? "Checking…" : "Finish processing this file"}
                </Button>
              ) : null}

              {/* Metadata: confirmed, proposed (advisory), and folder default. */}
              <div className="flex flex-col gap-3 border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Description</p>
                  {canManage && !editingMetadata ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditingMetadata(true)}>
                      {item.confirmedMetadata ? "Edit" : "Confirm"}
                    </Button>
                  ) : null}
                </div>

                {editingMetadata ? (
                  <div className="flex flex-col gap-2.5">
                    {METADATA_FIELDS.map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <Label htmlFor={`metadata-${field.key}`}>{field.label}</Label>
                        <Input
                          id={`metadata-${field.key}`}
                          dir="auto"
                          value={metadataDraft[field.key] ?? ""}
                          onChange={(event) =>
                            setMetadataDraft((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          placeholder="Comma-separated"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={submitMetadata}
                        disabled={confirmMetadata.isPending}
                      >
                        Save confirmed description
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingMetadata(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <MetadataList label="Confirmed" metadata={item.confirmedMetadata} />
                    <MetadataList label="Suggested (not yet confirmed)" metadata={item.proposedMetadata} />
                    <MetadataList label="Folder default" metadata={item.folderDefaultMetadata} />
                    {item.confirmedMetadata === null &&
                    item.proposedMetadata === null &&
                    item.folderDefaultMetadata === null ? (
                      <p className="text-xs text-muted-foreground">No description recorded yet.</p>
                    ) : null}
                  </>
                )}
              </div>

              {/* Rights, folder. */}
              <div className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Rights</p>
                  <p>{creativeHistoryRightsChoice(String((item.rights as { status?: unknown }).status ?? "")).label}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Folder</p>
                  <p dir="auto">{item.folderName ?? "Uncategorized"}</p>
                </div>
              </div>

              {/* Version history. */}
              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-sm font-semibold">Version history</p>
                <ul className="flex flex-col gap-2">
                  {item.versions.map((version) => (
                    <li key={version.versionId} className="flex flex-col gap-0.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">v{version.version}</span>
                        <span className="text-muted-foreground">
                          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone }).format(
                            new Date(version.createdAt),
                          )}
                        </span>
                        {version.review ? (
                          <Badge variant={version.review.verdict === "approved" ? "default" : "secondary"}>
                            {version.review.verdict === "approved" ? "Approved" : "Rejected"}
                          </Badge>
                        ) : version.state === "usable" ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            Unreviewed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            {creativeHistoryUploadStateLabel("reserved")}
                          </Badge>
                        )}
                        {version.sourceKind === "studio_render" ? (
                          <Badge variant="outline">From Studio</Badge>
                        ) : null}
                      </div>
                      {version.review?.reasonCodes.length ? (
                        <p className="text-muted-foreground">
                          {version.review.reasonCodes
                            .map((code) => reviewReasonLabel(code as CreativeReviewReasonCode))
                            .join(", ")}
                          {version.review.note ? ` — ${version.review.note}` : ""}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Review actions: gated at the control and, again, at submit. */}
              {canReview && item.currentVersion ? (
                <div className="flex flex-col gap-3 border-t pt-4">
                  <p className="text-sm font-semibold">Review this version</p>
                  {!rejecting ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" disabled={review.isPending} onClick={() => submitReview("approved")}>
                        Approve as reference
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={review.isPending}
                        onClick={() => setRejecting(true)}
                      >
                        Reject as reference
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        {(intakeQuery.data?.reviewReasons.map((reason) => reason.code) ??
                          CREATIVE_REVIEW_REASON_CODES
                        ).map((code) => {
                          const reasonCode = code as CreativeReviewReasonCode;
                          const chosen = reasonCodes.includes(reasonCode);
                          return (
                            <Button
                              key={reasonCode}
                              type="button"
                              size="sm"
                              variant={chosen ? "default" : "outline"}
                              aria-pressed={chosen}
                              onClick={() => toggleReason(reasonCode)}
                            >
                              {reviewReasonLabel(reasonCode)}
                            </Button>
                          );
                        })}
                      </div>
                      <Textarea
                        value={note}
                        maxLength={500}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Anything to add? (optional)"
                      />
                      {missingReason ? (
                        <p role="alert" className="text-sm text-destructive">
                          Choose at least one reason. A rejection without a reason teaches the next
                          attempt nothing.
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={review.isPending}
                          onClick={() => submitReview("rejected")}
                        >
                          Send rejection
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRejecting(false);
                            setReasonCodes([]);
                            setMissingReason(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {canManage && item.archivedAt === null ? (
                <div className="border-t pt-4">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Archive design
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive this design?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Archiving removes it from future selection. Every version, review, and
                          receipt it has earned stays readable, and this can be reversed later.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={submitArchive}>Archive</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
