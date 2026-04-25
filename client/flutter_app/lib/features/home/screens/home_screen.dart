import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/notification_model.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/socket_service.dart';
import '../../admin/screens/admin_home_screen.dart';
import '../../auth/providers/auth_provider.dart';
import '../../notifications/models/notification_service.dart';
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
          color: AppColors.surface,
          border: const Border(top: BorderSide(color: AppColors.border)),
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
          unselectedItemColor: AppColors.grey,
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

class _HomeTab extends StatelessWidget {
  final VoidCallback onGoToRentals;
  const _HomeTab({required this.onGoToRentals});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: CustomScrollView(
        slivers: [
          // Navy gradient header
          SliverAppBar(
            expandedHeight: 160,
            pinned: true,
            backgroundColor: AppColors.primaryDark,
            foregroundColor: AppColors.white,
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
              title: const Text(
                'EngiRent Hub',
                style: TextStyle(color: AppColors.white, fontWeight: FontWeight.w800, fontSize: 17),
              ),
              titlePadding: const EdgeInsets.only(left: 16, bottom: 12),
            ),
          ),

          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                // Quick actions
                const Text('Quick Actions', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                const SizedBox(height: 12),
                GridView.count(
                  crossAxisCount: MediaQuery.of(context).size.width > 700 ? 4 : 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  childAspectRatio: 1.1,
                  children: [
                    _QuickActionCard(
                      icon: Icons.add_box_rounded,
                      title: 'List Item',
                      subtitle: 'Earn from your tools',
                      color: AppColors.primary,
                      onTap: () => Navigator.pushNamed(context, '/items/create'),
                    ),
                    _QuickActionCard(
                      icon: Icons.search_rounded,
                      title: 'Browse',
                      subtitle: 'Find equipment',
                      color: AppColors.secondary,
                      onTap: () => Navigator.pushNamed(context, '/items'),
                    ),
                    _QuickActionCard(
                      icon: Icons.qr_code_scanner_rounded,
                      title: 'Kiosk Scan',
                      subtitle: 'Use at the hub',
                      color: AppColors.accent,
                      onTap: () => Navigator.pushNamed(context, '/kiosk/scan'),
                    ),
                    _QuickActionCard(
                      icon: Icons.receipt_long_rounded,
                      title: 'My Rentals',
                      subtitle: 'Track your items',
                      color: AppColors.info,
                      onTap: onGoToRentals,
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Categories
                const Text('Browse by Category', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: AppConstants.categories.entries.map((e) {
                    return GestureDetector(
                      onTap: () => Navigator.pushNamed(context, '/items', arguments: {'category': e.key}),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Text(
                          e.value,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 24),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _QuickActionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: 0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 24),
            ),
            const Spacer(),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppColors.textPrimary)),
            const SizedBox(height: 2),
            Text(subtitle, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          ],
        ),
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
    'VERIFICATION' || 'AWAITING_RETURN' => AppColors.warning,
    _ => AppColors.textSecondary,
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
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
                    Center(child: Text(_error!, style: const TextStyle(color: AppColors.textSecondary))),
                  ])
                : _rentals.isEmpty
                    ? ListView(children: [
                        const SizedBox(height: 80),
                        const Center(
                          child: Column(children: [
                            Icon(Icons.receipt_long_outlined, size: 56, color: AppColors.grey),
                            SizedBox(height: 12),
                            Text('No rentals yet', style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
                            SizedBox(height: 6),
                            Text('Browse items to start your first rental', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
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
                                color: AppColors.surface,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AppColors.border),
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
                                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.textPrimary),
                                        ),
                                        const SizedBox(height: 4),
                                        Row(
                                          children: [
                                            Icon(Icons.calendar_today_outlined, size: 12, color: AppColors.textSecondary),
                                            const SizedBox(width: 4),
                                            Text(
                                              'Ends ${rental.daysRemaining > 0 ? 'in ${rental.daysRemaining}d' : 'today'}',
                                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                            ),
                                            const SizedBox(width: 10),
                                            Icon(Icons.payments_outlined, size: 12, color: AppColors.textSecondary),
                                            const SizedBox(width: 4),
                                            Text(
                                              'PHP ${rental.totalPrice.toStringAsFixed(0)}',
                                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
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
                                      const Icon(Icons.chevron_right_rounded, color: AppColors.grey, size: 18),
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
    'PAYMENT_RECEIVED' => AppColors.secondary,
    _ => AppColors.info,
  };

  @override
  Widget build(BuildContext context) {
    final hasUnread = _notifications.any((n) => !n.isRead);
    return Scaffold(
      backgroundColor: AppColors.background,
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
                        const Center(
                          child: Column(children: [
                            Icon(Icons.notifications_off_outlined, size: 56, color: AppColors.grey),
                            SizedBox(height: 12),
                            Text('All clear!', style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
                            SizedBox(height: 6),
                            Text('No notifications yet', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
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
                                  color: n.isRead ? AppColors.border : AppColors.primary.withValues(alpha: 0.2),
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
                                            color: AppColors.textPrimary,
                                          ),
                                        ),
                                        const SizedBox(height: 3),
                                        Text(n.message, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        timeago.format(n.createdAt, allowFromNow: true),
                                        style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
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
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;
    return Scaffold(
      backgroundColor: AppColors.background,
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
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                _ProfileTile(icon: Icons.verified_user_rounded, iconColor: AppColors.success, title: 'Identity Verified', subtitle: 'Face ID + QR workflow enabled'),
                const Divider(height: 1, indent: 56),
                _ProfileTile(icon: Icons.phone_rounded, iconColor: AppColors.primary, title: 'Phone', subtitle: user?.phoneNumber ?? 'Not set'),
                if (user?.isAdmin ?? false) ...[
                  const Divider(height: 1, indent: 56),
                  _ProfileTile(
                    icon: Icons.admin_panel_settings_rounded,
                    iconColor: AppColors.accent,
                    title: 'Admin Panel',
                    subtitle: 'Manage users, rentals & kiosks',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const AdminHomeScreen()),
                    ),
                  ),
                ],
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
}

class _ProfileTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _ProfileTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: iconColor.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, color: iconColor, size: 20),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
      trailing: onTap != null ? const Icon(Icons.chevron_right_rounded, color: AppColors.grey) : null,
    );
  }
}
