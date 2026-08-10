import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import '../../../core/observability/crash_reporting.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../../core/constants/app_colors.dart';
import '../../../core/models/notification_model.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:showcaseview/showcaseview.dart';
import '../../../core/models/item_model.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/widgets/item_card.dart';
import '../../items/screens/item_detail_screen.dart';
import '../../../core/theme/theme_controller.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_avatar.dart';
import '../../../core/widgets/rental_widgets.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/stale_data_banner.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../l10n/app_localizations.dart';
import '../../../core/localization/locale_controller.dart';
import '../../auth/providers/auth_provider.dart';
import '../../auth/screens/edit_profile_screen.dart';
import 'account_activity_screen.dart';
import '../../notifications/models/notification_service.dart';
import '../../notifications/screens/notification_preferences_screen.dart';
import '../../payments/screens/payout_details_screen.dart';
import '../../payments/screens/transaction_history_screen.dart';
import '../../rentals/models/rental_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;

  void _goToRentals() => setState(() => _currentIndex = 1);

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final l10n = AppLocalizations.of(context)!;
    final pages = [
      _HomeTab(onGoToRentals: _goToRentals),
      const _RentalsTab(),
      const _NotificationsTab(),
      const _ProfileTab(),
    ];

    return Scaffold(
      body: pages[_currentIndex],
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: p.surface,
          border: Border(top: BorderSide(color: p.border)),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: 0.06),
              blurRadius: 12,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (i) => setState(() => _currentIndex = i),
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.transparent,
          elevation: 0,
          selectedItemColor: AppColors.primary,
          unselectedItemColor: p.muted,
          items: [
            BottomNavigationBarItem(icon: const Icon(Icons.home_filled), label: l10n.navHome),
            BottomNavigationBarItem(icon: const Icon(Icons.receipt_long), label: l10n.navRentals),
            BottomNavigationBarItem(icon: const Icon(Icons.notifications), label: l10n.navAlerts),
            BottomNavigationBarItem(icon: const Icon(Icons.person), label: l10n.navProfile),
          ],
        ),
      ),
    );
  }
}

// ── Home Tab ─────────────────────────────────────────────────────────────────
class _HomeTab extends StatefulWidget {
  final VoidCallback onGoToRentals;
  const _HomeTab({required this.onGoToRentals});

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<_HomeTab> {
  // Mandate §2.3 (part 2) — the "?" tour targets. Each key is attached to a
  // real control below, so the tour highlights the actual button rather than
  // describing it in the abstract.
  final _kBrowse = GlobalKey();
  final _kList = GlobalKey();
  final _kKiosk = GlobalKey();
  final _kRentals = GlobalKey();
  final _kHelp = GlobalKey();

  static const _tourSeenKey = 'engirent_home_tour_seen';

  final _api = ApiService();
  List<ItemModel> _featured = [];
  bool _loadingFeatured = true;
  String? _featuredError;

  @override
  void initState() {
    super.initState();
    ShowcaseView.register(
      autoPlayDelay: const Duration(seconds: 4),
      globalTooltipActionConfig: const TooltipActionConfig(
        position: TooltipActionPosition.inside,
        alignment: MainAxisAlignment.spaceBetween,
        actionGap: 16,
      ),
    );
    _loadFeatured();
    _maybeAutoStartTour();
  }

  /// Runs the tour automatically the first time Home is reached, then only on
  /// demand from "?". Persisted so it doesn't re-run on every launch.
  Future<void> _maybeAutoStartTour() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getBool(_tourSeenKey) ?? false) return;
      await prefs.setBool(_tourSeenKey, true);
    } catch (_) {
      return; // never let a prefs failure trigger a surprise tour
    }
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) => _startTour());
  }

  void _startTour() {
    if (!mounted) return;
    ShowcaseView.get().startShowCase(
      [_kBrowse, _kList, _kKiosk, _kRentals, _kHelp],
    );
  }

  Future<void> _loadFeatured() async {
    setState(() => _featuredError = null);
    try {
      final resp = await _api.get('/items?page=1&limit=6', authenticated: false);
      final data = jsonDecode(resp.body);
      if (!mounted) return;
      if (resp.statusCode == 200 && data['success'] == true) {
        setState(() {
          _featured = (data['data']['items'] as List<dynamic>)
              .map((j) => ItemModel.fromJson(j as Map<String, dynamic>))
              .toList();
          _loadingFeatured = false;
        });
      } else {
        setState(() {
          _loadingFeatured = false;
          _featuredError = data['error'] as String? ?? 'Failed to load equipment';
        });
      }
    } catch (e) {
      // Distinct from "nothing listed yet" — an empty _featured list from a
      // failed request used to render the exact same "be the first to list"
      // message as a genuinely empty catalog, which is actively misleading
      // during a real outage (mandate §2.10.1: no dead ends).
      if (mounted) {
        setState(() {
          _loadingFeatured = false;
          _featuredError = friendlyErrorMessage(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final l10n = AppLocalizations.of(context)!;
    final user = context.watch<AuthProvider>().user;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: RefreshIndicator(
        onRefresh: _loadFeatured,
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              expandedHeight: 150,
              pinned: true,
              backgroundColor: AppColors.primaryDark,
              foregroundColor: AppColors.white,
              actions: [
                // Mandate §2.3 — always-available help. Wrapped in its own
                // Showcase so the tour finishes by pointing at the way to
                // replay itself.
                Showcase(
                  key: _kHelp,
                  title: 'Need a refresher?',
                  description:
                      'Tap here any time to replay this walkthrough.',
                  targetBorderRadius: AppRadius.card,
                  tooltipBackgroundColor: p.surface,
                  textColor: p.ink,
                  tooltipBorderRadius: AppRadius.card,
                  child: IconButton(
                    icon: const Icon(Icons.help_outline_rounded),
                    tooltip: 'How this works',
                    onPressed: _startTour,
                  ),
                ),
                const SizedBox(width: AppSpacing.hair),
              ],
              flexibleSpace: FlexibleSpaceBar(
                background: Container(
                  decoration: const BoxDecoration(gradient: AppColors.primaryGradient),
                  padding: const EdgeInsets.fromLTRB(20, 60, 20, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Text(
                        'Hello, ${user?.firstName ?? "Student"} 👋',
                        style: const TextStyle(
                          color: AppColors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'What would you like to do today?',
                        style: TextStyle(color: Colors.white70, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                // No FlexibleSpaceBar.title — it renders bottom-aligned in the
                // same space as the greeting and doesn't reliably fade out,
                // which collided with "Hello, {name}" (caught by screenshot,
                // invisible in a code read).
              ),
            ),

            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  // Mandate §2.2 — the 2×2 grid of equal squares is gone.
                  // Browsing is the primary action and gets a full-width
                  // panel; the other three are secondary and share a row.
                  Showcase(
                    key: _kBrowse,
                    title: 'Find equipment',
                    description:
                        'Browse what other students have listed — calculators, kits, lab gear.',
                    targetBorderRadius: AppRadius.card,
                    tooltipBackgroundColor: p.surface,
                    textColor: p.ink,
                    tooltipBorderRadius: AppRadius.card,
                    child: _PrimaryAction(
                      onTap: () => Navigator.pushNamed(context, '/items'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),

                  Row(
                    children: [
                      Expanded(
                        child: Showcase(
                          key: _kList,
                          title: 'Earn from your gear',
                          description:
                              'List something you own so other students can rent it.',
                          targetBorderRadius: AppRadius.card,
                          tooltipBackgroundColor: p.surface,
                          textColor: p.ink,
                          tooltipBorderRadius: AppRadius.card,
                          child: _SecondaryAction(
                            icon: Icons.add_box_outlined,
                            label: l10n.listAnItem,
                            color: AppColors.secondary,
                            onTap: () =>
                                Navigator.pushNamed(context, '/items/create'),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      Expanded(
                        child: Showcase(
                          key: _kKiosk,
                          title: 'At the locker',
                          description:
                              'Scan the kiosk QR to drop off or collect an item.',
                          targetBorderRadius: AppRadius.card,
                          tooltipBackgroundColor: p.surface,
                          textColor: p.ink,
                          tooltipBorderRadius: AppRadius.card,
                          child: _SecondaryAction(
                            icon: Icons.qr_code_scanner_rounded,
                            label: l10n.scanKiosk,
                            color: AppColors.accent,
                            onTap: () =>
                                Navigator.pushNamed(context, '/kiosk/scan'),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      Expanded(
                        child: Showcase(
                          key: _kRentals,
                          title: 'Track your rentals',
                          description:
                              'See what you\'ve borrowed and what\'s due back.',
                          targetBorderRadius: AppRadius.card,
                          tooltipBackgroundColor: p.surface,
                          textColor: p.ink,
                          tooltipBorderRadius: AppRadius.card,
                          child: _SecondaryAction(
                            icon: Icons.receipt_long_rounded,
                            label: l10n.myRentalsAction,
                            color: AppColors.info,
                            onTap: widget.onGoToRentals,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      // Stage 2.1 — an owner could publish a listing and then
                      // never see it again: no edit, no unlist, no delete, no
                      // "did anyone rent this" visibility at all. Not part of
                      // the onboarding tour's fixed five steps, so plain
                      // rather than Showcase-wrapped.
                      Expanded(
                        child: _SecondaryAction(
                          icon: Icons.inventory_2_rounded,
                          label: l10n.myListingsAction,
                          color: AppColors.secondary,
                          onTap: () => Navigator.pushNamed(context, '/items/mine'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  SectionLabel(
                    l10n.browseByCategory,
                    trailing: GestureDetector(
                      onTap: () => Navigator.pushNamed(context, '/items'),
                      child: Text(
                        l10n.seeAll,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: p.primary,
                        ),
                      ),
                    ),
                  ),
                ]),
              ),
            ),

            // Category rail is full-bleed, so it can scroll past the screen
            // edge the way a real shopping app's does.
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.lg),
                child: CategoryRail(
                  selected: null,
                  onSelect: (key) => Navigator.pushNamed(
                    context,
                    '/items',
                    arguments: {'category': key},
                  ),
                ),
              ),
            ),

            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              sliver: SliverToBoxAdapter(
                child: SectionLabel('Recently listed'),
              ),
            ),

            // Featured grid — Home now shows real inventory instead of only
            // navigation. A marketplace home page with no products on it is
            // the main thing that made this screen feel empty.
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, 0, AppSpacing.md, AppSpacing.xl),
              sliver: _loadingFeatured
                  ? SliverGrid(
                      gridDelegate: _homeGrid(context),
                      delegate: SliverChildBuilderDelegate(
                        (_, __) => const ItemCardSkeleton(),
                        childCount: 4,
                      ),
                    )
                  : _featuredError != null
                      ? SliverToBoxAdapter(
                          child: AppCard(
                            child: Row(
                              children: [
                                Icon(Icons.wifi_off_rounded,
                                    color: p.muted, size: 20),
                                const SizedBox(width: AppSpacing.sm),
                                Expanded(
                                  child: Text(
                                    _featuredError!,
                                    style: TextStyle(
                                        fontSize: 13, color: p.muted),
                                  ),
                                ),
                                TextButton(
                                  onPressed: _loadFeatured,
                                  child: Text(l10n.retry),
                                ),
                              ],
                            ),
                          ),
                        )
                      : _featured.isEmpty
                      ? SliverToBoxAdapter(
                          child: AppCard(
                            child: Row(
                              children: [
                                Icon(Icons.inventory_2_outlined,
                                    color: p.muted, size: 20),
                                const SizedBox(width: AppSpacing.sm),
                                Expanded(
                                  child: Text(
                                    'Nothing listed yet — be the first.',
                                    style: TextStyle(
                                        fontSize: 13, color: p.muted),
                                  ),
                                ),
                                TextButton(
                                  onPressed: () => Navigator.pushNamed(
                                      context, '/items/create'),
                                  child: const Text('List'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : SliverGrid(
                          gridDelegate: _homeGrid(context),
                          delegate: SliverChildBuilderDelegate(
                            (context, i) => Stagger(
                              index: i,
                              child: ItemCard(
                                item: _featured[i],
                                onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        ItemDetailScreen(item: _featured[i]),
                                  ),
                                ),
                              ),
                            ),
                            childCount: _featured.length,
                          ),
                        ),
            ),
          ],
        ),
      ),
    );
  }

  SliverGridDelegate _homeGrid(BuildContext context) =>
      itemGridDelegate(context);
}

/// The one action most people open the app to do. Full width, illustrated,
/// and visually dominant — the opposite of the previous four-equal-squares
/// arrangement that gave "browse" the same weight as "scan kiosk".
class _PrimaryAction extends StatelessWidget {
  const _PrimaryAction({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.card,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            gradient: AppColors.primaryGradient,
            borderRadius: AppRadius.card,
          ),
          child: Row(
            children: [
              Container(
                height: 44,
                width: 44,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  borderRadius: AppRadius.button,
                ),
                child: const Icon(Icons.search_rounded,
                    color: Colors.white, size: 22),
              ),
              const SizedBox(width: AppSpacing.sm),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Find equipment to rent',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Browse what students near you have listed',
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.arrow_forward_rounded,
                  color: Colors.white, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

/// Secondary actions — compact, equal to each other but clearly subordinate
/// to the primary panel above.
class _SecondaryAction extends StatelessWidget {
  const _SecondaryAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
          vertical: AppSpacing.sm, horizontal: AppSpacing.xs),
      child: Column(
        children: [
          Container(
            height: 34,
            width: 34,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.13),
              borderRadius: AppRadius.button,
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              height: 1.2,
              color: p.ink,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Rentals Tab ──────────────────────────────────────────────────────────────

class _RentalsTab extends StatefulWidget {
  const _RentalsTab();

  @override
  State<_RentalsTab> createState() => _RentalsTabState();
}

class _RentalsTabState extends State<_RentalsTab> {
  String? _filter;
  final _service = RentalService();
  bool _loading = true;
  String? _error;
  List<RentalModel> _rentals = [];
  StreamSubscription<Map<String, dynamic>>? _socketSub;
  // Checklist Stage 4.2
  bool _stale = false;
  DateTime? _cachedAt;

  @override
  void initState() {
    super.initState();
    _load();
    _socketSub = SocketService.instance.onAnyRentalChange.listen((_) => _load());
  }

  @override
  void dispose() {
    _socketSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    final result = await _service.getRentals();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success'] == true) {
        _rentals = result['rentals'] as List<RentalModel>;
        _stale = result['stale'] == true;
        _cachedAt = result['cachedAt'] as DateTime?;
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    // Order-history layout (mandate §2.2), modelled on the FlutterShop /
    // order_status references: thumbnail, title, status, dates and money all
    // legible in one row, with a filter rail so "what do I still have out"
    // doesn't require reading the whole list.
    final l10n = AppLocalizations.of(context)!;
    final visible = _filter == null
        ? _rentals
        : _rentals.where((r) => _filterMatches(r.status)).toList();

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: Text(l10n.myRentalsTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _load,
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: Column(
        children: [
          _RentalFilterRail(
            selected: _filter,
            onSelect: (v) => setState(() => _filter = v),
          ),
          if (_stale && _cachedAt != null) StaleDataBanner(cachedAt: _cachedAt!),
          const SizedBox(height: AppSpacing.xs),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _loading
                  ? ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      itemCount: 4,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: AppSpacing.xs),
                      itemBuilder: (_, __) => const RentalCardSkeleton(),
                    )
                  : _error != null
                      ? AppEmptyState(
                          icon: Icons.wifi_off_rounded,
                          title: l10n.couldNotLoadRentals,
                          body: _error,
                          action: OutlinedButton(
                            onPressed: _load,
                            child: Text(l10n.tryAgain),
                          ),
                        )
                      : visible.isEmpty
                          ? AppEmptyState(
                              icon: Icons.receipt_long_outlined,
                              title: _filter == null
                                  ? l10n.noRentalsYet
                                  : 'Nothing in this filter',
                              body: _filter == null
                                  ? 'Browse equipment to start your first rental.'
                                  : 'Try a different filter to see your other rentals.',
                              action: _filter == null
                                  ? ElevatedButton(
                                      onPressed: () => Navigator.pushNamed(
                                          context, '/items'),
                                      child: Text(l10n.browseEquipment),
                                    )
                                  : OutlinedButton(
                                      onPressed: () =>
                                          setState(() => _filter = null),
                                      child: const Text('Show all'),
                                    ),
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(
                                  AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                              itemCount: visible.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: AppSpacing.xs),
                              itemBuilder: (context, index) {
                                final rental = visible[index];
                                return Stagger(
                                  index: index,
                                  child: RentalCard(
                                    rental: rental,
                                    onTap: () => Navigator.pushNamed(
                                            context, '/rentals/${rental.id}')
                                        .then((_) => _load()),
                                  ),
                                );
                              },
                            ),
            ),
          ),
        ],
      ),
    );
  }

  /// Groups the eight lifecycle statuses into the three questions a renter
  /// actually asks: what's coming, what do I have, what's finished.
  bool _filterMatches(String status) => switch (_filter) {
        'active' => status == 'ACTIVE' || status == 'DEPOSITED',
        'upcoming' =>
          status == 'PENDING' || status == 'AWAITING_DEPOSIT',
        'past' => status == 'COMPLETED' ||
            status == 'CANCELLED' ||
            status == 'DISPUTED' ||
            status == 'VERIFICATION',
        _ => true,
      };
}

// ── Notifications Tab ────────────────────────────────────────────────────────

class _NotificationsTab extends StatefulWidget {
  const _NotificationsTab();

  @override
  State<_NotificationsTab> createState() => _NotificationsTabState();
}

class _NotificationsTabState extends State<_NotificationsTab> {
  final _service = NotificationService();
  bool _loading = true;
  String? _error;
  List<NotificationModel> _notifications = [];
  StreamSubscription<Map<String, dynamic>>? _socketSub;
  bool _unreadOnly = false;

  @override
  void initState() {
    super.initState();
    _load();
    _socketSub = SocketService.instance.onAnyRentalChange.listen((_) => _load());
  }

  @override
  void dispose() {
    _socketSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    final result = await _service.getNotifications();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success'] == true) {
        _notifications = result['notifications'] as List<NotificationModel>;
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  IconData _notifIcon(String type) => switch (type) {
        'BOOKING_CONFIRMED' => Icons.check_circle_outline_rounded,
        'ITEM_READY_FOR_CLAIM' => Icons.inbox_rounded,
        'RENTAL_STARTED' => Icons.play_circle_outline_rounded,
        'RENTAL_DUE_SOON' => Icons.schedule_rounded,
        'RENTAL_OVERDUE' => Icons.warning_amber_rounded,
        'PAYMENT_RECEIVED' || 'PAYOUT_SENT' => Icons.payments_outlined,
        'DEPOSIT_REFUNDED' => Icons.savings_outlined,
        'REVIEW_RECEIVED' => Icons.star_outline_rounded,
        'DISPUTE_OPENED' => Icons.gavel_rounded,
        _ => Icons.notifications_none_rounded,
      };

  Color _notifColor(String type) => switch (type) {
        'BOOKING_CONFIRMED' ||
        'PAYMENT_RECEIVED' ||
        'PAYOUT_SENT' ||
        'DEPOSIT_REFUNDED' =>
          AppColors.success,
        'ITEM_READY_FOR_CLAIM' => AppColors.accent,
        'RENTAL_STARTED' => AppColors.primary,
        'RENTAL_DUE_SOON' => AppColors.warning,
        'RENTAL_OVERDUE' || 'DISPUTE_OPENED' => AppColors.error,
        'REVIEW_RECEIVED' => AppColors.secondary,
        _ => AppColors.info,
      };

  /// Buckets notifications by recency. A flat reverse-chronological list gives
  /// no sense of whether something needs attention now or happened last week —
  /// date headers are how every mature inbox solves that.
  String _bucketOf(DateTime when) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(when.year, when.month, when.day);
    final diff = today.difference(day).inDays;
    if (diff <= 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    if (diff < 7) return 'This week';
    if (diff < 30) return 'This month';
    return 'Earlier';
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final unread = _notifications.where((n) => !n.isRead).length;
    final visible =
        _unreadOnly ? _notifications.where((n) => !n.isRead).toList() : _notifications;

    // Build a flat render list of headers + rows so a single ListView keeps
    // scrolling cheap on long histories.
    final rows = <Widget>[];
    String? lastBucket;
    for (var i = 0; i < visible.length; i++) {
      final n = visible[i];
      final bucket = _bucketOf(n.createdAt);
      if (bucket != lastBucket) {
        rows.add(Padding(
          padding: EdgeInsets.only(
              top: lastBucket == null ? 0 : AppSpacing.md, bottom: AppSpacing.xs),
          child: SectionLabel(bucket),
        ));
        lastBucket = bucket;
      }
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.xs),
        child: Stagger(
          index: i,
          child: _NotificationRow(
            notification: n,
            icon: _notifIcon(n.type),
            color: _notifColor(n.type),
            onTap: () async {
              if (!n.isRead) {
                await _service.markRead(n.id);
                _load();
              }
            },
          ),
        ),
      ));
    }

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (unread > 0)
            TextButton(
              onPressed: () async {
                await _service.markAllRead();
                _load();
              },
              child: const Text('Mark all read'),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? ListView(
                padding: const EdgeInsets.all(AppSpacing.md),
                children: const [
                  _NotificationSkeleton(),
                  SizedBox(height: AppSpacing.xs),
                  _NotificationSkeleton(),
                  SizedBox(height: AppSpacing.xs),
                  _NotificationSkeleton(),
                ],
              )
            : _error != null
                ? AppEmptyState(
                    icon: Icons.wifi_off_rounded,
                    title: 'Couldn\'t load notifications',
                    body: _error,
                    action: OutlinedButton(
                      onPressed: _load,
                      child: const Text('Try again'),
                    ),
                  )
                : _notifications.isEmpty
                    ? const AppEmptyState(
                        icon: Icons.notifications_none_rounded,
                        title: 'You\'re all caught up',
                        body:
                            'Updates about your rentals — payments, locker codes, '
                            'return reminders — show up here.',
                      )
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(AppSpacing.md,
                            AppSpacing.md, AppSpacing.md, AppSpacing.lg),
                        children: [
                          // Unread filter, shown only when it would do anything.
                          if (unread > 0 || _unreadOnly) ...[
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: AppSpacing.xs, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: p.primary.withValues(alpha: 0.12),
                                    borderRadius: AppRadius.input,
                                  ),
                                  child: MonoText(
                                    '$unread UNREAD',
                                    size: 10.5,
                                    color: p.primary,
                                  ),
                                ),
                                const Spacer(),
                                GestureDetector(
                                  onTap: () =>
                                      setState(() => _unreadOnly = !_unreadOnly),
                                  child: Row(
                                    children: [
                                      Icon(
                                        _unreadOnly
                                            ? Icons.check_box_rounded
                                            : Icons.check_box_outline_blank_rounded,
                                        size: 16,
                                        color: _unreadOnly ? p.primary : p.muted,
                                      ),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Unread only',
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: _unreadOnly ? p.primary : p.muted,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSpacing.md),
                          ],
                          if (visible.isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                  vertical: AppSpacing.xxl),
                              child: Text(
                                'Nothing unread.',
                                textAlign: TextAlign.center,
                                style: TextStyle(fontSize: 13, color: p.muted),
                              ),
                            )
                          else
                            ...rows,
                        ],
                      ),
      ),
    );
  }
}

/// A single notification. Unread state is carried by a left accent bar and
/// weight rather than a tinted background — the old tinted card was nearly
/// invisible in dark mode, where a 4% white overlay reads as noise.
class _NotificationRow extends StatelessWidget {
  const _NotificationRow({
    required this.notification,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final NotificationModel notification;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final unread = !notification.isRead;

    return AppCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      borderColor: unread ? color.withValues(alpha: 0.45) : null,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 3, color: unread ? color : Colors.transparent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.sm),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.12),
                        borderRadius: AppRadius.input,
                      ),
                      child: Icon(icon, color: color, size: 17),
                    ),
                    const SizedBox(width: AppSpacing.xs + 2),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Text(
                                  notification.title,
                                  style: TextStyle(
                                    fontWeight:
                                        unread ? FontWeight.w800 : FontWeight.w600,
                                    fontSize: 13.5,
                                    height: 1.25,
                                    color: p.ink,
                                  ),
                                ),
                              ),
                              const SizedBox(width: AppSpacing.xs),
                              Text(
                                timeago.format(notification.createdAt,
                                    allowFromNow: true, locale: 'en_short'),
                                style: TextStyle(fontSize: 10.5, color: p.muted),
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            notification.message,
                            style: TextStyle(
                                fontSize: 12.5, height: 1.4, color: p.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationSkeleton extends StatelessWidget {
  const _NotificationSkeleton();

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 31,
            height: 31,
            decoration: BoxDecoration(
                color: p.surfaceAlt, borderRadius: AppRadius.input),
          ),
          const SizedBox(width: AppSpacing.xs + 2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(height: 11, width: 140, color: p.surfaceAlt),
                const SizedBox(height: AppSpacing.xs),
                Container(height: 9, width: double.infinity, color: p.surfaceAlt),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Profile Tab ──────────────────────────────────────────────────────────────

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final l10n = AppLocalizations.of(context)!;
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Avatar card
          // Identity card. The gradient hero this replaces is banned by
          // mandate §1.1, and it also buried the one thing this header should
          // answer: whether this account is actually verified.
          AppCard(
            child: Row(
              children: [
                // AppAvatar rather than a bare NetworkImage: the avatar
                // endpoint requires a Bearer token, so the previous version
                // 401'd and rendered an empty circle whenever a photo existed.
                AppAvatar(
                  name: '${user?.firstName ?? ''} ${user?.lastName ?? ''}',
                  imageUrl: user?.profileImage,
                  radius: 30,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.fullName ?? 'Student',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.3,
                          color: p.ink,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        user?.email ?? '',
                        style: TextStyle(fontSize: 12, color: p.muted),
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Row(
                        children: [
                          if (user != null && user.studentId.isNotEmpty) ...[
                            MonoText(
                              user.studentId,
                              size: 11,
                              color: p.muted,
                            ),
                            const SizedBox(width: AppSpacing.xs),
                          ],
                          // Reflects the real isVerified flag. The old row
                          // read "Identity Verified" unconditionally, which
                          // told unverified users the opposite of the truth.
                          StatusPill(
                            label: _verifyLabel(user?.verificationStatus,
                                user?.isVerified ?? false),
                            color: _verifyColor(user?.verificationStatus,
                                user?.isVerified ?? false),
                            dense: true,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          const SectionLabel('Account'),
          Container(
            decoration: BoxDecoration(
              color: p.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: p.border),
            ),
            child: Column(
              children: [
                // A rejected student previously saw the same "awaiting
                // review" line as everyone else, with no reason and no way
                // forward. Rejection now says why and routes to re-submit.
                _ProfileTile(
                  icon: _verifyIcon(
                      user?.verificationStatus, user?.isVerified ?? false),
                  iconColor: _verifyColor(
                      user?.verificationStatus, user?.isVerified ?? false),
                  title: 'Identity',
                  subtitle: _verifySubtitle(user?.verificationStatus,
                      user?.verificationReason, user?.verificationNote,
                      user?.isVerified ?? false),
                  onTap: user?.verificationStatus == 'REJECTED'
                      ? () => Navigator.pushNamed(context, '/profile/setup')
                      : null,
                ),
                const Divider(height: 1, indent: 56),
                _ProfileTile(
                  icon: Icons.phone_rounded,
                  iconColor: AppColors.primary,
                  title: 'Phone',
                  subtitle: user?.phoneNumber ?? 'Not set',
                  // Checklist Stage 9 — this tile was display-only before;
                  // "profile editing beyond payout" opens from here.
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const EditProfileScreen()),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                // Mandate §2.1 — the light/dark choice is surfaced here as a
                // real control, not just inherited from the OS. Reads through
                // isDark(context) so the switch reflects what's actually
                // rendered even while the mode is still `system`.
                Consumer<ThemeController>(
                  builder: (context, themeController, _) {
                    final isDark = themeController.isDark(context);
                    return _ProfileTile(
                      icon: isDark
                          ? Icons.dark_mode_rounded
                          : Icons.light_mode_rounded,
                      iconColor: AppColors.secondary,
                      title: 'Appearance',
                      subtitle: switch (themeController.mode) {
                        ThemeMode.system => 'Following your device setting',
                        ThemeMode.dark => 'Dark',
                        ThemeMode.light => 'Light',
                      },
                      trailing: Switch(
                        value: isDark,
                        onChanged: (_) => themeController.toggle(context),
                      ),
                      onTap: () => themeController.toggle(context),
                    );
                  },
                ),
                const Divider(height: 1, indent: 56),
                // Checklist Stage 9 — the language picker. Persists through
                // LocaleController, same pattern as the Appearance switch
                // above persists through ThemeController.
                Consumer<LocaleController>(
                  builder: (context, localeController, _) => _ProfileTile(
                    icon: Icons.language_rounded,
                    iconColor: AppColors.info,
                    title: l10n.language,
                    subtitle: _languageLabel(l10n, localeController.locale),
                    onTap: () => _showLanguagePicker(context, l10n, localeController),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                _ProfileTile(
                  icon: Icons.inventory_2_rounded,
                  iconColor: AppColors.secondary,
                  title: 'My Listings',
                  subtitle: 'Edit, unlist, or delete items you\'ve listed',
                  onTap: () => Navigator.pushNamed(context, '/items/mine'),
                ),
                const Divider(height: 1, indent: 56),
                _ProfileTile(
                  icon: Icons.account_balance_wallet_rounded,
                  iconColor: (user?.payoutConfigured ?? false) ? AppColors.success : AppColors.accent,
                  title: 'Payout Details',
                  subtitle: (user?.payoutConfigured ?? false)
                      ? 'Set up — receiving rental earnings & deposit refunds'
                      : 'Not set up — required to receive rental earnings',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const PayoutDetailsScreen()),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                // Checklist Stage 9 — GET /payments existed and was called
                // by nothing; a student had no way to see their own
                // payment/refund/fee history at all.
                _ProfileTile(
                  icon: Icons.receipt_long_outlined,
                  iconColor: AppColors.info,
                  title: 'Transaction History',
                  subtitle: 'Payments, deposits, refunds, and fees',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const TransactionHistoryScreen()),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                // Checklist Stage 9 — "account activity log visible to the
                // user." A merged, read-only view over rentals + notifications
                // rather than a new audit table duplicating what those two
                // already record.
                _ProfileTile(
                  icon: Icons.history_rounded,
                  iconColor: AppColors.primary,
                  title: 'Account Activity',
                  subtitle: 'Your rentals and alerts, newest first',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const AccountActivityScreen()),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                _ProfileTile(
                  icon: Icons.notifications_active_outlined,
                  iconColor: AppColors.accent,
                  title: 'Notification Preferences',
                  subtitle: 'Choose which alerts you get',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const NotificationPreferencesScreen()),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                _ProfileTile(
                  icon: Icons.forum_outlined,
                  iconColor: AppColors.info,
                  title: 'Send Feedback',
                  subtitle: 'Report a bug, a kiosk problem, or a suggestion',
                  onTap: () => Navigator.pushNamed(context, '/feedback'),
                ),
                const Divider(height: 1, indent: 56),
                _ProfileTile(
                  icon: Icons.delete_forever_rounded,
                  iconColor: AppColors.error,
                  title: 'Delete My Biometric Data & Account',
                  subtitle: 'Permanently erase face/ID photos and deactivate',
                  onTap: () => _confirmDeleteAccount(context, authProvider),
                ),
                const Divider(height: 1, indent: 56),
                _ProfileTile(
                  icon: Icons.logout_rounded,
                  iconColor: AppColors.error,
                  title: 'Logout',
                  subtitle: 'Sign out of your account',
                  onTap: () async {
                    await authProvider.logout();
                    if (context.mounted) {
                      Navigator.pushNamedAndRemoveUntil(context, '/login', (_) => false);
                    }
                  },
                ),
                const Divider(height: 1, indent: 56),
                const _VersionRow(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// RA 10173 erasure-right entry point — requires password re-confirmation
  /// (a destructive action, not a routine edit) before calling
  /// DELETE /auth/account, which genuinely purges faceEncoding/idImageUrl/
  /// profileImage server-side and deactivates the account.
  Future<void> _confirmDeleteAccount(BuildContext context, AuthProvider authProvider) async {
    final passwordCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Delete biometric data & account?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'This permanently deletes your face photo, ID photo, and face '
              'recognition template, and deactivates your account. This cannot '
              'be undone. Enter your password to confirm.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: passwordCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Current password'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx, false),
            child: Text(AppLocalizations.of(dialogCtx)!.cancel),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx, true),
            child: const Text('Delete Permanently', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;
    if (passwordCtrl.text.isEmpty) {
      AppToast.error(context, 'Password required', 'Enter your password to confirm deletion.');
      return;
    }

    try {
      final resp = await ApiService().delete('/auth/account', body: {'password': passwordCtrl.text});
      if (resp.statusCode == 200) {
        await authProvider.logout();
        if (context.mounted) {
          AppToast.success(context, 'Account deleted', 'Your biometric data has been permanently removed.');
          Navigator.pushNamedAndRemoveUntil(context, '/login', (_) => false);
        }
      } else {
        final data = jsonDecode(resp.body);
        if (context.mounted) {
          AppToast.error(context, 'Could not delete account', data['message'] as String? ?? 'Please try again.');
        }
      }
    } catch (e) {
      if (context.mounted) {
        AppToast.error(context, 'Could not delete account', friendlyErrorMessage(e));
      }
    }
  }

  /// Subtitle under the Language tile — shows what's actually applied.
  /// `null` (no persisted choice) reads as "follows the device", matching
  /// what `LocaleController.locale == null` really means at the MaterialApp
  /// level.
  String _languageLabel(AppLocalizations l10n, Locale? locale) {
    return switch (locale?.languageCode) {
      'fil' => l10n.languageFilipino,
      'ceb' => l10n.languageBisaya,
      _ => l10n.languageEnglish,
    };
  }

  /// Bottom-sheet language picker — checklist Stage 9. Three options only
  /// (English / Filipino / Bisaya), matching `LocaleController.supportedLocales`
  /// and the three ARB files under lib/l10n/.
  Future<void> _showLanguagePicker(
    BuildContext context,
    AppLocalizations l10n,
    LocaleController localeController,
  ) async {
    final current = localeController.locale?.languageCode;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetCtx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.language,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    l10n.languageSubtitle,
                    style: TextStyle(
                        fontSize: 12, color: AppPalette.of(sheetCtx).muted),
                  ),
                ],
              ),
            ),
            _LanguageOption(
              label: l10n.languageEnglish,
              selected: current == 'en',
              onTap: () {
                localeController.setLocale(const Locale('en'));
                Navigator.pop(sheetCtx);
              },
            ),
            _LanguageOption(
              label: l10n.languageFilipino,
              selected: current == 'fil',
              onTap: () {
                localeController.setLocale(const Locale('fil'));
                Navigator.pop(sheetCtx);
              },
            ),
            _LanguageOption(
              label: l10n.languageBisaya,
              selected: current == 'ceb',
              onTap: () {
                localeController.setLocale(const Locale('ceb'));
                Navigator.pop(sheetCtx);
              },
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );
  }
}

/// One row in the language picker bottom sheet. Plain ListTile + checkmark
/// rather than RadioListTile — the Radio-family widgets' `groupValue`/
/// `onChanged` were deprecated in favour of a `RadioGroup` ancestor, and
/// three independently-tappable rows are simpler here than wiring one up.
class _LanguageOption extends StatelessWidget {
  const _LanguageOption({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(label),
      trailing: selected
          ? Icon(Icons.check_rounded, color: AppColors.primary)
          : null,
      onTap: onTap,
    );
  }
}

class _ProfileTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  /// Overrides the default chevron — used by the Appearance row, which needs
  /// a Switch rather than a navigation affordance.
  final Widget? trailing;

  const _ProfileTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    this.onTap,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    // Subtitle/chevron colours were hardcoded to the light palette, so in
    // dark mode they rendered as near-invisible grey on a dark surface.
    final p = AppPalette.of(context);
    return ListTile(
      onTap: onTap,
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: iconColor.withValues(alpha: 0.12),
          borderRadius: AppRadius.button,
        ),
        child: Icon(icon, color: iconColor, size: 20),
      ),
      title: Text(title,
          style: TextStyle(
              fontWeight: FontWeight.w600, fontSize: 14, color: p.ink)),
      subtitle:
          Text(subtitle, style: TextStyle(fontSize: 12, color: p.muted)),
      trailing: trailing ??
          (onTap != null
              ? Icon(Icons.chevron_right_rounded, color: p.muted)
              : null),
    );
  }
}

/// Shows the build the student is actually running.
///
/// This is the first thing worth asking for in a bug report, and until now
/// there was nowhere in the app to find it — `AppConstants.appVersion` was a
/// hardcoded '1.0.0' that had drifted five minor versions and was referenced
/// by nothing.
///
/// In debug builds a long-press fires a deliberate exception through the
/// crash reporter, so the pipeline can be proven from a real build on a real
/// device rather than assumed from the code.
class _VersionRow extends StatefulWidget {
  const _VersionRow();

  @override
  State<_VersionRow> createState() => _VersionRowState();
}

class _VersionRowState extends State<_VersionRow> {
  String _version = '…';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (mounted) setState(() => _version = '${info.version} (build ${info.buildNumber})');
    } catch (_) {
      if (mounted) setState(() => _version = 'unknown');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final reporting = CrashReporting.isEnabled
        ? 'Crash reporting on'
        : 'Crash reporting off for this build';

    return GestureDetector(
      onLongPress: kDebugMode
          ? () async {
              await CrashReporting.sendTestEvent();
              if (!context.mounted) return;
              AppToast.info(
                context,
                'Crash reporting test',
                CrashReporting.isEnabled
                    ? 'Test event sent to the crash reporter.'
                    : 'No DSN in this build — test error logged locally.',
              );
            }
          : null,
      child: ListTile(
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: p.muted.withValues(alpha: 0.12),
            borderRadius: AppRadius.button,
          ),
          child: Icon(Icons.info_outline_rounded, color: p.muted, size: 20),
        ),
        title: Text('EngiRent Hub $_version',
            style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: p.ink)),
        subtitle: Text(reporting, style: TextStyle(fontSize: 12, color: p.muted)),
      ),
    );
  }
}

/// Filter rail for the rentals list. Groups the eight lifecycle statuses into
/// the three questions a renter actually asks — what's coming, what do I have
/// right now, what's finished — rather than exposing raw status names.
class _RentalFilterRail extends StatelessWidget {
  const _RentalFilterRail({required this.selected, required this.onSelect});

  final String? selected;
  final ValueChanged<String?> onSelect;

  static const _options = <({String? key, String label})>[
    (key: null, label: 'All'),
    (key: 'active', label: 'With me'),
    (key: 'upcoming', label: 'Upcoming'),
    (key: 'past', label: 'Past'),
  ];

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return SizedBox(
      height: scaledHeight(context, 34),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        itemCount: _options.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
        itemBuilder: (context, i) {
          final o = _options[i];
          final active = o.key == selected;
          return GestureDetector(
            onTap: () => onSelect(o.key),
            child: AnimatedContainer(
              duration: AppMotion.fast,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.xs,
              ),
              decoration: BoxDecoration(
                color: active ? p.primary : p.surface,
                borderRadius: AppRadius.input,
                border: Border.all(color: active ? p.primary : p.border),
              ),
              child: Text(
                o.label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  color: active
                      ? (Theme.of(context).brightness == Brightness.dark
                          ? const Color(0xFF04211D)
                          : Colors.white)
                      : p.muted,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ── Verification state helpers ───────────────────────────────────────────
// The API returns both a gate (isVerified) and a workflow state. Reading only
// the gate is what made "never submitted", "waiting" and "rejected" all render
// identically as pending (mandate §2.11).

String _verifyLabel(String? status, bool verified) {
  if (verified) return 'Verified';
  return switch (status) {
    'REJECTED' => 'Action needed',
    'PENDING' => 'Under review',
    _ => 'Not submitted',
  };
}

Color _verifyColor(String? status, bool verified) {
  if (verified) return AppColors.success;
  return switch (status) {
    'REJECTED' => AppColors.error,
    'PENDING' => AppColors.warning,
    _ => AppColors.grey,
  };
}

IconData _verifyIcon(String? status, bool verified) {
  if (verified) return Icons.verified_user_rounded;
  return switch (status) {
    'REJECTED' => Icons.error_outline_rounded,
    'PENDING' => Icons.hourglass_top_rounded,
    _ => Icons.badge_outlined,
  };
}

/// Human-readable rejection reasons, mirroring the server's ID_REJECT_REASONS.
const Map<String, String> _rejectReasons = {
  'UNREADABLE': 'The photo was too blurry or dark to read.',
  'NOT_A_STUDENT_ID': "That didn't look like a UCLM student ID.",
  'NAME_MISMATCH': "The name on the ID didn't match your account.",
  'EXPIRED': 'The ID has expired.',
  'SUSPECTED_FORGERY':
      "The ID couldn't be accepted. Please visit the registrar.",
};

String _verifySubtitle(
    String? status, String? reason, String? note, bool verified) {
  if (verified) return 'Verified — face unlock is active at the kiosk';
  return switch (status) {
    'REJECTED' =>
      '${_rejectReasons[reason] ?? 'Your ID could not be verified.'}'
          '${(note != null && note.isNotEmpty) ? ' $note' : ''}'
          ' Tap to submit a new photo.',
    // Checklist Stage 8 — an ETA, not just "you're waiting". No real SLA is
    // tracked yet, so this is a plain estimate ("typically"), not a promise.
    'PENDING' =>
      'Your student ID is with an administrator — reviews are typically completed '
          'within 24 hours. You can browse and rent while you wait.',
    _ => 'Submit your student ID to unlock renting and listing.',
  };
}
