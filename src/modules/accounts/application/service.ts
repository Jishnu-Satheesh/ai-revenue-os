import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  invitationExpiresAt,
  invitationPreviewSchema,
  type CreateInvitationInput,
  type InvitationPreview,
  type InvitationRefusalCode,
  type InvitationWithToken,
  type PendingInvitation,
} from "@/domain/access/invitations";
import { accountRoleSchema, organizationRoleSchema } from "@/domain/organizations/types";
import { createInvitationToken, tokenDigest } from "@/modules/accounts/application/tokens";
import { invitationEmailSender } from "@/modules/accounts/application/email";
import { mintInvitationSignInUrl } from "@/modules/accounts/application/sign-in-links";

type AccountClient = SupabaseClient<Database>;

/**
 * One message for every reason an invitation cannot be redeemed.
 *
 * Distinguishing "unknown" from "expired" to an unauthenticated caller turns the
 * accept route into a probe for valid tokens, and distinguishing "wrong address"
 * from "no such invitation" confirms that an address was invited. The specific
 * reason is logged; the caller sees this.
 */
const OPAQUE_REFUSAL = "This invitation link is no longer valid.";

function refuse(code: InvitationRefusalCode): never {
  logger.warn("account_invitation.refused", { refusalCode: code });
  throw new DomainError("AUTHORIZATION_ERROR", OPAQUE_REFUSAL);
}

function acceptUrlFor(token: string): string {
  return new URL(`/invitations/${token}`, env.NEXT_PUBLIC_APP_URL).toString();
}

/**
 * Maps a database refusal onto a stable code. The RPCs raise specific SQLSTATEs
 * precisely so this does not have to match on message text, which would break
 * the first time a message was reworded.
 */
function refusalCodeFor(error: { code?: string; message?: string } | null): InvitationRefusalCode {
  if (error?.code === "P0002") return "unknown";
  if (error?.code === "42501") return "email_mismatch";
  return "unknown";
}

const accountRoleLabels: Record<string, string> = {
  owner: "Owner — full control of the agency",
  admin: "Admin — can invite people and add clients",
  member: "Member — a seat in the agency",
};

const organizationRoleLabels: Record<string, string> = {
  owner: "Owner in every client",
  admin: "Admin in every client — settings, integrations, approvals",
  operator: "Operator in every client — day-to-day work, no approvals",
  viewer: "Viewer in every client — read only",
};

/**
 * Delivers the invitation, and never lets delivery decide whether the invitation
 * exists. The row is already written by the time this runs, and the caller still
 * gets a working link, so a failed send degrades the experience rather than the
 * result.
 *
 * The preferred link signs the recipient in as well, which is what turns two
 * trips to an inbox into one. When it cannot be minted the email still goes out
 * carrying the plain invitation link, and the recipient signs in from the page.
 */
async function deliverInvitation(input: {
  invitationId: string;
  email: string;
  token: string;
  accountName: string;
  inviterName: string | null;
  accountRole: string;
  organizationRole: string | null;
  expiresAt: string;
}): Promise<{ emailSent: boolean }> {
  const signInUrl = await mintInvitationSignInUrl({
    email: input.email,
    invitationToken: input.token,
  }).catch(() => null);

  const { sent } = await invitationEmailSender().send({
    to: input.email,
    invitationId: input.invitationId,
    accountName: input.accountName,
    inviterName: input.inviterName,
    accountRoleLabel: accountRoleLabels[input.accountRole] ?? input.accountRole,
    organizationRoleLabel: input.organizationRole
      ? (organizationRoleLabels[input.organizationRole] ?? input.organizationRole)
      : "No access to clients until someone grants it",
    actionUrl: signInUrl ?? acceptUrlFor(input.token),
    isOneClick: signInUrl !== null,
    expiresAt: input.expiresAt,
  });

  return { emailSent: sent };
}

export async function createInvitation(
  supabase: AccountClient,
  accountId: string,
  input: CreateInvitationInput,
  context: { accountName: string; inviterName: string | null },
): Promise<InvitationWithToken> {
  const { token, tokenDigest: digest } = createInvitationToken();
  const expiresAt = invitationExpiresAt();

  const { data, error } = await supabase.rpc("create_account_invitation", {
    p_account_id: accountId,
    p_email: input.email,
    p_account_role: input.accountRole,
    p_default_organization_role: input.defaultOrganizationRole,
    p_token_hash: digest,
    p_expires_at: expiresAt.toISOString(),
  });

  if (error || !data) {
    // These are the inviter's own mistakes, not a probe surface, so they are
    // reported specifically. Nothing here reveals anything about the invitee.
    if (error?.code === "23505")
      throw new DomainError(
        "DOMAIN_ERROR",
        "That person already has an invitation or is already a member.",
      );
    if (error?.code === "53400")
      throw new DomainError(
        "DOMAIN_ERROR",
        "Too many invitations from this agency in the last hour. Try again later.",
      );
    if (error?.code === "42501")
      throw new DomainError("AUTHORIZATION_ERROR", "You cannot invite at that role.");
    throw new DomainError("DOMAIN_ERROR", "The invitation could not be created.", error);
  }

  logger.info("account_invitation.created", { accountId, invitationId: data.id });

  const { emailSent } = await deliverInvitation({
    invitationId: data.id,
    email: data.email,
    token,
    accountName: context.accountName,
    inviterName: context.inviterName,
    accountRole: data.account_role,
    organizationRole: data.default_organization_role,
    expiresAt: data.expires_at,
  });

  return {
    id: data.id,
    email: data.email,
    accountRole: accountRoleSchema.parse(data.account_role),
    defaultOrganizationRole: data.default_organization_role
      ? organizationRoleSchema.parse(data.default_organization_role)
      : null,
    expiresAt: data.expires_at,
    acceptUrl: acceptUrlFor(token),
    emailSent,
  };
}

/**
 * Reissue is revoke-and-replace, because the raw token is unrecoverable by
 * design. The caller gets a new link; the old one stops working immediately.
 */
export async function reissueInvitation(
  supabase: AccountClient,
  invitationId: string,
  context: { accountName: string; inviterName: string | null },
): Promise<InvitationWithToken> {
  const { token, tokenDigest: digest } = createInvitationToken();
  const expiresAt = invitationExpiresAt();

  const { data, error } = await supabase.rpc("reissue_account_invitation", {
    p_invitation_id: invitationId,
    p_token_hash: digest,
    p_expires_at: expiresAt.toISOString(),
  });

  if (error || !data)
    throw new DomainError("DOMAIN_ERROR", "That invitation is no longer pending.", error);

  logger.info("account_invitation.reissued", { invitationId });

  const { emailSent } = await deliverInvitation({
    invitationId: data.id,
    email: data.email,
    token,
    accountName: context.accountName,
    inviterName: context.inviterName,
    accountRole: data.account_role,
    organizationRole: data.default_organization_role,
    expiresAt: data.expires_at,
  });

  return {
    id: data.id,
    email: data.email,
    accountRole: accountRoleSchema.parse(data.account_role),
    defaultOrganizationRole: data.default_organization_role
      ? organizationRoleSchema.parse(data.default_organization_role)
      : null,
    expiresAt: data.expires_at,
    acceptUrl: acceptUrlFor(token),
    emailSent,
  };
}

export async function revokeInvitation(
  supabase: AccountClient,
  invitationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("revoke_account_invitation", {
    p_invitation_id: invitationId,
  });

  if (error) throw new DomainError("DOMAIN_ERROR", "That invitation is no longer pending.", error);
  logger.info("account_invitation.revoked", { invitationId });
}

export async function listPendingInvitations(
  supabase: AccountClient,
  accountId: string,
): Promise<readonly PendingInvitation[]> {
  const { data, error } = await supabase
    .from("account_invitations")
    .select(
      "id, email, account_role, default_organization_role, expires_at, created_at, status, invited_by",
    )
    .eq("account_id", accountId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new DomainError("DOMAIN_ERROR", "Invitations could not be loaded.", error);

  const inviterIds = [...new Set((data ?? []).map((row) => row.invited_by))];
  const { data: profiles } = inviterIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", inviterIds)
    : { data: [] as { id: string; display_name: string | null }[] };
  const nameById = new Map((profiles ?? []).map((row) => [row.id, row.display_name]));

  const now = Date.now();
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    accountRole: accountRoleSchema.parse(row.account_role),
    defaultOrganizationRole: row.default_organization_role
      ? organizationRoleSchema.parse(row.default_organization_role)
      : null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    invitedByName: nameById.get(row.invited_by) ?? null,
    // Expiry is evaluated, never trusted from `status`, exactly as in the
    // database. A row can read `pending` and be past its date.
    isExpired: new Date(row.expires_at).getTime() <= now,
  }));
}

export async function previewInvitation(
  supabase: AccountClient,
  token: string,
): Promise<InvitationPreview> {
  const { data, error } = await supabase
    .rpc("preview_account_invitation", { p_token_hash: tokenDigest(token) })
    .maybeSingle();

  if (error) throw new DomainError("DOMAIN_ERROR", "The invitation could not be read.", error);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return invitationPreviewSchema.parse({
    state: data?.state ?? "invalid",
    accountName: data?.account_name ?? null,
    invitedEmail: data?.invited_email ?? null,
    inviterName: data?.inviter_name ?? null,
    accountRole: data?.account_role ?? null,
    defaultOrganizationRole: data?.default_organization_role ?? null,
    expiresAt: data?.expires_at ?? null,
    matchesCaller: data?.matches_caller ?? false,
    signedInEmail: user?.email ?? null,
  });
}

export async function acceptInvitation(
  supabase: AccountClient,
  token: string,
): Promise<{ accountId: string; accountName: string }> {
  const { data, error } = await supabase.rpc("accept_account_invitation", {
    p_token_hash: tokenDigest(token),
  });

  if (error || !data) refuse(refusalCodeFor(error));

  logger.info("account_invitation.accepted", { accountId: data.id });
  return { accountId: data.id, accountName: data.name };
}
