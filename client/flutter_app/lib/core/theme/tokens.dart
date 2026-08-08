import 'package:flutter/material.dart';

/// Design tokens — mandate §1.4.
///
/// Screens reference `AppSpacing.md`, never a bare `16`. The point isn't
/// ceremony: arbitrary one-off values (13, 22, 37) are the single fastest
/// visual tell of generated layout, and they only creep in when there's no
/// named scale to reach for.
class AppSpacing {
  AppSpacing._();

  /// 4px — icon-to-label gaps and inline chip padding only. Everything else
  /// starts at [xs]; the 8px grid has no other sub-8 step.
  static const double hair = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
  static const double huge = 64;
}

/// Radius scale — mandate §1.4, hard cap 6px. "Machined edges, not lozenges."
/// Nothing is fully rounded except avatars and status dots, which use
/// [AppRadius.circle] explicitly.
class AppRadius {
  AppRadius._();

  /// Inputs, chips, badges.
  static const double xs = 2;

  /// Buttons.
  static const double sm = 4;

  /// Cards, panels, sheets, modals.
  static const double md = 6;

  static const BorderRadius input = BorderRadius.all(Radius.circular(xs));
  static const BorderRadius button = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius card = BorderRadius.all(Radius.circular(md));

  /// Only for avatars and status dots.
  static const BorderRadius circle = BorderRadius.all(Radius.circular(999));
}

/// Elevation — mandate §1.4: "borders do the work shadows used to."
/// There is exactly one shadow token and no elevation ladder. If something
/// needs to separate from its background, it gets a 1px palette-tinted
/// border, not a bigger shadow.
class AppElevation {
  AppElevation._();

  static List<BoxShadow> hairline(Color shadowColor) => [
        BoxShadow(
          color: shadowColor.withValues(alpha: 0.06),
          blurRadius: 2,
          offset: const Offset(0, 1),
        ),
      ];
}

/// Motion — one duration scale so transitions feel like one system.
class AppMotion {
  AppMotion._();

  static const Duration fast = Duration(milliseconds: 160);
  static const Duration base = Duration(milliseconds: 260);
  static const Duration slow = Duration(milliseconds: 420);

  /// Matches the cubic-bezier used on the web surfaces so a shared gesture
  /// (a panel entering, a badge swapping) decelerates identically everywhere.
  static const Curve ease = Cubic(0.16, 1, 0.3, 1);
}
