import { Coins } from "lucide-react";

import { ChannelEconomicsPanel } from "@/components/economics/channel-economics-panel";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  buildEconomicsView,
  resolveWindow,
  type EconomicsWindowPreset,
} from "@/modules/economics/application/read-model";
import {
  loadCatalogCoverage,
  loadLedgerEntries,
} from "@/modules/economics/infrastructure/repository";

type PageProps = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ window?: string }>;
};

const PRESETS = new Set<EconomicsWindowPreset>(["7d", "30d", "90d"]);

function toPreset(value: string | undefined): EconomicsWindowPreset {
  return value && PRESETS.has(value as EconomicsWindowPreset)
    ? (value as EconomicsWindowPreset)
    : "30d";
}

export default async function ChannelEconomicsPage({ params, searchParams }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);

  // Periods were bucketed in the branch timezone when they were written, so the
  // window has to be expressed in the same zone or it would slice days in half.
  const window = resolveWindow({
    preset: toPreset((await searchParams).window),
    timeZone: organization.default_timezone,
    now: new Date(),
  });

  const entries = await loadLedgerEntries(context.supabase, {
    organizationId: context.organizationId,
    branchId: null,
    rangeStart: window.rangeStart,
    rangeEndExclusive: window.rangeEndExclusive,
  });

  // Coverage comes through a governed RPC rather than the rate table, so an
  // operator without admin rights still sees what is priced and what is not.
  const catalog = await loadCatalogCoverage(context.supabase, context.organizationId);

  const view = buildEconomicsView({ window, entries, catalog });

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Coins />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Channel economics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.name} · contribution margin by channel, after every variable cost
          </p>
        </div>
      </div>

      <ChannelEconomicsPanel
        view={view}
        organizationName={organization.name}
        // Deep-links to the section that resolves these gaps, so the operator
        // lands on the form rather than hunting for it in an eleven-section rail.
        costStructureHref={`/organizations/${context.organizationId}/onboarding?section=cost_structure`}
      />
    </div>
  );
}
