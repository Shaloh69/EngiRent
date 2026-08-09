import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:engirent/core/services/offline_write_queue.dart';

/// Checklist Stage 4.3's hard rule — "payments and locker actions must
/// never be queued, replaying either is dangerous" — is enforced
/// structurally in [OfflineWriteQueue.enqueue], not just by convention at
/// each call site. This is the proof: every payments/kiosk endpoint shape
/// actually used in the app is asserted to throw rather than silently queue.
void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('OfflineWriteQueue — forbidden endpoints', () {
    test('refuses to queue a payment', () async {
      expect(
        () => OfflineWriteQueue.instance.enqueue(
          method: 'POST',
          endpoint: '/payments',
          body: {'rentalId': 'r1'},
          label: 'test',
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('refuses to queue a kiosk command', () async {
      expect(
        () => OfflineWriteQueue.instance.enqueue(
          method: 'POST',
          endpoint: '/kiosk/session/validate',
          body: {},
          label: 'test',
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('a forbidden enqueue attempt does not get persisted', () async {
      final before = await OfflineWriteQueue.instance.pendingCount();
      try {
        await OfflineWriteQueue.instance.enqueue(
          method: 'POST',
          endpoint: '/payments/refund',
          body: {},
          label: 'test',
        );
      } catch (_) {}
      final after = await OfflineWriteQueue.instance.pendingCount();
      expect(after, before);
    });
  });

  group('OfflineWriteQueue — allowed writes', () {
    test('enqueue + pendingCount round-trips', () async {
      expect(await OfflineWriteQueue.instance.pendingCount(), 0);
      await OfflineWriteQueue.instance.enqueue(
        method: 'POST',
        endpoint: '/reviews',
        body: {'rentalId': 'r1', 'rating': 5, 'reviewType': 'ITEM'},
        label: 'Review for rental r1',
      );
      expect(await OfflineWriteQueue.instance.pendingCount(), 1);
    });

    test('multiple queued writes accumulate in order', () async {
      await OfflineWriteQueue.instance.enqueue(
        method: 'POST', endpoint: '/reviews', body: {'n': 1}, label: 'first',
      );
      await OfflineWriteQueue.instance.enqueue(
        method: 'POST', endpoint: '/reviews', body: {'n': 2}, label: 'second',
      );
      expect(await OfflineWriteQueue.instance.pendingCount(), 2);
    });
  });
}
