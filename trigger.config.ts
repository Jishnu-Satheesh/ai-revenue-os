import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./src/trigger"],
  runtime: "node-22",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
    },
  },
  maxDuration: 900,
  build: {
    // `sharp` ships prebuilt native binaries. Bundling it produces a worker
    // that fails at runtime on the first image, so it has to stay external.
    external: ["sharp"],
  },
});
