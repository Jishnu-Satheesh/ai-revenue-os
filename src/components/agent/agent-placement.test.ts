import { describe, expect, it } from "vitest";

import {
  AGENT_DRAWER_COLLAPSE_HEIGHT_PX,
  AGENT_DRAWER_MIN_WIDTH_PX,
  clampDrawerHeight,
  clampDrawerOffset,
  clampDrawerWidth,
  maxDrawerHeight,
  maxDrawerWidth,
  shouldCollapseDrawerHeight,
} from "@/components/agent/agent-placement";

describe("movable-drawer geometry (F5)", () => {
  it("floors width at 300px and never collapses it", () => {
    expect(clampDrawerWidth(100, 1024)).toBe(AGENT_DRAWER_MIN_WIDTH_PX);
    expect(clampDrawerWidth(-50, 1024)).toBe(AGENT_DRAWER_MIN_WIDTH_PX);
    expect(clampDrawerWidth(500, 1024)).toBe(500);
  });

  it("caps width at the viewport minus margins", () => {
    expect(maxDrawerWidth(1024)).toBe(1024 - 32);
    expect(clampDrawerWidth(5000, 1024)).toBe(1024 - 32);
  });

  it("keeps the floor reachable on narrow viewports", () => {
    expect(maxDrawerWidth(200)).toBe(AGENT_DRAWER_MIN_WIDTH_PX);
    expect(clampDrawerWidth(5000, 200)).toBe(AGENT_DRAWER_MIN_WIDTH_PX);
  });

  it("collapses below 12rem and holds the line itself", () => {
    expect(shouldCollapseDrawerHeight(AGENT_DRAWER_COLLAPSE_HEIGHT_PX - 1)).toBe(true);
    expect(shouldCollapseDrawerHeight(AGENT_DRAWER_COLLAPSE_HEIGHT_PX)).toBe(false);
    expect(clampDrawerHeight(5000, 768)).toBe(maxDrawerHeight(768));
  });

  it("keeps the dragged unit reachable on-screen", () => {
    // Roaming far right/bottom parks at the guard rails, never off-screen.
    expect(clampDrawerOffset(5000, 5000, 1024, 768)).toEqual({ x: 824, y: 0 });
    // Roaming far up-left parks at the opposite rails.
    expect(clampDrawerOffset(-5000, -5000, 1024, 768)).toEqual({ x: -824, y: -568 });
    // Small moves pass through untouched.
    expect(clampDrawerOffset(100, -100, 1024, 768)).toEqual({ x: 100, y: -100 });
  });
});
