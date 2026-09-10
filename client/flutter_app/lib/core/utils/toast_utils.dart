import 'package:flutter/material.dart';
import 'package:toastification/toastification.dart';

import '../theme/design_tokens.g.dart';

/// App-wide toast.
///
/// E3.2 restyled this onto the generated design tokens. **Behaviour is
/// deliberately unchanged** — same four entry points, same signatures, same
/// durations, same alignment and dismissal, so all 14 call sites keep working
/// and nothing about *when* a toast appears was touched. Only what it looks
/// like moved.
///
/// What was wrong: every method passed a bare `ToastificationType` with
/// `ToastificationStyle.flatColored`, which means **the package chose the
/// colours** — its own green/red/blue/orange, not EngiRent's. Exactly the
/// shape of D-46, where the admin console's inputs turned out to be painted by
/// Mantine's default grey rather than by any token we own. A dependency's
/// palette is still a palette, and it drifts from the product silently.
///
/// Two smaller corrections came with it:
///  * `borderRadius: 12` violated the mandate's §1.4 6px cap. Now
///    [DesignRadius.card].
///  * There was no PENDING/review toast, so anything "awaiting review" had to
///    borrow [warning] — the precise mistake E3.1's ruling forbids, since
///    PENDING is cyan-teal and never warning-yellow. [review] now exists.
class AppToast {
  const AppToast._();

  /// Resolves the token set for the ambient theme, so a toast raised on a dark
  /// screen is a dark-resolution toast rather than a light one over a dark app.
  static DesignTokens _t(BuildContext context) =>
      DesignTokens.of(Theme.of(context).brightness);

  static void _show(
    BuildContext context,
    ToastificationType type,
    Color fill,
    Color ink,
    String title,
    String? description,
    Duration duration,
  ) {
    toastification.show(
      context: context,
      type: type,
      style: ToastificationStyle.flatColored,
      // The three that take the colour away from the package.
      primaryColor: fill,
      backgroundColor: _t(context).surface,
      foregroundColor: ink,
      title: Text(
        title,
        style: TextStyle(fontWeight: FontWeight.w700, color: ink),
      ),
      description: description != null
          ? Text(description, style: TextStyle(color: ink))
          : null,
      alignment: Alignment.topCenter,
      autoCloseDuration: duration,
      borderRadius: BorderRadius.circular(DesignRadius.card),
      showProgressBar: false,
      pauseOnHover: true,
    );
  }

  static void success(BuildContext context, String title,
      [String? description]) {
    final t = _t(context);
    _show(context, ToastificationType.success, t.success, t.successInk, title,
        description, const Duration(seconds: 4));
  }

  static void error(BuildContext context, String title,
      [String? description]) {
    final t = _t(context);
    _show(context, ToastificationType.error, t.critical, t.criticalInk, title,
        description, const Duration(seconds: 5));
  }

  static void info(BuildContext context, String title, [String? description]) {
    final t = _t(context);
    _show(context, ToastificationType.info, t.brand, t.brandInk, title,
        description, const Duration(seconds: 3));
  }

  static void warning(BuildContext context, String title,
      [String? description]) {
    final t = _t(context);
    _show(context, ToastificationType.warning, t.warning, t.warningInk, title,
        description, const Duration(seconds: 4));
  }

  /// Something is awaiting review — a submitted verification, a payment an
  /// admin has yet to confirm. Cyan-teal, never warning-yellow: a state that is
  /// merely *pending* must not read as a state that is *wrong*.
  static void review(BuildContext context, String title,
      [String? description]) {
    final t = _t(context);
    _show(context, ToastificationType.info, t.review, t.reviewInk, title,
        description, const Duration(seconds: 4));
  }
}
