import { createClient } from "@/lib/supabase/server";
import {
  invitationTokenSchema,
  type OrganizationInvitationPreview,
} from "@/domain/access/invitations";
import { previewOrganizationInvitation } from "@/modules/organizations/application/invitations";
import { AcceptOrganizationInvitation } from "@/components/organizations/accept-organization-invitation";

const INVALID_PREVIEW: OrganizationInvitationPreview = {
  state: "invalid",
  organizationId: null,
  organizationName: null,
  invitedEmail: null,
  inviterName: null,
  role: null,
  expiresAt: null,
  matchesCaller: false,
  signedInEmail: null,
};

/**
 * The one route in the product a signed-out stranger is meant to reach for a
 * client invitation. Separate from the agency accept path: the tokens live in
 * different tables, and a shared lookup would double the probe surface.
 *
 * It resolves on the server so the recipient sees who invited them without a
 * loading state, and so a malformed token is indistinguishable from an unknown
 * one before any request is made.
 */
export default async function OrganizationInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const parsed = invitationTokenSchema.safeParse(token);

  if (!parsed.success) return <AcceptOrganizationInvitation token={token} preview={INVALID_PREVIEW} />;

  const supabase = await createClient();
  const preview = await previewOrganizationInvitation(supabase, parsed.data);

  return <AcceptOrganizationInvitation token={parsed.data} preview={preview} />;
}
