"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { OpportunityCard } from "@/modules/growth-intelligence/application/read-model";
import { GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY } from "@/modules/decisions/playbooks/governed-campaign-draft-v1";

/**
 * The governed-draft control for one opportunity card. The action is Create
 * governed draft, never Approve: success appears only for a committed request
 * outcome, and a linked draft opens by route rather than by claim. Viewers
 * get nothing interactive — state, when there is any, already reads on the
 * card itself.
 */
export function CampaignDraftAction({
  card,
  organizationId,
  canManage,
}: {
  card: OpportunityCard;
  organizationId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;
  if (card.actionKey !== GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY) return null;

  const draft = card.draftRequest;

  async function submit(body: Record<string, unknown>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/opportunities/${card.id}/campaign-draft`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }),
        },
      );
      // The response waits for the committed outcome, so a success always
      // means the answer is stored. A refusal keeps every typed word exactly
      // where it was, with a line saying so.
      if (response.ok) {
        router.refresh();
        return true;
      }
      setError(
        response.status === 403
          ? "Your role cannot request a governed draft."
          : "The draft request could not be recorded just now. It is kept below — try again.",
      );
      return false;
    } catch {
      setError("The draft request could not be recorded just now. It is kept below — try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  const ready = objective.trim().length > 0 && audience.trim().length > 0;

  if (draft?.status === "completed" && draft.campaignId) {
    return (
      <Link
        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
        href={`/organizations/${organizationId}/campaigns/${draft.campaignId}`}
      >
        Open draft
      </Link>
    );
  }

  if (draft && (draft.status === "pending" || draft.status === "processing")) {
    return <p className="text-xs text-muted-foreground">The draft is being prepared.</p>;
  }

  if (draft?.status === "permanent_failed") {
    return (
      <p className="text-xs text-muted-foreground">
        The draft could not be prepared and will not be retried. Nothing was created.
      </p>
    );
  }

  if (draft?.status === "cancelled") {
    return <p className="text-xs text-muted-foreground">The draft request was cancelled.</p>;
  }

  if (draft?.status === "retryable_failed") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          The last attempt did not finish. Nothing was created. State the intent again to retry.
        </p>
        <IntentInputs
          objective={objective}
          audience={audience}
          onObjective={setObjective}
          onAudience={setAudience}
        />
        {error ? (
          <p role="alert" className="text-[11px] font-medium text-warning">
            {error}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            size="sm"
            disabled={pending || !ready}
            onClick={() =>
              submit({
                opportunityVersion: card.version,
                objective: objective.trim(),
                audience: audience.trim(),
              })
            }
          >
            Retry draft request
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <IntentInputs
        objective={objective}
        audience={audience}
        onObjective={setObjective}
        onAudience={setAudience}
      />
      {error ? (
        <p role="alert" className="text-[11px] font-medium text-warning">
          {error}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          size="sm"
          disabled={pending || !ready}
          onClick={() =>
            submit({
              opportunityVersion: card.version,
              objective: objective.trim(),
              audience: audience.trim(),
            })
          }
        >
          Create governed draft
        </Button>
      </div>
    </div>
  );
}

function IntentInputs({
  objective,
  audience,
  onObjective,
  onAudience,
}: {
  objective: string;
  audience: string;
  onObjective: (value: string) => void;
  onAudience: (value: string) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Objective
        <input
          aria-label="Objective"
          className="rounded-lg border border-border bg-background p-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={objective}
          onChange={(event) => onObjective(event.target.value)}
          placeholder="What the draft must achieve"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Audience
        <input
          aria-label="Audience"
          className="rounded-lg border border-border bg-background p-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={audience}
          onChange={(event) => onAudience(event.target.value)}
          placeholder="Who the draft speaks to"
        />
      </label>
    </>
  );
}
