import { Badge } from "@/components/ui/badge";
import type { CreativeDirectionKind } from "@/domain/campaigns/schemas";

/**
 * A channel-accurate preview of the proposed post.
 *
 * The design contract asks the campaign artwork to carry the visual energy
 * while the application chrome stays restrained, so this renders the post the
 * way an operator will actually see it: the channel frame, the creative, the
 * caption, the hashtags.
 *
 * The artwork is a deliberate abstract composition rather than a photograph.
 * A photograph here would imply a generated asset exists and would quietly
 * assert something about a real place, product, or person. Each direction gets
 * a visibly different composition so switching between them changes the page
 * rather than only the words on it.
 */
function ControlArt() {
  return (
    <g>
      {/* Structured and symmetrical: the established layout the other
          directions are measured against. */}
      <rect x="0" y="0" width="400" height="500" className="fill-muted" />
      <circle cx="200" cy="230" r="118" className="fill-background" opacity="0.9" />
      <circle cx="200" cy="230" r="86" className="fill-muted-foreground" opacity="0.16" />
      <circle cx="200" cy="230" r="52" className="fill-primary" opacity="0.22" />
      <rect
        x="92"
        y="392"
        width="216"
        height="10"
        rx="5"
        className="fill-muted-foreground"
        opacity="0.32"
      />
      <rect
        x="132"
        y="416"
        width="136"
        height="8"
        rx="4"
        className="fill-muted-foreground"
        opacity="0.2"
      />
      <rect x="0" y="470" width="400" height="30" className="fill-primary" opacity="0.14" />
    </g>
  );
}

function EvidenceLedArt() {
  return (
    <g>
      {/* A time motif: this direction leads with the exact window, because the
          constraint the evidence points at is timing rather than price. */}
      <rect x="0" y="0" width="400" height="500" className="fill-muted" />
      <circle cx="200" cy="215" r="128" className="fill-background" opacity="0.92" />
      <path d="M200 87 A128 128 0 0 1 328 215 L200 215 Z" className="fill-primary" opacity="0.28" />
      <circle
        cx="200"
        cy="215"
        r="128"
        className="fill-none stroke-primary"
        strokeWidth="3"
        opacity="0.5"
      />
      <rect
        x="196"
        y="128"
        width="8"
        height="92"
        rx="4"
        className="fill-foreground"
        opacity="0.55"
      />
      <rect
        x="196"
        y="211"
        width="72"
        height="8"
        rx="4"
        className="fill-foreground"
        opacity="0.55"
      />
      <circle cx="200" cy="215" r="10" className="fill-foreground" opacity="0.7" />
      <rect
        x="64"
        y="396"
        width="272"
        height="12"
        rx="6"
        className="fill-foreground"
        opacity="0.28"
      />
      <rect
        x="112"
        y="424"
        width="176"
        height="9"
        rx="4.5"
        className="fill-muted-foreground"
        opacity="0.24"
      />
    </g>
  );
}

function ExperimentalArt() {
  return (
    <g>
      {/* Deliberately unlike the control: a bold diagonal and an hourglass
          metaphor, testing whether graphic treatment outperforms food imagery. */}
      <rect x="0" y="0" width="400" height="500" className="fill-foreground" opacity="0.9" />
      <path d="M0 0 L400 0 L400 190 L0 330 Z" className="fill-primary" opacity="0.35" />
      <path
        d="M120 118 L280 118 L212 250 L280 382 L120 382 L188 250 Z"
        className="fill-background"
        opacity="0.92"
      />
      <path d="M150 148 L250 148 L200 244 Z" className="fill-primary" opacity="0.55" />
      <path d="M200 262 L250 352 L150 352 Z" className="fill-primary" opacity="0.28" />
      <rect
        x="96"
        y="414"
        width="208"
        height="12"
        rx="6"
        className="fill-background"
        opacity="0.6"
      />
      <rect
        x="140"
        y="440"
        width="120"
        height="9"
        rx="4.5"
        className="fill-background"
        opacity="0.35"
      />
    </g>
  );
}

const ART: Readonly<Record<CreativeDirectionKind, () => React.JSX.Element>> = {
  control: ControlArt,
  evidence_led: EvidenceLedArt,
  experimental: ExperimentalArt,
};

export function CreativePreview({
  kind,
  organizationName,
  placementLabel,
  caption,
  hashtags,
  callToAction,
  imageAlt,
  syntheticContent,
  previewUrl = null,
}: Readonly<{
  kind: CreativeDirectionKind;
  organizationName: string;
  placementLabel: string;
  caption: string;
  hashtags: readonly string[];
  callToAction: string;
  imageAlt: string;
  syntheticContent: boolean;
  /** Signed link to the real artwork. Null before one exists, or if signing failed. */
  previewUrl?: string | null;
}>) {
  const Art = ART[kind];
  const initials = organizationName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <figure className="w-full max-w-sm overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {initials}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{organizationName}</span>
          <span className="text-xs text-muted-foreground">{placementLabel}</span>
        </span>
      </div>

      <div className="relative">
        {previewUrl ? (
          // The generated artwork itself. The alt text is the description the
          // image was drawn from, so the picture and its description cannot
          // drift apart.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={imageAlt}
            className="block aspect-4/5 w-full bg-muted object-cover"
          />
        ) : (
          <svg
            viewBox="0 0 400 500"
            className="block aspect-4/5 w-full"
            role="img"
            aria-label={imageAlt}
          >
            <Art />
          </svg>
        )}
        {syntheticContent ? (
          <Badge variant="secondary" className="absolute top-2 right-2">
            Synthetic
          </Badge>
        ) : null}
        {previewUrl ? null : (
          // Said out loud rather than left as a stylised drawing an operator
          // might mistake for the proposed image and attest to.
          <Badge variant="outline" className="absolute bottom-2 left-2 bg-card">
            Artwork unavailable
          </Badge>
        )}
      </div>

      <figcaption className="flex flex-col gap-2 px-3 py-3">
        <p className="text-sm leading-relaxed">{caption}</p>
        <p className="text-sm text-primary">{hashtags.join(" ")}</p>
        <span className="mt-1 inline-flex w-fit rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
          {callToAction}
        </span>
      </figcaption>
    </figure>
  );
}
