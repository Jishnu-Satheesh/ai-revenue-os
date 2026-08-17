"use client";

import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function OpportunitiesError({ reset }: { reset: () => void }) {
  return (
    // The boundary never repeats the thrown message: a failure here can mean a
    // missing membership, a refused read, or a data fault, and none of those
    // may be confirmed to someone who may not belong to this organization.
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Opportunities could not be loaded</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Check that you have access to this organization, then try again. No proposal was answered
          and nothing was changed.
        </span>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
