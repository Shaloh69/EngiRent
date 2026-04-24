import 'package:flutter/material.dart';

class AppColors {
  // Primary: Deep Navy
  static const Color primary = Color(0xFF1A3A5C);
  static const Color primaryDark = Color(0xFF0D2137);
  static const Color primaryLight = Color(0xFF2E6DA8);

  // Secondary: Keep Green for availability / success states
  static const Color secondary = Color(0xFF10B981);
  static const Color secondaryDark = Color(0xFF059669);
  static const Color secondaryLight = Color(0xFF34D399);

  // Accent / CTA: Warm Orange
  static const Color accent = Color(0xFFFF6B35);
  static const Color accentDark = Color(0xFFE5521A);
  static const Color accentLight = Color(0xFFFF9066);

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

  // Background Colors
  static const Color background = Color(0xFFF4F6FA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceDark = Color(0xFF1F2937);

  // Text Colors
  static const Color textPrimary = Color(0xFF0D2137);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color textDisabled = Color(0xFF9CA3AF);

  // Border Colors
  static const Color border = Color(0xFFE5E7EB);
  static const Color borderDark = Color(0xFFD1D5DB);

  // Navy gradient — used for hero banners and AppBars
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [Color(0xFF0D2137), Color(0xFF1A3A5C)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Orange CTA gradient — used for "Rent Now" / "Confirm" buttons
  static const LinearGradient accentGradient = LinearGradient(
    colors: [Color(0xFFFF6B35), Color(0xFFE5521A)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
