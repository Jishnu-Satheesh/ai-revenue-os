"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Asking the platform to work out what campaign to run next.
 *
 * Nothing in the product could do this. The research allowance, the admission
 * rules, the worker and the whole proposal pipeline existed with no way for a
 * person to start any of it, so the section above this button was correct and
 * permanently empty.
 *
 * Two things this is careful about.
 *
 * It never claims more than happened. The request is admitted by the database
 * and then handed to a worker, and those are separate facts: "research has
 * started" and "it is admitted but no worker has it yet" read differently here,
 * because only one of them means a proposal is on its way.
 *
 * It names the limit that stopped it. Every refusal from the allowance, the
 * cooldown and the pending cap comes back as its own sentence, because "could
 * not start research" tells somebody nothing about whether to wait, to raise a
 * budget, or to ask an owner.
 *
 * Allowance and outcome info always surface as toasts, never as inline page
 * content, so every host of this button (the Overview merged header and the
 * Recommendations proposal section) inherits the same behaviour with no extra
 * copy under the button.
 */
export function RequestCampaignResearch({
  organizationId,
}: Readonly<{ organizationId: string }>) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "working" }>({
    kind: "idle",
  });

  /**
   * One key per attempt, held across retries.
   *
   * A fresh key on every press would let a timed-out request become a second
   * admitted run against the same allowance. Reusing it means the database
   * replays the run it already admitted.
   */
  const attemptKey = useRef<string | null>(null);

  async function request() {
    setState({ kind: "working" });
    // Spend context is never inline page content, but never lost either: it
    // goes out as a toast the moment the user presses Ask, before the fetch.
    toast.info("Uses research allowance", {
      description: "This spends part of the research allowance set in Research settings.",
    });
    attemptKey.current ??= crypto.randomUUID();

    let response: Response;
    try {
      response = await fetch(`/api/organizations/${organizationId}/campaign-research/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          triggerKind: "manual_request",
          idempotencyKey: attemptKey.current,
        }),
      });
    } catch {
      // A request that never arrived admitted nothing and spent nothing, and
      // must not be reported as if it might have.
      toast.error("Research could not be started", {
        description: "That could not be sent. Nothing was started and nothing was spent.",
      });
      setState({ kind: "idle" });
      return;
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "object" &&
        (body as { error: { message?: unknown } }).error !== null &&
        typeof (body as { error: { message?: unknown } }).error.message === "string"
          ? (body as { error: { message: string } }).error.message
          : "Research could not be started. Nothing was spent.";
      toast.error("Research could not be started", { description: message });
      setState({ kind: "idle" });
      return;
    }

    // A started run is a new attempt; the next press is a new question.
    attemptKey.current = null;
    const started =
      typeof body === "object" && body !== null && "started" in body
        ? Boolean((body as { started: unknown }).started)
        : false;
    const queuedOnly = !started;
    toast.success("Research has started", {
      description: queuedOnly
        ? "The request is recorded and waiting for a worker to pick it up. Nothing has been written yet."
        : "A proposal will appear here when there is something worth deciding on.",
    });
    setState({ kind: "idle" });
    router.refresh();
  }

  return (
    <div>
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={state.kind === "working"}
        onClick={request}
      >
        <Sparkles aria-hidden="true" />
        {state.kind === "working" ? "Asking…" : "Ask for a campaign"}
      </Button>
    </div>
  );
}
