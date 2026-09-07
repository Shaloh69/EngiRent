import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:toastification/toastification.dart';
import 'core/localization/ceb_framework_localizations.dart';
import 'core/theme/design_reference_screen.dart';
import 'core/localization/locale_controller.dart';
import 'core/observability/crash_reporting.dart';
import 'core/services/api_service.dart';
import 'core/services/connectivity_controller.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_controller.dart';
import 'core/utils/toast_utils.dart';
import 'core/widgets/force_update_gate.dart';
import 'core/widgets/offline_banner.dart';
import 'l10n/app_localizations.dart';
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
import 'features/items/screens/my_listings_screen.dart';
import 'features/feedback/screens/feedback_screen.dart';
import 'features/feedback/screens/send_feedback_screen.dart';
import 'features/kiosk/screens/kiosk_scan_screen.dart';
import 'features/rentals/screens/create_rental_screen.dart';
import 'features/rentals/screens/rental_detail_screen.dart';
import 'features/reviews/screens/reviews_screen.dart';

void main() async {
  // Mandate §2.10.1 — crash reporting wraps everything, including startup.
  // A crash while resolving the first-run flag or restoring the theme is
  // exactly the kind that used to be invisible: the app dies on a white
  // screen before any of our own error handling exists.
  await CrashReporting.run(() async {
    WidgetsFlutterBinding.ensureInitialized();
    // Mandate §2.3 — resolve the first-run flag before the first frame, so a
    // fresh install opens straight onto onboarding rather than flashing the
    // login screen and then replacing it.
    final showOnboarding = await OnboardingScreen.shouldShow();
    // Checklist Stage 9 — see _handleSessionExpired's doc comment.
    ApiService.onSessionExpired = _handleSessionExpired;
    runApp(ToastificationWrapper(child: MyApp(showOnboarding: showOnboarding)));
  });
}

// Checklist Stage 9 — lets the session-expiry handler navigate and show a
// toast from inside ApiService, which is a plain class with no
// BuildContext of its own.
final _rootNavigatorKey = GlobalKey<NavigatorState>();

// Guarded so a burst of concurrent 401s (several in-flight requests failing
// around the same moment) only navigates/toasts once, not once per request.
bool _sessionExpiryHandled = false;

void _handleSessionExpired() {
  if (_sessionExpiryHandled) return;
  final ctx = _rootNavigatorKey.currentContext;
  if (ctx == null) return;
  _sessionExpiryHandled = true;
  Provider.of<AuthProvider>(ctx, listen: false).logout();
  _rootNavigatorKey.currentState?.pushNamedAndRemoveUntil('/login', (_) => false);
  WidgetsBinding.instance.addPostFrameCallback((_) {
    final toastCtx = _rootNavigatorKey.currentContext;
    if (toastCtx != null) {
      AppToast.info(toastCtx, 'Session expired', 'Please sign in again to continue.');
    }
    _sessionExpiryHandled = false;
  });
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
        // Checklist Stage 9 — same load-without-blocking-first-paint pattern
        // as ThemeController above; starts on the system locale so the
        // pre-restore frame already matches whatever was persisted, or the
        // device default when nothing was.
        ChangeNotifierProvider(create: (_) => LocaleController()..load()),
        // Singleton (see connectivity_controller.dart's doc comment for why)
        // — .value registers the existing instance rather than creating a
        // second one, so ApiService's reportRequestOutcome() calls and this
        // widget tree stay in sync.
        ChangeNotifierProvider.value(
          value: ConnectivityController.instance..start(),
        ),
      ],
      child: Consumer2<ThemeController, LocaleController>(
        builder: (context, themeController, localeController, _) => MaterialApp(
          title: 'EngiRent Hub',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          themeMode: themeController.mode,
          // Checklist Stage 9 — null means "no explicit choice", which
          // MaterialApp resolves against supportedLocales the same way it
          // would without a `locale` argument at all: device locale if
          // supported, English otherwise.
          locale: localeController.locale,
          // Bug found via a live user report: switching to Bisaya crashed
          // to a blank white screen — flutter_localizations has no Cebuano
          // Material/Cupertino/Widgets data at all, and the framework
          // delegate's load() force-unwraps a null lookup for it. The
          // cebFrameworkLocalizationsDelegates fill that specific gap; see
          // their doc comment for the full mechanism. Filipino needs none
          // of this — flutter_localizations ships real `fil` data already.
          localizationsDelegates: [
            ...AppLocalizations.localizationsDelegates,
            ...cebFrameworkLocalizationsDelegates,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          navigatorKey: _rootNavigatorKey,
          // E3's definition of done asks for a reference screen per surface
          // that renders every token and every status state. Reaching a real
          // status chip in this app needs a live tunnel, a verified account and
          // a rental in the right state, so the reference screen is opened
          // directly instead:
          //
          //   flutter run --dart-define=DESIGN_REFERENCE=1
          //
          // Debug builds only, linked from nowhere, shipped to nobody.
          initialRoute:
              kDebugMode && const bool.fromEnvironment('DESIGN_REFERENCE')
                  ? '/design-reference'
                  : (showOnboarding ? '/onboarding' : '/login'),
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
              // Checklist Stage 9 — outermost, so a blocked build shows
              // only the update screen, not the offline banner underneath
              // it too.
              child: ForceUpdateGate(
                // Checklist Stage 4.1 — one banner, wrapping every screen
                // via this single builder, rather than something each
                // screen has to remember to add. Column+Expanded rather
                // than a Stack overlay so the banner actually pushes
                // content down instead of covering the first ~24px of
                // every screen.
                child: Column(
                  children: [
                    const OfflineBanner(),
                    Expanded(child: child ?? const SizedBox.shrink()),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }


  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      // E3 token reference. Debug-only and unreachable from the UI — see the
      // initialRoute comment above.
      case '/design-reference':
        return MaterialPageRoute(builder: (_) => const DesignReferenceScreen());
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
      case '/items/mine':
        // Checklist Stage 2.1 — GET /items/my-items existed and was never
        // called; an owner could publish a listing and then never see it
        // again. This is the screen that finally shows it back to them.
        return MaterialPageRoute(builder: (_) => const _AuthGuard(child: MyListingsScreen()));
      case '/feedback':
        return MaterialPageRoute(builder: (_) => const _AuthGuard(child: FeedbackScreen()));
      case '/feedback/new':
        // Contextual entry (checklist 3.2) — a failed kiosk scan, a payment
        // error, or a disputed rental pushes straight to compose with
        // category/rentalId/kioskId already filled in, skipping the list.
        final args = settings.arguments as Map<String, dynamic>? ?? {};
        return MaterialPageRoute(
          builder: (_) => _AuthGuard(
            child: SendFeedbackScreen(
              initialCategory: args['category'] as String?,
              initialBody: args['body'] as String?,
              contextNote: args['contextNote'] as String?,
              screen: args['screen'] as String?,
              rentalId: args['rentalId'] as String?,
              kioskId: args['kioskId'] as String?,
            ),
          ),
        );
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
