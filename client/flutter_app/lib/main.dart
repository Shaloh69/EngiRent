import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:toastification/toastification.dart';
import 'core/constants/app_colors.dart';
import 'core/models/item_model.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/register_screen.dart';
import 'features/auth/screens/profile_setup_screen.dart';
import 'features/home/screens/home_screen.dart';
import 'features/items/screens/create_item_screen.dart';
import 'features/items/screens/item_detail_screen.dart';
import 'features/items/screens/items_screen.dart';
import 'features/kiosk/screens/kiosk_scan_screen.dart';
import 'features/rentals/screens/create_rental_screen.dart';
import 'features/rentals/screens/rental_detail_screen.dart';
import 'features/reviews/screens/reviews_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ToastificationWrapper(child: MyApp()));
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
      ],
      child: MaterialApp(
        title: 'EngiRent Hub',
        debugShowCheckedModeBanner: false,
        theme: _buildTheme(),
        initialRoute: '/login',
        onGenerateRoute: _onGenerateRoute,
      ),
    );
  }

  ThemeData _buildTheme() {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      primary: AppColors.primary,
      secondary: AppColors.secondary,
      tertiary: AppColors.accent,
      error: AppColors.error,
      brightness: Brightness.light,
      surface: AppColors.surface,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.background,
      fontFamily: 'Inter',
      appBarTheme: const AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        titleTextStyle: TextStyle(
          color: AppColors.textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.white,
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        selectedItemColor: AppColors.primary,
        unselectedItemColor: AppColors.grey,
        backgroundColor: AppColors.surface,
        elevation: 0,
        selectedLabelStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 11),
        unselectedLabelStyle: TextStyle(fontSize: 11),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.greyLight,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        side: BorderSide.none,
      ),
    );
  }

  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case '/login':
        return MaterialPageRoute(builder: (_) => const LoginScreen());
      case '/register':
        return MaterialPageRoute(builder: (_) => const RegisterScreen());
      case '/profile/setup':
        return MaterialPageRoute(builder: (_) => const ProfileSetupScreen());
      case '/home':
        return MaterialPageRoute(builder: (_) => const _AuthGuard(child: HomeScreen()));
      case '/items':
      case '/items/search':
        final itemsArgs = settings.arguments as Map<String, dynamic>? ?? {};
        final category = itemsArgs['category'] as String?;
        return MaterialPageRoute(
          builder: (_) => _AuthGuard(child: ItemsScreen(category: category)),
        );
      case '/items/create':
        return MaterialPageRoute(builder: (_) => const _AuthGuard(child: CreateItemScreen()));
      case '/kiosk/scan':
        final kioskArgs = settings.arguments as Map<String, dynamic>? ?? {};
        final kioskRentalId = kioskArgs['rentalId'] as String? ?? '';
        final kioskMode = kioskArgs['mode'] as String? ?? 'place';
        return MaterialPageRoute(
          builder: (_) => _AuthGuard(
            child: KioskScanScreen(rentalId: kioskRentalId, mode: kioskMode),
          ),
        );
      case '/rentals/create':
        final args = settings.arguments as Map<String, dynamic>? ?? {};
        final item = args['item'] as ItemModel?;
        if (item == null) return null;
        return MaterialPageRoute(
          builder: (_) => _AuthGuard(child: CreateRentalScreen(item: item)),
        );
      case '/reviews':
        final args = settings.arguments as Map<String, String?>? ?? {};
        return MaterialPageRoute(
          builder: (ctx) => _AuthGuard(
            child: ReviewsScreen(itemId: args['itemId'], userId: args['userId']),
          ),
        );
    }

    final uri = Uri.tryParse(settings.name ?? '');
    if (uri != null) {
      final seg = uri.pathSegments;

      // /rentals/:id
      if (seg.length == 2 && seg[0] == 'rentals') {
        return MaterialPageRoute(
          builder: (_) => _AuthGuard(child: RentalDetailScreen(rentalId: seg[1])),
        );
      }

      // /items/:id  (must come after /items/create & /items/search)
      if (seg.length == 2 && seg[0] == 'items' && seg[1] != 'create' && seg[1] != 'search') {
        final args = settings.arguments as Map<String, dynamic>? ?? {};
        final item = args['item'] as ItemModel?;
        if (item != null) {
          return MaterialPageRoute(
            builder: (_) => _AuthGuard(child: ItemDetailScreen(item: item)),
          );
        }
      }
    }

    return null;
  }
}

class _AuthGuard extends StatelessWidget {
  final Widget child;
  const _AuthGuard({required this.child});

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (!auth.isAuthenticated) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            Navigator.pushNamedAndRemoveUntil(context, '/login', (_) => false);
          });
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (auth.user != null && !auth.user!.profileComplete) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            Navigator.pushNamedAndRemoveUntil(context, '/profile/setup', (_) => false);
          });
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        return child;
      },
    );
  }
}
