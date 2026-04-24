import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/notification_model.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/socket_service.dart';
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

  @override
  Widget build(BuildContext context) {
    final pages = [
      const _HomeTab(),
      const _RentalsTab(),
      const _NotificationsTab(),
      const _ProfileTab(),
    ];

    return Scaffold(
      body: pages[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        type: BottomNavigationBarType.fixed,
        selectedItemColor: AppColors.primary,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home_filled), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.receipt_long), label: 'Rentals'),
          BottomNavigationBarItem(icon: Icon(Icons.notifications), label: 'Alerts'),
          BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}

class _HomeTab extends StatelessWidget {
  const _HomeTab();

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    return Scaffold(
      appBar: AppBar(title: const Text('EngiRent Hub')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: AppColors.primaryGradient,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Welcome, ${user?.firstName ?? "Student"}',
                  style: const TextStyle(color: AppColors.white, fontSize: 24, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Secure kiosk-powered rentals for engineering tools.',
                  style: TextStyle(color: AppColors.white),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text('Quick Actions', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: MediaQuery.of(context).size.width > 700 ? 4 : 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            children: [
              _QuickActionCard(
                icon: Icons.add_box_rounded,
                title: 'List Item',
                color: AppColors.primary,
                onTap: () => Navigator.pushNamed(context, '/items/create'),
              ),
              _QuickActionCard(
                icon: Icons.search,
                title: 'Browse',
                color: AppColors.secondary,
                onTap: () => Navigator.pushNamed(context, '/items'),
              ),
              _QuickActionCard(
                icon: Icons.qr_code_scanner,
                title: 'Kiosk',
                color: AppColors.accent,
                onTap: () => Navigator.pushNamed(context, '/kiosk/scan'),
              ),
              _QuickActionCard(
                icon: Icons.receipt_long,
                title: 'My Rentals',
                color: AppColors.info,
                onTap: () {},
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Text('Popular Categories', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: AppConstants.categories.values
                .map(
                  (category) => Chip(
                    label: Text(category),
                    backgroundColor: AppColors.surface,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(999),
                      side: const BorderSide(color: AppColors.border),
                    ),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _QuickActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final Color color;
  final VoidCallback onTap;

  const _QuickActionCard({
    required this.icon,
    required this.title,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 38),
            const SizedBox(height: 8),
            Text(
              title,
              textAlign: TextAlign.center,
              style: TextStyle(color: color, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

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
    // Refresh whenever any rental status changes arrive via Socket.io
    _socketSub = SocketService.instance.onAnyRentalChange.listen((_) => _load());
  }

  @override
  void dispose() {
    _socketSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await _service.getRentals();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success']) {
        _rentals = result['rentals'] as List<RentalModel>;
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Rentals')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(children: [const SizedBox(height: 100), Center(child: Text(_error!))])
                : _rentals.isEmpty
                    ? ListView(children: const [SizedBox(height: 100), Center(child: Text('No rentals yet'))])
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _rentals.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final rental = _rentals[index];
                          return Card(
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(rental.item.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                        decoration: BoxDecoration(
                                          color: AppColors.primary.withValues(alpha: 0.1),
                                          borderRadius: BorderRadius.circular(999),
                                        ),
                                        child: Text(
                                          AppConstants.rentalStatus[rental.status] ?? rental.status,
                                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primaryDark),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Text('Total: PHP ${rental.totalPrice.toStringAsFixed(0)}'),
                                  Text('Ends in ${rental.daysRemaining} day(s)', style: const TextStyle(color: AppColors.textSecondary)),
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
    // Refresh notifications list whenever a rental event arrives
    _socketSub = SocketService.instance.onAnyRentalChange.listen((_) => _load());
  }

  @override
  void dispose() {
    _socketSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await _service.getNotifications();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success']) {
        _notifications = result['notifications'] as List<NotificationModel>;
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(children: [const SizedBox(height: 100), Center(child: Text(_error!))])
                : _notifications.isEmpty
                    ? ListView(children: const [SizedBox(height: 100), Center(child: Text('No notifications yet'))])
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _notifications.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final notification = _notifications[index];
                          return Card(
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor: notification.isRead
                                    ? AppColors.greyLight
                                    : AppColors.primaryLight.withValues(alpha: 0.3),
                                child: Icon(
                                  notification.isRead ? Icons.mark_email_read : Icons.notifications_active,
                                  color: notification.isRead ? AppColors.greyDark : AppColors.primaryDark,
                                ),
                              ),
                              title: Text(notification.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                              subtitle: Text(notification.message),
                              trailing: Text(
                                '${notification.createdAt.month}/${notification.createdAt.day}',
                                style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                              ),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 42,
                    backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                    child: Text(
                      (user?.firstName.isNotEmpty ?? false) ? user!.firstName.substring(0, 1) : 'U',
                      style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700, color: AppColors.primaryDark),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(user?.fullName ?? 'User', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  Text(user?.email ?? '', style: const TextStyle(color: AppColors.textSecondary)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Column(
              children: [
                const ListTile(leading: Icon(Icons.verified_user), title: Text('Identity Verification'), subtitle: Text('QR + face workflow enabled')),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.lock_outline),
                  title: const Text('Logout'),
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
