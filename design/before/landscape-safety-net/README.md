# Landscape safety-net captures — NOT the real kiosk

These 12 images were captured at **1920×1200 landscape** before the kiosk's
orientation was confirmed. **They do not show what the kiosk displays.**

`screens.css:1510` carries an `@media (orientation: landscape)` block described
in its own comment as a *"landscape safety net… so a bench test on a laptop
shouldn't render an unusable page."* Capturing landscape renders that fallback.
It looks completely plausible, which is exactly what makes it dangerous.

The real kiosk is **1080×1920 portrait** — `theme.css:14`: *"PORTRAIT. This is
a vertical screen (1080x1920)."* The canonical BEFORE images live one level up
in `design/before/kiosk-*.png`.

Kept only as evidence that the landscape fallback path renders, and as a
worked example of a convincing-but-wrong capture.
