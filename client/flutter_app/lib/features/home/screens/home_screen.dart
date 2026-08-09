import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
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
import '../../../core/widgets/app_widgets.dart';
import '../../../core/utils/toast_utils.dart';
import '../../auth/providers/auth_provider.dart';
import '../../notifications/models/notification_service.dart';
import '../../payments/screens/payout_details_screen.dart';
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
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.home_filled), label: 'Home'),
            BottomNavigationBarItem(icon: Icon(Icons.receipt_long), label: 'Rentals'),
            BottomNavigationBarItem(icon: Icon(Icons.notifications), label: 'Alerts'),
            BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profile'),
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
        setState(() => _loadingFeatured = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loadingFeatured = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
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
                            label: 'List an item',
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
                            label: 'Scan kiosk',
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
                            label: 'My rentals',
                            color: AppColors.info,
                            onTap: widget.onGoToRentals,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  SectionLabel(
                    'Browse by category',
                    trailing: GestureDetector(
                      onTap: () => Navigator.pushNamed(context, '/items'),
                      child: Text(
                        'See all',
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

  SliverGridDelegate _homeGrid(BuildContext context) {
    final w = MediaQuery.of(context).size.width;
    return SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: w > 900 ? 4 : (w > 600 ? 3 : 2),
      crossAxisSpacing: AppSpacing.sm,
      mainAxisSpacing: AppSpacing.sm,
      childAspectRatio: 0.63,
    );
  }
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
  final _service = RentalService();
  bool _loading = true;
  String? _error;
  List<RentalModel> _rentals = [];
  StreamSubscription<Map<String, dynamic>>? _socketSub;

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
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  Color _statusColor(String status) => switch (status) {
    'ACTIVE' => AppColors.success,
    'COMPLETED' => AppColors.info,
    'CANCELLED' || 'DISPUTED' => AppColors.error,
    'AWAITING_DEPOSIT' || 'DEPOSITED' => AppColors.accent,
    'VERIFICATION' => AppColors.warning,
    _ => AppColors.grey,
  };

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('My Rentals'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _load,
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(children: [
                    const SizedBox(height: 100),
                    Center(child: Text(_error!, style: TextStyle(color: p.muted))),
                  ])
                : _rentals.isEmpty
                    ? ListView(children: [
                        const SizedBox(height: 80),
                        Center(
                          child: Column(children: [
                            Icon(Icons.receipt_long_outlined, size: 56, color: p.muted),
                            SizedBox(height: 12),
                            Text('No rentals yet', style: TextStyle(fontWeight: FontWeight.w600, color: p.muted)),
                            SizedBox(height: 6),
                            Text('Browse items to start your first rental', style: TextStyle(color: p.muted, fontSize: 13)),
                          ]),
                        ),
                      ])
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _rentals.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final rental = _rentals[index];
                          final statusColor = _statusColor(rental.status);
                          return GestureDetector(
                            onTap: () => Navigator.pushNamed(context, '/rentals/${rental.id}').then((_) => _load()),
                            child: Container(
                              decoration: BoxDecoration(
                                color: p.surface,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: p.border),
                                boxShadow: [
                                  BoxShadow(
                                    color: AppColors.primaryDark.withValues(alpha: 0.04),
                                    blurRadius: 8,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                              ),
                              padding: const EdgeInsets.all(16),
                              child: Row(
                                children: [
                                  // Status indicator strip
                                  Container(
                                    width: 4,
                                    height: 56,
                                    decoration: BoxDecoration(
                                      color: statusColor,
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          rental.item.title,
                                          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: p.ink),
                                        ),
                                        const SizedBox(height: 4),
                                        Row(
                                          children: [
                                            Icon(Icons.calendar_today_outlined, size: 12, color: p.muted),
                                            const SizedBox(width: 4),
                                            Text(
                                              'Ends ${rental.daysRemaining > 0 ? 'in ${rental.daysRemaining}d' : 'today'}',
                                              style: TextStyle(color: p.muted, fontSize: 12),
                                            ),
                                            const SizedBox(width: 10),
                                            Icon(Icons.payments_outlined, size: 12, color: p.muted),
                                            const SizedBox(width: 4),
                                            Text(
                                              'PHP ${rental.totalPrice.toStringAsFixed(0)}',
                                              style: TextStyle(color: p.muted, fontSize: 12),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                        decoration: BoxDecoration(
                                          color: statusColor.withValues(alpha: 0.1),
                                          borderRadius: BorderRadius.circular(999),
                                        ),
                                        child: Text(
                                          AppConstants.rentalStatus[rental.status] ?? rental.status,
                                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: statusColor),
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Icon(Icons.chevron_right_rounded, color: p.muted, size: 18),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
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
    'BOOKING_CONFIRMED' => Icons.check_circle_rounded,
    'ITEM_READY_FOR_CLAIM' => Icons.inventory_2_rounded,
    'RENTAL_STARTED' => Icons.play_circle_rounded,
    'PAYMENT_RECEIVED' => Icons.payments_rounded,
    _ => Icons.notifications_rounded,
  };

  Color _notifColor(String type) => switch (type) {
    'BOOKING_CONFIRMED' => AppColors.success,
    'ITEM_READY_FOR_CLAIM' => AppColors.accent,
    'RENTAL_STARTED' => AppColors.primary,
    'PAYMENT_RECEIVED' => AppColors.success,
    _ => AppColors.info,
  };

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final hasUnread = _notifications.any((n) => !n.isRead);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (hasUnread)
            TextButton(
              onPressed: () async {
                await _service.markAllRead();
                _load();
              },
              child: const Text('Mark all read', style: TextStyle(color: AppColors.primary)),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(children: [const SizedBox(height: 100), Center(child: Text(_error!))])
                : _notifications.isEmpty
                    ? ListView(children: [
                        const SizedBox(height: 80),
                        Center(
                          child: Column(children: [
                            Icon(Icons.notifications_off_outlined, size: 56, color: p.muted),
                            SizedBox(height: 12),
                            Text('All clear!', style: TextStyle(fontWeight: FontWeight.w600, color: p.muted)),
                            SizedBox(height: 6),
                            Text('No notifications yet', style: TextStyle(color: p.muted, fontSize: 13)),
                          ]),
                        ),
                      ])
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _notifications.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final n = _notifications[index];
                          final color = _notifColor(n.type);
                          return GestureDetector(
                            onTap: () async {
                              if (!n.isRead) {
                                await _service.markRead(n.id);
                                _load();
                              }
                            },
                            child: Container(
                              decoration: BoxDecoration(
                                color: n.isRead ? AppColors.surface : AppColors.primary.withValues(alpha: 0.04),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: n.isRead ? p.border : AppColors.primary.withValues(alpha: 0.2),
                                ),
                              ),
                              padding: const EdgeInsets.all(14),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(9),
                                    decoration: BoxDecoration(
                                      color: color.withValues(alpha: 0.12),
                                      shape: BoxShape.circle,
                                    ),
                                    child: Icon(_notifIcon(n.type), color: color, size: 18),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          n.title,
                                          style: TextStyle(
                                            fontWeight: n.isRead ? FontWeight.w600 : FontWeight.w800,
                                            fontSize: 14,
                                            color: p.ink,
                                          ),
                                        ),
                                        const SizedBox(height: 3),
                                        Text(n.message, style: TextStyle(fontSize: 13, color: p.muted)),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        timeago.format(n.createdAt, allowFromNow: true),
                                        style: TextStyle(fontSize: 11, color: p.muted),
                                      ),
                                      if (!n.isRead) ...[
                                        const SizedBox(height: 6),
                                        Container(
                                          width: 8,
                                          height: 8,
                                          decoration: const BoxDecoration(
                                            color: AppColors.primary,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
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
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Avatar card
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: AppColors.primaryGradient,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              children: [
                CircleAvatar(
                  radius: 40,
                  backgroundColor: Colors.white24,
                  backgroundImage: user?.profileImage != null
                      ? NetworkImage(user!.profileImage!)
                      : null,
                  child: user?.profileImage == null
                      ? Text(
                          (user?.firstName.isNotEmpty ?? false) ? user!.firstName[0].toUpperCase() : 'U',
                          style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: AppColors.white),
                        )
                      : null,
                ),
                const SizedBox(height: 12),
                Text(
                  user?.fullName ?? 'Student',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.white),
                ),
                const SizedBox(height: 4),
                Text(
                  user?.email ?? '',
                  style: const TextStyle(color: Colors.white70, fontSize: 13),
                ),
                if (user != null && user.studentId.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      user.studentId,
                      style: const TextStyle(color: AppColors.white, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Info items
          Container(
            decoration: BoxDecoration(
              color: p.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: p.border),
            ),
            child: Column(
              children: [
                _ProfileTile(icon: Icons.verified_user_rounded, iconColor: AppColors.success, title: 'Identity Verified', subtitle: 'Face ID + QR workflow enabled'),
                const Divider(height: 1, indent: 56),
                _ProfileTile(icon: Icons.phone_rounded, iconColor: AppColors.primary, title: 'Phone', subtitle: user?.phoneNumber ?? 'Not set'),
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
          TextButton(onPressed: () => Navigator.pop(dialogCtx, false), child: const Text('Cancel')),
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
        AppToast.error(context, 'Could not delete account', e.toString());
      }
    }
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
