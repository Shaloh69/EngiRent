import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/observability/pii_scrubber.dart';

/// The checklist's definition of done for Stage 1.1 includes "the scrubber is
/// proven by asserting a token-bearing event is redacted". This is that proof.
///
/// These are the payloads this app genuinely produces — a real JWT shape from
/// `/auth/login`, a 128-float face encoding from the ML service, a signed
/// media URL for a student ID — not invented strings that happen to match.
void main() {
  group('scrubText', () {
    test('redacts a JWT embedded in an exception message', () {
      const jwt =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJlZWJhMTMwYyJ9.UFWiTjIa_SbR7Egexksg4l';
      final out = scrubText('Request failed with Authorization: Bearer $jwt');
      expect(out.contains('eyJ'), isFalse, reason: 'the token survived: $out');
      expect(out.contains(redacted), isTrue);
    });

    test('redacts a bare bearer token even without a JWT shape', () {
      final out = scrubText('headers: {Authorization: Bearer abc123def456ghi}');
      expect(out.contains('abc123def456ghi'), isFalse);
    });

    test('redacts a 128-float face encoding', () {
      final encoding = List.generate(128, (i) => (i / 100 - 0.5).toStringAsFixed(6)).join(', ');
      final out = scrubText('faceEncoding: [$encoding]');
      expect(out.length, lessThan(120), reason: 'encoding was not collapsed: $out');
      expect(out.contains(redacted), isTrue);
    });

    test('redacts a signed media URL, which grants access on its own', () {
      final out = scrubText(
        'GET https://api.example.com/media/secure/abc.def.ghi123 failed',
      );
      expect(out.contains('abc.def.ghi123'), isFalse, reason: out);
    });

    test('redacts stored face and ID photo paths', () {
      final out = scrubText('saveBuffer users/1e07d03f-d1cd-48b4-842d-72ae05c88369/id.jpg');
      expect(out.contains('id.jpg'), isFalse, reason: out);
    });

    test('masks an email but keeps it distinguishable for debugging', () {
      final out = scrubText('login failed for ian.luna@uclm.edu.ph');
      expect(out.contains('ian.luna'), isFalse);
      expect(out.contains('uclm.edu.ph'), isTrue,
          reason: 'the domain is useful and not identifying');
      expect(out.contains('i***@'), isTrue);
    });

    test('redacts Philippine mobile numbers in both formats', () {
      expect(scrubText('contact 09171234567').contains('09171234567'), isFalse);
      expect(scrubText('contact +639171234567').contains('639171234567'), isFalse);
    });

    test('leaves ordinary diagnostic text alone', () {
      const msg = 'Rental 4821 moved PENDING -> ACTIVE after 2 retries (price 250.00)';
      expect(scrubText(msg), msg);
    });
  });

  group('isSensitiveKey', () {
    test('matches across naming conventions', () {
      for (final key in [
        'token',
        'accessToken',
        'access_token',
        'refresh_token',
        'Authorization',
        'X-Api-Key',
        'faceEncoding',
        'idImageUrl',
        'password',
      ]) {
        expect(isSensitiveKey(key), isTrue, reason: '$key should be sensitive');
      }
    });

    test('does not over-match ordinary fields', () {
      for (final key in ['itemId', 'rentalId', 'status', 'price', 'category', 'firstName']) {
        expect(isSensitiveKey(key), isFalse, reason: '$key should not be sensitive');
      }
    });
  });

  group('scrubValue', () {
    test('redacts by key name regardless of the value', () {
      final out = scrubMap({
        'accessToken': 'not-even-jwt-shaped',
        'itemId': 'abc-123',
      });
      expect(out['accessToken'], redacted);
      expect(out['itemId'], 'abc-123');
    });

    test('redacts a long numeric list as a biometric template', () {
      final out = scrubMap({'encodingValues': List.generate(128, (i) => i * 0.01)});
      expect(out['encodingValues'], redacted);
    });

    test('keeps short numeric lists, which are ordinary data', () {
      final out = scrubMap({'ratings': [5, 4, 3]});
      expect(out['ratings'], [5, 4, 3]);
    });

    test('recurses into nested structures', () {
      final out = scrubMap({
        'request': {
          'headers': {'Authorization': 'Bearer secrettokenvalue'},
          'body': {
            'user': {'email': 'allan.mondejar@uclm.edu.ph'},
          },
        },
      });
      final request = out['request'] as Map<String, Object?>;
      // `headers` is a container, not a secret, so it is walked rather than
      // replaced wholesale — the Authorization inside it is what gets redacted.
      final headers = request['headers'] as Map<String, Object?>;
      expect(headers['Authorization'], redacted);
      final body = request['body'] as Map<String, Object?>;
      final user = body['user'] as Map<String, Object?>;
      expect((user['email'] as String).contains('allan.mondejar'), isFalse);
    });

    test('does not mutate the input', () {
      final input = <String, Object?>{'accessToken': 'abc'};
      scrubMap(input);
      expect(input['accessToken'], 'abc');
    });

    test('survives deeply nested structures without blowing the stack', () {
      Map<String, Object?> nested = {'leaf': 'ok'};
      for (var i = 0; i < 50; i++) {
        nested = {'level$i': nested};
      }
      expect(() => scrubMap(nested), returnsNormally);
    });
  });
}
