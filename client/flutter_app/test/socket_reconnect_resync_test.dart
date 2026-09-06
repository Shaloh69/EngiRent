import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/services/socket_service.dart';

/// E2.2's other half — refetch on reconnect.
///
/// socket.io reconnects by itself, but the events emitted while it was down
/// are gone: they are fire-and-forget, not queued. So a reconnect is the
/// moment this client is most likely to be showing stale data while looking
/// perfectly healthy. E0's stale-state sweep named this as "the one genuine
/// remainder" after ConnectivityController and offline_write_queue, neither
/// of which re-syncs reads.
///
/// The rule has two edges, and both are load-bearing.
void main() {
  final socket = SocketService.instance;

  test('the FIRST connect does not signal a resync', () async {
    final seen = <Map<String, dynamic>>[];
    final sub = socket.onReconnected.listen(seen.add);

    socket.noteConnected();
    await Future<void>.delayed(Duration.zero);

    // Every screen already fetches on mount. Firing here would double the
    // initial load of every screen in the app, on every launch.
    expect(seen, isEmpty);
    await sub.cancel();
  });

  test('a RE-connect signals a resync', () async {
    socket.disconnect(); // reset to a known state
    final seen = <Map<String, dynamic>>[];
    final sub = socket.onReconnected.listen(seen.add);

    socket.noteConnected(); // first — silent
    socket.noteConnected(); // second — this is a reconnect
    await Future<void>.delayed(Duration.zero);

    expect(seen, hasLength(1));
    expect(seen.single['reason'], 'reconnected');
    await sub.cancel();
  });

  test('the resync also reaches onAnyRentalChange, so existing screens get it free', () async {
    socket.disconnect();
    final seen = <Map<String, dynamic>>[];
    final sub = socket.onAnyRentalChange.listen(seen.add);

    socket.noteConnected();
    socket.noteConnected();
    await Future<void>.delayed(Duration.zero);

    // home_screen's two tabs already listen here and call _load(). Reusing
    // that channel is what stops every screen growing its own reconnect
    // handler — the duplicated-implementation shape ENGIRENT-CLAUDE.md §7
    // says to grep for at the end of a phase.
    expect(seen, hasLength(1));
    expect(seen.single['reason'], 'reconnected');
    await sub.cancel();
  });

  test('an explicit disconnect resets it, so the next login is not a reconnect', () async {
    socket.disconnect();
    final seen = <Map<String, dynamic>>[];
    final sub = socket.onReconnected.listen(seen.add);

    socket.noteConnected(); // session A, first connect
    socket.disconnect();    // logout
    socket.noteConnected(); // session B, first connect — must be silent
    await Future<void>.delayed(Duration.zero);

    expect(seen, isEmpty);
    await sub.cancel();
  });
}
