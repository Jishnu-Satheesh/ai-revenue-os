# Vendored fonts

These three files are inputs to every rendered poster, not ambient facts about whichever machine
happens to run the worker. A container's font configuration is not something anybody approved, and a
font that silently updates changes what a client publishes — so the bytes live here, pinned by
SHA-256 in `src/domain/campaigns/font-manifest.ts`, and the manifest digest forms part of the render
digest.

Do not replace a file without updating the manifest. `font-manifest.test.ts` fails if the bytes and
the manifest disagree, which is the intended outcome.

| File | Family | Script | Version |
|---|---|---|---|
| `NotoSans-Regular.ttf` | Noto Sans | Latn | 2.004 |
| `NotoSansMalayalam-Regular.ttf` | Noto Sans Malayalam | Mlym | 2.001 |
| `NotoSansArabic-Regular.ttf` | Noto Sans Arabic | Arab | 2.005 |

**Provenance.** Copied from the Debian `fonts-noto-core` package, version `20201225-2`, on
2026-08-24. Licensed under the SIL Open Font License 1.1 — see `LICENSE-OFL-1.1.txt`, which is the
package's own copyright file and must travel with the fonts.

These exact files were proved to shape correctly before being adopted; the evidence is in
`docs/verification/campaigns/renderer-spike-2026-08-24/`.
