import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { getAccountContext } from "@/lib/api/account-context";
import { DomainError } from "@/lib/errors";
import { revokeInvitation } from "@/modules/accounts/application/service";

const invitationIdSchema = z.string().uuid();

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await getAccountContext("member.invite");
    const parsed = invitationIdSchema.safeParse((await params).id);
    if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Invitation ID is invalid.");

    // Scoping is the table's policy, not this route's: `member.invite` is checked
    // against the caller's own account, and the update matches no row in anyone
    // else's.
    await revokeInvitation(supabase, parsed.data);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
