import { NextResponse } from "next/server";
import { createEventPublisher } from "@/domain/events/publisher";
import { createOrganizationInputSchema } from "@/domain/organizations/types";
import { createOrganization } from "@/domain/organizations/repository";
import { DomainError, toPublicError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new DomainError("AUTHENTICATION_ERROR", "Authentication is required.");

    const input = createOrganizationInputSchema.parse(await request.json());
    const organization = await createOrganization(supabase, input);
    await createEventPublisher().publish({
      eventId: crypto.randomUUID(),
      eventName: "organization.created",
      occurredAt: new Date().toISOString(),
      organizationId: organization.id,
      actorType: "user",
      actorId: user.id,
      correlationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: { slug: organization.slug },
    });

    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    const publicError = toPublicError(error);
    const status = publicError.code === "AUTHENTICATION_ERROR" ? 401 : publicError.code === "VALIDATION_ERROR" ? 400 : 500;
    return NextResponse.json({ error: publicError }, { status });
  }
}
