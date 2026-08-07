import 'package:flutter/material.dart';

class AppColors {
  // Primary/brand — "EngiRent Vault" deep teal (design mandate
  // docs/planning/02-design-mandate.md §1), same hex as client/admin's
  // Mantine theme and the Kiosk's theme.css. Replaces the prior violet,
  // which shipped reading as a generic SaaS blue/violet.
  static const Color primary = Color(0xFF0D9488);
  static const Color primaryDark = Color(0xFF0A7169);
  static const Color primaryLight = Color(0xFF3EC3B3);

  // Secondary — the mandate's literal "key" accent (gold). Previously this
  // slot held green, which duplicated `success` exactly; the two roles are
  // now distinct, so a gold element and a green "available" badge can't be
  // confused for each other.
  static const Color secondary = Color(0xFFF5A623);
  static const Color secondaryDark = Color(0xFFC78314);
  static const Color secondaryLight = Color(0xFFF6BA4D);

  // Accent / CTA — mandate's coral "CTA energy" tertiary, replacing the
  // prior warm-orange scheme (accent is already used app-wide for
  // "Rent Now"/"Confirm"-style buttons, which maps directly onto this role).
  static const Color accent = Color(0xFFFB7185);
  static const Color accentDark = Color(0xFFE35F72);
  static const Color accentLight = Color(0xFFFC8797);

  // Status Colors. `success` is a distinct shade from the teal brand
  // primary (mandate §1) so "available/success" never reads as just another
  // brand-colored element. Dark/light variants exist because availability
  // badges need a readable foreground on a tinted background.
  static const Color success = Color(0xFF22C55E);
  static const Color successDark = Color(0xFF199748);
  static const Color successLight = Color(0xFF45DC80);
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
  static const Color textPrimary = Color(0xFF0F2622);
  static const Color textSecondary = Color(0xFF55706B);
  static const Color textDisabled = Color(0xFF9CA3AF);

  // Border Colors — tinted toward the teal primary so borders read as part
  // of the palette rather than a neutral grey box.
  static const Color border = Color(0xFFD9ECE8);
  static const Color borderDark = Color(0xFFD1D5DB);

  // Teal gradient — used for hero banners and AppBars
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [Color(0xFF0A7169), Color(0xFF0D9488)],
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
