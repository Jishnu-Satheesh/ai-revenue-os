#!/usr/bin/env tsx
// Task 1 provider-qualification CLI. Fixture/fake mode runs the full harness
// offline with zero spend. The live entry point fails closed: without an
// explicit authorized budget cap plus provider credentials it refuses, and
// even with both it refuses because Task 1 ships no live provider adapter.
// Usage:
//   pnpm tsx scripts/creative-studio/qualify-provider.ts fake [--out /tmp/studio-qualification]
//   pnpm tsx scripts/creative-studio/qualify-provider.ts live
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { z } from "zod";

import {
  authorizeLiveRun,
  captureRetentionDisclosure,
  createFakeStudioProvider,
  decodeImageFrame,
  discoverCeilings,
  FakeProviderConfigSchema,
  QUALIFICATION_RATIOS,
  renderEvidenceViewerHtml,
  runEditSequence,
  runFailureProbes,
  runQualificationRatio,
  sanitizeEvidence,
  type QualificationRatio,
  type ViewerFrame,
} from "../../src/modules/creative-studio/infrastructure/provider-qualification";

const ArgsSchema = z.object({
  mode: z.enum(["fake", "live"]),
  out: z.string().min(1),
});

function parseArgs(argv: string[]): z.infer<typeof ArgsSchema> {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const outFlag = argv.indexOf("--out");
  return ArgsSchema.parse({
    mode: positional[0] ?? "fake",
    out: outFlag >= 0 && argv[outFlag + 1] ? argv[outFlag + 1] : "/tmp/studio-qualification",
  });
}

// Fixture-only PNG builder for the local evidence viewer. These bytes stand in
// for recorded frame fixtures so the browser verifier can see the viewer; they
// are labeled FIXTURE and are never production streaming output.
function fixturePngDataUri(width: number, height: number, seed: number): string {
  const bytes = Buffer.alloc(56);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  for (let i = 33; i < bytes.length; i++) bytes[i] = (seed + i) % 256;
  decodeImageFrame(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), "image/png");
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function runFakeMode(out: string): Promise<void> {
  const provider = createFakeStudioProvider(
    FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 2, "1:1": 1, "9:16": 3 } }),
  );
  const fixtures: Array<{ ratio: QualificationRatio; fixtureId: string; kinds: Array<"copy" | "product" | "design" | "logo" | "typographic" | "multilingual"> }> = [
    { ratio: "4:5", fixtureId: "copy-product-design-logo", kinds: ["copy", "product", "design", "logo"] },
    { ratio: "1:1", fixtureId: "typographic", kinds: ["typographic", "copy"] },
    { ratio: "9:16", fixtureId: "multilingual", kinds: ["multilingual", "copy", "logo"] },
  ];
  const ratioResults = [];
  for (const f of fixtures) {
    ratioResults.push(
      await runQualificationRatio(provider, f.ratio, { fixtureId: f.fixtureId, referenceKinds: f.kinds }),
    );
  }
  // Fresh-process reload: rehydrate by safe continuation ID in a new instance,
  // then two contextual edits including a branch from the older revision.
  const reloaded = createFakeStudioProvider(
    FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 2, "1:1": 1, "9:16": 3 } }),
  );
  const first = ratioResults[0];
  const edits = await runEditSequence(reloaded, {
    parentContinuationId: first.finalContinuationId,
    parentRevisionId: first.finalRevisionId,
    edits: [
      { instructionKind: "marker_edit", branchFromRevisionId: first.finalRevisionId },
      { instructionKind: "marker_edit", branchFromRevisionId: first.olderRevisionId },
    ],
  });
  const probes = await runFailureProbes((fault) =>
    createFakeStudioProvider(
      FakeProviderConfigSchema.parse({
        previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 },
        fault,
      }),
    ),
  );
  const ceilings = await discoverCeilings(provider);
  const disclosure = captureRetentionDisclosure(provider.profile);
  const evidence = sanitizeEvidence({ ratioResults, profile: provider.profile });

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "evidence.json"), `${JSON.stringify({ evidence, edits, probes, ceilings, disclosure }, null, 2)}\n`);

  const frames: ViewerFrame[] = ratioResults.flatMap((r) =>
    r.frames.map((f) => ({
      index: f.index,
      label: `${r.ratio} ${f.type} ${f.index}`,
      dataUri: fixturePngDataUri(f.width, f.height, f.index + r.previewCount),
      width: f.width,
      height: f.height,
      sha256: f.sha256,
    })),
  );
  writeFileSync(join(out, "evidence-viewer.html"), renderEvidenceViewerHtml({ title: "Studio qualification evidence (FIXTURE)", frames }));

  const failedProbes = probes.filter((p) => p.code === "unexpected_success");
  const missingPreview = ratioResults.filter((r) => r.missingProgressivePreview);
  const summary = {
    ratios: QUALIFICATION_RATIOS.length,
    previewTotals: ratioResults.map((r) => ({ ratio: r.ratio, previews: r.previewCount })),
    edits: edits.length,
    olderBranchOk: edits[1]?.branchedFromOlderRevision === true,
    failedProbes: failedProbes.length,
    missingPreviewRuns: missingPreview.length,
    ceilingsVerified: ceilings.verifiedByBoundaryProbe,
    spendMinor: 0,
  };
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const digest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex").slice(0, 16);
  console.log(`fake qualification complete: evidence digest ${digest}`);
  console.log(JSON.stringify(summary));
  if (failedProbes.length > 0 || missingPreview.length > 0) {
    console.log("note: fake run anomalies recorded honestly; live matrix stays BLOCKED pending cap.");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "live") {
    const decision = authorizeLiveRun(process.env as Record<string, string | undefined>);
    if (!decision.authorized) {
      console.error(`BLOCKED: ${decision.reason}`);
      process.exit(2);
    }
    console.error("BLOCKED: no live provider adapter ships in Task 1; refusing to spend.");
    process.exit(2);
  }
  await runFakeMode(args.out);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
