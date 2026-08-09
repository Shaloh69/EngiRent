import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Last-good-response cache — checklist Stage 4.2.
///
/// Deliberately dumb: callers hand it whatever `jsonDecode`d payload they
/// already have (the same shape their normal parsing path expects) and get
/// the same shape back, plus when it was saved. There's no schema here on
/// purpose — a typed cache per screen would mean keeping two parsers (live +
/// cached) in sync for every cached endpoint, which is exactly the kind of
/// duplication that drifts.
class CachedResult {
  const CachedResult({required this.data, required this.cachedAt});
  final dynamic data;
  final DateTime cachedAt;
}

class LocalCache {
  static const _prefix = 'engirent_cache_';

  static Future<void> save(String key, dynamic jsonData) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        '$_prefix$key',
        jsonEncode({'data': jsonData, 'cachedAt': DateTime.now().toIso8601String()}),
      );
    } catch (_) {
      // Caching is a nice-to-have on top of a real network call that already
      // succeeded — never let a storage failure surface as a user-facing error.
    }
  }

  static Future<CachedResult?> load(String key) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('$_prefix$key');
      if (raw == null) return null;
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return CachedResult(
        data: decoded['data'],
        cachedAt: DateTime.parse(decoded['cachedAt'] as String),
      );
    } catch (_) {
      return null;
    }
  }
}
