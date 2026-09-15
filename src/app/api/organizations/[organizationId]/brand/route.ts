import { NextResponse } from "next/server";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { brandRequestSchema } from "@/app/api/organizations/[organizationId]/brand/schema";
import {
  readBrandIdentity,
  saveBrandGuidelines,
  saveBrandLogo,
} from "@/modules/brand/application/brand-identity-service";
import {
  createBrandIdentityAdapter,
  type BrandIdentityPersistence,
} from "@/modules/brand/infrastructure/brand-identity-repository";

/**
 * An organization's brand identity: its mark and the rules generation respects.
 *
 * One route for both halves rather than two. The Brand Guidelines tab reads
 * and writes them together, and splitting them would make a partial save look
 * atomic when it is two requests that can half-succeed.
 *
 * Reading needs membership; writing needs `brand.manage`, which is the same
 * permission the RLS policy checks. Every call runs on the caller's session,
 * so there is no service-role path from a browser to an organization's rules.
 */

/**
 * Derived from the mirror rather than listed, so this route and the RLS policy
 * cannot come to disagree about who may edit a brand.
 */
const brandManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter((role) => hasOrganizationPermission(role, "brand.manage"));

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params);
    const identity = await readBrandIdentity(
      createBrandIdentityAdapter({
        persistence: context.supabase as unknown as BrandIdentityPersistence,
        organizationId: context.organizationId,
        userId: context.user.id,
      }),
    );
    return NextResponse.json(identity, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, brandManagerRoles);
    const body = brandRequestSchema.parse(
      await request.json().catch(() => {
        throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
      }),
    );

    const ports = createBrandIdentityAdapter({
      persistence: context.supabase as unknown as BrandIdentityPersistence,
      organizationId: context.organizationId,
      userId: context.user.id,
    });

    // The logo first. It is the half that can be refused on its own merits —
    // an unusable version — and writing the rules before discovering that
    // would leave a save that half happened while reporting a failure.
    if (body.logo) await saveBrandLogo(body.logo, ports);
    if (body.guidelines) await saveBrandGuidelines(body.guidelines, ports);

    return NextResponse.json(await readBrandIdentity(ports), { status: 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
