import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Where the API is RIGHT NOW (improvement #1, user ruling 2026-10-11).
///
/// The server is reached through a Cloudflare quick tunnel whose hostname
/// changes on every restart, and the URL used to be baked into the APK — three
/// releases in two weeks existed only to carry a new hostname. Now the app
/// reads a tiny JSON file from a host that never changes (a public GitHub gist
/// the team edits on each rotation) and uses the URL inside it.
///
/// Order of trust, so the app still starts when GitHub or the network is down:
///   1. the gist, if it answers within a few seconds with a valid https URL;
///   2. the last URL that worked on this phone;
///   3. the URL baked into this build (`--dart-define=API_BASE_URL`).
///
/// It only ever chooses WHICH server to talk to. Every security decision still
/// happens on that server; a wrong URL here can only fail to connect.
class ApiEndpoint {
  ApiEndpoint._();

  /// The stable host. Raw URL without a commit id, so it always serves the
  /// latest revision (GitHub caches it for up to five minutes).
  static const String registryUrl =
      'https://gist.githubusercontent.com/Shaloh69/c9c8b972eb40e09fb42e726668404045/raw/engirent-endpoint.json';

  static const String baked = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://playlist-flux-misc-livestock.trycloudflare.com/api/v1',
  );

  /// TEST BUILDS ONLY (`--dart-define=API_PINNED=true`): use [baked] and never
  /// ask the registry or reuse a saved address, so a build can be pointed at a
  /// private test API without the gist sending it to the live server. Off by
  /// default: every release build behaves exactly as before.
  static const bool pinned = bool.fromEnvironment('API_PINNED');

  static const String _prefKey = 'api_base_url_last_good';
  static String _current = baked;
  static String _source = 'built-in';
  static DateTime? _lastRefresh;

  static String get current => _current;

  /// Where [current] came from: "registry", "last-good" or "built-in".
  static String get source => _source;

  static bool _valid(String? url) =>
      url != null && url.startsWith('https://') && url.endsWith('/api/v1') && Uri.tryParse(url) != null;

  /// Called once before the first frame. Never throws and never waits longer
  /// than [timeout] on the network.
  static Future<void> init({Duration timeout = const Duration(seconds: 4)}) async {
    if (pinned) {
      _current = baked;
      _source = 'pinned';
      return;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefKey);
      if (_valid(saved)) {
        _current = saved!;
        _source = 'last-good';
      }
    } catch (_) {}
    await refresh(timeout: timeout);
  }

  /// Ask the registry again. Throttled to once a minute, because a request
  /// failing to connect is exactly when every screen will call this at once.
  static Future<bool> refresh({Duration timeout = const Duration(seconds: 4), bool force = false}) async {
    if (pinned) return false;
    final now = DateTime.now();
    if (!force && _lastRefresh != null && now.difference(_lastRefresh!) < const Duration(minutes: 1)) {
      return false;
    }
    _lastRefresh = now;
    try {
      final resp = await http
          .get(Uri.parse('$registryUrl?t=${now.millisecondsSinceEpoch ~/ 60000}'))
          .timeout(timeout);
      if (resp.statusCode != 200) return false;
      final body = jsonDecode(resp.body);
      final api = body is Map ? body['api'] as String? : null;
      if (!_valid(api)) return false;
      final changed = api != _current;
      _current = api!;
      _source = 'registry';
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefKey, api);
      } catch (_) {}
      if (changed) debugPrint('[ApiEndpoint] API is now $api');
      return changed;
    } catch (e) {
      debugPrint('[ApiEndpoint] registry unavailable ($e); using $_source $_current');
      return false;
    }
  }
}
