import "server-only";

import { Resend } from "resend";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  invitationEmailHtml,
  invitationEmailSubject,
  invitationEmailText,
  invitationSenderFrom,
  organizationInvitationEmailHtml,
  organizationInvitationEmailSubject,
  organizationInvitationEmailText,
  type InvitationEmailInput,
  type OrganizationInvitationEmailInput,
} from "@/modules/accounts/application/invitation-email";

export type InvitationEmailRequest = InvitationEmailInput & {
  to: string;
  /** Used as the idempotency key, so a retried send cannot deliver twice. */
  invitationId: string;
};

export type OrganizationInvitationEmailRequest = OrganizationInvitationEmailInput & {
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

/**
 * The one transport both invitation kinds share. The Resend SDK resolves with
 * `{ data, error }` rather than throwing, so an unchecked call looks
 * successful while delivering nothing.
 */
async function deliverViaResend(
  apiKey: string,
  message: { from: string; to: string[]; subject: string; html: string; text: string },
  idempotencyKey: string,
  logScope: string,
  invitationId: string,
): Promise<InvitationEmailResult> {
  const resend = new Resend(apiKey);
  // Scoped to the invitation, so a retry of the same send is collapsed
  // rather than delivered again.
  const { data, error } = await resend.emails.send(message, { idempotencyKey });

  if (error || !data) {
    // The address is deliberately absent: `LogContext` has no field for it,
    // which is what stops a recipient's email reaching the logs.
    logger.error(`${logScope}.failed`, {
      invitationId,
      errorCode: error?.name ?? "unknown",
    });
    return { sent: false };
  }

  logger.info(`${logScope}.sent`, { invitationId });
  return { sent: true };
}

export function createResendInvitationEmailSender(apiKey: string): InvitationEmailSender {
  return {
    async send(request) {
      return deliverViaResend(
        apiKey,
        {
          from: invitationSenderFrom(request.accountName, env.INVITATION_FROM_ADDRESS),
          to: [request.to],
          subject: invitationEmailSubject(request.accountName),
          html: invitationEmailHtml(request),
          text: invitationEmailText(request),
        },
        `account-invitation/${request.invitationId}`,
        "invitation_email",
        request.invitationId,
      );
    },
  };
}

export type OrganizationInvitationEmailSender = {
  send(request: OrganizationInvitationEmailRequest): Promise<InvitationEmailResult>;
};

/**
 * The organization variant: same transport, client-scoped copy, and the sender
 * derived from the organization name. Without an API key nothing leaves the
 * process, exactly like the account sender.
 */
export function createOrganizationInvitationEmailSender(
  apiKey: string | undefined,
): OrganizationInvitationEmailSender {
  if (!apiKey) {
    return {
      async send(request) {
        logger.info("organization_invitation_email.skipped", {
          invitationId: request.invitationId,
        });
        return { sent: false };
      },
    };
  }

  return {
    async send(request) {
      return deliverViaResend(
        apiKey,
        {
          from: invitationSenderFrom(request.organizationName, env.INVITATION_FROM_ADDRESS),
          to: [request.to],
          subject: organizationInvitationEmailSubject(request.organizationName),
          html: organizationInvitationEmailHtml(request),
          text: organizationInvitationEmailText(request),
        },
        `organization-invitation/${request.invitationId}`,
        "organization_invitation_email",
        request.invitationId,
      );
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

let cachedOrganization: OrganizationInvitationEmailSender | null = null;

/** Same resolution for the organization variant. */
export function organizationInvitationEmailSender(): OrganizationInvitationEmailSender {
  if (!cachedOrganization) {
    cachedOrganization = createOrganizationInvitationEmailSender(env.RESEND_API_KEY);
  }
  return cachedOrganization;
}
