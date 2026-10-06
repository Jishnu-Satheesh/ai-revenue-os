import { HomeRevenue } from "@/components/organizations/home/home-revenue";
import {
  buildAheadGrowthSection,
  buildBehindGrowthSection,
} from "@/components/organizations/home/home-growth-fixtures";

// TEST-ONLY Task 6 inspection route, preserved here as a non-executing copy.
// To reproduce the canonical screenshots: temporarily copy this file to
// src/app/overview-growth-harness/page.tsx, run `pnpm dev`, run render.mjs,
// then DELETE the route (never commit it under src/app). It renders test-only
// fixture DTOs and must never ship. Absence is proven by the growth
// fixture-boundary suite ("ships no growth-fixture render route under
// src/app") plus `git status` plus a production-build check.
const ORG_ID = "11111111-1111-4111-8111-111111111111";

export default async function OverviewGrowthHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const growth =
    state === "ahead" ? buildAheadGrowthSection(ORG_ID) : buildBehindGrowthSection(ORG_ID);
  return (
    <div style={{ background: "#ffffff", minHeight: "100vh" }}>
      <p
        style={{
          margin: 0,
          padding: "20px 60px 0",
          textAlign: "right",
          fontSize: 13,
          color: "#6b7280",
        }}
      >
        Design preview · Illustrative data
      </p>
      <div style={{ width: 1550, margin: "50px 0 0 63px" }}>
        <HomeRevenue organizationId={ORG_ID} section={{ status: "disabled" }} growth={growth} />
      </div>
    </div>
  );
}
