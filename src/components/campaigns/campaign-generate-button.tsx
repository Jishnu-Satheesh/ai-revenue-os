"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { idempotencyKey, startGeneration } from "@/components/campaigns/campaign-actions";
import { Button } from "@/components/ui/button";

/**
 * The explicit click that spends the approved purse.
 *
 * Rendered only for a campaign born from an approved proposal that has no
 * bundle version yet. After the first dispatch the caller replaces this with
 * generation status — there is never a second live button without a new
 * version or retry path, because a second click would spend again.
 *
 * Never auto-fires: starting generation is a POST on click, never an effect
 * on mount. Approval authorized preparation; this is the spend.
 */
export function CampaignGenerateButton({
  organizationId,
  campaignId,
  label = "Generate proposal creative",
  disabled = false,
  disabledReason,
}: Readonly<{
  organizationId: string;
  campaignId: string;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
}>) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      const result = await startGeneration({
        organizationId,
        campaignId,
        idempotencyKey: idempotencyKey(),
      });

      if (!result.ok) {
        toast.error("Could not start generation", { description: result.message });
        return;
      }

      toast.success("Generation started", {
        description:
          "The proposal creative is being built. This page will show it when it is ready.",
      });
      router.refresh();
    } catch {
      toast.error("Could not start generation", {
        description: "The request could not be sent. Check your connection.",
      });
    } finally {
      setStarting(false);
    }
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <Button onClick={start} disabled={disabled || starting} title={disabled ? disabledReason : undefined}>
        {starting ? "Starting…" : label}
      </Button>
      {disabled && disabledReason ? (
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      ) : null}
    </span>
  );
}
