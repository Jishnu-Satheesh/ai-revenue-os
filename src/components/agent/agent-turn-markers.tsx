"use client";

import {
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  FileSpreadsheetIcon,
  SearchIcon,
} from "lucide-react";
import { z } from "zod";
import { useState } from "react";

import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { agentPeriodSwitchSchema } from "@/modules/agent-chat/application/advice-context";
import type { AgentTurnEvent } from "@/modules/agent-chat/infrastructure/turn-repository";
import {
  AgentQuestionnaireCard,
  type QuestionnaireAnswers,
} from "@/components/agent/agent-questionnaire-card";
import {
  agentTurnIsTerminal,
  questionnaireForAgentTurn,
  type AgentTurnBundle,
} from "@/components/agent/agent-governed-client";
import {
  AGENT_REPORT_ACCEPT,
  agentReportMediaType,
} from "@/components/agent/agent-attachment-upload";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

function dateLabel(day: string): { month: string; day: number; year: number } {
  const [year, month, date] = day.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return { month: monthName, day: date, year };
}

function rangeLabel(start: string, end: string): string {
  const first = dateLabel(start);
  const last = dateLabel(end);
  if (first.month === last.month && first.year === last.year) {
    return `${first.month} ${first.day}–${last.day}, ${last.year}`;
  }
  return `${first.month} ${first.day}, ${first.year}–${last.month} ${last.day}, ${last.year}`;
}

function exactAuditHref(organizationId: string, payload: Record<string, unknown>): string | null {
  const { channelId, runId, auditHref } = payload;
  if (typeof channelId !== "string" || typeof runId !== "string" || typeof auditHref !== "string")
    return null;
  if (
    !z.string().uuid().safeParse(channelId).success ||
    !z.string().uuid().safeParse(runId).success
  )
    return null;
  const expected = `/organizations/${organizationId}/channels/${channelId}?runId=${runId}`;
  return auditHref === expected ? expected : null;
}

/** Actions, files, and pending questions restored from one durable turn. */
export function AgentTurnPanel({
  organizationId,
  bundle,
  viewer,
  upload,
  challengePending,
  challengeError,
  onAnswers,
  onRetry,
  onReselect,
}: {
  organizationId: string;
  bundle: AgentTurnBundle;
  viewer: boolean;
  upload?: { percent: number; error: string | null; pending: boolean };
  challengePending: boolean;
  challengeError: string | null;
  onAnswers: (challengeId: string, answers: QuestionnaireAnswers) => void;
  onRetry: () => void;
  onReselect: (file: File) => void;
}) {
  const [observedAt] = useState(Date.now);
  const questionnaire = questionnaireForAgentTurn(bundle.turn);
  return (
    <div className="flex flex-col gap-3" aria-label="Request progress">
      <AgentTurnMarkers organizationId={organizationId} events={bundle.events} />
      {bundle.attachments.map((file) => (
        <Attachment
          key={file.id}
          size="sm"
          state={
            upload?.pending
              ? "uploading"
              : file.status === "awaiting_upload"
                ? "idle"
                : file.status === "failed" || file.status === "expired"
                  ? "error"
                  : file.status === "promoted"
                    ? "done"
                    : "processing"
          }
        >
          <AttachmentMedia>
            <FileSpreadsheetIcon aria-hidden="true" />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{file.fileName}</AttachmentTitle>
            <AttachmentDescription>
              {file.status === "promoted"
                ? "Saved in governed reports"
                : file.status === "verified"
                  ? "File verified; governed checks continue"
                  : file.status === "expired"
                    ? "Upload expired; attach the report in a new message"
                    : file.status === "failed"
                      ? "Report upload needs attention"
                      : "Waiting for report upload"}
            </AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      ))}
      {upload?.pending ? (
        <div role="status" className="flex flex-col gap-2">
          <span>Uploading report · {upload.percent}%</span>
          <Progress value={upload.percent} aria-label="Report upload progress" />
        </div>
      ) : null}
      {upload?.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {upload.error}
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry report upload
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!viewer &&
      !upload &&
      bundle.attachments.some(
        (file) => file.status === "awaiting_upload" && Date.parse(file.expiresAt) > observedAt,
      ) ? (
        <div className="flex flex-col gap-2">
          <span>Select the same report to resume its upload.</span>
          <Input
            type="file"
            accept={AGENT_REPORT_ACCEPT}
            aria-label="Resume report upload"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                const existing = bundle.attachments[0];
                try {
                  const mediaType = agentReportMediaType(file);
                  if (
                    existing.fileName === file.name &&
                    existing.byteSize === file.size &&
                    existing.mediaType === mediaType
                  )
                    onReselect(file);
                  else
                    event.target.setCustomValidity(
                      "Select the original report with the same filename and size.",
                    );
                } catch {
                  event.target.setCustomValidity("Choose the original CSV or XLSX report.");
                }
                event.target.reportValidity();
              }
            }}
          />
        </div>
      ) : null}
      {questionnaire && bundle.turn.pendingChallenge ? (
        <AgentQuestionnaireCard
          key={questionnaire.resumeKey}
          spec={questionnaire}
          disabled={challengePending || (viewer && bundle.turn.objective === "report_intake")}
          onSubmit={(answers) => onAnswers(bundle.turn.pendingChallenge!.id, answers)}
        />
      ) : null}
      {challengeError ? (
        <Alert variant="destructive">
          <AlertDescription>{challengeError}</AlertDescription>
        </Alert>
      ) : null}
      {bundle.turn.status === "awaiting_approval" && bundle.turn.pendingApproval ? (
        <Marker>
          <MarkerIcon>
            <CircleAlertIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>
            Report needs an authorized review ·{" "}
            <a
              href={`/organizations/${organizationId}/integrations?tab=data-sources&package=${bundle.turn.pendingApproval.packageId}`}
            >
              Review governed report
            </a>
          </MarkerContent>
        </Marker>
      ) : null}
      {!agentTurnIsTerminal(bundle.turn) &&
      ["queued", "running"].includes(bundle.turn.status) &&
      !upload?.pending ? (
        <Marker>
          <MarkerIcon>
            <Spinner />
          </MarkerIcon>
          <MarkerContent>
            {bundle.turn.objective === "report_intake" && bundle.attachments.length === 0
              ? "Preparing secure report upload"
              : "Working on your request"}
          </MarkerContent>
        </Marker>
      ) : null}
    </div>
  );
}

/**
 * Separator marker for a dated evidence-window switch. Dates live in the
 * marker, never as filler in the answer body. Shared by durable turn
 * events and message-body-encoded switches so reopened history renders
 * the same marker either way.
 */
export function PeriodSwitchMarker({
  period,
}: {
  period: z.infer<typeof agentPeriodSwitchSchema>;
}) {
  return (
    <Marker variant="separator">
      <MarkerIcon>
        <ArrowRightLeftIcon aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent className="max-w-[85%]">
        Switched from {rangeLabel(period.requestedStart, period.requestedEnd)} to{" "}
        {rangeLabel(period.selectedStart, period.selectedEnd)} because the requested period lacked
        usable data.
      </MarkerContent>
    </Marker>
  );
}

/**
 * Exact deep links derived from the answer, rendered as real focusable
 * links with the writer-set label. Hrefs are writer-validated
 * in-organization paths. Unlike the turn-event completion marker, no
 * outcome is asserted here: an in-progress analysis links the same way.
 */
export function AnswerLinkMarkers({
  links,
}: {
  links: readonly { label: string; href: string }[];
}) {
  if (links.length === 0) return null;
  return (
    <>
      {links.map((link) => (
        <Marker key={link.href}>
          <MarkerIcon>
            <ArrowUpRightIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>
            <a href={link.href}>{link.label}</a>
          </MarkerContent>
        </Marker>
      ))}
    </>
  );
}

export function AgentTurnMarkers({
  organizationId,
  events,
}: {
  organizationId: string;
  events: readonly AgentTurnEvent[];
}) {
  return (
    <div className="flex flex-col gap-2" aria-label="Agent actions">
      {[...events]
        .sort((a, b) => a.seq - b.seq)
        .map((event) => {
          if (event.type === "period_switched") {
            const parsed = agentPeriodSwitchSchema.safeParse(event.payload);
            if (!parsed.success) return null;
            return <PeriodSwitchMarker key={event.id} period={parsed.data} />;
          }
          if (event.type === "analysis_started") {
            return (
              <Marker key={event.id}>
                <MarkerIcon>
                  <SearchIcon aria-hidden="true" />
                </MarkerIcon>
                <MarkerContent>Started channel analysis</MarkerContent>
              </Marker>
            );
          }
          if (event.type === "analysis_completed") {
            const href = exactAuditHref(organizationId, event.payload);
            return (
              <Marker key={event.id}>
                <MarkerIcon>
                  <CheckIcon aria-hidden="true" />
                </MarkerIcon>
                <MarkerContent>
                  Channel analysis complete
                  {href ? (
                    <>
                      {" "}
                      ·{" "}
                      <a href={href}>
                        Open exact channel audit{" "}
                        <ArrowUpRightIcon aria-hidden="true" className="inline size-3" />
                      </a>
                    </>
                  ) : null}
                </MarkerContent>
              </Marker>
            );
          }
          if (event.type === "report_uploaded") {
            return (
              <Marker key={event.id}>
                <MarkerIcon>
                  <FileSpreadsheetIcon aria-hidden="true" />
                </MarkerIcon>
                <MarkerContent>Report uploaded for governed checks</MarkerContent>
              </Marker>
            );
          }
          if (event.type === "report_processed") {
            const packageId = z.string().uuid().safeParse(event.payload.packageId).success
              ? (event.payload.packageId as string)
              : null;
            return (
              <Marker key={event.id}>
                <MarkerIcon>
                  <CheckIcon aria-hidden="true" />
                </MarkerIcon>
                <MarkerContent>
                  Report checked
                  {packageId ? (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={`/organizations/${organizationId}/integrations?tab=data-sources&package=${packageId}`}
                      >
                        Open governed report package{" "}
                        <ArrowUpRightIcon aria-hidden="true" className="inline size-3" />
                      </a>
                    </>
                  ) : null}
                </MarkerContent>
              </Marker>
            );
          }
          if (event.type === "turn_failed") {
            return (
              <Marker key={event.id}>
                <MarkerIcon>
                  <CircleAlertIcon aria-hidden="true" />
                </MarkerIcon>
                <MarkerContent>
                  This action stopped. Review the message and retry if needed.
                </MarkerContent>
              </Marker>
            );
          }
          return null;
        })}
    </div>
  );
}
