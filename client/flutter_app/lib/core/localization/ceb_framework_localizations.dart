import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

/// Real bug, found via a live user report: switching the app language to
/// Bisaya (Cebuano, `ceb`) crashed to a blank white screen. Root cause —
/// `flutter_localizations` ships Material/Cupertino/Widgets translations
/// for Filipino (`material_fil.arb` etc.) but has no Cebuano data at all.
/// `GlobalMaterialLocalizations.delegate.isSupported(Locale('ceb'))` is
/// false, but our own `AppLocalizations` delegate *does* support `ceb` (we
/// generated it), so `MaterialApp.locale` still resolves to `ceb` — and the
/// framework delegate's `load()` then force-unwraps a lookup that returns
/// null for an unrecognized language code. In release mode, where the
/// assertion that would explain this is stripped, that's a silent crash
/// with no visible error — exactly the reported symptom.
///
/// These three delegates claim Cebuano support and hand back Flutter's own
/// real English framework translations underneath. Only the built-in
/// chrome (date-picker labels, "OK"/"Cancel", tooltips) reads in English —
/// every string this app actually owns still comes through
/// `AppLocalizations` in genuine Cebuano, since that's a separate delegate
/// entirely. Filipino needs no such wrapper: flutter_localizations ships
/// real `fil` data, so it already works without one.
class CebMaterialLocalizationsDelegate
    extends LocalizationsDelegate<MaterialLocalizations> {
  const CebMaterialLocalizationsDelegate();
  @override
  bool isSupported(Locale locale) => locale.languageCode == 'ceb';
  @override
  Future<MaterialLocalizations> load(Locale locale) =>
      GlobalMaterialLocalizations.delegate.load(const Locale('en'));
  @override
  bool shouldReload(CebMaterialLocalizationsDelegate old) => false;
}

class CebCupertinoLocalizationsDelegate
    extends LocalizationsDelegate<CupertinoLocalizations> {
  const CebCupertinoLocalizationsDelegate();
  @override
  bool isSupported(Locale locale) => locale.languageCode == 'ceb';
  @override
  Future<CupertinoLocalizations> load(Locale locale) =>
      GlobalCupertinoLocalizations.delegate.load(const Locale('en'));
  @override
  bool shouldReload(CebCupertinoLocalizationsDelegate old) => false;
}

class CebWidgetsLocalizationsDelegate
    extends LocalizationsDelegate<WidgetsLocalizations> {
  const CebWidgetsLocalizationsDelegate();
  @override
  bool isSupported(Locale locale) => locale.languageCode == 'ceb';
  @override
  Future<WidgetsLocalizations> load(Locale locale) =>
      GlobalWidgetsLocalizations.delegate.load(const Locale('en'));
  @override
  bool shouldReload(CebWidgetsLocalizationsDelegate old) => false;
}

const List<LocalizationsDelegate<Object?>> cebFrameworkLocalizationsDelegates =
    [
  CebMaterialLocalizationsDelegate(),
  CebCupertinoLocalizationsDelegate(),
  CebWidgetsLocalizationsDelegate(),
];
