import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "@/modules/organizations/application/landing";

/**
 * App-only entry: every visit resolves through the ADR 0015 landing rule.
 * Signed-in users reach their organization or the create wizard; everyone
 * else reaches `/login`. The public site now lives in the separate Astro
 * project, so this route renders no marketing.
 */
export default async function HomePage() {
  const supabase = await createClient();
  let path: string;
  try {
    path = await resolveLandingPath(supabase);
  } catch {
    path = "/login";
  }
  redirect(path);
}
