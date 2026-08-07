import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QueryProvider } from "@/components/providers/query-provider";

describe("QueryProvider", () => {
  it("renders children inside the application query boundary", () => {
    const markup = renderToString(
      <QueryProvider>
        <p>Interactive server state</p>
      </QueryProvider>,
    );

    expect(markup).toContain("Interactive server state");
  });
});
