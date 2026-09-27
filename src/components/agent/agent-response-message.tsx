"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  parseAnswerBody,
  type AnswerCitation,
} from "@/modules/agent-chat/application/answer-writer";
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
 * Numbered citation superscript (finding D): `[n]` opens a Tooltip carrying
 * the claim + source on hover and on keyboard focus.
 */
function CitationMarker({ index, citation }: { index: number; citation: AnswerCitation }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Source ${index}: ${citation.claim}`}
          className="cursor-pointer align-super text-[11px] font-semibold text-primary hover:underline focus-visible:underline"
        >
          [{index}]
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <span className="flex flex-col gap-1">
          <span>
            [{index}] {citation.claim}
          </span>
          <span className="opacity-80">{citation.sourceId}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Splits one paragraph around the first occurrence of each not-yet-placed
 * citation claim (case-insensitive), so the `[n]` marker lands beside the
 * sentence it grounds. Claims with no verbatim match return unplaced and
 * are appended after the final paragraph — every citation keeps a marker.
 */
function splitParagraph(
  paragraph: string,
  citations: readonly AnswerCitation[],
  placed: Set<number>,
  renderMarker: (citationIndex: number) => ReactNode,
): { nodes: ReactNode[]; key: string } {
  const lower = paragraph.toLowerCase();
  const hits: Array<{ index: number; start: number; end: number }> = [];
  const used: Array<{ start: number; end: number }> = [];
  citations.forEach((citation, citationIndex) => {
    if (placed.has(citationIndex)) return;
    const needle = citation.claim.trim().toLowerCase();
    if (needle.length === 0) return;
    const start = lower.indexOf(needle);
    if (start === -1) return;
    const end = start + needle.length;
    if (used.some((range) => start < range.end && end > range.start)) return;
    used.push({ start, end });
    hits.push({ index: citationIndex, start, end });
  });
  hits.sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const hit of hits) {
    placed.add(hit.index);
    nodes.push(paragraph.slice(cursor, hit.end));
    nodes.push(renderMarker(hit.index));
    cursor = hit.end;
  }
  nodes.push(paragraph.slice(cursor));
  return { nodes, key: paragraph };
}

/**
 * Poll-rendered assistant answer (Slice A) with a live-streaming preview
 * (streaming synthesis Task 4), in modern chatbot style (finding D).
 * Renders from the durable row body — citations, limitations, and labeled
 * estimates are encoded sections (the fenced RPC carries body text only),
 * parsed back here, so reopened history shows exactly what the live turn
 * showed. The body renders as natural paragraphs (blank-line separated);
 * legacy stored-context header blocks are stripped at the parse boundary,
 * never rendered. Each citation owns a numbered `[n]` superscript beside
 * the sentence it grounds (appended at the end when the claim has no
 * verbatim match), with the claim + source in a hover/focus Tooltip; the
 * Sources list sits outside and below the synthesis card, Limitations
 * compact beneath it, and Estimates keep their inputs and assumptions on
 * the same surface. While the Task 3 stream is open there is no durable
 * row yet, so the caller passes `message={null}` with the joined `token`
 * preview as `liveBody` in the same bubble shell — the `end` swap replaces
 * it with the durable render (or a draft-only row when `end.messageId` is
 * null), and a dropped stream keeps its partial text beside `liveNote`.
 * Plain text only: no markdown renderer exists in this tree, and none is
 * added — bodies render with preserved whitespace and never as HTML.
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
  const placed = new Set<number>();
  const renderMarker = (citationIndex: number): ReactNode => (
    <CitationMarker
      key={`cite-${citationIndex}`}
      index={citationIndex + 1}
      citation={parsed.citations[citationIndex] as AnswerCitation}
    />
  );
  const paragraphNodes = rawParagraphs.map((paragraph) =>
    splitParagraph(paragraph, parsed.citations, placed, renderMarker),
  );
  const unplaced = parsed.citations
    .map((citation, citationIndex) => ({ citation, citationIndex }))
    .filter(({ citationIndex }) => !placed.has(citationIndex));
  return (
    <TooltipProvider>
      <div className="flex justify-start">
        <div className="flex max-w-[90%] flex-col gap-2">
          <Card>
            <CardContent className="flex flex-col gap-3 text-sm">
              {paragraphNodes.map((paragraph, index) => (
                <p
                  key={`${index}:${paragraph.key.slice(0, 24)}`}
                  className="break-words whitespace-pre-wrap"
                >
                  {paragraph.nodes.map((node, nodeIndex) => (
                    <span key={nodeIndex}>{node}</span>
                  ))}
                  {index === paragraphNodes.length - 1 && unplaced.length > 0 ? (
                    <span> {unplaced.map(({ citationIndex }) => renderMarker(citationIndex))}</span>
                  ) : null}
                </p>
              ))}
            </CardContent>
          </Card>
          {parsed.citations.length > 0 ? (
            <div className="flex flex-col gap-1.5 px-1">
              <p className="text-xs font-medium text-muted-foreground">Sources</p>
              <ul className="flex flex-col gap-1.5" aria-label="Answer sources">
                {parsed.citations.map((citation, citationIndex) => (
                  <li
                    key={`${citation.sourceId}:${citation.digest}`}
                    className="flex flex-wrap items-baseline gap-1.5 text-xs"
                  >
                    <span aria-hidden="true" className="font-semibold text-muted-foreground">
                      [{citationIndex + 1}]
                    </span>
                    <Badge variant="outline">{citation.sourceId}</Badge>
                    <span className="text-muted-foreground">{citation.claim}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {parsed.limitations.length > 0 ? (
            <div className="flex flex-col gap-1.5 px-1">
              <p className="text-xs font-medium text-muted-foreground">Limitations</p>
              <ul
                className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground"
                aria-label="Answer limitations"
              >
                {parsed.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          ) : null}
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
