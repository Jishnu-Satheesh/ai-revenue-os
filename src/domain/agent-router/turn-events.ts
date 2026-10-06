import { z } from "zod";

export const agentTurnEventTypeSchema = z.enum([
  "turn_queued",
  "turn_started",
  "period_switched",
  "analysis_started",
  "analysis_completed",
  "report_uploaded",
  "report_processed",
  "research_completed",
  "challenge_requested",
  "challenge_answered",
  "approval_required",
  "answer_completed",
  "turn_failed",
  "turn_cancelled",
]);
export type AgentTurnEventType = z.infer<typeof agentTurnEventTypeSchema>;
