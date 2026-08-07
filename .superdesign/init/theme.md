# Revenue Intelligence System theme

## Compact token summary

- Framework: Tailwind CSS v4 with `@theme inline`; shadcn/ui New York, Radix base.
- Font: Arial, Helvetica, sans-serif (current implementation).
- Background: `oklch(0.985 0.006 250)`; foreground: `oklch(0.21 0.025 255)`.
- Card: white; muted: `oklch(0.94 0.012 250)`; border/input: `oklch(0.89 0.018 250)`.
- Primary: dark foreground; accent/ring: `oklch(0.53 0.16 250)`.
- Semantic statuses: success green, warning amber, danger red.
- Surface: calm, compact-professional, rounded cards, restrained shadows, no gradients.
- Layout: desktop-first dense operator shell; responsive mobile support.
- Motion: short directional transitions, dynamic height, respect reduced motion.

## Raw token source

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
:root {
  --background: oklch(0.985 0.006 250); --foreground: oklch(0.21 0.025 255);
  --card: oklch(1 0 0); --card-foreground: oklch(0.21 0.025 255);
  --popover: oklch(1 0 0); --popover-foreground: oklch(0.21 0.025 255);
  --primary: oklch(0.21 0.025 255); --primary-foreground: oklch(0.985 0.006 250);
  --secondary: oklch(0.94 0.012 250); --secondary-foreground: oklch(0.28 0.025 255);
  --muted: oklch(0.94 0.012 250); --muted-foreground: oklch(0.51 0.03 255);
  --destructive: oklch(0.59 0.18 25); --input: oklch(0.89 0.018 250); --ring: oklch(0.53 0.16 250);
  --border: oklch(0.89 0.018 250); --accent: oklch(0.53 0.16 250); --accent-foreground: oklch(0.21 0.025 255);
  --success: oklch(0.58 0.13 155); --warning: oklch(0.72 0.14 80); --danger: oklch(0.59 0.18 25);
  --sidebar: hsl(0 0% 98%); --sidebar-foreground: hsl(240 5.3% 26.1%); --sidebar-accent: hsl(240 4.8% 95.9%); --sidebar-border: hsl(220 13% 91%);
}
```
