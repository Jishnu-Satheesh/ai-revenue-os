import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { getAccountContext } from "@/lib/api/account-context";
import { DomainError } from "@/lib/errors";
import { reissueInvitation } from "@/modules/accounts/application/service";

const invitationIdSchema = z.string().uuid();

/**
 * Reissue rather than "resend": the previous link is revoked in the same
 * transaction, so a link already shared stops working the moment this succeeds.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await getAccountContext("member.invite");
    const parsed = invitationIdSchema.safeParse((await params).id);
    if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Invitation ID is invalid.");

    const invitation = await reissueInvitation(supabase, parsed.data);
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
