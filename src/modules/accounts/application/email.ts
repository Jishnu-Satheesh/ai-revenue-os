import "server-only";

import { Resend } from "resend";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  invitationEmailHtml,
  invitationEmailSubject,
  invitationEmailText,
  type InvitationEmailInput,
} from "@/modules/accounts/application/invitation-email";

export type InvitationEmailRequest = InvitationEmailInput & {
  to: string;
  /** Used as the idempotency key, so a retried send cannot deliver twice. */
  invitationId: string;
};

/**
 * Whether the message actually left. The caller never treats `sent: false` as a
 * failure of the invitation -- the row is already written and the copy-link
 * already works -- but the UI does need to know, so it can say the email did not
 * go out instead of implying it did.
 */
export type InvitationEmailResult = { sent: boolean };

export type InvitationEmailSender = {
  send(request: InvitationEmailRequest): Promise<InvitationEmailResult>;
};

/**
 * The default whenever no API key is configured, which is every test run and any
 * developer machine without one. Nothing leaves the process, so a suite can
 * never mail a real person by accident.
 */
export function createNoopInvitationEmailSender(): InvitationEmailSender {
  return {
    async send(request) {
      logger.info("invitation_email.skipped", { invitationId: request.invitationId });
      return { sent: false };
    },
  };
}

export function createResendInvitationEmailSender(apiKey: string): InvitationEmailSender {
  const resend = new Resend(apiKey);

  return {
    async send(request) {
      // The Resend SDK resolves with `{ data, error }` rather than throwing, so
      // an unchecked call looks successful while delivering nothing.
      const { data, error } = await resend.emails.send(
        {
          from: env.INVITATION_FROM_ADDRESS,
          to: [request.to],
          subject: invitationEmailSubject(request.accountName),
          html: invitationEmailHtml(request),
          text: invitationEmailText(request),
        },
        // Scoped to the invitation, so a retry of the same send is collapsed
        // rather than delivered again.
        { idempotencyKey: `account-invitation/${request.invitationId}` },
      );

      if (error || !data) {
        // The address is deliberately absent: `LogContext` has no field for it,
        // which is what stops a recipient's email reaching the logs.
        logger.error("invitation_email.failed", {
          invitationId: request.invitationId,
          errorCode: error?.name ?? "unknown",
        });
        return { sent: false };
      }

      logger.info("invitation_email.sent", { invitationId: request.invitationId });
      return { sent: true };
    },
  };
}

let cached: InvitationEmailSender | null = null;

/** Resolved once per process: the adapter cannot change while it is running. */
export function invitationEmailSender(): InvitationEmailSender {
  if (!cached) {
    cached = env.RESEND_API_KEY
      ? createResendInvitationEmailSender(env.RESEND_API_KEY)
      : createNoopInvitationEmailSender();
  }
  return cached;
}
