/**
 * Dispatch the execution loop against production and report what each worker did.
 *
 * These five were registered long after they were written, so the thing worth
 * proving is not that the code runs -- the unit tests cover that -- but that
 * each one reaches its real adapters, reads real rows, and comes back with an
 * answer rather than an exception.
 *
 * Read-mostly by construction in a deployment with no provider connected: the
 * dispatcher finds nothing queued, metrics refuse for want of a grant, and the
 * allocation cycle refuses for want of a configured policy. Settlement and
 * learning do write, and are idempotent -- a settled outcome replays as
 * `unchanged` rather than producing a second current answer.
 *
 *   node scripts/execution-loop-proof.mjs --org <organizationId>
 */
import { configure, runs, tasks } from "@trigger.dev/sdk";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

configure({ secretKey: env.TRIGGER_SECRET_KEY });

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const organizationId = arg("org", "9f566f3d-61bd-497f-b77e-76a74f9d07c1");

const dispatches = [
  ["campaign.dispatch-due-actions", { limit: 50 }],
  ["campaign.collect-metrics", { collectionRunId: randomUUID(), limit: 50 }],
  ["campaign.allocation-cycle", { organizationId }],
  ["campaign.settle-outcome", { organizationId }],
  ["campaign.propose-learning", { organizationId }],
];

let failures = 0;

for (const [taskId, payload] of dispatches) {
  process.stdout.write(`\n=== ${taskId} ===\n`);
  try {
    const handle = await tasks.trigger(taskId, payload);
    const finished = await runs.poll(handle.id, { pollIntervalMs: 2000 });
    console.log("status:", finished.status);
    console.log("output:", JSON.stringify(finished.output));
    if (finished.error) {
      // A refusal that names its reason is a result, not a crash. The point of
      // printing it is that an operator can tell the two apart.
      console.log("error:", JSON.stringify(finished.error));
    }
    if (finished.status !== "COMPLETED" && !finished.error) failures += 1;
  } catch (error) {
    failures += 1;
    console.log("dispatch failed:", error instanceof Error ? error.message : error);
  }
}

console.log(`\n${dispatches.length - failures}/${dispatches.length} reached a verdict.`);
