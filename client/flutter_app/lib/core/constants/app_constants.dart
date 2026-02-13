class AppConstants {
  // API Configuration
  static const String baseUrl = 'http://localhost:5000/api/v1';
  static const String mlServiceUrl = 'http://localhost:8001/api/v1';

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
    'AWAITING_CLAIM': 'Awaiting Claim',
    'ACTIVE': 'Active',
    'AWAITING_RETURN': 'Awaiting Return',
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
}
