"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { parseAnswerBody } from "@/modules/agent-chat/application/answer-writer";
import type { ThreadMessageView } from "@/modules/agent-chat/infrastructure/thread-repository";

export type AgentResponseMessageProps = {
  message: ThreadMessageView;
};

/**
 * Poll-rendered assistant answer (Slice A). Renders from the durable row
 * body — citations, limitations, and labeled estimates are encoded sections
 * (the fenced RPC carries body text only), parsed back here, so reopened
 * history shows exactly what the live turn showed. Plain text only: no
 * markdown renderer exists in this tree, and none is added — bodies render
 * with preserved whitespace and never as HTML. Estimates keep their inputs
 * and assumptions on the same surface, beside the fixed "Estimate" label.
 */
export function AgentResponseMessage({ message }: AgentResponseMessageProps) {
  const parsed = parseAnswerBody(message.body ?? "");
  return (
    <div className="flex justify-start">
      <Card className="max-w-[90%]">
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="whitespace-pre-wrap">{parsed.body === "" ? "(empty answer)" : parsed.body}</p>
          {parsed.citations.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Separator />
              <p className="text-xs font-medium text-muted-foreground">Sources</p>
              <ul className="flex flex-col gap-1.5" aria-label="Answer sources">
                {parsed.citations.map((citation) => (
                  <li key={`${citation.sourceId}:${citation.digest}`} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline">{citation.sourceId}</Badge>
                    <span className="text-muted-foreground">{citation.claim}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {parsed.limitations.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Separator />
              <p className="text-xs font-medium text-muted-foreground">Limitations</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground" aria-label="Answer limitations">
                {parsed.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {parsed.estimates.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Separator />
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
        </CardContent>
      </Card>
    </div>
  );
}
