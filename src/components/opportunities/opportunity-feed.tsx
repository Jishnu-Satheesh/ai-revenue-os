"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles } from "lucide-react";

import { OpportunityCard, OpportunityCardError } from "@/components/opportunities/opportunity-card";
import {
  opportunityFeedQueryOptions,
  opportunityQueryKeys,
  submitOpportunityAnswer,
  type OpportunityAnswer,
} from "@/components/opportunities/query-options";
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { OpportunityAction, OpportunityFeed } from "@/modules/decisions/application/feed";

const TIER_HEADINGS = {
  computed: {
    title: "Backed by your data",
    description: "These use your own economics, so the range is the one worth acting on first.",
  },
  observed: {
    title: "Backed by observed activity",
    description: "These come from what your connected sources reported, not from your own ledger.",
  },
  prior: {
    title: "Starting assumptions",
    description: "These have no measured basis yet. Treat the range as a hypothesis to test.",
  },
} as const;

export function OpportunityFeedView({
  organizationId,
  timeZone,
  initialFeed,
}: {
  organizationId: string;
  timeZone: string;
  initialFeed: OpportunityFeed;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ id: string; action: OpportunityAction } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const { data: feed } = useQuery(
    opportunityFeedQueryOptions({ organizationId, initialData: initialFeed }),
  );

  /**
   * Answers are never optimistic. An opportunity changes on screen because the
   * next authenticated read said so, which is the only version of events the
   * append-only feedback ledger agrees with.
   */
  const answer = useMutation({
    mutationFn: (input: OpportunityAnswer) => submitOpportunityAnswer(input),
    onMutate: (input) => {
      setFailure(null);
      setPending({ id: input.opportunityId, action: input.feedbackKind });
    },
    onError: (error: Error) => setFailure(error.message),
    onSettled: async () => {
      setPending(null);
      await queryClient.invalidateQueries({
        queryKey: opportunityQueryKeys.feed(organizationId),
      });
    },
  });

  const groups = feed?.groups ?? [];

  if (groups.length === 0) {
    return (
      <Empty>
        <EmptyContent>
          <Sparkles className="size-6 text-muted-foreground" aria-hidden />
          <EmptyTitle>No open proposals</EmptyTitle>
          <EmptyDescription>
            The Decision Engine proposes an opportunity only when the evidence it needs is present
            and current. Nothing is waiting on you right now.
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {failure && <OpportunityCardError message={failure} />}

      {groups.map((group) => {
        const heading = TIER_HEADINGS[group.evidenceTier];
        return (
          <section key={group.evidenceTier} aria-labelledby={`tier-${group.evidenceTier}`}>
            <div className="flex flex-col gap-1">
              <h2 id={`tier-${group.evidenceTier}`} className="text-sm font-semibold">
                {heading.title}
              </h2>
              <p className="text-sm text-muted-foreground">{heading.description}</p>
            </div>
            <Separator className="my-4" />
            <div className="grid gap-4 lg:grid-cols-2">
              {group.items.map((entry) => (
                <OpportunityCard
                  key={entry.id}
                  entry={entry}
                  timeZone={timeZone}
                  pendingAction={pending?.id === entry.id ? pending.action : null}
                  onAnswer={(action) =>
                    answer.mutate({
                      organizationId,
                      opportunityId: entry.id,
                      feedbackKind: action,
                      reason: null,
                      ...(action === "edited" ? { editDiff: { title: entry.title } } : {}),
                    })
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
