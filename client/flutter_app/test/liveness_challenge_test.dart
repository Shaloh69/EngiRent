import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/liveness/liveness_capture_controller.dart';
import 'package:engirent/core/models/user_model.dart';

void main() {
  group('FaceChallenge.fromJson', () {
    test('accepts any permutation of the three steps with a nonce', () {
      final c = FaceChallenge.fromJson({
        'order': ['TURN_RIGHT', 'BLINK', 'TURN_LEFT'],
        'nonce': 'abc',
      });
      expect(c, isNotNull);
      expect(c!.order, ['TURN_RIGHT', 'BLINK', 'TURN_LEFT']);
      expect(c.nonce, 'abc');
    });

    test('rejects anything malformed instead of guessing', () {
      expect(FaceChallenge.fromJson(null), isNull);
      expect(FaceChallenge.fromJson({'order': ['BLINK'], 'nonce': 'x'}), isNull);
      expect(FaceChallenge.fromJson({'order': ['BLINK', 'BLINK', 'TURN_LEFT'], 'nonce': 'x'}), isNull);
      expect(FaceChallenge.fromJson({'order': ['BLINK', 'TURN_LEFT', 'SMILE'], 'nonce': 'x'}), isNull);
      expect(FaceChallenge.fromJson({'order': ['BLINK', 'TURN_LEFT', 'TURN_RIGHT']}), isNull);
    });
  });

  group('step wording', () {
    test('every step has its own instruction', () {
      final all = ['centre', 'BLINK', 'TURN_LEFT', 'TURN_RIGHT'].map(LivenessCaptureController.instructionFor).toSet();
      expect(all.length, 4);
    });
  });

  group('UserModel face enrolment', () {
    Map<String, dynamic> json(Map<String, dynamic> extra) => {
          'id': 'u',
          'email': 'a@b.c',
          'studentId': '1',
          'firstName': 'A',
          'lastName': 'B',
          'phoneNumber': '0',
          'profileComplete': true,
          'isVerified': true,
          'verificationStatus': 'APPROVED',
          ...extra,
        };

    test('an account from before the revamp is asked to update', () {
      expect(UserModel.fromJson(json({})).needsFaceUpdate, isTrue);
      expect(UserModel.fromJson(json({'faceEnrolmentVersion': 1})).needsFaceUpdate, isTrue);
    });

    test('version 2, a face under review, or an unfinished profile is not asked', () {
      expect(UserModel.fromJson(json({'faceEnrolmentVersion': 2})).needsFaceUpdate, isFalse);
      final review = UserModel.fromJson(json({'pendingFaceAt': '2026-10-15T00:00:00Z'}));
      expect(review.needsFaceUpdate, isFalse);
      expect(review.faceUnderReview, isTrue);
      expect(UserModel.fromJson(json({'profileComplete': false})).needsFaceUpdate, isFalse);
    });
  });
}
