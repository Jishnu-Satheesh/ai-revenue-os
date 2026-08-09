"use client";

import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function MemoryError({ reset }: { reset: () => void }) {
  return (
    // The boundary never repeats the thrown message: a failure here can mean a
    // missing membership, a sensitivity refusal, or a read fault, and none of
    // those may be confirmed to someone who may not belong to this tenant.
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Business Memory could not be loaded</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Check that you have access to this organization, then try again. Nothing was changed.
        </span>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
