import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { getAccountContext, inviterContext } from "@/lib/api/account-context";
import { createInvitationInputSchema } from "@/domain/access/invitations";
import { createInvitation, listPendingInvitations } from "@/modules/accounts/application/service";

export async function GET() {
  try {
    const { supabase, accountId } = await getAccountContext("member.read");
    return NextResponse.json({ invitations: await listPendingInvitations(supabase, accountId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * The response carries `acceptUrl`, which contains the raw token. It is the only
 * time that value exists outside the inviter's clipboard: nothing persists it,
 * and there is no route that can read it back.
 */
export async function POST(request: Request) {
  try {
    const context = await getAccountContext("member.invite");
    const input = createInvitationInputSchema.parse(await request.json());
    const invitation = await createInvitation(
      context.supabase,
      context.accountId,
      input,
      await inviterContext(context),
    );
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
