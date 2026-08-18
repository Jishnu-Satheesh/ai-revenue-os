import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";

import { CampaignStudio } from "@/components/campaigns/campaign-studio";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { toGeneration } from "@/modules/campaigns/application/studio-view";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { readStudioView } from "@/modules/campaigns/infrastructure/studio-reader";
import { createCampaignVariantStore } from "@/modules/campaigns/infrastructure/variant-repository";
import type { CampaignVariantPersistence } from "@/modules/campaigns/infrastructure/variant-repository";
import { remainingCapacity } from "@/modules/campaigns/application/variant-service";
import type { VariantCard } from "@/components/campaigns/variant-grid";

type PageProps = {
  params: Promise<{ organizationId: string; campaignId: string }>;
  searchParams: Promise<{ version?: string }>;
};

export default async function CampaignDetailPage({ params, searchParams }: PageProps) {
  const resolved = await params;
  const context = await getOrganizationContext(Promise.resolve(resolved));
  const organization = await getOrganization(context.supabase, context.organizationId);
  const { version } = await searchParams;

  const read = createCampaignReadRepository(context.supabase as unknown as CampaignPersistence);

  const view = await readStudioView(read, context.organizationId, resolved.campaignId, {
    versionId: version,
    // Signed against the caller's own session, so the private bucket is
    // reached with the member's permissions rather than around them.
    previews: {
      database: context.supabase as never,
      storage: context.supabase as never,
    },
    // Also the caller's session. The readiness function runs as the invoker,
    // so the member's own row level security decides what it can see.
    readiness: context.supabase as never,
  });

  if (!view) {
    // "Not found" and "not yours" must stay indistinguishable, or the answer
    // would confirm another tenant's campaign exists. "Mine, but not generated
    // yet" is a different question: the caller already proved membership to get
    // here, and RLS is what makes this read safe to trust.
    const campaign = await read.getCampaign(context.organizationId, resolved.campaignId);
    if (!campaign) notFound();

    const run = await read.latestGenerationRun(context.organizationId, resolved.campaignId);
    const generation = toGeneration(run, false, new Date().toISOString());

    return (
      <div className="flex min-h-0 flex-col gap-6">
        <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
        <RegisterRouteLabel segment={resolved.campaignId} label={campaign.title} />

        <div className="flex shrink-0 items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Megaphone />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{campaign.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              No proposal has been generated yet · {organization.name}
            </p>
          </div>
        </div>

        <Alert>
          <AlertTitle>
            {generation.status === "generating"
              ? "This campaign is still being built"
              : "This campaign has no proposal to review"}
          </AlertTitle>
          <AlertDescription>
            {generation.detail} Nothing has been approved, scheduled, or published, so no creative
            exists to review yet.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Read only once an approval exists: before that there is no envelope for
  // creative to live inside, and the query would be work with no answer.
  const fleet =
    view.approval.status === "live"
      ? await readFleet(context, view)
      : { variants: [] as VariantCard[], remaining: {} as Record<string, number> };

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={resolved.campaignId} label={view.title} />

      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Megaphone />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{view.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view.sourceLabel} · version {view.versionNumber} · {organization.name}
          </p>
        </div>
      </div>

      <Alert>
        <AlertTitle>Objective</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>{view.objective}</span>
          <span className="text-xs">{view.rationale}</span>
        </AlertDescription>
      </Alert>

      <CampaignStudio
        view={view}
        organizationId={context.organizationId}
        organizationName={organization.name}
        timeZone={organization.default_timezone}
        variants={fleet.variants}
        variantsRemaining={fleet.remaining}
      />
    </div>
  );
}

/**
 * The creative produced under this approval, joined to the directions it varies.
 *
 * The direction's name and kind live in the approved manifest rather than on the
 * variant row, so the join happens here: duplicating them onto every variant
 * would let a renamed direction disagree with itself across a fleet.
 */
async function readFleet(
  context: { supabase: unknown; organizationId: string },
  view: Awaited<ReturnType<typeof readStudioView>>,
): Promise<{ variants: VariantCard[]; remaining: Record<string, number> }> {
  if (!view) return { variants: [], remaining: {} };

  const store = createCampaignVariantStore(
    context.supabase as unknown as CampaignVariantPersistence,
  );
  const [stored, capacity] = await Promise.all([
    store.listForVersion(context.organizationId, view.versionId),
    store.readCapacity(context.organizationId, view.versionId),
  ]);

  const byDirection = new Map(view.directions.map((direction) => [direction.id, direction]));

  return {
    variants: stored.flatMap((variant) => {
      const direction = byDirection.get(variant.directionId);
      if (!direction) return [];
      return [
        {
          id: variant.id,
          directionId: variant.directionId,
          directionName: direction.name,
          directionKind: direction.kind,
          ordinal: variant.ordinal,
          state: variant.state,
          hook: variant.hook,
          caption: variant.caption,
          callToAction: variant.callToAction,
          hashtags: variant.hashtags,
          channel: variant.channel,
          placement: variant.placement,
          // Signed previews are issued per bundle asset; a variant's own image
          // gets its link in the same pass once that path exists. Null renders
          // as "preview unavailable" rather than a broken image.
          previewUrl: null,
        },
      ];
    }),
    remaining: Object.fromEntries(
      view.directions.map((direction) => [
        direction.id,
        remainingCapacity({ generationPolicy: view.generationPolicy } as never, {
          usedInDirection: capacity.usedByDirection[direction.id] ?? 0,
          usedInTotal: capacity.usedInTotal,
        }),
      ]),
    ),
  };
}
