"use client";

import { ArrowRight, CircleAlert, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { ReadinessResult } from "@/domain/onboarding/readiness";
import { useState } from "react";
import { useOnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";

export function ReviewReadinessSection({
  readiness,
  onConfirm,
}: {
  readiness: ReadinessResult | null;
  onConfirm: () => Promise<boolean | void>;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const workspace = useOnboardingWorkspace();
  const blockers = readiness?.criticalBlockers ?? [];

  async function confirm() {
    setIsConfirming(true);
    try {
      const completed = await onConfirm();
      if (completed || (readiness && blockers.length === 0)) workspace?.goToNextSection();
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-(--card-spacing) py-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>AI readiness score</span>
              <Badge variant={blockers.length ? "secondary" : "default"}>
                {readiness?.overallScore ?? 0}%
              </Badge>
            </CardTitle>
            <CardDescription>
              Every point maps to a named requirement and a source-aware next action.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={readiness?.overallScore ?? 0} aria-label="AI readiness score" />
            {readiness && blockers.length ? (
              <Alert>
                <CircleAlert />
                <AlertTitle>Critical blockers remain</AlertTitle>
                <AlertDescription>{blockers.join(", ")}</AlertDescription>
              </Alert>
            ) : readiness ? (
              <Alert>
                <ShieldCheck />
                <AlertTitle>Review is ready for confirmation</AlertTitle>
                <AlertDescription>
                  Confirming records the operator decision and completes onboarding.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CircleAlert />
                <AlertTitle>Readiness has not been generated</AlertTitle>
                <AlertDescription>
                  Generate the deterministic assessment to see blockers and next actions.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next actions</CardTitle>
            <CardDescription>
              Prioritized actions stay visible even when onboarding is incomplete.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(readiness?.nextActions ?? []).map((action) => (
              <div
                key={action.reasonId}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <span className="text-sm font-medium">{action.reasonId}</span>
                <Badge variant="outline">{action.owner.replaceAll("_", " ")}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-card px-(--card-spacing) py-4">
        <p className="text-xs text-muted-foreground">
          {readiness && blockers.length > 0
            ? "Critical blockers must be cleared in their own sections before the review can be confirmed."
            : "Confirming records the operator decision and completes onboarding."}
        </p>
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={isConfirming || Boolean(readiness && blockers.length > 0)}
            onClick={() => void confirm()}
          >
            {isConfirming ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ArrowRight data-icon="inline-end" />
            )}
            {readiness ? "Confirm review" : "Generate readiness"}
          </Button>
        </div>
      </div>
    </div>
  );
}
