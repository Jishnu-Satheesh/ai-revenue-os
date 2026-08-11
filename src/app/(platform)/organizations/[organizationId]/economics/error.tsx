"use client";

import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function ChannelEconomicsError({ reset }: { reset: () => void }) {
  return (
    // The boundary never repeats the thrown message: a failure here can mean a
    // missing membership or a window that mixes currencies, and the first must
    // not be confirmed to a stranger.
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Channel economics could not be loaded</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Check that you have access to this organization, and that its imported revenue is all in
          one currency, then try again.
        </span>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
