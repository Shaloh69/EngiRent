import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Holds the user's chosen app language — checklist Stage 9 localisation
/// scaffolding.
///
/// Mirrors `ThemeController`'s shape: defaults to `null` (meaning "follow
/// the system locale", which `MaterialApp.locale` treats the same way when
/// nothing is set) and persists any explicit choice via the same
/// `shared_preferences` instance every other persisted setting in this app
/// already uses, rather than adding a second storage mechanism.
class LocaleController extends ChangeNotifier {
  static const _prefsKey = 'engirent_locale';

  /// Keep in sync with `supportedLocales` in main.dart and the ARB files
  /// under lib/l10n/.
  static const supportedLocales = [
    Locale('en'),
    Locale('fil'),
    Locale('ceb'),
  ];

  Locale? _locale;

  /// `null` means "no explicit choice" — MaterialApp falls back to the
  /// device locale (or English, if the device locale isn't one of
  /// [supportedLocales]).
  Locale? get locale => _locale;

  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);
      if (saved == null) return;
      final match = supportedLocales
          .where((l) => l.languageCode == saved)
          .toList();
      if (match.isNotEmpty) {
        _locale = match.first;
        notifyListeners();
      }
    } catch (_) {
      // A failed read must never block app start — falling back to the
      // system locale is always a valid state.
    }
  }

  Future<void> setLocale(Locale? next) async {
    if (next == _locale) return;
    _locale = next;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      if (next == null) {
        await prefs.remove(_prefsKey);
      } else {
        await prefs.setString(_prefsKey, next.languageCode);
      }
    } catch (_) {
      // Persist failure is not worth surfacing — the choice still applies
      // for this session.
    }
  }
}
