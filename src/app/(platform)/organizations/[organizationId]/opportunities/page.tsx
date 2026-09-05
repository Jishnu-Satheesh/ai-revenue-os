import { redirect } from "next/navigation";

import { growthIntelligencePath } from "@/lib/routes";

type PageProps = { params: Promise<{ organizationId: string }> };

/**
 * The old Opportunity feed address now lands on the composed Growth
 * Intelligence workspace. The redirect starts no work and answers nothing:
 * old bookmarks keep working without triggering anything.
 */
export default async function OpportunitiesPage({ params }: PageProps) {
  const { organizationId } = await params;
  redirect(growthIntelligencePath(organizationId));
}
