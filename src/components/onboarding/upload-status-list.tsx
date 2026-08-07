"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OnboardingUploadRecord } from "@/modules/onboarding/application/service";

export function UploadStatusList({ uploads }: { uploads: readonly OnboardingUploadRecord[] }) {
  if (!uploads.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No files uploaded yet. Manual source entry remains available.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {uploads.map((upload) => (
        <Card key={upload.id} className="py-3">
          <CardHeader className="px-4 pb-1">
            <CardTitle className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{upload.original_filename}</span>
              <Badge variant={upload.status === "failed" ? "destructive" : "secondary"}>
                {upload.status}
              </Badge>
            </CardTitle>
            <CardDescription>
              {upload.media_type} · {Math.round(upload.byte_size / 1024)} KB
            </CardDescription>
          </CardHeader>
          {upload.error_summary ? (
            <CardContent className="px-4 pt-1 text-xs text-destructive">
              {upload.error_summary}
            </CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
