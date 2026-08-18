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

/**
 * Two ways a link becomes a session, and both land here.
 *
 * `code` is the PKCE exchange, used by sign-in the browser itself asked for.
 * `token_hash` is an admin-minted token, used by the invitation email -- that
 * link is built by us from `NEXT_PUBLIC_APP_URL` and verified here, so it never
 * depends on Supabase's redirect allowlist.
 */
const OTP_TYPES = new Set(["magiclink", "invite", "signup", "recovery", "email_change", "email"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && otpType && OTP_TYPES.has(otpType)) {
    const supabase = await createClient();
    // A failure here leaves the caller signed out, and the page they land on
    // says so. Redirecting to an error route instead would tell an anonymous
    // visitor that the token was real but spent.
    await supabase.auth.verifyOtp({
      type: otpType as "magiclink" | "invite" | "signup" | "recovery" | "email_change" | "email",
      token_hash: tokenHash,
    });
  }

  // Every magic link must land here first: this is where the code becomes a
  // session. A link that points anywhere else arrives signed out, and the page
  // it lands on can only ask the person to check their email again.
  //
  // With no destination the root resolves where the user belongs: their last
  // organization, or the create wizard when they have none yet.
  return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), request.url));
}
