"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { truthClassChip } from "@/components/assets/asset-vocabulary";
import { AssetLibraryGrid, type LibraryReference } from "@/components/assets/asset-library-grid";
import { AssetReviewForm, type AssetReviewSubmission } from "@/components/assets/asset-review-form";
import { SubjectList, type SubjectRow } from "@/components/assets/subject-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CampaignOutputGroup } from "@/modules/campaigns/infrastructure/campaign-output-reader";

/**
 * The workspace: what we taught it, what it drew, and what we sell.
 *
 * The three tabs are deliberately not one long page. References are curated
 * rarely, campaign output is looked at after every generation, and subjects are
 * edited when the menu changes. Mixing them puts the rarely-used controls in
 * front of the daily ones.
 *
 * Every mutation here refreshes the server component rather than patching local
 * state. The database is the authority on verdicts and confirmation — a local
 * optimistic update would show an approval that the RPC may well have refused.
 */

type AssetWorkspaceProps = {
  organizationId: string;
  references: readonly LibraryReference[];
  campaignOutput: readonly CampaignOutputGroup[];
  subjects: readonly SubjectRow[];
  /** False for a role that may manage subjects but not approve one. */
  canConfirmSubjects: boolean;
  canReview: boolean;
};

export function AssetWorkspace({
  organizationId,
  references,
  campaignOutput,
  subjects,
  canConfirmSubjects,
  canReview,
}: AssetWorkspaceProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  async function send(path: string, method: string, body: unknown) {
    setFailure(null);
    const response = await fetch(`/api/organizations/${organizationId}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setFailure(payload?.error?.message ?? "That did not go through. Nothing was changed.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {failure === null ? null : (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {failure}
        </p>
      )}

      <Tabs defaultValue="references" className="flex min-h-0 flex-col gap-4">
        <TabsList>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="output">Campaign output</TabsTrigger>
          <TabsTrigger value="subjects">Dishes</TabsTrigger>
        </TabsList>

        <TabsContent value="references">
          <AssetLibraryGrid
            references={references}
            renderActions={
              canReview
                ? (reference) => (
                    <AssetReviewForm
                      subjectKind="brand_asset_version"
                      subjectId={reference.brandAssetVersionId}
                      pending={pending}
                      onSubmit={(submission: AssetReviewSubmission) =>
                        void send("/assets/reviews", "POST", submission)
                      }
                    />
                  )
                : undefined
            }
          />
        </TabsContent>

        <TabsContent value="output">
          {campaignOutput.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <h3 className="text-lg font-semibold">Nothing drawn yet</h3>
                <p className="max-w-md text-sm text-muted-foreground">
                  Generate a campaign and its images will collect here, newest round first.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-6">
              {campaignOutput.map((group) => (
                <section key={group.campaignId} className="flex flex-col gap-3">
                  <h3 dir="auto" className="text-lg font-semibold">
                    {group.title}
                  </h3>
                  {group.versions.map((version) => (
                    <div key={version.bundleVersionId} className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">Round {version.version}</p>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {version.images.map((image) => {
                          const chip = truthClassChip(image.truthClass);
                          return (
                            <Card key={image.id}>
                              <CardContent className="flex flex-col gap-2 p-4">
                                <Badge variant={chip.variant} className="w-fit">
                                  {chip.label}
                                </Badge>
                                <p className="text-xs text-muted-foreground">{chip.explanation}</p>
                                {image.altText === null ? null : (
                                  <p dir="auto" className="text-sm">
                                    {image.altText}
                                  </p>
                                )}
                                {canReview ? (
                                  <AssetReviewForm
                                    subjectKind="campaign_asset"
                                    subjectId={image.id}
                                    pending={pending}
                                    onSubmit={(submission: AssetReviewSubmission) =>
                                      void send("/assets/reviews", "POST", submission)
                                    }
                                  />
                                ) : null}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="subjects">
          <SubjectList
            subjects={subjects}
            canConfirm={canConfirmSubjects}
            pending={pending}
            onConfirm={(subjectId) =>
              void send(`/subjects/${subjectId}`, "PATCH", { action: "confirm" })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
