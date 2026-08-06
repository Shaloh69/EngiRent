import 'package:flutter/material.dart';

class AppColors {
  // Primary/brand — "EngiRent Spectrum" violet (design mandate
  // docs/planning/02-design-mandate.md §1), same hex as client/admin's
  // Mantine theme and the Kiosk's theme.css. Was a deep-navy scheme before
  // this migration.
  static const Color primary = Color(0xFF7C3AED);
  static const Color primaryDark = Color(0xFF5B21B6);
  static const Color primaryLight = Color(0xFF935CF0);

  // Secondary: kept as green — used throughout this app specifically for
  // availability/success semantics (badges, status text), not as a general
  // brand accent, and its hex already coincidentally matches the mandate's
  // own "Success / available" emerald (#10B981) exactly. The mandate's
  // *literal* secondary role (amber #F5A623, a "key" accent) isn't
  // introduced as a separate constant here since nothing in this app uses
  // a slot for it yet — see AppColors.warning for the closest existing use.
  static const Color secondary = Color(0xFF10B981);
  static const Color secondaryDark = Color(0xFF059669);
  static const Color secondaryLight = Color(0xFF34D399);

  // Accent / CTA — mandate's coral "CTA energy" tertiary, replacing the
  // prior warm-orange scheme (accent is already used app-wide for
  // "Rent Now"/"Confirm"-style buttons, which maps directly onto this role).
  static const Color accent = Color(0xFFFB7185);
  static const Color accentDark = Color(0xFFE35F72);
  static const Color accentLight = Color(0xFFFC8797);

  // Status Colors
  static const Color success = Color(0xFF10B981);
  static const Color warning = Color(0xFFF59E0B);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF3B82F6);

  // Neutral Colors
  static const Color white = Color(0xFFFFFFFF);
  static const Color black = Color(0xFF000000);
  static const Color grey = Color(0xFF9CA3AF);
  static const Color greyLight = Color(0xFFF3F4F6);
  static const Color greyDark = Color(0xFF4B5563);

  // Background Colors — "Campus Day" mode (warm off-white, not stark white
  // or cool grey), same base tone as client/admin's Mantine theme.
  static const Color background = Color(0xFFFDFBF7);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceDark = Color(0xFF1F2937);

  // Text Colors
  static const Color textPrimary = Color(0xFF1A1625);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color textDisabled = Color(0xFF9CA3AF);

  // Border Colors
  static const Color border = Color(0xFFE4D6FC);
  static const Color borderDark = Color(0xFFD1D5DB);

  // Violet gradient — used for hero banners and AppBars
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [Color(0xFF5B21B6), Color(0xFF7C3AED)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Coral CTA gradient — used for "Rent Now" / "Confirm" buttons
  static const LinearGradient accentGradient = LinearGradient(
    colors: [Color(0xFFFB7185), Color(0xFFE35F72)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
