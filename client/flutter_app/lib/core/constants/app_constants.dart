import 'package:flutter/foundation.dart';

class AppConstants {
  // API Configuration — build-configurable via --dart-define, e.g.:
  //   flutter build apk --dart-define=API_BASE_URL=https://<current-tunnel>.trycloudflare.com/api/v1
  //
  // The old fallback here was the Render URL, which was decommissioned in the
  // Phase 0.5 self-hosting migration — so any APK built without --dart-define
  // was silently pointing at a dead host (found 2026-09-03).
  //
  // This default must be a *publicly* reachable address: real students are on
  // mobile data, not the tailnet, so `http://desktop-gklhcri:5000` would not
  // work for them even though it is the stabler address. That leaves the
  // Cloudflare quick tunnel, which rotates its hostname on every restart —
  // meaning this default goes stale and the APK needs rebuilding each time
  // the tunnel restarts. That is the accepted tradeoff of the free tunnel
  // (see memory.md); the fix, if it ever becomes worth it, is a stable
  // hostname rather than a smarter default here.
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://mpg-clothing-maui-chicago.trycloudflare.com/api/v1',
  );
  // Note: the ML service is no longer called directly by this app — face
  // registration goes through POST /auth/register-face (a Node proxy) so the
  // ML service's server-to-server API key never has to live in this app's
  // bundle. See features/auth/screens/profile_setup_screen.dart.

  // Storage Keys
  static const String keyAccessToken = 'access_token';
  static const String keyRefreshToken = 'refresh_token';
  static const String keyUserId = 'user_id';
  static const String keyUserEmail = 'user_email';

  // Item Categories
  static const Map<String, String> categories = {
    'SCHOOL_ATTIRE': 'School Attire',
    'ACADEMIC_TOOLS': 'Academic Tools',
    'ELECTRONICS': 'Electronics',
    'DEVELOPMENT_KITS': 'Development Kits',
    'MEASUREMENT_TOOLS': 'Measurement Tools',
    'AUDIO_VISUAL': 'Audio/Visual',
    'SPORTS_EQUIPMENT': 'Sports Equipment',
    'OTHER': 'Other',
  };

  // Rental Status
  static const Map<String, String> rentalStatus = {
    'PENDING': 'Pending',
    'AWAITING_DEPOSIT': 'Awaiting Deposit',
    'DEPOSITED': 'Deposited',
    'ACTIVE': 'Active',
    'VERIFICATION': 'Under Verification',
    'COMPLETED': 'Completed',
    'CANCELLED': 'Cancelled',
    'DISPUTED': 'Disputed',
  };

  // App Info
  static const String appName = 'EngiRent Hub';
  // Version deliberately not a constant here: this one said '1.0.0' while
  // pubspec was on 1.5.2+15, and nothing referenced it, so it was pure
  // misinformation waiting to be believed. Read the real value from the
  // bundle instead — CrashReporting.release, via package_info_plus.

  // Default Values
  static const int defaultPageSize = 10;
  static const int maxImageSize = 10485760; // 10MB
  static const List<String> allowedImageTypes = ['jpg', 'jpeg', 'png', 'webp'];

  // Dev/demo fallback mode for offline UI checks
  static bool get demoMode =>
      kDebugMode && const bool.fromEnvironment('USE_DEMO_MODE', defaultValue: true);
}
