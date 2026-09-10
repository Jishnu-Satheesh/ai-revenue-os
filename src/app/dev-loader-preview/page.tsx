"use client";

// TEMPORARY visual harness for the analysis loader. Delete after screenshots.
import { useEffect, useState } from "react";

import { AnalysisProgress } from "@/components/analysis/analysis-progress";

const SEQUENCE = ["queued", "running", "narrating"] as const;

export default function DevLoaderPreview() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let index = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          stage: SEQUENCE[Math.min(index++, SEQUENCE.length - 1)],
          analysisRunId: null,
        }),
      }) as unknown as Response) as typeof fetch;
    setReady(true);
    return () => {
      globalThis.fetch = original;
    };
  }, []);

  return (
    <main className="min-h-screen space-y-4 p-10">
      <h1 className="text-2xl font-semibold">Channel workspace behind the loader</h1>
      <p className="text-muted-foreground">
        Filler content so the backdrop blur and the scroll lock are visible.
      </p>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 text-sm">
          Chapter {i + 1}
        </div>
      ))}
      {ready ? (
        <AnalysisProgress
          organizationId="859cf039-1cd8-41b0-bd09-66c6c52e9c52"
          channelId="23d08606-599d-440f-a330-5d522579dce7"
          window={{ from: "2026-03-25", to: "2026-03-31" }}
          onReady={() => {}}
          onDismiss={() => {}}
          pollMs={2500}
        />
      ) : null}
    </main>
  );
}
