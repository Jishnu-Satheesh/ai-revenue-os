import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { getAccountContext } from "@/lib/api/account-context";
import { accountRolePermissions } from "@/domain/access/permissions";

/**
 * One "who am I" object.
 *
 * `accounts` and `profiles` are separate tables for good reason -- a profile is
 * one person, an account is the agency many people belong to -- but nothing in
 * the application needs to care. This route joins them so the client deals with
 * a single shape.
 *
 * `permissions` is included so the UI can hide controls without re-deriving the
 * role mapping in the browser. It is a convenience, never an authority: the
 * database refuses regardless of what this says.
 */
export async function GET() {
  try {
    const { supabase, user, accountId, accountName, accountSlug, accountRole } =
      await getAccountContext();

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    return NextResponse.json({
      account: { id: accountId, name: accountName, slug: accountSlug },
      membership: { accountRole },
      profile: {
        id: user.id,
        email: user.email ?? null,
        displayName: profile?.display_name ?? user.email ?? null,
        avatarUrl: profile?.avatar_url ?? null,
      },
      permissions: accountRolePermissions[accountRole],
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
