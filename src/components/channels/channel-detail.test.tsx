// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChannelDetail } from "@/components/channels/channel-detail";

afterEach(cleanup);

describe("ChannelDetail", () => {
  it("opens on Analysis when an analysis is available", () => {
    render(
      <ChannelDetail
        channelName="talabat"
        workspace={<p>Workspace here</p>}
        setup={<p>Setup here</p>}
        defaultTab="analysis"
      />,
    );

    expect(screen.getByRole("tab", { name: "Analysis" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("heading", { name: "talabat" })).toBeTruthy();
  });

  it("offers no Analysis tab when the slice is off for the organization", () => {
    render(
      <ChannelDetail
        channelName="talabat"
        workspace={null}
        setup={<p>Setup here</p>}
        defaultTab="setup"
      />,
    );

    expect(screen.queryByRole("tab", { name: "Analysis" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Setup" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows Setup even when asked to default to an analysis that does not exist", () => {
    // An archived channel resolves to no workspace. Defaulting to a tab that
    // was never drawn would render an empty panel.
    render(
      <ChannelDetail
        channelName="talabat"
        workspace={null}
        setup={<p>Setup here</p>}
        defaultTab="analysis"
      />,
    );

    expect(screen.getByText("Setup here")).toBeTruthy();
  });
});
