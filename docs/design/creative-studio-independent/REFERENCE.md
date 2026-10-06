# Proposed visual reference — Independent Creative Studio

Status: **APPROVED VISUAL REFERENCE.** Prepared September 20–24, 2026 and explicitly approved by the user on September 24, 2026 as the replacement for the unavailable wireframe. The source and screenshot hashes below are frozen for implementation comparison. This visual approval does not, by itself, approve the separate Tier 3 specification or execution plan.

## Open the prototype

[Hosted interactive preview](https://p.superdesign.dev/draft/21d0f45c-6ad2-4d78-a831-03df6684d43a) · [Superdesign canvas](https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/1acb3016-c8be-4e30-a461-3e06e9782041?node=draft-variant-21d0f45c-6ad2-4d78-a831-03df6684d43a)

Local source: `.superdesign/creative-studio-independent/prototype.html`. See README for the local server command. The hosted import has the same author source; service packaging may add runtime scaffolding. Neither is production.

## Canonical geometry

Chrome DevTools MCP screenshot; viewport 1728 × 1080, device scale 1, browser zoom 100%, light theme, Manrope. The 26px sample-content banner is prototype chrome and should not appear in production; for exact comparison use the equivalent review harness banner/spacer or subtract its height from downstream Y anchors explicitly. Do not hide the distinction during comparison.

| Anchor | X | Y | Width | Notes |
| --- | ---: | ---: | ---: | --- |
| Global navigation | 0 | 0 | 256 | Existing shell style, inner8px inset |
| Top header | 256 | 0 | 1472 | Height64 |
| Settings panel | 288 | 201 | 276.8 | 20% of usable pane widths |
| Workspace | 588.8 | 201 | 1107.2 | 80%; 24px inter-pane gap |
| Product upload | 307 | 927 | 238.8 | Bottom976; visible before Generate |
| Generate | 307 | 1004 | 238.8 | Height39; pinned inside settings |

Outer page gutters32px. Left labels share their baseline/left edge. Canonical vertical field gap15px, upload target49px, prompt112px (~five lines), copy77px. Smaller desktops keep scrolling settings and a256px minimum rail. The 20/80 split excludes global navigation, gutters and gap; at1440px the rail clamps instead of becoming unreadably narrow.

## States and limitations

State hooks are `?state=history`, `canvas`, `picker`, `loading`, `streaming`, `markers`, `empty`, `error`. These are visual fixtures. Generation, campaigns, uploads and history are mock session state. Progressive mock visuals do not establish real independently decoded provider frames. The final production verifier must generate and edit through the actual app/provider.

Original embedded sample artwork and organization are fictional. All production strings, assets and controls follow the specification, not the demo artwork generator. The spec additionally requires durable history, permissions, full marker lists/revisions, placement qualification and export acceptance where the prototype only illustrates the interaction.

## Freeze and compare during implementation

The approval date and exact source/screenshot SHA-256 values are recorded in `reference-manifest.json`; preserve these approved bytes unchanged. New implementation captures belong under `docs/verification/creative-studio-independent/`. Compare matching state/viewport/font/scale; box tolerance2px; inspect every mismatch. Anti-aliasing differences may be explained, missing controls and altered spacing may not. Do not overwrite a failed reference to make the implementation pass.

The hashes below identify the approved visual package. They do not establish provider, persistence, authorization or end-to-end implementation acceptance.

| Artifact | SHA-256 |
| --- | --- |
| Prototype HTML | `9bdef5dc39342f1f1425149233766003e0ae05bb9535963288b00ad60fb41672` |
| Desktop.png | `06b25bc32d616cc4513d6f0367a862900f90d37574ce82c15519e94f0cd2fec3` |
| Canvas.png | `6ba78ad3251ee9026ed64cebbb6f0192a433ffbfc172fe8875635a4b769068cc` |
| Reference-picker.png | `a5355eb61ba0a634d97ff4e1b34591c9ee64869d4189a2ab4a027728fb738f9f` |
| Loading.png | `ecbeb3aad820be506dac54d77cb692676aeae7a5566b71bd52e35e3994772da0` |
| Streaming.png | `a460dee44786aa26fc147c4d986f79776e5cab180243f19f12e77fa3ad20e96c` |
| Markers.png | `c47a9360231a7ab674a64742c14ce9e92a255f2a09f3b772b9ef60195095f82d` |
| Empty.png | `8604616d96ec25f5b01d8b90bb58d261f90829aa1d6b0059aa83e806dca7a9aa` |
| Error.png | `69f553d4e9b03c52fa355eaaaa34f46c6128374a2c40265ee50e1aa1b47beb30` |
| Desktop-1440.png | `1d37293dc0686e7803f6c8d7f42a8af2fdb5ac15fa207de589b02f39f7dd3765` |
| Mobile-history.png | `e5b6c68390e59e77645f93a41df342e81514e5a50b85ffb08518816393d9c34a` |
| Mobile-settings.png | `758c5d992335abc938ad66b3d19e660c1b6c3b0a7d3fa7aef817a83397d18d81` |
