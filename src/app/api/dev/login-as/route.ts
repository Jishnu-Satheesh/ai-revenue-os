import { NextResponse } from "next/server";
import { z } from "zod";

import { toPublicError } from "@/lib/errors";

import {
  createDevPersonaServiceClient,
  devPersonaRoleSchema,
  ensureDevPersona,
  mintDevPersonaSignInUrl,
} from "@/modules/accounts/application/dev-personas";

/**
 * Local-development sign-in as a test persona (ADR 0073).
 *
 * The gate is the whole safety case: anything but `pnpm dev` gets a 404
 * before any other code runs, and no override flag exists. Past the gate the
 * route provisions the namespaced persona and redirects through the real
 * `/auth/callback`, so the session in the browser is genuine — RLS, role
 * gates, and audit all behave exactly like production.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404 },
    );
  }
  try {
    const url = new URL(request.url);
    const parsed = z
      .object({ org: z.string().uuid(), role: devPersonaRoleSchema })
      .safeParse({ org: url.searchParams.get("org"), role: url.searchParams.get("role") });
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "org must be a UUID and role one of owner, admin, operator, viewer.",
          },
        },
        { status: 400 },
      );
    }
    const deps = createDevPersonaServiceClient();
    const persona = await ensureDevPersona(deps, {
      organizationId: parsed.data.org,
      role: parsed.data.role,
    });
    const signInUrl = await mintDevPersonaSignInUrl(deps, {
      email: persona.email,
      next: safeNextPath(url.searchParams.get("next")),
    });
    // Explicit 302: NextResponse.redirect defaults to 307, and the spec promises 302.
    return NextResponse.redirect(signInUrl, 302);
  } catch (error) {
    const publicError = toPublicError(error);
    const status = publicError.code === "AUTHENTICATION_ERROR" ? 401 : 422;
    return NextResponse.json({ error: publicError }, { status });
  }
}

/**
 * Only a same-origin path is an acceptable destination. Mirrors the callback's
 * own rule: `next` is attacker-influenced by construction, and `//evil` /
 * `/\evil` are protocol-relative despite starting with a slash.
 */
function safeNextPath(candidate: string | null): string {
  if (!candidate) return "/";
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  return candidate;
}
