"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  MarketProfileView,
  MarketProfileVersionView,
} from "@/modules/growth-intelligence/application/ports";

function latestPendingVersion(profile: MarketProfileView): MarketProfileVersionView | null {
  const decided = new Set(profile.decisions.map((decision) => decision.profileVersionId));
  const candidates = profile.versions
    .filter(
      (version) => version.id !== profile.profile?.currentVersionId && !decided.has(version.id),
    )
    .sort((left, right) => right.version - left.version);
  return candidates[0] ?? null;
}

export function MarketProfileReview({
  organizationId,
  profile,
  canManage,
}: {
  organizationId: string;
  profile: MarketProfileView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "working" | "saved" | "failed">("idle");

  const current = profile.versions.find(
    (version) => version.id === profile.profile?.currentVersionId,
  );
  const pending = latestPendingVersion(profile);

  async function decide(version: MarketProfileVersionView, decision: "confirmed" | "rejected") {
    setStatus("working");
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/market-profile/versions/${version.id}/decisions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision,
            profileDigest: version.digest,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok) {
        setStatus("failed");
        return;
      }
      // Non-optimistic success: the confirmation counts only after the
      // authoritative read returns the approved version.
      const reread = await fetch(`/api/organizations/${organizationId}/market-profile`);
      if (!reread.ok) {
        setStatus("failed");
        return;
      }
      const body = (await reread.json()) as {
        marketProfile: MarketProfileView;
      };
      const confirmed =
        decision === "rejected" || body.marketProfile.profile?.currentVersionId === version.id;
      if (!confirmed) {
        setStatus("failed");
        return;
      }
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("failed");
    }
  }

  return (
    <section aria-label="Market profile review" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Market profile</h2>
      {current ? (
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Version {current.version} is active</AlertTitle>
          <AlertDescription>
            {current.document.publicIdentity.approvedName} · digest{" "}
            <span className="font-mono text-xs">{current.digest.slice(0, 12)}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      {!pending ? (
        <p className="text-sm text-muted-foreground">
          {current ? "No pending proposal." : "No Market Profile has been proposed yet."}
        </p>
      ) : (
        <Card data-testid={`market-profile-proposal-${pending.id}`}>
          <CardHeader>
            <CardTitle className="text-base">
              Proposed: {pending.document.publicIdentity.approvedName}
            </CardTitle>
            <CardDescription>
              Version {pending.version} · proposed by {pending.proposalSource} ·{" "}
              {pending.document.nicheDescriptors.join(", ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Confirming this proposal supersedes the active version and enqueues research work.
              Nothing is published or spent.
            </p>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={status === "working"}
                  onClick={() => decide(pending, "confirmed")}
                >
                  <ShieldCheck aria-hidden="true" />
                  Confirm profile
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={status === "working"}
                  onClick={() => decide(pending, "rejected")}
                >
                  Reject
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Read-only for your role. An operator confirms proposals.
              </p>
            )}
            {status === "saved" ? (
              <p className="text-sm">
                Saved. The proposal was confirmed and active on the authoritative read.
              </p>
            ) : null}
            {status === "failed" ? (
              <p className="text-sm text-destructive">
                The decision could not be saved. Nothing changed.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
      {status === "saved" && !pending ? (
        <p className="text-sm">The proposal was confirmed and active.</p>
      ) : null}
    </section>
  );
}
