import { ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  conditioningRoleLabel,
  ownershipChoice,
  reviewReasonLabel,
  verdictLabel,
} from "@/components/assets/asset-vocabulary";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type {
  AssetOwnership,
  ConditioningRole,
  CreativeReviewReasonCode,
  CreativeReviewVerdict,
} from "@/domain/campaigns/asset-library";

/**
 * The references the organization has taught the platform with.
 *
 * Two things here are easy to get wrong and both are visible to the client.
 *
 * **Direction.** Every string on this surface was written by the operator, and
 * this client writes in Malayalam, English and Arabic. `dir="auto"` lets each
 * string choose for itself, so an Arabic tag reads right-to-left inside an
 * otherwise left-to-right page. A page-level direction would break one script
 * or the other, and the break is invisible to whoever cannot read that script.
 *
 * **Rejection is not deletion.** A rejected reference is still doing work: spec
 * 019 routes it into the bounded `avoid` slot, so the model learns what this
 * client does not want. Styling rejection as removal would make an operator
 * delete the very thing that was teaching. Its picture is shown for the same
 * reason.
 *
 * **The picture is the point.** A card without one asks somebody to approve or
 * reject an image by its filename. The signed URL has reached this component
 * since previews were fixed at the page; it was simply never drawn.
 */

export type LibraryReference = {
  brandAssetId: string;
  brandAssetVersionId: string;
  label: string;
  assetRole: "logo" | "product" | "venue" | "team" | "other";
  conditioningRoles: readonly ConditioningRole[];
  tags: readonly string[];
  scripts: readonly string[];
  ownership: AssetOwnership;
  archivedAt: string | null;
  version: number;
  previewUrl: string | null;
  currentVerdict: CreativeReviewVerdict | null;
  currentReasonCodes: readonly CreativeReviewReasonCode[];
  currentReviewedAt: string | null;
};

type AssetLibraryGridProps = {
  references: readonly LibraryReference[];
  /** Rendered inside each card, so review controls can be wired by the page. */
  renderActions?: (reference: LibraryReference) => ReactNode;
  emptyAction?: ReactNode;
};

/** Operator-authored text. Never render one of these without `dir="auto"`. */
function OperatorText({ children, className }: { children: string; className?: string }) {
  return (
    <span dir="auto" className={className}>
      {children}
    </span>
  );
}

function VerdictBadge({ reference }: { reference: LibraryReference }) {
  if (reference.currentVerdict === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Not reviewed yet
      </Badge>
    );
  }
  return (
    <Badge variant={reference.currentVerdict === "approved" ? "default" : "secondary"}>
      {verdictLabel(reference.currentVerdict)}
    </Badge>
  );
}

/**
 * The reference itself.
 *
 * Two ways there is no picture, and they are told apart on purpose. The URL
 * can be absent because signing failed at the page, and it can stop working
 * mid-session because a signed URL has a bounded life. Both end as a plain
 * "preview unavailable"; neither is allowed to become a broken-image icon,
 * which reads as a damaged asset rather than a preview that expired.
 */
function ReferencePreview({ reference }: { reference: LibraryReference }) {
  const [failed, setFailed] = useState(false);
  const showImage = reference.previewUrl !== null && !failed;

  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-muted/50">
      {showImage ? (
        /* eslint-disable-next-line @next/next/no-img-element -- a session-signed
           private URL, not a static asset the image optimizer can fetch. */
        <img
          src={reference.previewUrl ?? ""}
          alt={reference.label}
          loading="lazy"
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="flex flex-col items-center gap-1.5 p-3 text-center text-xs text-muted-foreground">
          <ImageOff className="size-5" aria-hidden="true" />
          Preview unavailable
        </span>
      )}
    </div>
  );
}

export function AssetLibraryGrid({
  references,
  renderActions,
  emptyAction,
}: AssetLibraryGridProps) {
  if (references.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <ImageOff />
          </span>
          <h3 className="text-lg font-semibold">No references yet</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Upload a photograph of something you sell. One good picture teaches more than a
            long description, and the platform will draw from it instead of guessing.
          </p>
          {emptyAction}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {references.map((reference) => {
        const ownership = ownershipChoice(reference.ownership);
        return (
          <Card key={reference.brandAssetVersionId} className="overflow-hidden">
            <CardContent className="flex flex-col gap-3 p-4">
              <ReferencePreview reference={reference} />

              <div className="flex items-start justify-between gap-2">
                <OperatorText className="text-base font-semibold leading-tight">
                  {reference.label}
                </OperatorText>
                <VerdictBadge reference={reference} />
              </div>

              <p className="text-xs text-muted-foreground">
                Version {reference.version}
                {reference.archivedAt === null ? null : " · Archived"}
              </p>

              {reference.conditioningRoles.length === 0 ? null : (
                <div className="flex flex-wrap gap-1.5">
                  {reference.conditioningRoles.map((role) => (
                    <Badge key={role} variant="outline">
                      {conditioningRoleLabel(role)}
                    </Badge>
                  ))}
                </div>
              )}

              {reference.tags.length === 0 ? null : (
                <div className="flex flex-wrap gap-1.5">
                  {reference.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="font-normal">
                      <OperatorText>{tag}</OperatorText>
                    </Badge>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">{ownership.label}</p>

              {reference.currentVerdict === "rejected" ? (
                <div className="flex flex-col gap-1.5 rounded-md bg-muted/60 p-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {reference.currentReasonCodes.map((code) => (
                      <Badge key={code} variant="outline">
                        {reviewReasonLabel(code)}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Kept on purpose. A rejected reference is still used, as an example of what to
                    avoid.
                  </p>
                </div>
              ) : null}

              {renderActions?.(reference)}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
