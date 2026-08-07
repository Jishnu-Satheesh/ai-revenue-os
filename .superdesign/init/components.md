# Shared UI Components

Framework: Next.js App Router, React 19, Tailwind CSS v4, shadcn/ui New York style, Radix primitives, Lucide icons.

The full source of every installed primitive remains in `src/components/ui/`. The primitives most relevant to onboarding are reproduced below so design generation uses the exact APIs and tokens.

## Button

Source: `src/components/ui/button.tsx`

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: { default: "bg-primary text-primary-foreground hover:bg-primary/90", destructive: "bg-destructive text-white hover:bg-destructive/90", outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground", secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80", ghost: "hover:bg-accent hover:text-accent-foreground", link: "text-primary underline-offset-4 hover:underline" },
    size: { default: "h-9 px-4 py-2 has-[>svg]:px-3", sm: "h-8 gap-1.5 rounded-md px-3", lg: "h-10 rounded-md px-6", icon: "size-9" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

function Button({ className, variant = "default", size = "default", asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
```

## Card

Source: `src/components/ui/card.tsx`

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
function Card({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card" className={cn("flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm", className)} {...props} />; }
function CardHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-header" className={cn("@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6", className)} {...props} />; }
function CardTitle({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-title" className={cn("leading-none font-semibold", className)} {...props} />; }
function CardDescription({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />; }
function CardContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-content" className={cn("px-6", className)} {...props} />; }
function CardFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-footer" className={cn("flex items-center px-6", className)} {...props} />; }
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
```

## Form primitives

Sources: `src/components/ui/input.tsx`, `textarea.tsx`, `select.tsx`, `checkbox.tsx`, `field.tsx`, `progress.tsx`, `alert.tsx`, `badge.tsx`, `empty.tsx`, and `alert-dialog.tsx`.

Public exports used by onboarding are `Input`, `Textarea`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `Checkbox`, `Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `Progress`, `Alert`, `AlertTitle`, `AlertDescription`, `Badge`, `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, and `AlertDialogAction`.

Use `FieldGroup` + `Field`, semantic tokens, `data-invalid`/`aria-invalid`, and `data-icon="inline-start|inline-end"` for button icons. Do not introduce bare controls in feature components.
