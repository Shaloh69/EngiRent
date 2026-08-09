/// Redaction applied to everything on its way to the crash reporter.
///
/// Mandate §2.10.1 makes crash reporting a blocker, but this app handles
/// material that must never leave the device: JWTs, face encodings, student ID
/// photo paths, and the personal details attached to a verification. A crash
/// reporter is a firehose — breadcrumbs capture HTTP calls, exception messages
/// routinely embed the URL and body that failed — so the redaction has to sit
/// between the app and the SDK rather than being a rule people remember to
/// follow at each call site.
///
/// Kept free of any Sentry import on purpose: these are pure functions over
/// strings and maps, so they can be unit-tested without a DSN, a network, or
/// an initialised SDK. `test/pii_scrubber_test.dart` is that test.
library;

const String redacted = '[redacted]';

/// Key names whose *value* is never safe, whatever it looks like.
///
/// Matched case-insensitively against the whole key, and against
/// snake_case/camelCase fragments, so `refresh_token`, `refreshToken` and
/// `X-Refresh-Token` all match the same rule.
const List<String> sensitiveKeyFragments = [
  'token',
  'authorization',
  'auth',
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'faceencoding',
  'face_encoding',
  'encoding',
  'idimage',
  'id_image',
  'idphoto',
  'id_photo',
  'facephoto',
  'face_photo',
  'biometric',
  'cookie',
  'session',
  'signature',
  'otp',
  'pin',
];

// A JWT is three base64url segments separated by dots. Matching the shape
// rather than a key name catches tokens embedded mid-sentence in an
// exception message, which is where they actually leak.
final RegExp _jwt = RegExp(r'\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b');

final RegExp _bearer = RegExp(r'(bearer\s+)[A-Za-z0-9._\-]{8,}', caseSensitive: false);

final RegExp _email = RegExp(r'\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b');

// Philippine mobile numbers as this app collects them (09xxxxxxxxx /
// +639xxxxxxxxx), plus a generic long-digit-run guard.
final RegExp _phone = RegExp(r'\b(?:\+?63|0)9\d{9}\b');

// Signed media links and the stored paths behind them. The token in a signed
// URL grants access to the image on its own, so a breadcrumb containing one is
// as good as shipping the ID photo itself.
final RegExp _mediaSecure = RegExp(r'/media/secure/[A-Za-z0-9._\-]+');
final RegExp _userMediaPath = RegExp(
  r'users/[0-9a-fA-F-]{8,}/(?:face|id)\.(?:jpg|jpeg|png|webp)',
);

/// A run of comma-separated floats — the shape of a 128-element face
/// encoding. Deliberately requires several in a row so ordinary coordinate
/// pairs and prices are left alone.
final RegExp _floatVector = RegExp(r'(-?\d+\.\d+\s*,\s*){7,}-?\d+\.\d+');

bool isSensitiveKey(String key) {
  final normalised = key.toLowerCase().replaceAll(RegExp(r'[^a-z]'), '');
  for (final fragment in sensitiveKeyFragments) {
    if (normalised.contains(fragment.replaceAll(RegExp(r'[^a-z]'), ''))) {
      return true;
    }
  }
  return false;
}

/// Redacts secrets inside free text.
///
/// Order matters: the float-vector and JWT rules run before the generic ones
/// so a long encoding isn't partially rewritten into something unrecognisable
/// first.
String scrubText(String input) {
  var out = input;
  out = out.replaceAll(_floatVector, redacted);
  out = out.replaceAll(_jwt, redacted);
  out = out.replaceAllMapped(_bearer, (m) => '${m[1]}$redacted');
  out = out.replaceAll(_mediaSecure, '/media/secure/$redacted');
  out = out.replaceAll(_userMediaPath, 'users/$redacted');
  // Emails keep their first character and domain: enough to tell two users
  // apart while debugging, not enough to identify anyone.
  out = out.replaceAllMapped(_email, (m) => '${m[1]}***@${m[2]}');
  out = out.replaceAll(_phone, redacted);
  return out;
}

/// Recursively redacts a decoded-JSON-shaped structure.
///
/// Returns a new structure; the input is not modified, because these maps come
/// from live app state and mutating them would change what the app itself
/// sees.
Object? scrubValue(Object? value, {int depth = 0}) {
  // Cheap cycle/blow-up guard: crash payloads are not worth a stack overflow.
  if (depth > 12) return redacted;

  if (value is String) return scrubText(value);

  if (value is Map) {
    final out = <String, Object?>{};
    value.forEach((k, v) {
      final key = k.toString();
      if (isSensitiveKey(key)) {
        out[key] = redacted;
      } else {
        out[key] = scrubValue(v, depth: depth + 1);
      }
    });
    return out;
  }

  if (value is List) {
    // A long list of numbers is a biometric template, not telemetry.
    if (value.length >= 32 && value.every((e) => e is num)) {
      return redacted;
    }
    return value.map((e) => scrubValue(e, depth: depth + 1)).toList();
  }

  return value;
}

Map<String, Object?> scrubMap(Map<String, Object?> input) =>
    scrubValue(input) as Map<String, Object?>;
