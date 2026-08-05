import 'package:flutter/foundation.dart';

class AppConstants {
  // API Configuration — build-configurable via --dart-define, e.g.:
  //   flutter build apk --dart-define=API_BASE_URL=http://desktop-gklhcri:5000/api/v1
  // Falls back to the current production (Render) URL so existing build
  // commands without --dart-define keep working exactly as before; update
  // the fallback once the Phase 0.5 PC-hosting migration is live and the
  // default should point there instead.
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://engirent-api.onrender.com/api/v1',
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
  static const String appVersion = '1.0.0';

  // Default Values
  static const int defaultPageSize = 10;
  static const int maxImageSize = 10485760; // 10MB
  static const List<String> allowedImageTypes = ['jpg', 'jpeg', 'png', 'webp'];

  // Dev/demo fallback mode for offline UI checks
  static bool get demoMode =>
      kDebugMode && const bool.fromEnvironment('USE_DEMO_MODE', defaultValue: true);
}
