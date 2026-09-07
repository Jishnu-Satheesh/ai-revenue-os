import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./src/trigger"],
  runtime: "node-22",
  // So `process.cwd()` is the build directory in dev as well as in production.
  // `font-manifest.ts` resolves the vendored fonts from cwd, and a dev worker
  // that resolved them from somewhere else would prove nothing about the
  // deployed one.
  legacyDevProcessCwdBehaviour: false,
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
    // `fontkit` answers glyph coverage. It is not native, but it is ESM-only,
    // parses binary tables, and opens the vendored font files from disk by path
    // at runtime. Bundling it risks the same shape of failure as the two above:
    // a build that succeeds and a worker that dies on the first render.
    external: ["sharp", "@napi-rs/canvas", "fontkit"],
    // The fonts are inputs to a render, not assets of a website, so they have
    // to be in the image the worker runs from. Marking the renderer external
    // ships the code that draws and none of the files it draws with: the first
    // real deployed render failed with "Could not register the vendored font
    // NotoSans-Regular.ttf", which is the font registry refusing to fall back
    // rather than quietly rendering a client's Malayalam as empty boxes.
    //
    // The paths are preserved relative to this file's directory, which is what
    // lets `font-manifest.ts` keep resolving them from `process.cwd()`.
    extensions: [additionalFiles({ files: ["./assets/fonts/**"] })],
  },
});
