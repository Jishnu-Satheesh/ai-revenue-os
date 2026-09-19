import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  invitationExpiresAt,
  organizationInvitationPreviewSchema,
  type CreateOrganizationInvitationInput,
  type OrganizationInvitationPreview,
  type OrganizationInvitationWithToken,
  type OrganizationRefusalCode,
  type OrganizationTeamMember,
  type PendingOrganizationInvitation,
} from "@/domain/access/invitations";
import {
  organizationRoleSchema,
  type OrganizationRole,
} from "@/domain/organizations/types";
import { createInvitationToken, tokenDigest } from "@/modules/accounts/application/tokens";
import { organizationInvitationEmailSender } from "@/modules/accounts/application/email";
import { mintInvitationSignInUrl } from "@/modules/accounts/application/sign-in-links";

type OrganizationClient = SupabaseClient<Database>;

/**
 * One message for every reason an organization invitation cannot be redeemed.
 * Same discipline as account invitations: the specific reason is logged, the
 * caller sees one generalized message, so the route cannot probe tokens or
 * confirm that an address was invited.
 */
const OPAQUE_REFUSAL = "This invitation link is no longer valid.";

function refuse(code: OrganizationRefusalCode): never {
  logger.warn("organization_invitation.refused", { refusalCode: code });
  throw new DomainError("AUTHORIZATION_ERROR", OPAQUE_REFUSAL);
}

function acceptUrlFor(token: string): string {
  return new URL(`/organization-invitations/${token}`, env.NEXT_PUBLIC_APP_URL).toString();
}

/**
 * Maps a database refusal onto a stable code. The RPCs raise specific SQLSTATEs
 * precisely so this does not have to match on message text.
 */
function refusalCodeFor(error: { code?: string; message?: string } | null): OrganizationRefusalCode {
  if (error?.code === "P0002") return "unknown";
  if (error?.code === "42501") return "email_mismatch";
  return "unknown";
}

const organizationRoleLabels: Record<OrganizationRole, string> = {
  owner: "Owner — everything, including archiving the client",
  admin: "Admin — settings, integrations, approvals",
  operator: "Operator — day-to-day work, no approvals",
  viewer: "Viewer — read only",
};

async function organizationNameFor(
  supabase: OrganizationClient,
  organizationId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  if (error || !data)
    throw new DomainError("DOMAIN_ERROR", "That organization could not be read.", error);
  return data.name;
}

export async function createOrganizationInvitation(
  supabase: OrganizationClient,
  organizationId: string,
  input: CreateOrganizationInvitationInput,
  context: { organizationName: string; inviterName: string | null },
): Promise<OrganizationInvitationWithToken> {
  const { token, tokenDigest: digest } = createInvitationToken();
  const expiresAt = invitationExpiresAt();

  const { data, error } = await supabase.rpc("create_organization_invitation", {
    p_organization_id: organizationId,
    p_email: input.email,
    p_role: input.role,
    p_token_hash: digest,
    p_expires_at: expiresAt.toISOString(),
  });

  if (error || !data) {
    // These are the inviter's own mistakes, not a probe surface, so they are
    // reported specifically. Nothing here reveals anything about the invitee.
    if (error?.code === "23505")
      throw new DomainError(
        "DOMAIN_ERROR",
        "That person is already a member of this client.",
      );
    if (error?.code === "53400")
      throw new DomainError(
        "DOMAIN_ERROR",
        "Too many invitations from this client in the last hour. Try again later.",
      );
    if (error?.code === "42501")
      throw new DomainError("AUTHORIZATION_ERROR", "You cannot invite at that role.");
    throw new DomainError("DOMAIN_ERROR", "The invitation could not be created.", error);
  }

  logger.info("organization_invitation.created", { organizationId, invitationId: data.id });

  const { emailSent } = await deliverOrganizationInvitation({
    invitationId: data.id,
    email: data.email,
    token,
    organizationName: context.organizationName,
    inviterName: context.inviterName,
    role: organizationRoleSchema.parse(data.role),
    expiresAt: data.expires_at,
  });

  return {
    id: data.id,
    email: data.email,
    role: organizationRoleSchema.parse(data.role),
    expiresAt: data.expires_at,
    acceptUrl: acceptUrlFor(token),
    emailSent,
  };
}

/**
 * Reissue is revoke-and-replace, because the raw token is unrecoverable by
 * design. The caller gets a new link; the old one stops working immediately.
 */
export async function reissueOrganizationInvitation(
  supabase: OrganizationClient,
  organizationId: string,
  invitationId: string,
  context: { organizationName: string; inviterName: string | null },
): Promise<OrganizationInvitationWithToken> {
  const { token, tokenDigest: digest } = createInvitationToken();
  const expiresAt = invitationExpiresAt();

  const { data, error } = await supabase.rpc("reissue_organization_invitation", {
    p_invitation_id: invitationId,
    p_token_hash: digest,
    p_expires_at: expiresAt.toISOString(),
  });

  if (error || !data)
    throw new DomainError("DOMAIN_ERROR", "That invitation is no longer pending.", error);

  if (data.organization_id !== organizationId)
    throw new DomainError("DOMAIN_ERROR", "That invitation is no longer pending.");

  logger.info("organization_invitation.reissued", { organizationId, invitationId });

  const { emailSent } = await deliverOrganizationInvitation({
    invitationId: data.id,
    email: data.email,
    token,
    organizationName: context.organizationName,
    inviterName: context.inviterName,
    role: organizationRoleSchema.parse(data.role),
    expiresAt: data.expires_at,
  });

  return {
    id: data.id,
    email: data.email,
    role: organizationRoleSchema.parse(data.role),
    expiresAt: data.expires_at,
    acceptUrl: acceptUrlFor(token),
    emailSent,
  };
}

export async function revokeOrganizationInvitation(
  supabase: OrganizationClient,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("revoke_organization_invitation", {
    p_invitation_id: invitationId,
  });

  if (error || !data)
    throw new DomainError("DOMAIN_ERROR", "That invitation is no longer pending.", error);
  if (data.organization_id !== organizationId)
    throw new DomainError("DOMAIN_ERROR", "That invitation is no longer pending.");

  logger.info("organization_invitation.revoked", { organizationId, invitationId });
}

export async function listPendingOrganizationInvitations(
  supabase: OrganizationClient,
  organizationId: string,
): Promise<readonly PendingOrganizationInvitation[]> {
  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, email, role, expires_at, created_at, status, invited_by")
    .eq("organization_id", organizationId)
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
    role: organizationRoleSchema.parse(row.role),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    invitedByName: nameById.get(row.invited_by) ?? null,
    // Expiry is evaluated, never trusted from `status`, exactly as in the
    // database. A row can read `pending` and be past its date.
    isExpired: new Date(row.expires_at).getTime() <= now,
  }));
}

/**
 * The explicit team: who was deliberately added to this client, with the
 * addresses the table needs. Account-derived access never appears here.
 */
export async function listOrganizationTeam(
  supabase: OrganizationClient,
  organizationId: string,
): Promise<readonly OrganizationTeamMember[]> {
  const { data, error } = await supabase.rpc("list_organization_members", {
    p_organization_id: organizationId,
  });

  if (error) throw new DomainError("DOMAIN_ERROR", "Team members could not be loaded.", error);

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: organizationRoleSchema.parse(row.role),
    createdAt: row.created_at,
  }));
}

/**
 * Role changes and removals write the membership table directly: the RLS
 * policies admit owners and admins, and the ceiling trigger refuses anything
 * at or above the actor's own role plus any attempt on the last owner.
 */
export async function updateOrganizationMemberRole(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  role: OrganizationRole,
): Promise<void> {
  const { data, error } = await supabase
    .from("organization_memberships")
    .update({ role })
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) throw memberWriteError(error, "changed");
  if (!data || data.length === 0)
    throw new DomainError("AUTHORIZATION_ERROR", "That member could not be changed.");

  logger.info("organization_member.role_changed", { organizationId, userId });
}

export async function removeOrganizationMember(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("organization_memberships")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) throw memberWriteError(error, "removed");
  if (!data || data.length === 0)
    throw new DomainError("AUTHORIZATION_ERROR", "That member could not be removed.");

  logger.info("organization_member.removed", { organizationId, userId });
}

/**
 * The ceiling trigger raises `insufficient_privilege` for authority the actor
 * cannot grant and `P0001` for the last owner. Both arrive here as database
 * errors and leave as words the dialog can show.
 */
function memberWriteError(error: { code?: string } | null, verb: "changed" | "removed"): DomainError {
  if (error?.code === "P0001")
    return new DomainError(
      "DOMAIN_ERROR",
      "An organization must keep at least one owner.",
      error,
    );
  if (error?.code === "42501")
    return new DomainError(
      "AUTHORIZATION_ERROR",
      "You cannot change a role at or above your own.",
    );
  return new DomainError("DOMAIN_ERROR", `That member could not be ${verb}.`, error ?? undefined);
}

export async function previewOrganizationInvitation(
  supabase: OrganizationClient,
  token: string,
): Promise<OrganizationInvitationPreview> {
  const { data, error } = await supabase
    .rpc("preview_organization_invitation", { p_token_hash: tokenDigest(token) })
    .maybeSingle();

  if (error) throw new DomainError("DOMAIN_ERROR", "The invitation could not be read.", error);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return organizationInvitationPreviewSchema.parse({
    state: data?.state ?? "invalid",
    organizationId: data?.organization_id ?? null,
    organizationName: data?.organization_name ?? null,
    invitedEmail: data?.invited_email ?? null,
    inviterName: data?.inviter_name ?? null,
    role: data?.role ?? null,
    expiresAt: data?.expires_at ?? null,
    matchesCaller: data?.matches_caller ?? false,
    signedInEmail: user?.email ?? null,
  });
}

export async function acceptOrganizationInvitation(
  supabase: OrganizationClient,
  token: string,
): Promise<{ organizationId: string; organizationName: string }> {
  const { data, error } = await supabase.rpc("accept_organization_invitation", {
    p_token_hash: tokenDigest(token),
  });

  if (error || !data) refuse(refusalCodeFor(error));

  logger.info("organization_invitation.accepted", { organizationId: data.id });
  return { organizationId: data.id, organizationName: data.name };
}

async function deliverOrganizationInvitation(input: {
  invitationId: string;
  email: string;
  token: string;
  organizationName: string;
  inviterName: string | null;
  role: OrganizationRole;
  expiresAt: string;
}): Promise<{ emailSent: boolean }> {
  const signInUrl = await mintInvitationSignInUrl({
    email: input.email,
    invitationToken: input.token,
  }).catch(() => null);

  const { sent } = await organizationInvitationEmailSender().send({
    to: input.email,
    invitationId: input.invitationId,
    organizationName: input.organizationName,
    inviterName: input.inviterName,
    roleLabel: organizationRoleLabels[input.role],
    actionUrl: signInUrl ?? acceptUrlFor(input.token),
    isOneClick: signInUrl !== null,
    expiresAt: input.expiresAt,
  });

  return { emailSent: sent };
}

export { organizationNameFor };
