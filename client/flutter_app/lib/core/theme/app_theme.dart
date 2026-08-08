import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../constants/app_colors.dart';
import 'tokens.dart';

/// The app's two themes — mandate §1.6 requires both as first-class, so this
/// builds each from its own surface tokens rather than deriving dark by
/// inverting light.
///
/// Type stack (§1.2): Space Grotesk display, IBM Plex Mono for anything
/// numeric or identifier-like, Manrope for body. Inter is explicitly banned.
class AppTheme {
  AppTheme._();

  static ThemeData get light => _build(Brightness.light);
  static ThemeData get dark => _build(Brightness.dark);

  /// IBM Plex Mono with tabular figures — mandate §1.2 requires every
  /// monetary amount, rental ID, locker number and countdown to use this, so
  /// columns of numbers align and the product reads as an instrument.
  /// Exposed here (rather than each screen calling GoogleFonts directly) so
  /// there's one definition to change.
  static TextStyle mono({
    double? fontSize,
    FontWeight fontWeight = FontWeight.w600,
    Color? color,
    double? letterSpacing,
  }) =>
      GoogleFonts.ibmPlexMono(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing ?? -0.2,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final bg = isDark ? AppColors.backgroundDarkMode : AppColors.background;
    final surface = isDark ? AppColors.surfaceDarkMode : AppColors.surface;
    final surfaceAlt =
        isDark ? AppColors.surfaceAltDarkMode : const Color(0xFFF3F8F7);
    final border = isDark ? AppColors.borderDarkMode : AppColors.border;
    final ink = isDark ? AppColors.textPrimaryDark : AppColors.textPrimary;
    final muted = isDark ? AppColors.textSecondaryDark : AppColors.textSecondary;
    final primary = isDark ? AppColors.primaryOnDark : AppColors.primary;
    final secondary = isDark ? AppColors.secondaryOnDark : AppColors.secondary;
    final accent = isDark ? AppColors.accentOnDark : AppColors.accent;

    final scheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: isDark ? const Color(0xFF04211D) : Colors.white,
      secondary: secondary,
      onSecondary: const Color(0xFF3A2600),
      tertiary: accent,
      onTertiary: const Color(0xFF3D0E17),
      error: AppColors.error,
      onError: Colors.white,
      surface: surface,
      onSurface: ink,
      surfaceContainerHighest: surfaceAlt,
      outline: border,
      outlineVariant: border,
    );

    // Manrope body, Space Grotesk display. Applied over the platform's own
    // text theme so sizes/weights stay Material-correct and only the family
    // changes.
    final base = ThemeData(brightness: brightness);
    final bodyFont = GoogleFonts.manropeTextTheme(base.textTheme);
    final textTheme = bodyFont.copyWith(
      displayLarge: GoogleFonts.spaceGrotesk(textStyle: bodyFont.displayLarge),
      displayMedium: GoogleFonts.spaceGrotesk(textStyle: bodyFont.displayMedium),
      displaySmall: GoogleFonts.spaceGrotesk(textStyle: bodyFont.displaySmall),
      headlineLarge: GoogleFonts.spaceGrotesk(
          textStyle: bodyFont.headlineLarge, fontWeight: FontWeight.w700),
      headlineMedium: GoogleFonts.spaceGrotesk(
          textStyle: bodyFont.headlineMedium, fontWeight: FontWeight.w700),
      headlineSmall: GoogleFonts.spaceGrotesk(
          textStyle: bodyFont.headlineSmall, fontWeight: FontWeight.w700),
      titleLarge: GoogleFonts.spaceGrotesk(
          textStyle: bodyFont.titleLarge, fontWeight: FontWeight.w700),
    ).apply(bodyColor: ink, displayColor: ink);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      textTheme: textTheme,
      fontFamily: GoogleFonts.manrope().fontFamily,

      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        foregroundColor: ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: GoogleFonts.spaceGrotesk(
          fontSize: 19,
          fontWeight: FontWeight.w700,
          color: ink,
        ),
      ),

      // §1.4 — 6px cap, 1px palette-tinted border, no elevation ladder.
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.card,
          side: BorderSide(color: border),
        ),
      ),

      dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? surfaceAlt : surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: BorderSide(color: primary, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: const BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: const BorderSide(color: AppColors.error, width: 1.6),
        ),
        labelStyle: TextStyle(color: muted),
        hintStyle: TextStyle(color: muted),
        prefixIconColor: muted,
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: scheme.onPrimary,
          elevation: 0,
          minimumSize: const Size.fromHeight(52),
          shape: const RoundedRectangleBorder(borderRadius: AppRadius.button),
          textStyle: GoogleFonts.manrope(
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ink,
          minimumSize: const Size.fromHeight(52),
          side: BorderSide(color: border),
          shape: const RoundedRectangleBorder(borderRadius: AppRadius.button),
          textStyle: GoogleFonts.manrope(
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: primary,
          textStyle: GoogleFonts.manrope(fontWeight: FontWeight.w600),
        ),
      ),

      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: surface,
        selectedItemColor: primary,
        unselectedItemColor: muted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        selectedLabelStyle:
            GoogleFonts.manrope(fontSize: 11, fontWeight: FontWeight.w700),
        unselectedLabelStyle:
            GoogleFonts.manrope(fontSize: 11, fontWeight: FontWeight.w500),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: surfaceAlt,
        side: BorderSide(color: border),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.input),
        labelStyle: GoogleFonts.manrope(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: ink,
        ),
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? surfaceAlt : AppColors.textPrimary,
        contentTextStyle: GoogleFonts.manrope(color: Colors.white),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.button),
        behavior: SnackBarBehavior.floating,
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(color: primary),
    );
  }
}
