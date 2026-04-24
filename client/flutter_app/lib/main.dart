import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/constants/app_colors.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/register_screen.dart';
import 'features/auth/screens/profile_setup_screen.dart';
import 'features/home/screens/home_screen.dart';
import 'features/items/screens/create_item_screen.dart';
import 'features/items/screens/items_screen.dart';
import 'features/kiosk/screens/kiosk_scan_screen.dart';
import 'features/rentals/screens/rental_detail_screen.dart';
import 'features/reviews/screens/reviews_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      primary: AppColors.primary,
      secondary: AppColors.secondary,
      error: AppColors.error,
      brightness: Brightness.light,
    );

    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
      ],
      child: MaterialApp(
        title: 'EngiRent Hub',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: colorScheme,
          scaffoldBackgroundColor: AppColors.background,
          appBarTheme: const AppBarTheme(
            centerTitle: false,
            elevation: 0,
            backgroundColor: AppColors.surface,
            foregroundColor: AppColors.textPrimary,
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
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              textStyle: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ),
        initialRoute: '/login',
        onGenerateRoute: _onGenerateRoute,
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
        return MaterialPageRoute(builder: (_) => const _AuthGuard(child: ItemsScreen()));
      case '/items/create':
        return MaterialPageRoute(builder: (_) => const _AuthGuard(child: CreateItemScreen()));
      case '/kiosk/scan':
        return MaterialPageRoute(builder: (_) => const _AuthGuard(child: KioskScanScreen()));
      case '/reviews':
        return MaterialPageRoute(builder: (ctx) {
          final args = settings.arguments as Map<String, String?>? ?? {};
          return _AuthGuard(
            child: ReviewsScreen(itemId: args['itemId'], userId: args['userId']),
          );
        });
    }

    // Dynamic /rentals/:id route
    final uri = Uri.tryParse(settings.name ?? '');
    if (uri != null) {
      final segments = uri.pathSegments;
      if (segments.length == 2 && segments[0] == 'rentals') {
        return MaterialPageRoute(
          builder: (_) => _AuthGuard(child: RentalDetailScreen(rentalId: segments[1])),
        );
      }
    }

    return null;
  }
}

/// Wraps a screen with an auth check. Redirects to /login if not authenticated,
/// or to /profile/setup if authenticated but profile incomplete.
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
