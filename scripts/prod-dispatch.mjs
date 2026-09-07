import { randomUUID } from "node:crypto";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const { tasks } = await import("@trigger.dev/sdk");

const handle = await tasks.trigger("report-package.project", {
  organizationId: "2dda45b8-82db-4f5f-b17d-611b9bbb7846",
  packageId: "07b95201-d925-4a63-abee-366138021415",
  contractVersionId: "a44fc672-ef17-4cfa-a7a0-95e9d87c75c4",
  projectionVersionId: "3042693a-f743-466a-a9a7-217a3ce21650",
  projectionRunId: "db1ff64e-2096-4c7c-8bb1-6dee31685628",
  correlationId: randomUUID(),
  idempotencyKey: "sweep:db1ff64e-2",
});
console.log("dispatched:", handle.id);
process.exit(0);
