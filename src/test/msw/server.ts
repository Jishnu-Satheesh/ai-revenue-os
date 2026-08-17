import { setupServer } from "msw/node";
import type { RequestHandler } from "msw";

/**
 * Provider HTTP is mocked at the network boundary rather than by stubbing an
 * adapter, so an adapter's real request shape — path, headers, body, and error
 * handling — is what the test exercises.
 *
 * The server starts with no handlers and `onUnhandledRequest: "error"`. An
 * unmocked outbound call is a test failure, not a silent live request: a suite
 * that quietly reaches a provider is how credentials leak into CI.
 */
export const mswServer = setupServer();

export function useMswHandlers(...handlers: RequestHandler[]): void {
  mswServer.use(...handlers);
}
