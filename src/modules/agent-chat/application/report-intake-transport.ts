import { z } from "zod";

import type { AgentReportScope } from "./report-intake";

const uuid = z.string().uuid();
const intentReceiptSchema = z.object({
  attachmentId: uuid,
  storageBucketId: z.literal("agent-report-staging"),
  storagePath: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  replayed: z.boolean(),
}).strict();

export type AgentAttachmentIntentReceipt = z.output<typeof intentReceiptSchema>;
export type AgentAttachmentWork = { organizationId: string; turnId: string; attachmentId: string };
export type AgentAttachmentSubmission = AgentAttachmentWork & { actorId: string; scope: AgentReportScope | null };
export type AgentAttachmentIntentInput = {
  organizationId: string;
  actorId: string;
  turnId: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  idempotencyKey: string;
};

export async function beginAgentAttachment(
  input: AgentAttachmentIntentInput,
  ports: {
    createIntent: (input: AgentAttachmentIntentInput) => Promise<unknown>;
    sign: (input: { bucket: "agent-report-staging"; path: string }) => Promise<{ token: string }>;
  },
): Promise<AgentAttachmentIntentReceipt & { upload: { token: string } }> {
  const receipt = intentReceiptSchema.parse(await ports.createIntent(input));
  const expectedPrefix = `${input.organizationId}/${input.turnId}/${receipt.attachmentId}`;
  if (receipt.storagePath !== expectedPrefix && !receipt.storagePath.startsWith(`${expectedPrefix}/`)) {
    throw new Error("Attachment staging path did not match its turn.");
  }
  const upload = await ports.sign({ bucket: receipt.storageBucketId, path: receipt.storagePath });
  return { ...receipt, upload };
}

export async function submitAgentAttachment(
  input: AgentAttachmentSubmission,
  ports: {
    declareScope: (input: AgentAttachmentSubmission) => Promise<void>;
    dispatch: (input: AgentAttachmentWork) => Promise<void>;
  },
): Promise<void> {
  await ports.declareScope(input);
  await ports.dispatch({
    organizationId: input.organizationId,
    turnId: input.turnId,
    attachmentId: input.attachmentId,
  });
}
