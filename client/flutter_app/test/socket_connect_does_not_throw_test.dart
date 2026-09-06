import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/services/socket_service.dart';

/// D-40 regression.
///
/// `SocketService.connect()` contained
/// `.setReconnectionAttempts(double.infinity.toInt())`. In Dart that throws
/// `Unsupported operation: Infinity or NaN toInt`, so the method threw before
/// `io.io(...)` was ever reached and **no socket was ever created**. The line
/// was asking for unlimited reconnection attempts; by trying to express
/// "infinite" it produced zero connections.
///
/// The failure was invisible from inside the app. It surfaced only as an
/// "Uncaught platform error" line in logcat at login, and every socket-driven
/// feature simply did nothing — which is indistinguishable from a quiet
/// system with no events.
///
/// This test asserts the one thing that matters and that no other test
/// covered: that building the options and constructing the socket does not
/// throw. It does not assert a connection is established — that needs a live
/// server and belongs in the on-device pass.
void main() {
  tearDown(() => SocketService.instance.disconnect());

  test('connect() does not throw while building socket options (D-40)', () {
    expect(
      () => SocketService.instance.connect(
        userId: 'user-1',
        accessToken: 'token-1',
      ),
      returnsNormally,
    );
  });

  test('connect() does not throw without an access token either', () {
    expect(
      () => SocketService.instance.connect(userId: 'user-2'),
      returnsNormally,
    );
  });
}
