import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  // The root resolves where this user belongs: their last organization, or the
  // create wizard when they have none yet.
  return NextResponse.redirect(new URL("/", request.url));
}
