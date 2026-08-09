import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:toastification/toastification.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_controller.dart';
import 'core/models/item_model.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/onboarding/screens/onboarding_screen.dart';
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
  // Mandate §2.3 — resolve the first-run flag before the first frame, so a
  // fresh install opens straight onto onboarding rather than flashing the
  // login screen and then replacing it.
  final showOnboarding = await OnboardingScreen.shouldShow();
  runApp(ToastificationWrapper(child: MyApp(showOnboarding: showOnboarding)));
}

class MyApp extends StatelessWidget {
  const MyApp({super.key, this.showOnboarding = false});

  final bool showOnboarding;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        // Mandate §1.6 — light/dark is a first-class, persisted user choice.
        // `..load()` kicks off the restore without blocking first paint; the
        // controller starts on ThemeMode.system, so the pre-restore frame is
        // already the correct OS-following default rather than a flash of
        // the wrong theme.
        ChangeNotifierProvider(create: (_) => ThemeController()..load()),
      ],
      child: Consumer<ThemeController>(
        builder: (context, themeController, _) => MaterialApp(
          title: 'EngiRent Hub',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          themeMode: themeController.mode,
          initialRoute: showOnboarding ? '/onboarding' : '/login',
          onGenerateRoute: _onGenerateRoute,
          builder: (context, child) {
            // Mandate §1.7. Android's display "Font size" setting goes up to
            // 2.0x (and Samsung/Xiaomi skins go further still). At those
            // scales our labels overflowed their rows and fixed-height
            // elements — the tab bar, the sticky action bar, card headers —
            // clipped or spilled, which is what users on other phones were
            // seeing.
            //
            // Clamping rather than ignoring: honouring scale up to 1.3x
            // covers the large majority of people who enlarge text for real
            // legibility reasons, while keeping layouts intact. The floor
            // stops the "small" setting shrinking captions below readable.
            final media = MediaQuery.of(context);
            return MediaQuery(
              data: media.copyWith(
                textScaler: media.textScaler.clamp(
                  minScaleFactor: 0.9,
                  maxScaleFactor: 1.3,
                ),
              ),
              child: child ?? const SizedBox.shrink(),
            );
          },
        ),
      ),
    );
  }


  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case '/onboarding':
        return MaterialPageRoute(builder: (_) => const OnboardingScreen());
      case '/login':
        return MaterialPageRoute(builder: (_) => const LoginScreen());
      case '/register':
        return MaterialPageRoute(builder: (_) => const RegisterScreen());
      case '/profile/setup':
        return MaterialPageRoute(builder: (_) => const ProfileSetupScreen());
      case '/home':
        return MaterialPageRoute(
          // No ShowCaseWidget wrapper: v5 replaced it with
          // ShowcaseView.register(), which _HomeTabState already calls in
          // initState. Wrapping as well would register the scope twice.
          builder: (_) => const _AuthGuard(child: HomeScreen()),
        );
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
