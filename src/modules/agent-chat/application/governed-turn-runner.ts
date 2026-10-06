import type { OrganizationRole } from "@/domain/organizations/types";
import { encodeAnswerBody, type AnswerDraft } from "@/modules/agent-chat/application/answer-writer";
import type { AgentAdviceContext } from "@/modules/agent-chat/application/advice-context";
import type { ContextPack } from "@/modules/agent-chat/application/context-pack";
import type { ThreadMode } from "@/modules/agent-chat/infrastructure/thread-repository";
import type { ChannelAssessmentOutcome } from "./channel-assessment";
import type {
  AgentTurnChallengeField,
  AgentTurnEventType,
} from "@/modules/agent-chat/infrastructure/turn-repository";

export type GovernedTurnInput = {
  organizationId: string;
  turnId: string;
  threadId: string;
  userMessageId: string;
  actorId: string;
  leaseToken: string;
  objective: "business_advice" | "channel_assessment" | "report_intake";
  mode: ThreadMode;
  question: string;
};

export type GovernedTurnOutcome =
  | { kind: "completed" }
  | { kind: "failed" }
  | { kind: "waiting"; nextPollAfterMs: number }
  | { kind: "awaiting_user" }
  | { kind: "awaiting_upload" }
  | { kind: "revoked" };

export type GovernedChannelOutcome = ChannelAssessmentOutcome;

export type GovernedTurnPorts = {
  currentRole: () => Promise<OrganizationRole | null>;
  readAdvice: (scope?: {
    channelId: string;
    period: { start: string; end: string };
  }) => Promise<AgentAdviceContext>;
  readPack: () => Promise<ContextPack | null>;
  assessChannel: (input: {
    role: OrganizationRole;
    question: string;
  }) => Promise<GovernedChannelOutcome>;
  answer: (input: {
    question: string;
    advice: AgentAdviceContext;
    pack: ContextPack | null;
    mode: ThreadMode;
    threadId: string;
  }) => Promise<AnswerDraft>;
  appendEvent: (input: {
    eventKey: string;
    eventType: AgentTurnEventType;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
  setChallenge: (input: { kind: "scope"; fields: AgentTurnChallengeField[] }) => Promise<unknown>;
  complete: (input: { answerBody: string }) => Promise<unknown>;
};

export async function runGovernedAgentTurn(
  input: GovernedTurnInput,
  ports: GovernedTurnPorts,
): Promise<GovernedTurnOutcome> {
  const role = await ports.currentRole();
  if (!role) return { kind: "revoked" };

  if (input.objective === "report_intake") {
    // The attachment completion route owns the next transition. Starting a
    // report turn by itself neither reads unverified bytes nor invents a
    // report answer.
    return { kind: "awaiting_upload" };
  }

  if (input.objective === "channel_assessment") {
    const outcome = await ports.assessChannel({ role, question: input.question });
    if (outcome.status === "in_progress") {
      await recordPeriodSwitch(ports, outcome.periodSwitch);
      if (outcome.runId) {
        await ports.appendEvent({
          eventKey: `analysis:${outcome.runId}:started`,
          eventType: "analysis_started",
          payload: {
            channelId: outcome.channelId,
            runId: outcome.runId,
            periodStart: outcome.period.start,
            periodEnd: outcome.period.end,
            ...(outcome.auditHref ? { auditHref: outcome.auditHref } : {}),
          },
        });
      }
      return { kind: "waiting", nextPollAfterMs: outcome.nextPollAfterMs };
    }
    if (outcome.status === "needs_scope") {
      await ports.setChallenge({
        kind: "scope",
        fields:
          outcome.field === "channel"
            ? [
                {
                  key: "channelId",
                  label: "Which channel should I assess?",
                  kind: "single_select",
                  required: true,
                  options: outcome.options
                    .slice(0, 12)
                    .map((option) => ({ value: option.id, label: option.label })),
                },
              ]
            : [
                { key: "from", label: "Report period start", kind: "date", required: true },
                { key: "to", label: "Report period end", kind: "date", required: true },
              ],
      });
      return { kind: "awaiting_user" };
    }
    const advice = await ports.readAdvice(
      outcome.channelId && outcome.period
        ? { channelId: outcome.channelId, period: outcome.period }
        : undefined,
    );
    const channelAdvice: AgentAdviceContext =
      outcome.status === "ready"
        ? {
            ...advice,
            entries: [
              {
                sourceId: outcome.runId,
                kind: "insight" as const,
                title: `${outcome.channelName} audit`.slice(0, 200),
                detail: outcome.summary.slice(0, 1500),
                href: outcome.auditHref,
                sourceWindowStart: outcome.period.start,
                sourceWindowEnd: outcome.period.end,
                channelIds: [outcome.channelId],
                branchIds: [],
                evidenceRefs: [...outcome.evidenceRefs].slice(0, 100),
              },
              ...advice.entries,
            ].slice(0, 40),
            periodSwitch: outcome.periodSwitch ?? advice.periodSwitch,
          }
        : {
            ...advice,
            limitations: [...advice.limitations, channelUnavailableCopy(outcome.reason)].slice(
              0,
              30,
            ),
          };
    if (outcome.status === "ready") {
      await ports.appendEvent({
        eventKey: `analysis:${outcome.runId}:completed`,
        eventType: "analysis_completed",
        payload: {
          channelId: outcome.channelId,
          runId: outcome.runId,
          auditHref: outcome.auditHref,
        },
      });
    }
    return finishAnswer(input, ports, channelAdvice);
  }

  return finishAnswer(input, ports, await ports.readAdvice());
}

async function finishAnswer(
  input: GovernedTurnInput,
  ports: GovernedTurnPorts,
  advice: AgentAdviceContext,
): Promise<GovernedTurnOutcome> {
  await recordPeriodSwitch(ports, advice.periodSwitch);
  const pack = await ports.readPack();
  const draft = await ports.answer({
    question: input.question,
    advice,
    pack,
    mode: input.mode,
    threadId: input.threadId,
  });
  // A member can lose access during a model call. The final write remains
  // fenced by the database too, but avoid even attempting it after revocation.
  if (!(await ports.currentRole())) return { kind: "revoked" };
  await ports.complete({ answerBody: encodeAnswerBody({ ...draft, periodSwitch: null }) });
  return { kind: "completed" };
}

async function recordPeriodSwitch(
  ports: GovernedTurnPorts,
  switched: AgentAdviceContext["periodSwitch"],
): Promise<void> {
  if (!switched) return;
  await ports.appendEvent({
    eventKey: `period:${switched.requestedStart}:${switched.requestedEnd}:${switched.selectedStart}:${switched.selectedEnd}`,
    eventType: "period_switched",
    payload: switched,
  });
}

function channelUnavailableCopy(
  reason: Extract<ChannelAssessmentOutcome, { status: "not_available" }>["reason"],
): string {
  const messages: Record<typeof reason, string> = {
    channel_not_found: "Choose an active channel so I can connect the advice to its report.",
    no_governed_report:
      "Upload a channel report to check these suggestions against performance; the steps below are hypotheses to test.",
    analysis_permission_required:
      "An operator can run the channel audit; I can still suggest next steps using your permitted evidence.",
    analysis_not_started: "The channel report is available, but its audit has not started yet.",
    rate_limited:
      "The analysis limit has been reached. Review the existing evidence now and retry the audit later.",
    dispatch_failed:
      "The channel audit could not finish. Retry the audit to complete the channel-specific check.",
    feature_disabled: "Channel analysis is not enabled for this organization.",
    invalid_period: "Choose a valid report start and end date to assess this channel.",
    read_permission_required: "You need channel access to view this audit.",
  };
  return messages[reason];
}
