import { createClient } from "@/lib/supabase/server";
import { invitationTokenSchema, type InvitationPreview } from "@/domain/access/invitations";
import { previewInvitation } from "@/modules/accounts/application/service";
import { AcceptInvitation } from "@/components/accounts/accept-invitation";

const INVALID_PREVIEW: InvitationPreview = {
  state: "invalid",
  accountName: null,
  invitedEmail: null,
  inviterName: null,
  accountRole: null,
  defaultOrganizationRole: null,
  expiresAt: null,
  matchesCaller: false,
  signedInEmail: null,
};

/**
 * The one route in the product a signed-out stranger is meant to reach.
 *
 * It resolves on the server so the recipient sees who invited them without a
 * loading state, and so a malformed token is indistinguishable from an unknown
 * one before any request is made.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = invitationTokenSchema.safeParse(token);

  if (!parsed.success) return <AcceptInvitation token={token} preview={INVALID_PREVIEW} />;

  const supabase = await createClient();
  const preview = await previewInvitation(supabase, parsed.data);

  return <AcceptInvitation token={parsed.data} preview={preview} />;
}
