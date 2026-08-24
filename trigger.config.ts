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
  // Image generation is the long pole: three drawings, each of which may take
  // minutes under load and is retried once if it hangs.
  maxDuration: 3_300,
  build: {
    // `sharp` ships prebuilt native binaries. Bundling it produces a worker
    // that fails at runtime on the first image, so it has to stay external.
    //
    // `@napi-rs/canvas` is the poster text renderer and is native for the same
    // reason. It is listed here before anything imports it deliberately: the
    // failure mode of forgetting is a worker that builds cleanly and dies on the
    // first render, which is discovered far later and much more expensively.
    external: ["sharp", "@napi-rs/canvas"],
  },
});
