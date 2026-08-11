# Revenue Intelligence System theme

Regenerated 2026-08-11 from `src/app/globals.css`. The previous snapshot recorded a
blue accent (`oklch(0.53 0.16 250)`) and blue-tinted neutrals; neither exists in the
codebase. Anything designed against that snapshot will come out the wrong colour.

## Compact token summary

- Framework: Tailwind CSS v4 with `@theme inline`; shadcn/ui New York, Radix base.
- Font: Arial, Helvetica, sans-serif (current implementation).
- **Neutral greys, emerald brand.** Every neutral is pure achromatic (`chroma 0`); the
  only colour in the palette is the emerald ramp around hue 163–167.
- Primary: `oklch(0.508 0.118 165.612)` — emerald. This is the brand colour: primary
  buttons, active states, emphasis.
- Background: white; foreground: `oklch(0.145 0 0)`; card: white.
- Muted / accent: `oklch(0.97 0 0)` — a near-white grey. **`--accent` is a hover
  surface, not a brand colour.** Reach for `primary` when something should read as
  branded, never `accent`.
- Border and input: `oklch(0.922 0 0)`; ring: `oklch(0.708 0 0)` — both neutral.
- Chart ramp `--chart-1..5`: five emerald shades, light to dark. Use these for any
  proportional bar, series or waterfall rather than inventing tints.
- Semantic statuses: `--success` green, `--warning` amber, `--danger` red.
- Radius: `0.625rem`.
- Surface: calm, compact-professional, rounded cards, restrained shadows, no gradients.
- Layout: desktop-first dense operator shell; responsive mobile support.
- Motion: short directional transitions, dynamic height, respect reduced motion.

## Raw token source

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@custom-variant dark (&:is(.dark *));
:root {
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0); --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.508 0.118 165.612); --primary-foreground: oklch(0.979 0.021 166.113);
  --secondary: oklch(0.967 0.001 286.375); --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0); --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325); --destructive-foreground: oklch(0.985 0.006 250);
  --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
  --surface: oklch(1 0 0); --surface-subtle: oklch(0.975 0.008 250);
  --success: oklch(0.58 0.13 155); --warning: oklch(0.72 0.14 80); --danger: oklch(0.59 0.18 25);
  --sidebar: oklch(0.985 0 0); --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.596 0.145 163.225); --sidebar-primary-foreground: oklch(0.979 0.021 166.113);
  --sidebar-accent: oklch(0.97 0 0); --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0); --sidebar-ring: oklch(0.708 0 0);
  --chart-1: oklch(0.845 0.143 164.978); --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.596 0.145 163.225); --chart-4: oklch(0.508 0.118 165.612);
  --chart-5: oklch(0.432 0.095 166.913);
  --radius: 0.625rem;
}
.dark {
  --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0); --primary: oklch(0.432 0.095 166.913);
  --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0); --border: oklch(1 0 0 / 10%); --ring: oklch(0.556 0 0);
  --sidebar: oklch(0.205 0 0); --sidebar-primary: oklch(0.696 0.17 162.48);
  /* chart ramp is shared with :root */
}
```

## Rule for generated designs

Never hard-code a hex or oklch literal. Use the semantic Tailwind classes bound to
these variables — `bg-primary`, `text-primary`, `bg-muted`, `text-muted-foreground`,
`border-border`, `bg-chart-1`…`bg-chart-5`, `text-success`, `text-warning`,
`text-destructive` — so a token change reaches every surface at once.
