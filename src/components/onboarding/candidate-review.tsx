"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import type { OnboardingCandidateRecord } from "@/modules/onboarding/application/service";

type ReviewAction = "confirm" | "edit" | "reject" | "unknown";

export function CandidateReview({
  candidates,
  onReview,
}: {
  candidates: readonly OnboardingCandidateRecord[];
  onReview: (
    candidateId: string,
    input: {
      action: ReviewAction;
      payload?: Record<string, unknown>;
      evidence: Array<{ sourceReference: string; location?: string }>;
    },
  ) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        JSON.stringify(candidate.candidate_payload, null, 2),
      ]),
    ),
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(candidate: OnboardingCandidateRecord, action: ReviewAction) {
    setPending(candidate.id);
    setError(null);
    try {
      const payload =
        action === "edit" || action === "confirm"
          ? (JSON.parse(drafts[candidate.id] ?? "{}") as Record<string, unknown>)
          : undefined;
      await onReview(candidate.id, {
        action,
        payload,
        evidence: (candidate.evidence as Array<{ sourceReference: string; location?: string }>)
          .length
          ? (candidate.evidence as Array<{ sourceReference: string; location?: string }>)
          : [{ sourceReference: "operator review" }],
      });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Candidate review failed.");
    } finally {
      setPending(null);
    }
  }

  if (!candidates.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No extracted candidates are waiting for review.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Candidate review failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {candidates.map((candidate) => (
        <Card key={candidate.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>{candidate.fact_key ?? candidate.candidate_type.replaceAll("_", " ")}</span>
              <Badge variant={candidate.status === "pending" ? "secondary" : "outline"}>
                {candidate.status}
              </Badge>
            </CardTitle>
            <CardDescription>
              {candidate.evidence.length
                ? `Source: ${(candidate.evidence[0] as { sourceReference?: string }).sourceReference ?? "provided file"}`
                : "Source reference missing"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              aria-label={`Candidate ${candidate.id}`}
              value={drafts[candidate.id] ?? "{}"}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [candidate.id]: event.target.value }))
              }
              disabled={candidate.status !== "pending" || pending === candidate.id}
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending === candidate.id || candidate.status !== "pending"}
                onClick={() => void review(candidate, "unknown")}
              >
                Mark unknown
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending === candidate.id || candidate.status !== "pending"}
                onClick={() => void review(candidate, "reject")}
              >
                Reject
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending === candidate.id || candidate.status !== "pending"}
                onClick={() => void review(candidate, "edit")}
              >
                Save edit
              </Button>
              <Button
                type="button"
                disabled={pending === candidate.id || candidate.status !== "pending"}
                onClick={() => void review(candidate, "confirm")}
              >
                {pending === candidate.id ? <Spinner data-icon="inline-start" /> : null}
                Confirm fact
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
