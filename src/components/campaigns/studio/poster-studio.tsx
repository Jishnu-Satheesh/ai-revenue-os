"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Image as ImageIcon,
  Loader2,
  PanelRight,
  Redo2,
  Type,
  Undo2,
} from "lucide-react";

import { AnnotationCanvas } from "@/components/campaigns/studio/annotation-canvas";
import { LayoutControls } from "@/components/campaigns/studio/layout-controls";
import { ReferenceInspector } from "@/components/campaigns/studio/reference-inspector";
import { StudioPreview } from "@/components/campaigns/studio/studio-preview";
import { TextControls, type StudioTextDraft } from "@/components/campaigns/studio/text-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RenderableScript } from "@/domain/campaigns/poster-template";
import { detectScriptMismatch } from "@/domain/campaigns/script-detection";
import type { PosterStudioView } from "@/modules/campaigns/application/poster-studio-view";
import type { PosterStudioPlate } from "@/modules/campaigns/infrastructure/poster-studio-reader";

/**
 * The Creative Studio.
 *
 * Three rules shape the whole surface.
 *
 * **Nothing usable is hidden, and nothing unusable is silent.** Every template
 * this campaign could carry is listed, and the ones it cannot are shown dimmed
 * with the reason attached. An operator who cannot find a template concludes
 * the platform is broken; one who reads "this campaign has no governed offer
 * line" learns what is actually missing.
 *
 * **The words are shown before the picture is made.** Every string a poster
 * will draw is quoted from the approved manifest, so an operator can check it
 * without spending a render — and the browser preview places those strings in
 * the template's real boxes using the renderer's own fitting rule.
 *
 * **Saving and rendering are two acts, because they are two acts.** Editing
 * approved copy writes a new version; rendering draws one version. The button
 * therefore says which one it is about to do rather than offering a single
 * "Save & render" that would have to guess. Chaining them silently would also
 * mean rendering against a version whose assets this page has not read, which
 * is how the wrong picture ends up under the right words.
 */

const SCRIPT_LABEL: Readonly<Record<RenderableScript, string>> = {
  Latn: "English",
  Mlym: "മലയാളം",
  Arab: "العربية",
};

type StudioState = "saved" | "unsaved" | "saving" | "rendering";

const STATE_LABEL: Readonly<Record<StudioState, string>> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving",
  rendering: "Rendering",
};

export type PosterStudioProps = {
  readonly view: PosterStudioView;
  readonly plates: readonly PosterStudioPlate[];
  readonly renderPreviews: Readonly<Record<string, string>>;
  readonly organizationId: string;
  readonly campaignId: string;
  /** False for a viewer, who may read the Studio and produce nothing. */
  readonly canRender: boolean;
  readonly canEdit: boolean;
};

export function PosterStudio(props: PosterStudioProps) {
  const { view, plates, renderPreviews } = props;
  const router = useRouter();
  const [, startNavigation] = useTransition();

  const [script, setScript] = useState<RenderableScript>(view.scripts[0] ?? "Latn");
  const [directionId, setDirectionId] = useState(view.directions[0]?.id ?? "");
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "saving" | "rendering">(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const plateByKey = useMemo(
    () => new Map(plates.map((plate) => [plate.assetKey, plate])),
    [plates],
  );

  const direction = view.directions.find((entry) => entry.id === directionId) ?? null;
  const plate = direction ? (plateByKey.get(direction.plateAssetKey) ?? null) : null;

  const offers = useMemo(
    () => view.offers.filter((offer) => offer.directionId === directionId),
    [view.offers, directionId],
  );

  const selected =
    offers.find((offer) => offer.templateKey === templateKey) ??
    offers.find((offer) => offer.availability.available) ??
    offers[0] ??
    null;

  const baseline: StudioTextDraft = useMemo(
    () => ({
      hook: selected?.copy?.hook ?? "",
      callToAction: selected?.copy?.callToAction ?? "",
      extra: "",
    }),
    [selected?.copy?.hook, selected?.copy?.callToAction],
  );

  /**
   * Local edit history, kept in memory and never persisted.
   *
   * Undo before a save is just moving through drafts. Undo *after* a save would
   * be a new version restoring earlier values, which is a different act with a
   * different audit trail — so this stack is cleared whenever the page moves to
   * a new saved version rather than pretending to reach back across one.
   */
  const [history, setHistory] = useState<readonly StudioTextDraft[]>([baseline]);
  const [cursor, setCursor] = useState(0);
  const draft = history[cursor] ?? baseline;

  /**
   * Typing is coalesced into one history entry per burst.
   *
   * An entry per keystroke is technically an undo stack and practically
   * useless: reverting a headline would mean clicking Undo forty times. So a
   * run of edits to the same field, with no pause longer than the gap below,
   * keeps replacing the top entry instead of stacking on it. Moving to another
   * field or stopping to think starts a new one, which is roughly where a
   * person expects an undo to land.
   */
  const lastEdit = useRef<{ field: keyof StudioTextDraft; at: number } | null>(null);
  const COALESCE_MS = 700;

  const pushDraft = useCallback(
    (next: StudioTextDraft) => {
      const current = history[cursor];
      const field = current
        ? (Object.keys(next) as (keyof StudioTextDraft)[]).find((key) => next[key] !== current[key])
        : undefined;
      if (field === undefined) return;

      const now = Date.now();
      const coalesce =
        lastEdit.current !== null &&
        lastEdit.current.field === field &&
        now - lastEdit.current.at < COALESCE_MS;
      lastEdit.current = { field, at: now };

      // Editing after an undo discards what was redoable. Keeping it would let
      // Redo jump to a draft that never followed from what is now on screen.
      // Never below 1: index 0 is the approved text, and coalescing over it
      // would leave undo with nowhere to go back to.
      const kept = history.slice(0, coalesce ? Math.max(1, cursor) : cursor + 1);
      setHistory([...kept, next]);
      setCursor(kept.length);
    },
    [history, cursor],
  );

  const copyChanged =
    selected?.copy != null &&
    (draft.hook !== selected.copy.hook || draft.callToAction !== selected.copy.callToAction);
  const dirty = copyChanged || draft.extra.trim() !== "";

  const state: StudioState =
    busy === "saving" ? "saving" : busy === "rendering" ? "rendering" : dirty ? "unsaved" : "saved";

  const renders = useMemo(
    () =>
      view.renders.filter(
        (render) =>
          render.script === script &&
          (selected === null || render.templateKey === selected.templateKey),
      ),
    [view.renders, script, selected],
  );

  const latestRenderUrl =
    renders.find((render) => render.state === "rendered" && renderPreviews[render.id])?.id ?? null;

  /**
   * The language picker chooses which face draws the poster; the copy is
   * whatever the approved manifest holds. Nothing stops those disagreeing, and
   * when they do the renderer refuses on glyph coverage — after the render has
   * been queued and paid for. This says so beforehand.
   *
   * It can only warn. Silence here is "no mismatch found", not "this will
   * render": coverage is a cmap question answered by the renderer.
   */
  const mismatch = useMemo(() => {
    const words = [draft.hook, draft.callToAction, draft.extra].filter((value) => value.trim() !== "");
    for (const value of words) {
      const found = detectScriptMismatch(value, script);
      if (found) return found;
    }
    return null;
  }, [draft.hook, draft.callToAction, draft.extra, script]);

  /** Slots with the operator's current words substituted in, for the preview. */
  const previewSlots = useMemo(() => {
    if (!selected) return [];
    return selected.slots.map((slot) => {
      if (slot.slot === "caption" && draft.hook.trim() !== "") {
        return { ...slot, value: draft.hook } as (typeof selected.slots)[number];
      }
      if (slot.slot === "footer" && draft.callToAction.trim() !== "") {
        return { ...slot, value: draft.callToAction } as (typeof selected.slots)[number];
      }
      return slot;
    });
  }, [selected, draft.hook, draft.callToAction]);

  async function save() {
    if (!selected?.copy || selected.copyIndex === null) return;
    setBusy("saving");
    setConflict(null);
    try {
      const response = await fetch(
        `/api/organizations/${props.organizationId}/campaigns/${props.campaignId}/edits`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseVersionId: view.bundleVersionId,
            baseDigest: view.digest,
            edit: {
              directionId: selected.directionId,
              copyIndex: selected.copyIndex,
              hook: draft.hook,
              // Unchanged fields are sent as they stand. The edit schema takes
              // the whole record, so omitting them would blank them.
              caption: selected.copy.caption,
              callToAction: draft.callToAction,
              timingRationale: selected.copy.timingRationale,
              hashtagSetIndex: null,
              tags: null,
            },
          }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        const message = body?.error?.message ?? "The change could not be saved.";
        // A stale base is its own surface, not a toast that vanishes. The
        // operator's typing stays on screen so it can be copied forward.
        if (/changed since you read it/i.test(message)) {
          setConflict(message);
          return;
        }
        toast.error(message);
        return;
      }

      toast.success(
        body.invalidatesApproval
          ? `Saved as version ${body.version}. This change goes beyond what was approved, so the campaign needs approving again before it can publish.`
          : `Saved as version ${body.version}.`,
      );
      // The edit produced a different version. Staying on this one would leave
      // the operator editing a version that is no longer the newest.
      startNavigation(() => {
        router.push(
          `/organizations/${props.organizationId}/campaigns/${props.campaignId}/studio?version=${body.bundleVersionId}`,
        );
        router.refresh();
      });
    } catch {
      toast.error("The change could not be saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function queueRender() {
    if (!selected || !plate) return;
    setBusy("rendering");
    try {
      const response = await fetch(
        `/api/organizations/${props.organizationId}/campaigns/${props.campaignId}/renders`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bundleVersionId: view.bundleVersionId,
            bundleDigest: view.digest,
            plateAssetId: plate.assetId,
            directionId: selected.directionId,
            channel: selected.channel,
            templateKey: selected.templateKey,
            templateVersion: selected.templateVersion,
            script,
            extra: draft.extra.trim() === "" ? null : draft.extra.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        // The server's own words. It knows why it refused, and paraphrasing
        // would lose the reason an operator needs to act on.
        toast.error(body?.error?.message ?? "The poster could not be queued.");
        return;
      }
      // Not "this updates when it lands". Nothing here polls, and a promise the
      // page does not keep teaches an operator to distrust the rest of it.
      toast.success("Queued. Reload when it lands to see the finished poster.");
    } catch {
      toast.error("The poster could not be queued. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const inspector = (
    <ReferenceInspector view={view} direction={direction} offer={selected} renders={renders} />
  );

  const reviewHref = `/organizations/${props.organizationId}/campaigns/${props.campaignId}?tab=creative`;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Button asChild variant="link" size="sm" className="h-auto w-fit px-0">
            <Link href={reviewHref}>
              <ArrowLeft aria-hidden="true" />
              Back to Creative review
            </Link>
          </Button>
          <h2 className="text-xl font-semibold tracking-tight">
            {direction?.name ?? "No direction"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {selected
              ? `${selected.canvasWidthPx}×${selected.canvasHeightPx} · ${selected.placement} · ${SCRIPT_LABEL[script]}`
              : "No template available for this direction"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={state === "unsaved" ? "outline" : "secondary"}>
            {STATE_LABEL[state]}
          </Badge>

          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Undo"
            disabled={cursor === 0}
            onClick={() => setCursor((previous) => Math.max(0, previous - 1))}
          >
            <Undo2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Redo"
            disabled={cursor >= history.length - 1}
            onClick={() => setCursor((previous) => Math.min(history.length - 1, previous + 1))}
          >
            <Redo2 aria-hidden="true" />
          </Button>

          {/* Below the contract's 1200px the inspector is a Sheet rather than a
              third column. With the AppShell sidebar in place the content is
              narrower than the window, so this is the usual case, not the
              exception. */}
          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="2xl:hidden">
                <PanelRight aria-hidden="true" />
                Context
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-sm">
              <SheetHeader>
                <SheetTitle>Context</SheetTitle>
                <SheetDescription>
                  The approved terms this poster is being composed under.
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">{inspector}</div>
            </SheetContent>
          </Sheet>

          <Button asChild variant="outline" size="sm">
            <Link href={reviewHref}>Return to review</Link>
          </Button>

          {copyChanged ? (
            <Button type="button" size="sm" disabled={!props.canEdit || busy !== null} onClick={save}>
              {busy === "saving" ? <Loader2 className="animate-spin" /> : null}
              Save changes
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={
                !props.canRender ||
                busy !== null ||
                !plate ||
                selected === null ||
                selected.channel === null ||
                selected.availability.available === false
              }
              onClick={queueRender}
            >
              {busy === "rendering" ? <Loader2 className="animate-spin" /> : null}
              Render this poster
            </Button>
          )}
        </div>
      </div>

      {conflict ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>This version changed while you were editing</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              {conflict} Your words are still in the fields above — copy anything you want to keep
              before reloading. Nothing was saved, and nothing was retargeted to the newer version
              on your behalf.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => startNavigation(() => router.refresh())}
            >
              Reload this version
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {mismatch ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            The words are not written in the language you have chosen to draw them in
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              This copy contains {mismatch.unexpected.map((entry) => SCRIPT_LABEL[entry]).join(" and ")}{" "}
              characters, and you have selected {SCRIPT_LABEL[mismatch.selected]}. The{" "}
              {SCRIPT_LABEL[mismatch.selected]} font has no letters for them, so the renderer will
              refuse rather than draw empty boxes — but it can only tell you that after the render
              is spent.
            </span>
            {view.scripts.includes(mismatch.unexpected[0]!) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setScript(mismatch.unexpected[0]!)}
              >
                Draw it in {SCRIPT_LABEL[mismatch.unexpected[0]!]}
              </Button>
            ) : (
              <span className="text-xs">
                This version&apos;s poster plan does not list{" "}
                {SCRIPT_LABEL[mismatch.unexpected[0]!]}, so the words would have to change instead.
              </span>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {view.unreadableTemplates.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Some templates could not be read</AlertTitle>
          <AlertDescription>
            {view.unreadableTemplates.map((entry) => `${entry.key} v${entry.version}`).join(", ")} —
            the catalogue and this version of the platform disagree about what a template is. They
            are named rather than hidden so the gap is visible.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Rail, canvas, and — only where there is genuinely room — the inspector
          as a third column. Below that it is the Sheet in the top bar. */}
      <div className="grid min-w-0 gap-4 md:grid-cols-[17rem_minmax(0,1fr)] 2xl:grid-cols-[17rem_minmax(0,1fr)_17rem]">
        {/* Narrow screens put the poster first and the controls under it: the
            thing being judged should not sit below a screenful of inputs.
            Reordering is visual only, so the controls keep their place in the
            tab order. */}
        <div className="order-2 flex min-w-0 flex-col gap-3 md:order-none">
          <Tabs defaultValue="text" className="flex min-w-0 flex-col">
            <TabsList variant="line" aria-label="What to change" className="w-full justify-start">
              <TabsTrigger value="text" className="flex-none">
                <Type aria-hidden="true" />
                Text
              </TabsTrigger>
              <TabsTrigger value="image" className="flex-none">
                <ImageIcon aria-hidden="true" />
                Image
              </TabsTrigger>
              <TabsTrigger value="layout" className="flex-none">
                Layout
              </TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="mt-4">
              <TextControls
                copy={selected?.copy ?? null}
                draft={draft}
                script={script}
                canEdit={props.canEdit}
                onChange={pushDraft}
              />
            </TabsContent>

            <TabsContent value="image" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">Picture</p>
                <p className="text-xs text-muted-foreground">
                  {direction
                    ? `This direction composes over ${direction.plateAssetKey}.`
                    : "No direction selected."}
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link href={`/organizations/${props.organizationId}/assets`}>
                  Open the Asset Library
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                Changing which picture a direction uses changes what was approved, so it is a new
                proposal version rather than a swap here.
              </p>
              {plate && props.canEdit ? (
                <AnnotationCanvas
                  organizationId={props.organizationId}
                  campaignId={props.campaignId}
                  bundleVersionId={view.bundleVersionId}
                  bundleDigest={view.digest}
                  plate={plate}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="layout" className="mt-4">
              <LayoutControls
                offers={offers}
                selected={selected}
                scripts={view.scripts}
                script={script}
                onSelectTemplate={setTemplateKey}
                onSelectScript={setScript}
              />
            </TabsContent>
          </Tabs>

          {view.directions.length > 1 ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              <p className="text-sm font-medium">Direction</p>
              <div className="flex flex-wrap gap-2">
                {view.directions.map((entry) => (
                  <Button
                    key={entry.id}
                    type="button"
                    size="sm"
                    variant={entry.id === directionId ? "default" : "outline"}
                    onClick={() => setDirectionId(entry.id)}
                  >
                    {entry.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="order-1 min-w-0 md:order-none">
          {selected ? (
            <StudioPreview
              canvasWidthPx={selected.canvasWidthPx}
              canvasHeightPx={selected.canvasHeightPx}
              layout={selected.layout}
              slots={previewSlots}
              extra={draft.extra}
              script={script}
              plateUrl={plate?.previewUrl ?? null}
              renderedUrl={latestRenderUrl ? (renderPreviews[latestRenderUrl] ?? null) : null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No template matches the placements this direction has copy for, so there is nothing to
              draw.
            </p>
          )}
        </div>

        <aside className="order-3 hidden min-w-0 2xl:block" aria-label="Context">
          {inspector}
        </aside>
      </div>
    </div>
  );
}
