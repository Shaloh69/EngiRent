import 'package:flutter/material.dart';

import '../theme/design_tokens.g.dart';

/// The app's colour names, kept as a stable façade over the generated tokens.
///
/// E3.1: the hex values are no longer written here. They come from
/// `design/tokens/tokens.json` via `design/tokens/build.mjs`, which also
/// generates the admin console's Mantine tuples, the kiosk's CSS variables and
/// the website's — so the four surfaces cannot drift apart by hand any more.
///
/// This class stays because roughly a hundred call sites say `AppColors.x`, and
/// rewriting them all would be a large, risky diff that changes no pixel. New
/// code should prefer [DesignTokens] (via `DesignTokens.of(Theme.of(context)
/// .brightness)`), because that resolves per theme; the constants here are the
/// LIGHT resolution and cannot know which theme is active.
///
/// WHAT WAS REMOVED, and why it is not coming back: `grey` (#9CA3AF),
/// `greyLight` (#F3F4F6), `greyDark` (#4B5563), `borderDark` (#D1D5DB) and
/// `surfaceDark` (#1F2937). All five are the generic Tailwind-slate family the
/// design mandate bans outright, and four of the five had **zero** call sites —
/// they existed only as a bad example to copy. The fifth, `grey`, had four, all
/// of them the fallback arm of a status switch; those now resolve through the
/// shared status table instead.
class AppColors {
  AppColors._();

  // ── Brand ────────────────────────────────────────────────────────────────
  static const Color primary = DesignPalette.teal500;
  static const Color primaryDark = DesignPalette.teal700;
  static const Color primaryLight = DesignPalette.tealOnDark;

  /// The mandate's "key" accent (gold) — a distinct role from [success], so a
  /// gold element and a green "available" badge can't be confused.
  static const Color secondary = DesignPalette.gold500;
  static const Color secondaryDark = DesignPalette.gold700;
  static const Color secondaryLight = DesignPalette.goldOnDark;

  /// Coral "CTA energy" tertiary — used app-wide for Rent Now / Confirm.
  static const Color accent = DesignPalette.coral500;
  static const Color accentDark = DesignPalette.coral700;
  static const Color accentLight = DesignPalette.coralOnDark;

  // ── Status ───────────────────────────────────────────────────────────────
  // These are FILL hues. On a light surface they are not legible as text —
  // success is 2.28:1 on white — so use `statusInk()` for text and icons.
  static const Color success = DesignPalette.emerald500;
  static const Color successDark = DesignPalette.emerald700;
  static const Color successLight = DesignPalette.emerald400;
  static const Color warning = DesignPalette.warn500;
  static const Color error = DesignPalette.danger500;

  /// Was `info`. Now the cross-surface `review` role: the cyan-teal that the
  /// whole pending / under-review family resolves to. Kept under the old name
  /// as well so existing call sites compile.
  static const Color review = DesignPalette.review500;
  static const Color info = review;

  // ── Neutrals ─────────────────────────────────────────────────────────────
  static const Color white = DesignPalette.ink0;
  static const Color black = Color(0xFF000000);

  static const Color background = DesignPalette.inkLightBg;
  static const Color surface = DesignPalette.ink0;
  static const Color surfaceAlt = DesignPalette.inkSurfaceAlt;

  static const Color textPrimary = DesignPalette.inkText1;
  static const Color textSecondary = DesignPalette.inkText2;

  /// Teal-tinted, replacing the banned #9CA3AF. Disabled text is exempt from
  /// the WCAG contrast floor (1.4.3, "incidental"), which is why this sits at
  /// 2.49:1 deliberately rather than by neglect.
  static const Color textDisabled = Color(0xFF8CA2BC);

  /// The decorative hairline. For anything that is the visible *boundary of a
  /// control* — a text field's outline, an unchecked box — use [borderStrong],
  /// which clears the 3:1 that WCAG 1.4.11 requires and this one does not.
  static const Color border = DesignPalette.inkBorder;
  static const Color borderStrong = DesignPalette.inkBorderStrong;

  // ── Gradients ────────────────────────────────────────────────────────────
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [DesignPalette.teal700, DesignPalette.teal500],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient accentGradient = LinearGradient(
    colors: [DesignPalette.coral500, DesignPalette.coral700],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // ── Dark scheme ("Vault") ────────────────────────────────────────────────
  // Dark is a first-class theme, not light with inverted greys: its surfaces,
  // borders and muted values are its own, tinted toward the brand so dark mode
  // doesn't read as a generic slate library default.
  static const Color backgroundDarkMode = DesignPalette.inkDarkBg;
  static const Color surfaceDarkMode = DesignPalette.inkDarkSurface;
  static const Color surfaceAltDarkMode = DesignPalette.inkDarkSurfaceAlt;
  static const Color borderDarkMode = DesignPalette.inkDarkBorder;
  static const Color borderStrongDarkMode = DesignPalette.inkDarkBorderStrong;
  static const Color textPrimaryDark = DesignPalette.inkDarkText1;
  static const Color textSecondaryDark = DesignPalette.inkDarkText2;
  static const Color textDisabledDark = Color(0xFF5B7A96);

  /// Brand hues lifted for dark grounds — the light-mode brand sits under the
  /// 4.5:1 body-text floor on #050F1A, so anything carrying meaning uses these.
  static const Color primaryOnDark = DesignPalette.tealOnDark;
  static const Color secondaryOnDark = DesignPalette.goldOnDark;
  static const Color accentOnDark = DesignPalette.coralOnDark;
}
