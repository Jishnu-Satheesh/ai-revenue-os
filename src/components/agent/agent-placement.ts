"use client";

import { useSidebar } from "@/components/ui/sidebar";

/**
 * Left offset for the fixed agent containers (floating bar, open drawer).
 * The agent centers in the content area — viewport minus the sidebar — so it
 * never slides under the menu. Reuses the sidebar's own width tokens:
 * full width expanded, icon width collapsed, zero on mobile overlays.
 */
export function useAgentSidebarOffset(): string {
  const { state, isMobile } = useSidebar();
  if (isMobile) return "left-0";
  if (state === "collapsed") return "left-[calc(var(--sidebar-width-icon)+(--spacing(4)))]";
  return "left-(--sidebar-width)";
}

/**
 * Movable-drawer geometry (F5, spec section 5.2). Position and size live in
 * session memory only — the shell owns the state while mounted (so it
 * survives drawer close/reopen) and a full reload resets to defaults. No
 * localStorage, no DB write. Null width/height means "CSS default"
 * (`w-[min(44rem,100%)]` / `h-[34rem]`); offsets are pixels from rest.
 */
export type AgentDrawerGeometry = {
  x: number;
  y: number;
  width: number | null;
  height: number | null;
};

export const AGENT_DRAWER_DEFAULT_GEOMETRY: AgentDrawerGeometry = {
  x: 0,
  y: 0,
  width: null,
  height: null,
};

/** Resize floor: narrower than this the panel stops shrinking. */
export const AGENT_DRAWER_MIN_WIDTH_PX = 300;
/** Collapse line: a resize ending below this height docks the strip instead. */
export const AGENT_DRAWER_COLLAPSE_HEIGHT_PX = 192; // 12rem
/** Viewport margin kept visible around the unit (matches the px-4 gutters). */
export const AGENT_DRAWER_EDGE_MARGIN_PX = 16;
/** Fallback dims when resizing from the CSS default (44rem x 34rem). */
export const AGENT_DRAWER_DEFAULT_WIDTH_PX = 704;
export const AGENT_DRAWER_DEFAULT_HEIGHT_PX = 544; // 34rem

/** Widest the panel may grow: the viewport minus both gutters. */
export function maxDrawerWidth(viewportWidth: number): number {
  return Math.max(
    AGENT_DRAWER_MIN_WIDTH_PX,
    viewportWidth - AGENT_DRAWER_EDGE_MARGIN_PX * 2,
  );
}

/** Tallest the panel may grow: the viewport minus the top clearance. */
export function maxDrawerHeight(viewportHeight: number): number {
  return Math.max(
    AGENT_DRAWER_COLLAPSE_HEIGHT_PX,
    viewportHeight - AGENT_DRAWER_COLLAPSE_HEIGHT_PX,
  );
}

/** Width clamp: floor 300px, ceiling viewport minus margins. Never collapses. */
export function clampDrawerWidth(width: number, viewportWidth: number): number {
  return Math.min(maxDrawerWidth(viewportWidth), Math.max(AGENT_DRAWER_MIN_WIDTH_PX, width));
}

/** Height clamp after the collapse check below has passed. */
export function clampDrawerHeight(height: number, viewportHeight: number): number {
  return Math.min(
    maxDrawerHeight(viewportHeight),
    Math.max(AGENT_DRAWER_COLLAPSE_HEIGHT_PX, height),
  );
}

/** True when a resized height must dock the strip instead of shrinking. */
export function shouldCollapseDrawerHeight(height: number): boolean {
  return height < AGENT_DRAWER_COLLAPSE_HEIGHT_PX;
}

/**
 * Drag clamp: the unit may roam but never strand itself off-screen — at
 * least ~200px stay reachable horizontally, and it never drops below rest
 * or above one screen up.
 */
export function clampDrawerOffset(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const rangeX = Math.max(0, viewportWidth - 200);
  const minY = -Math.max(0, viewportHeight - 200);
  return {
    x: Math.min(rangeX, Math.max(-rangeX, x)),
    y: Math.min(0, Math.max(minY, y)),
  };
}
