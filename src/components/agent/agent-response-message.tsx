"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  parseAnswerBody,
  type AnswerCitation,
} from "@/modules/agent-chat/application/answer-writer";
import { AnswerLinkMarkers, PeriodSwitchMarker } from "@/components/agent/agent-turn-markers";
import type { ThreadMessageView } from "@/modules/agent-chat/infrastructure/thread-repository";

export type AgentResponseMessageProps = {
  /**
   * Durable assistant row. Null while the answer is still streaming — the
   * caller renders the live preview instead (see `liveBody`). Present
   * after the stream `end` swaps to the durable read, and always for
   * reopened history.
   */
  message: ThreadMessageView | null;
  /**
   * Streamed body preview: every Task 3 `token` frame `text` joined with
   * `""`. Rendered only while `message` is null; discarded on the `end`
   * swap, even when the preview arrived intact.
   */
  liveBody?: string | null;
  /**
   * Honest note kept beside a dropped stream's partial text (transport
   * closed before `done`). Never set alongside a durable `message`.
   */
  liveNote?: string | null;
};

/**
 * Single compact sources line (F3): one `Sources: [1]` / `Sources: [1+]`
 * trigger below the synthesis bubble owning the ONE hover/focus Tooltip
 * with the ordered claim+source list. Replaces the per-number `[n]`
 * marker tooltips — the body renders as clean paragraphs.
 */
function SourcesLine({ citations }: { citations: readonly AnswerCitation[] }) {
  if (citations.length === 0) return null;
  const count = citations.length;
  const visible = count === 1 ? "Sources: [1]" : "Sources: [1+]";
  const ariaLabel = count === 1 ? "Sources: 1 cited source" : `Sources: ${count} cited sources`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="cursor-pointer self-start px-1 text-left text-xs text-muted-foreground hover:underline focus-visible:underline"
        >
          {visible}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <ol aria-label="Cited sources" className="flex flex-col gap-1.5">
          {citations.map((citation, index) => (
            <li key={`${citation.sourceId}:${index}`} className="flex flex-col gap-0.5">
              <span>
                [{index + 1}] {citation.claim}
              </span>
              <span className="opacity-80">{citation.sourceId}</span>
            </li>
          ))}
        </ol>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Poll-rendered assistant answer (Slice A) with a live-streaming preview
 * (streaming synthesis Task 4), in modern chatbot style (finding D, F2
 * voice). Renders from the durable row body — citations, limitations, and
 * labeled estimates stay encoded in the row (the fenced RPC carries body
 * text only), parsed back here, so reopened history shows exactly what the
 * live turn showed. The body renders as natural paragraphs (blank-line
 * separated) with gaps voiced inline as sentences; legacy stored-context
 * header blocks are stripped at the parse boundary, never rendered. One
 * compact `Sources: [1]` / `Sources: [1+]` line sits outside and below the
 * bubble owning the single hover/focus Tooltip with the ordered
 * claim+source list; Sources and Limitations section lists are never
 * rendered, and Estimates keep their inputs and assumptions on the same
 * surface. While the Task 3 stream is open there is no durable row yet, so the caller passes
 * `message={null}` with the joined `token` preview as `liveBody` in the
 * same bubble shell — the `end` swap replaces it with the durable render
 * (or a draft-only row when `end.messageId` is null), and a dropped stream
 * keeps its partial text beside `liveNote`. Plain text only: no markdown
 * renderer exists in this tree, and none is added — bodies render with
 * preserved whitespace and never as HTML.
 */
export function AgentResponseMessage({
  message,
  liveBody = null,
  liveNote = null,
}: AgentResponseMessageProps) {
  if (!message) {
    const preview = parseAnswerBody(liveBody ?? "");
    const paragraphs =
      preview.body === ""
        ? ["(empty answer)"]
        : preview.body
            .split(/\n\s*\n/)
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    return (
      <TooltipProvider>
        <div className="flex justify-start">
          <div className="flex max-w-[90%] flex-col gap-2">
            <Card>
              <CardContent className="flex flex-col gap-3 text-sm">
                {paragraphs.map((paragraph, index) => (
                  <p
                    key={`${index}:${paragraph.slice(0, 24)}`}
                    aria-live={index === 0 ? "polite" : undefined}
                    className="break-words whitespace-pre-wrap"
                  >
                    {paragraph}
                  </p>
                ))}
              </CardContent>
            </Card>
            {liveNote ? (
              <p role="note" className="px-1 text-xs text-muted-foreground">
                {liveNote}
              </p>
            ) : null}
          </div>
        </div>
      </TooltipProvider>
    );
  }
  const parsed = parseAnswerBody(message.body ?? "");
  const rawParagraphs =
    parsed.body === ""
      ? ["(empty answer)"]
      : parsed.body
          .split(/\n\s*\n/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
  return (
    <TooltipProvider>
      <div className="flex justify-start">
        <div className="flex max-w-[90%] flex-col gap-2">
          {parsed.periodSwitch ? <PeriodSwitchMarker period={parsed.periodSwitch} /> : null}
          <Card>
            <CardContent className="flex flex-col gap-3 text-sm">
              {rawParagraphs.map((paragraph, index) => (
                <p
                  key={`${index}:${paragraph.slice(0, 24)}`}
                  className="break-words whitespace-pre-wrap"
                >
                  {paragraph}
                </p>
              ))}
            </CardContent>
          </Card>
          <SourcesLine citations={parsed.citations} />
          <AnswerLinkMarkers links={parsed.links} />
          {parsed.estimates.length > 0 ? (
            <div className="flex flex-col gap-1.5 px-1">
              <p className="text-xs font-medium text-muted-foreground">Estimates</p>
              <ul className="flex flex-col gap-2" aria-label="Answer estimates">
                {parsed.estimates.map((estimate) => (
                  <li
                    key={`${estimate.value}:${estimate.inputs.join("|")}`}
                    className="flex flex-col gap-1 text-xs"
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{estimate.label}</Badge>
                      <span>{estimate.value}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Inputs: {estimate.inputs.join("; ")}
                    </span>
                    <span className="text-muted-foreground">
                      Assumes: {estimate.assumptions.join("; ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
