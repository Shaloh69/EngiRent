import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/models/user_model.dart';

/// D-1 — the reported "Settings asks me to authenticate again, and never shows
/// my verification status."
///
/// Root cause is not a stale cache or a missing refetch: `UserModel.fromJson`
/// never read `verificationStatus` / `verificationReason` / `verificationNote`
/// at all, so every user fell through to the constructor default of
/// `UNSUBMITTED` no matter what the server said. The server has always sent
/// them — they're in `authController.ts`'s `PROFILE_SELECT`.
///
/// The visible consequence: the Profile tab's Identity tile matches the
/// `'UNSUBMITTED'` branch for everyone, so it always renders "submit your
/// student ID" and always routes to `/profile/setup`. A fully verified student
/// is asked to re-capture their ID and face. That is the "double
/// authentication" in the report.
///
/// `toJson` dropped the same three fields (D-7), so even a correct `fromJson`
/// would not survive a cache round-trip.
void main() {
  // A realistic `GET /auth/profile` payload for an approved student.
  Map<String, dynamic> profileJson({
    required String status,
    String? reason,
    String? note,
  }) => {
        'id': 'usr_123',
        'email': 'maya@engirent.edu.ph',
        'studentId': '2022-00123',
        'firstName': 'Maya',
        'lastName': 'Reyes',
        'phoneNumber': '09171234567',
        'profileComplete': true,
        'isVerified': status == 'APPROVED',
        'verificationStatus': status,
        if (reason != null) 'verificationReason': reason,
        if (note != null) 'verificationNote': note,
        'role': 'STUDENT',
        'payoutConfigured': false,
      };

  group('UserModel.fromJson — verification workflow state', () {
    test('reads APPROVED from the server instead of defaulting', () {
      final user = UserModel.fromJson(profileJson(status: 'APPROVED'));
      expect(user.verificationStatus, 'APPROVED');
      expect(user.isVerified, isTrue);
    });

    test('reads PENDING — a human is reviewing, not a failure', () {
      final user = UserModel.fromJson(profileJson(status: 'PENDING'));
      expect(user.verificationStatus, 'PENDING');
      expect(user.isVerified, isFalse);
    });

    test('reads REJECTED with its reason and reviewer note', () {
      final user = UserModel.fromJson(profileJson(
        status: 'REJECTED',
        reason: 'ID_UNREADABLE',
        note: 'The photo is too blurry to read your student number.',
      ));
      expect(user.verificationStatus, 'REJECTED');
      expect(user.verificationReason, 'ID_UNREADABLE');
      expect(user.verificationNote, contains('blurry'));
    });

    test('still defaults to UNSUBMITTED when the server omits the field', () {
      final json = profileJson(status: 'APPROVED')..remove('verificationStatus');
      expect(UserModel.fromJson(json).verificationStatus, 'UNSUBMITTED');
    });

    /// The bug as the user experiences it. An approved student must NOT match
    /// the Profile tab's re-prompt branch, which fires on
    /// `'REJECTED' || 'UNSUBMITTED' || null`.
    test('an approved student is never routed back into profile setup', () {
      final user = UserModel.fromJson(profileJson(status: 'APPROVED'));
      const reprompts = {'REJECTED', 'UNSUBMITTED'};
      expect(
        reprompts.contains(user.verificationStatus),
        isFalse,
        reason: 'A verified student was asked to re-submit ID and face — D-1.',
      );
    });
  });

  group('UserModel.toJson — survives a cache round-trip (D-7)', () {
    test('retains verification state through encode then decode', () {
      final original = UserModel.fromJson(profileJson(
        status: 'REJECTED',
        reason: 'ID_EXPIRED',
        note: 'This ID expired last term.',
      ));
      final restored = UserModel.fromJson(original.toJson());
      expect(restored.verificationStatus, 'REJECTED');
      expect(restored.verificationReason, 'ID_EXPIRED');
      expect(restored.verificationNote, 'This ID expired last term.');
    });
  });
}
