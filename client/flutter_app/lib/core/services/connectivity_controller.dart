import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'offline_write_queue.dart';

/// App-wide online/offline state — checklist Stage 4.1.
///
/// A connected wifi/cellular radio doesn't mean the API is actually
/// reachable (captive portals, the campus wifi being up but the PC hosting
/// the API being down), so this deliberately does more than ask
/// `connectivity_plus` "is there a radio link": it also tracks whether the
/// last few real API calls succeeded, via [reportRequestOutcome]. The
/// banner reflects "can you actually talk to EngiRent", not just "is wifi
/// connected".
class ConnectivityController extends ChangeNotifier {
  ConnectivityController._();

  /// Singleton, not DI-threaded through every constructor. `ApiService` is
  /// instantiated fresh in most screens/services (`final _api =
  /// ApiService();`, no shared instance) — reworking that just to inject
  /// this would be a much bigger, riskier change than this feature needs.
  /// The same instance is also registered with `ChangeNotifierProvider.value`
  /// in main.dart so widgets can watch it normally.
  static final ConnectivityController instance = ConnectivityController._();

  bool _hasRadio = true;
  bool _apiReachable = true;
  bool _started = false;
  StreamSubscription<List<ConnectivityResult>>? _sub;

  bool get isOnline => _hasRadio && _apiReachable;

  /// Idempotent — `MyApp.build()` re-runs on every rebuild, and `..start()`
  /// is called inline at the provider registration site each time, so this
  /// must be safe to call more than once rather than leaking a duplicate
  /// stream subscription.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    try {
      final initial = await Connectivity().checkConnectivity();
      _hasRadio = _isConnected(initial);
    } catch (_) {
      // Some platforms (web, in particular) can throw on first call in
      // certain embeddings; default to "assume online" rather than showing
      // a false offline banner on every launch.
      _hasRadio = true;
    }

    _sub = Connectivity().onConnectivityChanged.listen((results) {
      final was = isOnline;
      _hasRadio = _isConnected(results);
      // A radio coming back doesn't prove the API is reachable yet — leave
      // _apiReachable as-is until the next real request settles it, rather
      // than optimistically clearing a real API outage the instant wifi
      // reconnects.
      if (isOnline != was) notifyListeners();
    });
  }

  bool _isConnected(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none);

  /// Called by ApiService after every real request. This is what catches
  /// "wifi says connected but the API isn't reachable" — a captive portal,
  /// or the host machine being down — which a pure connectivity_plus check
  /// can't see.
  void reportRequestOutcome({required bool reachedServer}) {
    if (_apiReachable == reachedServer) return;
    final wasReachable = _apiReachable;
    _apiReachable = reachedServer;
    notifyListeners();
    // Checklist Stage 4.3 — this is the one place "we can genuinely reach
    // the API again" is known, as opposed to just "a radio reconnected",
    // which could still be a captive portal. That's the right moment to
    // replay anything queued while it was down.
    if (!wasReachable && reachedServer) {
      OfflineWriteQueue.instance.flush();
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
