import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingPage } from "@/components/marketing/landing-page";
import { createClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "@/modules/organizations/application/landing";

export const metadata: Metadata = {
  title: "RIO — Revenue Intelligence OS",
  description:
    "RIO builds a living twin of every business you serve, surfaces the safest high-value action each day, and measures what actually moved gross profit.",
  openGraph: {
    title: "RIO",
    description: "The operating cockpit for measurable client revenue.",
    type: "website",
  },
};

export default async function HomePage() {
  const supabase = await createClient();
  const user = await supabase.auth
    .getUser()
    .then(({ data }) => data.user)
    .catch(() => null);
  if (user) {
    redirect(await resolveLandingPath(supabase));
  }
  return <LandingPage />;
}
