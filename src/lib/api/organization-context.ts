import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DomainError, toPublicError } from "@/lib/errors";
import { requireOrganizationAccess } from "@/modules/organizations/application/authorization";
import type { OrganizationRole } from "@/domain/organizations/types";
import { NextResponse } from "next/server";
import { createEventPublisher } from "@/domain/events/publisher";

const organizationIdSchema = z.string().uuid();

export async function getOrganizationContext(
  params: Promise<{ organizationId: string }>,
  allowedRoles?: readonly OrganizationRole[],
) {
  const { organizationId: rawOrganizationId } = await params;
  const parsed = organizationIdSchema.safeParse(rawOrganizationId);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Organization ID is invalid.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new DomainError("AUTHENTICATION_ERROR", "Authentication is required.");
  const membership = await requireOrganizationAccess(supabase, parsed.data, user.id, allowedRoles);
  return { supabase, user, organizationId: parsed.data, membership };
}

export function apiErrorResponse(error: unknown) {
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "VALIDATION_ERROR"
          ? 400
          : 422;
  return NextResponse.json({ error: publicError }, { status });
}

export async function publishOrganizationEvent(input: {
  organizationId: string;
  userId: string;
  eventName: string;
  branchId?: string;
  payload?: Record<string, unknown>;
}) {
  await createEventPublisher().publish({
    eventId: crypto.randomUUID(),
    eventName: input.eventName,
    occurredAt: new Date().toISOString(),
    organizationId: input.organizationId,
    branchId: input.branchId,
    actorType: "user",
    actorId: input.userId,
    correlationId: crypto.randomUUID(),
    schemaVersion: 1,
    payload: input.payload ?? {},
  });
}
