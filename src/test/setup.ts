import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

import { mswServer } from "./msw/server";

// An outbound request with no handler fails the test rather than escaping to a
// real provider. Handlers are registered per test with `mswServer.use(...)`.
beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

if (typeof window !== "undefined") {
  window.scrollTo = () => undefined;

  // jsdom has no media query engine. Components read the viewport through
  // matchMedia, so the default answer is the desktop-first "no match".
  if (typeof window.matchMedia === "undefined") {
    window.matchMedia = ((query: string) => ({
      media: query,
      matches: false,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // jsdom implements neither observer, and Radix primitives (Switch, Select,
  // Popover) measure their triggers on mount through both.
  if (typeof window.ResizeObserver === "undefined") {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  if (typeof window.IntersectionObserver === "undefined") {
    window.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: readonly number[] = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
  }

  // Radix Select and Popover rely on pointer capture and scroll APIs that jsdom
  // leaves unimplemented.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}
