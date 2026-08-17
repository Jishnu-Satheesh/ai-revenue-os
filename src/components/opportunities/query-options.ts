"use client";

import type { OpportunityAction, OpportunityFeed } from "@/modules/decisions/application/feed";

/**
 * Every opportunity cache entry hangs off the organization it was read for, so
 * switching tenants can never surface another organization's proposals and a
 * confirmed answer invalidates exactly the scope it touched.
 */
export const opportunityQueryKeys = {
  root: (organizationId: string) => ["organizations", organizationId, "opportunities"] as const,
  feed: (organizationId: string) => [...opportunityQueryKeys.root(organizationId), "feed"] as const,
};

export function opportunitiesBasePath(organizationId: string): string {
  return `/api/organizations/${organizationId}/opportunities`;
}

export type PublicApiError = { code: string; message: string; retryable?: boolean };

export class OpportunityRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpportunityRequestError";
  }
}

/** Reads the safe public error envelope the API guarantees; nothing else exists. */
export async function opportunityRequest<TResponse>(
  input: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => null)) as
    | ({ error?: PublicApiError } & Record<string, unknown>)
    | null;
  if (!response.ok) {
    const error = body?.error;
    throw new OpportunityRequestError(
      error?.code ?? "UNEXPECTED_ERROR",
      error?.message ?? "The opportunity request could not be completed.",
      response.status,
    );
  }
  return body as TResponse;
}

export function opportunityFeedQueryOptions(input: {
  organizationId: string;
  initialData?: OpportunityFeed;
  initialDataUpdatedAt?: number;
}) {
  return {
    queryKey: opportunityQueryKeys.feed(input.organizationId),
    queryFn: async () => {
      const body = await opportunityRequest<{ feed?: OpportunityFeed }>(
        opportunitiesBasePath(input.organizationId),
      );
      // A 200 without a feed is a broken contract, not an empty feed. Returning
      // undefined here would blank the list and read as "nothing to answer".
      if (!body.feed) {
        throw new OpportunityRequestError(
          "UNEXPECTED_ERROR",
          "The opportunity feed response was incomplete.",
          200,
        );
      }
      return body.feed;
    },
    initialData: input.initialData,
    initialDataUpdatedAt: input.initialDataUpdatedAt,
    /**
     * Expiry is computed on the server against the same clock the write path
     * uses. A long-lived cache would keep offering an answer the database has
     * already started refusing, so the feed goes stale quickly.
     */
    staleTime: 15_000,
  };
}

export type OpportunityEditDiff = {
  title?: string;
  summary?: string;
  assumptions?: readonly string[];
};

export type OpportunityAnswer = {
  organizationId: string;
  opportunityId: string;
  feedbackKind: OpportunityAction;
  reason: string | null;
  editDiff?: OpportunityEditDiff;
};

export async function submitOpportunityAnswer(
  answer: OpportunityAnswer,
): Promise<{ feedbackId: string }> {
  return opportunityRequest<{ feedbackId: string }>(
    `${opportunitiesBasePath(answer.organizationId)}/${answer.opportunityId}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        feedbackKind: answer.feedbackKind,
        reason: answer.reason,
        ...(answer.editDiff ? { editDiff: answer.editDiff } : {}),
      }),
    },
  );
}
