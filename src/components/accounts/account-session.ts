"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { accountRoleSchema, organizationRoleSchema } from "@/domain/organizations/types";
import { pendingInvitationSchema } from "@/domain/access/invitations";
import type { AccountPermission } from "@/domain/access/permissions";

/**
 * The signed-in operator's agency, profile, and permissions in one shape.
 *
 * `accounts` and `profiles` are separate tables because a profile is one person
 * and an account is the agency many people belong to. Nothing in the UI needs to
 * know that: `/api/account` joins them, and this is the single object components
 * read.
 *
 * `permissions` decides what the UI *offers*. It never decides what the server
 * *allows* -- every route and every policy checks again.
 */
const accountSessionSchema = z.object({
  account: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
  membership: z.object({ accountRole: accountRoleSchema }),
  profile: z.object({
    id: z.string().uuid(),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  permissions: z.array(z.string()),
});

export type AccountSession = z.infer<typeof accountSessionSchema>;

const invitationListSchema = z.object({ invitations: z.array(pendingInvitationSchema) });

export const invitationWithTokenSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  accountRole: accountRoleSchema,
  defaultOrganizationRole: organizationRoleSchema.nullable(),
  expiresAt: z.string(),
  acceptUrl: z.string(),
});

export const accountSessionKey = ["account", "session"] as const;
export const accountInvitationsKey = ["account", "invitations"] as const;

async function readJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Something went wrong. Please try again.");
  }
  return body;
}

export function useAccountSession() {
  return useQuery({
    queryKey: accountSessionKey,
    queryFn: async () => accountSessionSchema.parse(await readJson(await fetch("/api/account"))),
    // A signed-in user with no agency is a real state during onboarding, not an
    // error worth retrying into.
    retry: false,
  });
}

export function usePendingInvitations(enabled: boolean) {
  return useQuery({
    queryKey: accountInvitationsKey,
    queryFn: async () =>
      invitationListSchema.parse(await readJson(await fetch("/api/account/invitations")))
        .invitations,
    enabled,
  });
}

export function hasPermission(
  session: AccountSession | undefined,
  permission: AccountPermission,
): boolean {
  return session?.permissions.includes(permission) ?? false;
}

export async function postInvitation(input: {
  email: string;
  accountRole: string;
  defaultOrganizationRole: string | null;
}) {
  const body = await readJson(
    await fetch("/api/account/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return invitationWithTokenSchema.parse(body.invitation);
}

export async function reissueInvitation(invitationId: string) {
  const body = await readJson(
    await fetch(`/api/account/invitations/${invitationId}/reissue`, { method: "POST" }),
  );
  return invitationWithTokenSchema.parse(body.invitation);
}

export async function revokeInvitation(invitationId: string) {
  await readJson(await fetch(`/api/account/invitations/${invitationId}`, { method: "DELETE" }));
}
