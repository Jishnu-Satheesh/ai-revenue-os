import type { ReactNode } from "react";

/**
 * Landing-specific decorative glyphs, copied from the recorded reference
 * geometry (`visual-inventory.json` symbols). The paths are generic shapes,
 * not brand marks. Each icon is decorative: `aria-hidden`, with the
 * accessible name living on the control that uses it. Sizes come from the
 * calling control's styles; the 18px default matches the reference.
 */

export const CHANNEL_ICON_NAMES = [
  "plus",
  "calendar",
  "down",
  "info",
  "arrow",
  "up",
  "search",
  "more",
  "close",
  "box",
  "globe",
  "store",
] as const;

export type ChannelIconName = (typeof CHANNEL_ICON_NAMES)[number];

const CHANNEL_ICON_CONTENT: Record<ChannelIconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18m-13 5h3" />
    </>
  ),
  down: <path d="m7 10 5 5 5-5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-11v1" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  up: <path d="M6 18 18 6M6 6h12v12" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  box: <path d="m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 5 9-5m-9 5v9M8 5l9 5v4" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  store: (
    <path d="M4 10v11h16V10M3 10l2-7h14l2 7M3 10c0 4 6 4 6 0 0 4 6 4 6 0 0 4 6 4 6 0M9 21v-7h6v7" />
  ),
};

export type ChannelIconProps = {
  name: ChannelIconName;
  className?: string;
};

export function ChannelIcon({ name, className }: ChannelIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {CHANNEL_ICON_CONTENT[name]}
    </svg>
  );
}
