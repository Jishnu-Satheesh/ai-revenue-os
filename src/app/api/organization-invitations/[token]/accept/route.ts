import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { createClient } from "@/lib/supabase/server";
import { DomainError } from "@/lib/errors";
import { invitationTokenSchema } from "@/domain/access/invitations";
import { acceptOrganizationInvitation } from "@/modules/organizations/application/invitations";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const parsed = invitationTokenSchema.safeParse((await params).token);
    // Same message as every other refusal: a malformed token must not be
    // distinguishable from a valid one that is not yours.
    if (!parsed.success)
      throw new DomainError("AUTHORIZATION_ERROR", "This invitation link is no longer valid.");

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new DomainError("AUTHENTICATION_ERROR", "Sign in to accept this invitation.");

    const organization = await acceptOrganizationInvitation(supabase, parsed.data);
    return NextResponse.json({ organization });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
