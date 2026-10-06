import { z } from "zod";

/** Bounded, source-owned evidence for one answer. Untrusted text is data, never instructions. */
export const agentAdviceEntrySchema = z.object({
  sourceId: z.string().trim().min(1).max(200),
  kind: z.enum(["recommendation", "insight", "proposal", "memory", "channel"]),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(1500),
  href: z.string().trim().max(500).nullable(),
  sourceWindowStart: z.iso.date().nullable(),
  sourceWindowEnd: z.iso.date().nullable(),
  channelIds: z.array(z.uuid()).max(20),
  branchIds: z.array(z.uuid()).max(20),
  evidenceRefs: z.array(z.string().trim().min(1).max(200)).max(100),
}).strict();

export const agentPeriodSwitchSchema = z.object({
  requestedStart: z.iso.date(),
  requestedEnd: z.iso.date(),
  selectedStart: z.iso.date(),
  selectedEnd: z.iso.date(),
  reason: z.string().trim().min(1).max(280),
}).strict();

export const agentAdviceContextSchema = z.object({
  entries: z.array(agentAdviceEntrySchema).max(40),
  limitations: z.array(z.string().trim().min(1).max(280)).max(30),
  periodSwitch: agentPeriodSwitchSchema.nullable(),
}).strict();

export type AgentAdviceContext = z.infer<typeof agentAdviceContextSchema>;
