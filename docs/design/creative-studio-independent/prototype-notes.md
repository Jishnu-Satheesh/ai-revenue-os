# Independent Creative Studio prototype notes

Status: proposed design only. The requested wireframe attachment was not available; this is derived from the written brief and the current repository shell. It is not an approved visual baseline or app implementation.

## Artifact and layout

- Artifact: `.superdesign/creative-studio-independent/prototype.html`.
- Canonical desktop: 1728 × 1080. Global sidebar occupies 256 px. Main horizontal padding is 32 px on either side; inter-panel gap is 24 px. Remaining panel width is 1384 px: settings 276.8 px (20%), creative workspace 1107.2 px (80%). Settings have a 256 px minimum at narrower desktop widths.
- Sidebar Campaigns children: Overview, Creative Studio, Asset Library, Research settings. Studio opens independently, with No campaign selected and history instead of a poster canvas.
- Current repository shell references: `src/components/layout/app-shell.tsx`, `sidebar.tsx`, `src/app/globals.css`, `.superdesign/design-system.md`, and `docs/verification/campaigns/2026-09-14-studio-1440.png`. The page deliberately permits the specified wider canonical workspace rather than copying the shell's 1440 px content maximum.
- Manrope typography, neutral surfaces, restrained borders and emerald primary actions. Tailwind CDN is included with preflight disabled so its late reset does not override the artifact's explicit typography. Iconify supplies Lucide-style icons. All artwork is an original embedded SVG data URL, with no private staging images.
- At desktop widths at least 1600 px and heights at least 1000 px, settings use 15 px field gaps, 49 px picker targets and fewer redundant helper lines so all controls fit together. Prompt retains about five readable lines.
- Settings preserve the requested order. The fields scroll independently and Generate stays pinned. On mobile the settings and workspace become tabs; the global sidebar opens from its header control.
- Stable DOM anchors: `settings`, `workspace`, `history-list`, `prompt`, `copy`, `reference-button`, `product-button`, `generate`, `poster-wrap`, `poster-image`, `canvas-status`, `modal-root`.

## Screenshot hooks

Use `?state=history`, `canvas`, `streaming`, `loading`, `error`, `empty`, `picker`, or `markers`. The loading and streaming hooks hold their state for captures. Default is history.

## Working interactions

- Search prompt/title; filter campaign including unassigned, review status, format and date. All fixtures use the fixed sample date 20 September 2026; Today means that sample date.
- Open and download saved sample images, create a fresh brief, select a campaign optionally, and choose aspect presets. Custom is intentionally visible but unavailable until export validation is defined, matching the design specification.
- Reference picker opens beside the settings on desktop, with approved-design thumbnails and a large preview. Products & Subjects uses the same interaction with a distinct sample pool. Local PNG/JPEG/WebP files can be selected and previewed before explicit use; uploads are labelled current-use and do not acquire library approval.
- Exact design requires a reference. Take Inspiration is the default. Prompt Enhance and New Idea open an original/suggestion comparison with Apply or Keep original; Text copy remains unchanged.
- Channel logos has an explicit selection affordance. This sample contains no approved channel-logo assets, so it explains their absence rather than inventing a provider logo or connection.
- Generate demonstrates loader stages, then the first displayable simulated preview in the right canvas, then a saved result. No fake percentage is shown. Preview actions are disabled. The finished mock is a single image, including the supplied Text copy, with a reminder to inspect spelling and product details.
- Clicking the poster records a normalized edit marker. Keyboard Enter/Space or Add edit marker places a centre marker. Instructions are required; Apply edits produces a visibly altered sample composition and a before/after toggle. The UI warns that surrounding details may change.
- Link campaign and Create campaign draft are session-only demonstrations. They do not approve or publish. Existing approved sample history records are labelled as fixtures; newly generated work remains Unreviewed.
- Dialogs support Escape, initial focus, basic focus trapping and focus return. Filters and inputs use native accessible controls. Mobile navigation and tabs work without app routes.

## Deliberate prototype limitations

- Studio & Supply, Alex Morgan, products, campaigns, prompts and creatives are fictional sample content. The slim global strip identifies sample content and simulated generation.
- No network generation, provider streaming, database, authentication, durable upload, cost, authorization or publish operation occurs. Timed blurred SVG states illustrate a proposed progressive experience only; they do not demonstrate independently decodable provider frames or satisfy production streaming acceptance.
- The SVG illustration is a visual stand-in for a future complete raster poster. There is no editable text-layer/compositor proposal. Download exports the labelled sample SVG, not a model-produced production file. Arbitrary long copy, dimensions and subject references are not rendered faithfully by this mock artwork.
- Alternate aspect controls demonstrate input selection, not qualified native generation or verified export conversion. Custom remains disabled. Sample history thumbnails use the same illustration geometry across aspect fixtures.
- History changes live only in JavaScript memory and disappear on reload. Revision comparison is transient; full immutable branching, per-marker instruction lists/position adjustment, provider continuation, revision restore and durable exact-byte campaign linking are implementation requirements, not claimed prototype capabilities.
- Browser screenshot and interaction evidence is captured separately by the controller. A JavaScript syntax check alone is not visual acceptance.
