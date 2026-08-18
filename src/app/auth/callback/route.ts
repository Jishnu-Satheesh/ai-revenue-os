import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Only a same-origin path is an acceptable destination.
 *
 * `next` arrives from a link in an email, so it is attacker-influenced by
 * construction. Without this check the callback would forward a freshly signed-in
 * session to any address someone put in the query string, which is the textbook
 * open redirect -- and a credible one here, because the user has just been told
 * to trust a link in their inbox.
 *
 * `//evil.com` and `/\evil.com` are protocol-relative and must be refused
 * despite starting with a slash.
 */
function safeNextPath(candidate: string | null): string {
  if (!candidate) return "/";
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  return candidate;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Every magic link must land here first: this is where the code becomes a
  // session. A link that points anywhere else arrives signed out, and the page
  // it lands on can only ask the person to check their email again.
  //
  // With no destination the root resolves where the user belongs: their last
  // organization, or the create wizard when they have none yet.
  return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), request.url));
}
