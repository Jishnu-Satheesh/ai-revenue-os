import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenSchema } from "@/domain/access/invitations";
import { previewInvitation } from "@/modules/accounts/application/service";

/**
 * Deliberately unauthenticated: the recipient must be able to see who invited
 * them before deciding whether to sign in at all.
 *
 * A malformed token returns the same `invalid` preview as a well-formed unknown
 * one, so nothing here distinguishes "no such invitation" from "not yours".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const parsed = invitationTokenSchema.safeParse((await params).token);
    if (!parsed.success)
      return NextResponse.json({
        preview: {
          state: "invalid",
          accountName: null,
          invitedEmail: null,
          inviterName: null,
          accountRole: null,
          defaultOrganizationRole: null,
          expiresAt: null,
          matchesCaller: false,
          signedInEmail: null,
        },
      });

    const supabase = await createClient();
    return NextResponse.json({ preview: await previewInvitation(supabase, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
