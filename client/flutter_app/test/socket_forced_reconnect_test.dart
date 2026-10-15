import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/services/socket_service.dart';

/// 2026-10-15: after a server restart one phone's live link never came back,
/// so a kiosk scan went nowhere. The scan screen now forces a fresh connection
/// (`reconnect`) when the link is down. These pin the two things that must hold.
void main() {
  tearDown(() => SocketService.instance.disconnect());

  test('reconnect() builds a fresh socket without throwing', () {
    expect(
      () => SocketService.instance.reconnect(userId: 'user-1', accessToken: 'token-1'),
      returnsNormally,
    );
  });

  test('a forced reconnect still counts as a REconnect, so missed events are refetched', () async {
    final s = SocketService.instance;
    s.disconnect();
    final events = <Map<String, dynamic>>[];
    final sub = s.onReconnected.listen(events.add);

    s.noteConnected(); // first connect of the session: no resync
    s.reconnect(userId: 'user-1', accessToken: 'token-1');
    s.noteConnected(); // the forced reconnect's connect: MUST resync
    await Future<void>.delayed(Duration.zero);

    expect(events, hasLength(1));
    await sub.cancel();
  });

  test('an explicit logout disconnect still resets it (the next login is fresh)', () async {
    final s = SocketService.instance;
    final events = <Map<String, dynamic>>[];
    final sub = s.onReconnected.listen(events.add);

    s.noteConnected();
    s.disconnect();
    s.noteConnected();
    await Future<void>.delayed(Duration.zero);

    expect(events, isEmpty);
    await sub.cancel();
  });
}
