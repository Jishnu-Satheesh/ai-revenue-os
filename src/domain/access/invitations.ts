import { z } from "zod";

import { accountRoleSchema, organizationRoleSchema } from "@/domain/organizations/types";

/**
 * Invitation contracts. See `specs/017-account-identity-and-access.md`.
 *
 * Pure schemas and constants with no server dependency, so the accept page and
 * the invite dialog can both import them.
 */

export const INVITATION_LIFETIME_DAYS = 7;

export const invitationStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/**
 * Why an invitation could not be redeemed. Logged in full; **never returned to
 * the client**, which sees one generalized message for all of them. Telling an
 * unauthenticated caller the difference between "unknown" and "expired" turns
 * the accept route into a probe for valid tokens.
 */
export const invitationRefusalCodes = [
  "unknown",
  "expired",
  "revoked",
  "consumed",
  "email_mismatch",
  "email_unconfirmed",
] as const;
export type InvitationRefusalCode = (typeof invitationRefusalCodes)[number];

/** What the accept page renders. `already_accepted` is only ever shown to the person who accepted. */
export const invitationPreviewStateSchema = z.enum(["valid", "invalid", "already_accepted"]);
export type InvitationPreviewState = z.infer<typeof invitationPreviewStateSchema>;

export const createInvitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(320),
  accountRole: accountRoleSchema.default("member"),
  /**
   * Null means the member joins with no blanket access to any client. It is a
   * legitimate choice, not a missing value, so it is nullable rather than
   * optional-with-a-default.
   */
  defaultOrganizationRole: organizationRoleSchema.nullable().default("viewer"),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;

/**
 * The token is returned exactly once, in the response that created or reissued
 * the invitation. It is never stored in recoverable form and never re-read, so
 * a client that discards it must reissue.
 */
export const invitationWithTokenSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  accountRole: accountRoleSchema,
  defaultOrganizationRole: organizationRoleSchema.nullable(),
  expiresAt: z.string(),
  acceptUrl: z.string().url(),
  /** False when no email left the system, so the UI never implies one did. */
  emailSent: z.boolean(),
});
export type InvitationWithToken = z.infer<typeof invitationWithTokenSchema>;

export const pendingInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  accountRole: accountRoleSchema,
  defaultOrganizationRole: organizationRoleSchema.nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedByName: z.string().nullable(),
  isExpired: z.boolean(),
});
export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;

export const invitationPreviewSchema = z.object({
  state: invitationPreviewStateSchema,
  accountName: z.string().nullable(),
  invitedEmail: z.string().nullable(),
  inviterName: z.string().nullable(),
  accountRole: accountRoleSchema.nullable(),
  defaultOrganizationRole: organizationRoleSchema.nullable(),
  expiresAt: z.string().nullable(),
  matchesCaller: z.boolean(),
  /** Null when nobody is signed in, so the page can offer sign-in rather than a mismatch. */
  signedInEmail: z.string().nullable(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/** A token is 32 random bytes, base64url-encoded: 43 characters, no padding. */
export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "That invitation link is not valid.");

export function invitationExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
}
