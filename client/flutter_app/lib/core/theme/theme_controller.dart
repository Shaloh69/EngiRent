import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Holds the user's light/dark choice — mandate §1.6.
///
/// Defaults to [ThemeMode.system] so the app follows the OS on first launch,
/// and persists any explicit choice so it survives a restart. Uses the
/// `shared_preferences` instance already in the app rather than adding a
/// second storage mechanism.
class ThemeController extends ChangeNotifier {
  static const _prefsKey = 'engirent_theme_mode';

  ThemeMode _mode = ThemeMode.system;
  ThemeMode get mode => _mode;

  /// Resolves [ThemeMode.system] into the concrete brightness actually being
  /// rendered. UI that needs to know "am I dark right now" must use this —
  /// reading [mode] directly reports `system` and gets the answer wrong on
  /// OS-dark devices.
  bool isDark(BuildContext context) => switch (_mode) {
        ThemeMode.dark => true,
        ThemeMode.light => false,
        ThemeMode.system =>
          MediaQuery.platformBrightnessOf(context) == Brightness.dark,
      };

  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);
      if (saved != null) {
        _mode = ThemeMode.values.firstWhere(
          (m) => m.name == saved,
          orElse: () => ThemeMode.system,
        );
        notifyListeners();
      }
    } catch (_) {
      // A failed read must never block app start — falling back to
      // ThemeMode.system is always a valid state.
    }
  }

  Future<void> setMode(ThemeMode next) async {
    if (next == _mode) return;
    _mode = next;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, next.name);
    } catch (_) {
      // Persist failure is not worth surfacing — the choice still applies
      // for this session.
    }
  }

  /// Convenience for the Profile toggle: flips to the opposite of what is
  /// currently *rendered*, so the first tap always visibly changes something
  /// even when the mode is still `system`.
  Future<void> toggle(BuildContext context) =>
      setMode(isDark(context) ? ThemeMode.light : ThemeMode.dark);
}
