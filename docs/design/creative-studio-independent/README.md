# Independent Creative Studio — review package

**Proposed design, not production implementation.** Campaign selection is optional, the model renders the complete poster including Text Copy, and real progressive image previews are mandatory.

- [Desktop.png](Desktop.png) — canonical 1728 × 1080 proposed layout.
- [Interactive prototype](../../../.superdesign/creative-studio-independent/prototype.html) — sample data and simulated generation.
- [Design specification](../../superpowers/specs/2026-09-20-independent-creative-studio-design.md).
- [Technical contract](technical-contract.md) — data, APIs, streaming, context, campaign linkage and library filing.
- [Implementation plan](../../superpowers/plans/2026-09-20-independent-creative-studio.md).
- [Start-here handoff](HANDOFF.md) — successor instructions, reviewer/fixer loops and real-browser acceptance.
- [Visual reference manifest](REFERENCE.md), [independent document review](design-review.md) and [browser review](browser-review.md).
- [Current implementation audit](current-studio-audit.md) and [provider/asset research](provider-and-assets-audit.md).

To run locally from the repository root: `rtk proxy python3 -m http.server 4317 --bind 127.0.0.1 --directory .superdesign/creative-studio-independent`, then open http://127.0.0.1:4317/prototype.html.

The original wireframe attachment was not available. This package follows the written requirements; comparison to the sketch remains open unless the user explicitly accepts this design as the replacement reference. Provider qualification and actual poster-generation acceptance belong to the subsequent approved implementation.
