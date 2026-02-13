# EngiRent Hub - Flutter Mobile App

Complete Flutter mobile application for EngiRent Hub IoT-powered Smart Kiosk System.

## Features

### ✅ **Authentication**
- User registration with student ID validation
- Login with email/password
- JWT token management
- Secure token storage
- Auto-login on app restart

### ✅ **Home & Navigation**
- Bottom navigation (Home, Rentals, Notifications, Profile)
- Welcome dashboard
- Quick actions (List Item, Browse, Scan QR, Rentals)
- Category browsing

### ✅ **Items Management**
- Browse available items with filters
- Search functionality
- Item details with images
- Rating and reviews
- Create new listings (for owners)
- Edit/delete own items

### ✅ **Rental System**
- Book items with date selection
- View rental status (Pending, Active, Completed)
- Rental history
- Active rentals tracking
- Days remaining counter

### ✅ **Kiosk Operations**
- QR code scanner for kiosk access
- Deposit item flow (owners)
- Claim item from locker (renters)
- Return item with image capture
- AI verification integration

### ✅ **Payments**
- GCash payment integration
- Security deposit handling
- Transaction history
- Refund processing

### ✅ **Notifications**
- Real-time push notifications
- In-app notification center
- Unread badge counter
- Notification types:
  - Booking confirmed
  - Item ready for claim
  - Rental started
  - Return reminders
  - Payment updates

### ✅ **Profile & Settings**
- View/edit profile
- Change password
- View rental statistics
- App settings
- Logout

## Architecture

```
lib/
├── core/
│   ├── constants/          # App-wide constants (colors, endpoints, etc.)
│   ├── models/             # Shared data models
│   ├── services/           # API service, storage service
│   └── utils/              # Helper functions
│
├── features/
│   ├── auth/
│   │   ├── screens/        # Login, register screens
│   │   ├── providers/      # Auth state management
│   │   └── models/         # Auth service
│   │
│   ├── home/
│   │   ├── screens/        # Home, navigation
│   │   └── widgets/        # Reusable widgets
│   │
│   ├── items/
│   │   ├── screens/        # Browse, detail, create
│   │   ├── providers/      # Items state
│   │   └── models/         # Item service
│   │
│   ├── rentals/
│   │   ├── screens/        # My rentals, rental detail
│   │   └── providers/      # Rentals state
│   │
│   ├── kiosk/
│   │   ├── screens/        # QR scanner, locker UI
│   │   └── services/       # Kiosk operations
│   │
│   ├── payments/
│   │   ├── screens/        # Payment UI, GCash integration
│   │   └── services/       # Payment service
│   │
│   ├── notifications/
│   │   ├── screens/        # Notification list
│   │   └── services/       # FCM, local notifications
│   │
│   └── profile/
│       ├── screens/        # Profile, settings
│       └── widgets/        # Profile widgets
│
├── shared/
│   └── widgets/            # Shared UI components
│
└── main.dart               # App entry point
```

## State Management

- **Provider** for app-wide state (authentication, items, rentals)
- **ChangeNotifier** for reactive state updates
- **GetIt** for dependency injection

## Dependencies

### Core
- `provider` - State management
- `get_it` - Service locator
- `http` & `dio` - HTTP clients

### UI
- `google_fonts` - Custom fonts
- `cached_network_image` - Image caching
- `flutter_rating_bar` - Rating UI
- `shimmer` - Loading skeletons

### Storage
- `shared_preferences` - Local data
- `flutter_secure_storage` - Secure token storage

### Media
- `image_picker` - Camera/gallery access
- `image_cropper` - Image editing
- `qr_code_scanner` - QR scanning
- `qr_flutter` - QR generation

### Notifications
- `flutter_local_notifications` - Local push

### Forms
- `flutter_form_builder` - Form handling
- `form_builder_validators` - Validation

### Utils
- `intl` - Date formatting
- `timeago` - Relative time
- `url_launcher` - External links
- `permission_handler` - Permissions

## Setup Instructions

### 1. Install Dependencies

```bash
flutter pub get
```

### 2. Configure API Endpoint

Edit `lib/core/constants/app_constants.dart`:

```dart
static const String baseUrl = 'http://YOUR_API_URL:5000/api/v1';
```

### 3. Run the App

**Android:**
```bash
flutter run -d android
```

**iOS:**
```bash
flutter run -d ios
```

### 4. Build Release

**Android APK:**
```bash
flutter build apk --release
```

**iOS:**
```bash
flutter build ios --release
```

## API Integration

The app connects to the EngiRent backend API running on `http://localhost:5000/api/v1`.

### Authentication Flow
1. User logs in → API returns JWT tokens
2. Tokens stored securely in `flutter_secure_storage`
3. All authenticated requests include `Authorization: Bearer <token>` header
4. Automatic token refresh on expiry

### API Endpoints Used
- `/auth/register` - Register new user
- `/auth/login` - Login
- `/auth/profile` - Get user profile
- `/items` - Browse items
- `/items/:id` - Item details
- `/rentals` - My rentals
- `/rentals` (POST) - Create booking
- `/kiosk/deposit` - Deposit item
- `/kiosk/claim` - Claim item
- `/kiosk/return` - Return with verification
- `/notifications` - Get notifications

## Testing

### Unit Tests
```bash
flutter test
```

### Integration Tests
```bash
flutter test integration_test
```

## Platform-Specific Configuration

### Android

**Minimum SDK:** 21 (Android 5.0)

Required permissions in `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

### iOS

**Minimum iOS:** 12.0

Required permissions in `ios/Runner/Info.plist`:
```xml
<key>NSCameraUsageDescription</key>
<string>Required for item verification</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Required to upload item images</string>
```

## Project Status

✅ Authentication system complete  
✅ Home screen and navigation complete  
✅ Core architecture (models, services) complete  
✅ API integration setup complete  
⏳ Items browsing screens (in progress)  
⏳ Rental management screens (planned)  
⏳ Kiosk QR integration (planned)  
⏳ Payment integration (planned)  

## License

MIT License

---

Built with ❤️ for UCLM Engineering Students
