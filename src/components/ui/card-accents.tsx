import { Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The secondary label beside the card type — recommendation scope and proposal
 * state alike. White chip, primary-green semibold words, tight padding, fully
 * rounded. One constant so the two cards cannot drift apart.
 */
export const CARD_CHIP_CLASSNAME =
  "inline-flex items-center rounded-full bg-white px-2 py-0.5 font-semibold text-primary";

/**
 * The footnote treatment shared by the recommendation limitation and the
 * proposal state sentence: Info icon plus muted relaxed small text.
 */
export function CardFootnote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The expanded full-text box shared by both cards. Fixed height regardless of
 * content; short copy centers in the leftover space while long copy scrolls
 * with its scrollbar hidden.
 */
export function CardQuote({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <figure
      data-testid={testId}
      className="flex h-28 flex-col justify-center overflow-hidden rounded-lg bg-white px-5 py-3 text-center"
    >
      <span aria-hidden="true" className="text-lg leading-none text-muted-foreground">
        {"\u201C"}
      </span>
      <blockquote className="min-h-0 flex-1 overflow-y-auto text-sm italic leading-relaxed text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="flex min-h-full flex-col items-center justify-center text-center">
          {children}
        </span>
      </blockquote>
    </figure>
  );
}
