import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "@/modules/organizations/application/landing";

/**
 * There is no account-wide page to land on, so the root resolves per user:
 * login, the organization they were last in, or the create wizard. Every rule
 * lives in the resolver so this route holds none of its own.
 */
export default async function HomePage() {
  const supabase = await createClient();
  redirect(await resolveLandingPath(supabase));
}
