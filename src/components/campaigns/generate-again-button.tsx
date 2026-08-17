"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { idempotencyKey, startGeneration } from "@/components/campaigns/campaign-actions";
import { Button } from "@/components/ui/button";

/**
 * The way out of a campaign whose generation stopped.
 *
 * The card already says the run can be started again, and a sentence that
 * describes an action nobody can take is worse than saying nothing. This is
 * that action.
 *
 * It is offered only for a run that is finished or abandoned. A live run keeps
 * its lease, and the database would refuse a second claim anyway — but showing
 * the button there would invite an operator to fight a worker that is working.
 */
export function GenerateAgainButton({
  organizationId,
  campaignId,
  label = "Generate again",
}: Readonly<{ organizationId: string; campaignId: string; label?: string }>) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    const result = await startGeneration({
      organizationId,
      campaignId,
      idempotencyKey: idempotencyKey(),
    });
    setStarting(false);

    if (!result.ok) {
      toast.error("Could not start generation", { description: result.message });
      return;
    }

    toast.success("Generation started", {
      description: "The proposal is being built. This page will show it when it is ready.",
    });
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={start} disabled={starting}>
      {starting ? "Starting…" : label}
    </Button>
  );
}
