"use client";

import { CheckCircle2, CircleAlert, Loader2, UploadCloud, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * The generic batch-upload engine, used for both Creative History and the
 * brand-asset reference library. The two domains reserve, transfer, and
 * finalize a file through different APIs — `run` below is where each caller
 * supplies its own three-step sequence — but the file-queue mechanics are
 * identical: a file picker and a drop zone, one entry per file keyed by a
 * client-generated ID rather than a filename (so two files both named
 * `poster.png` never collide or get merged in the list), per-file fields,
 * per-file progress and outcome, and retry that only touches the entries that
 * actually failed.
 *
 * Distinguishing bytes-transferred from processed from usable is not
 * cosmetic. `run` calls `onStage` when it moves from putting bytes in
 * storage to asking the server to finalize them, so an operator watching a
 * large file can tell "still sending" from "server is checking it now"
 * rather than staring at one spinner for both.
 *
 * A refusal is rendered as a refusal, never smoothed into "Uploaded" —
 * `AssetUploadOutcome` is a tagged union the caller must switch on, and this
 * component never invents a success state for a status it does not
 * recognise.
 */

export type AssetUploadOutcome =
  | { status: "queued" }
  | { status: "uploading" }
  | { status: "processing" }
  | { status: "usable"; message?: string }
  | { status: "refused"; message: string }
  /** Not retryable at the same slot: the bytes at that reservation are final. */
  | { status: "conflict"; message: string }
  | { status: "cancelled" };

export type AssetUploadEntry<TFields> = {
  clientId: string;
  file: File;
  fields: TFields;
  outcome: AssetUploadOutcome;
};

export type AssetUploadRunner<TFields> = (input: {
  file: File;
  fields: TFields;
  signal: AbortSignal;
  onStage: (stage: "uploading" | "processing") => void;
  /**
   * Lets a runner remember a reservation on the entry itself, so a retry
   * after a failed transfer or finalize reuses the same reserved item and
   * version instead of reserving a brand-new one. Retrying a lost response
   * must replay the same intent, never double it.
   */
  patchFields: (patch: Partial<TFields>) => void;
}) => Promise<AssetUploadOutcome>;

type AssetUploadProps<TFields> = {
  /** Shown in the file picker; advisory only, never enforced as authority. */
  accept: string;
  maxBytes: number;
  defaultFields: (file: File) => TFields;
  renderFields: (input: {
    fields: TFields;
    onChange: (next: TFields) => void;
    disabled: boolean;
    /** Unique per queued file, so a caller building `<Label htmlFor>` +
     * `<Input id>` pairs across a multi-file queue never collides two
     * files' otherwise-identical field names ("Name", "Type", ...) into the
     * same DOM id. */
    fieldId: (name: string) => string;
  }) => ReactNode;
  run: AssetUploadRunner<TFields>;
  onSettled?: () => void;
  submitLabel?: string;
  /** True for a viewer: the control is hidden by the caller, but this also
   * disables everything here so a control that somehow renders cannot submit. */
  disabled?: boolean;
  disabledReason?: string;
};

const OUTCOME_ICON: Readonly<Record<AssetUploadOutcome["status"], typeof Loader2>> = {
  queued: UploadCloud,
  uploading: Loader2,
  processing: Loader2,
  usable: CheckCircle2,
  refused: CircleAlert,
  conflict: CircleAlert,
  cancelled: X,
};

function outcomeMessage(outcome: AssetUploadOutcome): string | null {
  switch (outcome.status) {
    case "queued":
      return null;
    case "uploading":
      return "Uploading…";
    case "processing":
      return "Checking the file…";
    case "usable":
      return outcome.message ?? "Uploaded.";
    case "refused":
      return outcome.message;
    case "conflict":
      return outcome.message;
    case "cancelled":
      return "Cancelled.";
  }
}

function isRetryable(outcome: AssetUploadOutcome): boolean {
  return outcome.status === "refused" || outcome.status === "cancelled";
}

export function AssetUpload<TFields>({
  accept,
  maxBytes,
  defaultFields,
  renderFields,
  run,
  onSettled,
  submitLabel = "Upload",
  disabled = false,
  disabledReason,
}: AssetUploadProps<TFields>) {
  const [entries, setEntries] = useState<readonly AssetUploadEntry<TFields>[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(files: FileList | File[]) {
    const added: AssetUploadEntry<TFields>[] = Array.from(files).map((file) => {
      const tooLarge = file.size > maxBytes;
      return {
        clientId: crypto.randomUUID(),
        file,
        fields: defaultFields(file),
        outcome: tooLarge
          ? {
              status: "refused",
              message: `That file is larger than the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`,
            }
          : { status: "queued" },
      };
    });
    setEntries((current) => [...current, ...added]);
  }

  function removeEntry(clientId: string) {
    setEntries((current) => current.filter((entry) => entry.clientId !== clientId));
  }

  function cancelEntry(clientId: string) {
    controllers.current.get(clientId)?.abort();
    setEntries((current) =>
      current.map((entry) =>
        entry.clientId === clientId && (entry.outcome.status === "queued" || entry.outcome.status === "uploading")
          ? { ...entry, outcome: { status: "cancelled" } }
          : entry,
      ),
    );
  }

  function updateFields(clientId: string, next: TFields) {
    setEntries((current) =>
      current.map((entry) => (entry.clientId === clientId ? { ...entry, fields: next } : entry)),
    );
  }

  function setOutcome(clientId: string, outcome: AssetUploadOutcome) {
    setEntries((current) =>
      current.map((entry) => (entry.clientId === clientId ? { ...entry, outcome } : entry)),
    );
  }

  async function runEntry(entry: AssetUploadEntry<TFields>) {
    const controller = new AbortController();
    controllers.current.set(entry.clientId, controller);
    setOutcome(entry.clientId, { status: "uploading" });
    try {
      const outcome = await run({
        file: entry.file,
        fields: entry.fields,
        signal: controller.signal,
        onStage: (stage) => setOutcome(entry.clientId, { status: stage }),
        patchFields: (patch) => updateFields(entry.clientId, { ...entry.fields, ...patch }),
      });
      setOutcome(entry.clientId, outcome);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setOutcome(entry.clientId, { status: "cancelled" });
      } else {
        setOutcome(entry.clientId, {
          status: "refused",
          message: error instanceof Error ? error.message : "That upload could not be finished.",
        });
      }
    } finally {
      controllers.current.delete(entry.clientId);
    }
  }

  async function startAll() {
    const queued = entries.filter((entry) => entry.outcome.status === "queued");
    await Promise.all(queued.map((entry) => runEntry(entry)));
    onSettled?.();
  }

  async function retryFailed() {
    const retryable = entries.filter((entry) => isRetryable(entry.outcome));
    await Promise.all(retryable.map((entry) => runEntry(entry)));
    onSettled?.();
  }

  const hasQueued = entries.some((entry) => entry.outcome.status === "queued");
  const hasRetryable = entries.some((entry) => isRetryable(entry.outcome));
  const busy = entries.some(
    (entry) => entry.outcome.status === "uploading" || entry.outcome.status === "processing",
  );

  return (
    <div className="flex flex-col gap-4">
      {disabled && disabledReason ? (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      ) : (
        <>
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose files or drop them here"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
            }}
            className={
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm " +
              (dragOver ? "border-primary bg-accent/40" : "border-muted-foreground/30")
            }
          >
            <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
            <p>Drag files here, or</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
            >
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={accept}
              className="sr-only"
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {entries.length === 0 ? null : (
            <ul className="flex flex-col gap-3">
              {entries.map((entry) => {
                const Icon = OUTCOME_ICON[entry.outcome.status];
                const message = outcomeMessage(entry.outcome);
                const spinning = entry.outcome.status === "uploading" || entry.outcome.status === "processing";
                const editable = entry.outcome.status === "queued";
                const cancellable = entry.outcome.status === "queued" || entry.outcome.status === "uploading";
                return (
                  <li key={entry.clientId} className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon
                          className={
                            "size-4 shrink-0 " +
                            (spinning ? "animate-spin text-muted-foreground " : "") +
                            (entry.outcome.status === "refused" || entry.outcome.status === "conflict"
                              ? "text-destructive"
                              : "text-muted-foreground")
                          }
                        />
                        <span className="truncate text-sm">{entry.file.name}</span>
                      </div>
                      {cancellable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${entry.file.name}`}
                          onClick={() =>
                            entry.outcome.status === "queued"
                              ? removeEntry(entry.clientId)
                              : cancelEntry(entry.clientId)
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                    {message ? (
                      <span
                        role={entry.outcome.status === "refused" || entry.outcome.status === "conflict" ? "alert" : undefined}
                        className={
                          "text-xs " +
                          (entry.outcome.status === "refused" || entry.outcome.status === "conflict"
                            ? "text-destructive"
                            : "text-muted-foreground")
                        }
                      >
                        {message}
                      </span>
                    ) : null}
                    {editable ? renderFields({
                      fields: entry.fields,
                      onChange: (next) => updateFields(entry.clientId, next),
                      disabled: busy,
                      fieldId: (name) => `asset-upload-${entry.clientId}-${name}`,
                    }) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void startAll()} disabled={!hasQueued || busy}>
              {submitLabel}
            </Button>
            {hasRetryable ? (
              <Button type="button" variant="outline" onClick={() => void retryFailed()} disabled={busy}>
                Retry failed
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
