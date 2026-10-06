# RIO artwork-led landing direction

Status: new visual proposals, following the user's rejection of the prior desktop.png on 2026-09-12. The user explicitly requested separately generated platform images. The previous code-only visual restrictions and dense page mockup are not the direction to implement.

## Art direction

Original dimensional product imagery with charcoal, smoked glass, satin silver, controlled white illumination and a very small mint accent. Images provide visual atmosphere and explain relationships; webpage typography and controls remain separate and accessible.

Reference: [Linear](https://linear.app/) for product-oriented visual storytelling and restraint. No Linear brand assets are used in generated images. Direct retrieval of individual CDN images failed during this pass; the study also draws on the earlier browser inspection recorded in the research document.

## Proposed assets

- [desktop.png](desktop.png): full-page desktop composition combining the three artwork references, generated for user review on 2026-09-12. The exact composition prompt is [desktop.prompt.txt](desktop.prompt.txt). This replaces the prior visual proposal for review, not the production page. The user has requested this preview; implementation approval is still separate.

- [hero-platform.png](hero-platform.png): 1672 × 941, approximately 16:9; place below a concise hero introduction with generous space. Keep the image free of website headings and controls.
- [business-context.png](business-context.png): 1448 × 1086, 4:3 layered-data sculpture for the business-context section.
- [decision-detail.png](decision-detail.png): 1448 × 1086, 4:3 close product detail connecting evidence to a recommendation awaiting human review.
- Each image has its own `.prompt.txt` recording the built-in image generation prompt.

These are art-direction candidates, not approved final art. Retain the prior desktop.png only as rejected history. Do not upscale its low-resolution design into a new deliverable.

Generated with the built-in image-generation tool and visually inspected on 2026-09-12. All three PNG signatures and dimensions were checked. The requested larger dimensions in the prompts were not returned; the sizes above are the actual originals. Preserve the full frame initially. Decision-detail text is illustrative; repeat its meaning in accessible live section copy rather than relying on raster text.

## Integration boundary for the eventual handoff

- Live HTML owns headings, body copy, navigation, interactive demonstrations and Book a walkthrough. The email/phone/industry dialog and Resend customer-service flow remain requirements.
- Raster assets own the complex visual scenes. Never bake functional buttons, the lead form, or important financial data into a picture.
- Before implementation, revise the page composition around the chosen imagery and obtain review of the new visual direction. Do not use the old execution prompt as approval to implement its rejected design.
- Treat any depicted interface as an illustration, not a screenshot of a shipped feature or a customer result.
- Preserve original generated PNGs. Only after visual selection should implementation produce responsive WebP/AVIF derivatives, set intrinsic dimensions and crop focal points, and measure loading cost. No live provider/tenant data belongs in these assets.
- Optional motion should come from subtle transforms or separately approved animation assets. The PNGs themselves are still images and do not establish interaction acceptance.

No application implementation, database change, customer email or environment configuration is part of this artwork pass.
