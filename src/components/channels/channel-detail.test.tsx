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
        reports={<p>Reports here</p>}
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
        reports={<p>Reports here</p>}
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
        reports={<p>Reports here</p>}
        setup={<p>Setup here</p>}
        defaultTab="analysis"
      />,
    );

    expect(screen.getByText("Setup here")).toBeTruthy();
  });

  it("offers a Reports tab beside Analysis and Setup when intake is permitted", () => {
    render(
      <ChannelDetail
        channelName="talabat"
        workspace={<p>Workspace here</p>}
        reports={<p>Reports here</p>}
        setup={<p>Setup here</p>}
        defaultTab="analysis"
      />,
    );

    // Inactive tab panels stay unmounted, so the tab itself is the assertion.
    expect(screen.getByRole("tab", { name: "Reports" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Analysis" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Setup" })).toBeTruthy();
  });

  it("offers no Reports tab when the viewer may neither upload nor approve", () => {
    render(
      <ChannelDetail
        channelName="talabat"
        workspace={<p>Workspace here</p>}
        reports={null}
        setup={<p>Setup here</p>}
        defaultTab="analysis"
      />,
    );

    expect(screen.queryByRole("tab", { name: "Reports" })).toBeNull();
  });
});
