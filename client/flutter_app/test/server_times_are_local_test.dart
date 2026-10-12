import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/models/message_model.dart';
import 'package:engirent/core/models/notification_model.dart';
import 'package:engirent/core/models/rental_model.dart';

/// The server sends every timestamp in UTC ("...Z"). `DateTime.parse` keeps it
/// UTC, and `DateFormat` prints a UTC value as-is, so the chat showed 3:06 PM
/// when it was 11:06 PM in the Philippines (found live 2026-10-12). Times that
/// say WHEN something happened are converted to local as they are read.
///
/// The test machine's own zone is irrelevant: what is pinned is that the value
/// is a LOCAL DateTime (not UTC) and still the very same instant.
void main() {
  const iso = '2026-10-12T15:06:53.000Z';
  final instant = DateTime.utc(2026, 10, 12, 15, 6, 53);

  test('a chat message time is local, same instant', () {
    final m = MessageModel.fromJson({
      'id': 'm1',
      'body': 'hello',
      'createdAt': iso,
      'readAt': iso,
      'sender': {'id': 'u1', 'firstName': 'A', 'lastName': 'B'},
    });
    expect(m.createdAt.isUtc, isFalse);
    expect(m.createdAt.isAtSameMomentAs(instant), isTrue);
    expect(m.readAt!.isUtc, isFalse);
  });

  test('a notification time is local, same instant', () {
    final n = NotificationModel.fromJson({
      'id': 'n1',
      'title': 't',
      'message': 'm',
      'type': 'SYSTEM_ANNOUNCEMENT',
      'isRead': false,
      'createdAt': iso,
    });
    expect(n.createdAt.isUtc, isFalse);
    expect(n.createdAt.isAtSameMomentAs(instant), isTrue);
  });

  test('a rental transaction time is local, same instant', () {
    final t = RentalTransaction.fromJson({'id': 't1', 'type': 'RENTAL_PAYMENT', 'createdAt': iso});
    expect(t.createdAt!.isUtc, isFalse);
    expect(t.createdAt!.isAtSameMomentAs(instant), isTrue);
  });
}
