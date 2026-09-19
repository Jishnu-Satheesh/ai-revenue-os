"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { organizationRoleSchema } from "@/domain/organizations/types";
import {
  organizationInvitationWithTokenSchema,
  organizationTeamMemberSchema,
  pendingOrganizationInvitationSchema,
} from "@/domain/access/invitations";

/**
 * The signed-in operator's standing in one client, mirroring
 * `account-session` at organization scope.
 *
 * `role` decides what the UI *offers*. It never decides what the server
 * *allows* -- every route, policy, and trigger checks again.
 */
const organizationSessionSchema = z.object({ role: organizationRoleSchema.nullable() });

export type OrganizationSession = {
  organizationId: string;
  role: z.infer<typeof organizationRoleSchema> | null;
};

const teamListSchema = z.object({ members: z.array(organizationTeamMemberSchema) });
const invitationListSchema = z.object({
  invitations: z.array(pendingOrganizationInvitationSchema),
});

export const organizationSessionKey = (organizationId: string) =>
  ["organization", organizationId, "session"] as const;
export const organizationTeamKey = (organizationId: string) =>
  ["organization", organizationId, "team"] as const;
export const organizationInvitationsKey = (organizationId: string) =>
  ["organization", organizationId, "invitations"] as const;

async function readJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Something went wrong. Please try again.");
  }
  return body;
}

export function useOrganizationSession(organizationId: string) {
  return useQuery({
    queryKey: organizationSessionKey(organizationId),
    queryFn: async (): Promise<OrganizationSession> => {
      const parsed = organizationSessionSchema.parse(
        await readJson(await fetch(`/api/organizations/${organizationId}/session`)),
      );
      return { organizationId, role: parsed.role };
    },
    retry: false,
  });
}

export function useTeamMembers(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: organizationTeamKey(organizationId),
    queryFn: async () =>
      teamListSchema.parse(
        await readJson(await fetch(`/api/organizations/${organizationId}/members`)),
      ).members,
    enabled,
  });
}

export function usePendingOrganizationInvitations(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: organizationInvitationsKey(organizationId),
    queryFn: async () =>
      invitationListSchema.parse(
        await readJson(await fetch(`/api/organizations/${organizationId}/invitations`)),
      ).invitations,
    enabled,
  });
}

export async function postOrganizationInvitation(
  organizationId: string,
  input: { email: string; role: string },
) {
  const body = await readJson(
    await fetch(`/api/organizations/${organizationId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return organizationInvitationWithTokenSchema.parse(body.invitation);
}

export async function reissueOrganizationInvitation(organizationId: string, invitationId: string) {
  const body = await readJson(
    await fetch(`/api/organizations/${organizationId}/invitations/${invitationId}/reissue`, {
      method: "POST",
    }),
  );
  return organizationInvitationWithTokenSchema.parse(body.invitation);
}

export async function revokeOrganizationInvitation(organizationId: string, invitationId: string) {
  await readJson(
    await fetch(`/api/organizations/${organizationId}/invitations/${invitationId}`, {
      method: "DELETE",
    }),
  );
}

export async function updateTeamMemberRole(
  organizationId: string,
  userId: string,
  role: string,
) {
  await readJson(
    await fetch(`/api/organizations/${organizationId}/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }),
  );
}

export async function removeTeamMember(organizationId: string, userId: string) {
  await readJson(
    await fetch(`/api/organizations/${organizationId}/members/${userId}`, { method: "DELETE" }),
  );
}
