import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/api_service.dart';
import '../../../core/utils/toast_utils.dart';

// ── Entry point ───────────────────────────────────────────────────────────────

class AdminHomeScreen extends StatefulWidget {
  const AdminHomeScreen({super.key});

  @override
  State<AdminHomeScreen> createState() => _AdminHomeScreenState();
}

class _AdminHomeScreenState extends State<AdminHomeScreen> {
  int _tab = 0;

  static const _tabs = [
    BottomNavigationBarItem(icon: Icon(Icons.dashboard_rounded), label: 'Dashboard'),
    BottomNavigationBarItem(icon: Icon(Icons.people_rounded), label: 'Users'),
    BottomNavigationBarItem(icon: Icon(Icons.receipt_long_rounded), label: 'Rentals'),
    BottomNavigationBarItem(icon: Icon(Icons.admin_panel_settings_rounded), label: 'More'),
  ];

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      const _DashboardTab(),
      const _UsersTab(),
      const _AdminRentalsTab(),
      const _MoreTab(),
    ];

    return Scaffold(
      body: pages[_tab],
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
          currentIndex: _tab,
          onTap: (i) => setState(() => _tab = i),
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.transparent,
          elevation: 0,
          selectedItemColor: AppColors.accent,
          unselectedItemColor: AppColors.grey,
          items: _tabs,
        ),
      ),
    );
  }
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

class _DashboardTab extends StatefulWidget {
  const _DashboardTab();

  @override
  State<_DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<_DashboardTab> {
  final _api = ApiService();
  Map<String, dynamic>? _stats;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get('/admin/stats');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() { _stats = data['data'] as Map<String, dynamic>?; _loading = false; });
      } else {
        setState(() { _loading = false; _error = 'Failed to load stats'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Admin Dashboard'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _AdminError(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Header
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: AppColors.primaryGradient,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'EngiRent Admin',
                              style: TextStyle(color: AppColors.white, fontSize: 18, fontWeight: FontWeight.w800),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'System overview — ${DateFormat('MMMM d, yyyy').format(DateTime.now())}',
                              style: const TextStyle(color: Colors.white70, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Stats grid
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                        childAspectRatio: 1.3,
                        children: [
                          _StatCard(
                            icon: Icons.people_rounded,
                            label: 'Total Users',
                            value: '${_stats?['totalUsers'] ?? 0}',
                            color: AppColors.primary,
                          ),
                          _StatCard(
                            icon: Icons.inventory_2_rounded,
                            label: 'Listed Items',
                            value: '${_stats?['totalItems'] ?? 0}',
                            color: AppColors.secondary,
                          ),
                          _StatCard(
                            icon: Icons.receipt_long_rounded,
                            label: 'Active Rentals',
                            value: '${_stats?['activeRentals'] ?? 0}',
                            color: AppColors.accent,
                          ),
                          _StatCard(
                            icon: Icons.payments_rounded,
                            label: 'Total Revenue',
                            value: 'PHP ${((_stats?['totalRevenue'] as num?) ?? 0).toStringAsFixed(0)}',
                            color: AppColors.success,
                          ),
                          _StatCard(
                            icon: Icons.pending_actions_rounded,
                            label: 'Pending Rentals',
                            value: '${_stats?['pendingRentals'] ?? 0}',
                            color: AppColors.warning,
                          ),
                          _StatCard(
                            icon: Icons.verified_rounded,
                            label: 'Verifications',
                            value: '${_stats?['pendingVerifications'] ?? 0}',
                            color: AppColors.info,
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Quick actions
                      _SectionHeader('Quick Actions'),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: _AdminActionCard(
                              icon: Icons.fact_check_rounded,
                              label: 'Review Verifications',
                              color: AppColors.warning,
                              onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(builder: (_) => const _VerificationsPage()),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _AdminActionCard(
                              icon: Icons.router_rounded,
                              label: 'Kiosk Control',
                              color: AppColors.info,
                              onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(builder: (_) => const _KioskPage()),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
    );
  }
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

class _UsersTab extends StatefulWidget {
  const _UsersTab();

  @override
  State<_UsersTab> createState() => _UsersTabState();
}

class _UsersTabState extends State<_UsersTab> {
  final _api = ApiService();
  final _searchCtrl = TextEditingController();
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load({String? search}) async {
    setState(() { _loading = true; _error = null; });
    try {
      final q = (search?.isNotEmpty ?? false) ? '?search=${Uri.encodeComponent(search!)}' : '';
      final resp = await _api.get('/admin/users$q');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() {
          _users = List<Map<String, dynamic>>.from(data['data']['users'] as List? ?? []);
          _loading = false;
        });
      } else {
        setState(() { _loading = false; _error = 'Failed to load users'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _toggleRole(Map<String, dynamic> user) async {
    final isAdmin = user['role'] == 'ADMIN';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Text(isAdmin ? 'Remove Admin Role?' : 'Grant Admin Role?',
            style: const TextStyle(fontWeight: FontWeight.w800)),
        content: Text(
          '${isAdmin ? 'Remove admin privileges from' : 'Grant admin privileges to'} '
          '${user['firstName']} ${user['lastName']}?',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: isAdmin ? AppColors.error : AppColors.success),
            child: Text(isAdmin ? 'Remove' : 'Grant'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      final resp = await _api.patch('/admin/users/${user['id']}', {
        'role': isAdmin ? 'STUDENT' : 'ADMIN',
      });
      if (!mounted) return;
      if (resp.statusCode == 200) {
        AppToast.success(context, 'Role Updated', 'User role has been changed.');
        _load();
      } else {
        AppToast.error(context, 'Failed', 'Could not update user role.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Error', e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Users'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _load),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search users…',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.search_rounded),
                  onPressed: () => _load(search: _searchCtrl.text.trim()),
                ),
              ),
              onSubmitted: (v) => _load(search: v.trim()),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _AdminError(message: _error!, onRetry: _load)
                    : _users.isEmpty
                        ? const Center(child: Text('No users found', style: TextStyle(color: AppColors.textSecondary)))
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _users.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (_, i) {
                                final u = _users[i];
                                final isAdmin = u['role'] == 'ADMIN';
                                return Container(
                                  decoration: BoxDecoration(
                                    color: AppColors.surface,
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(color: AppColors.border),
                                  ),
                                  padding: const EdgeInsets.all(14),
                                  child: Row(
                                    children: [
                                      CircleAvatar(
                                        radius: 22,
                                        backgroundColor: AppColors.primary.withValues(alpha: 0.1),
                                        backgroundImage: u['profileImage'] != null
                                            ? NetworkImage(u['profileImage'] as String)
                                            : null,
                                        child: u['profileImage'] == null
                                            ? Text(
                                                (u['firstName'] as String? ?? 'U').substring(0, 1).toUpperCase(),
                                                style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.primary),
                                              )
                                            : null,
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              '${u['firstName']} ${u['lastName']}',
                                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                            ),
                                            Text(
                                              u['email'] as String? ?? '',
                                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                            ),
                                            if ((u['studentId'] as String? ?? '').isNotEmpty)
                                              Text(
                                                u['studentId'] as String,
                                                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                                              ),
                                          ],
                                        ),
                                      ),
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.end,
                                        children: [
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                            decoration: BoxDecoration(
                                              color: (isAdmin ? AppColors.accent : AppColors.primary).withValues(alpha: 0.1),
                                              borderRadius: BorderRadius.circular(999),
                                            ),
                                            child: Text(
                                              isAdmin ? 'ADMIN' : 'STUDENT',
                                              style: TextStyle(
                                                fontSize: 10,
                                                fontWeight: FontWeight.w700,
                                                color: isAdmin ? AppColors.accent : AppColors.primary,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(height: 6),
                                          GestureDetector(
                                            onTap: () => _toggleRole(u),
                                            child: Text(
                                              isAdmin ? 'Remove Admin' : 'Make Admin',
                                              style: TextStyle(
                                                fontSize: 11,
                                                color: isAdmin ? AppColors.error : AppColors.success,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
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
}

// ── Admin Rentals Tab ─────────────────────────────────────────────────────────

class _AdminRentalsTab extends StatefulWidget {
  const _AdminRentalsTab();

  @override
  State<_AdminRentalsTab> createState() => _AdminRentalsTabState();
}

class _AdminRentalsTabState extends State<_AdminRentalsTab> {
  final _api = ApiService();
  List<Map<String, dynamic>> _rentals = [];
  bool _loading = true;
  String? _error;
  String _filter = 'ALL';

  static const _filters = ['ALL', 'PENDING', 'ACTIVE', 'VERIFICATION', 'DISPUTED', 'COMPLETED', 'CANCELLED'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final q = _filter != 'ALL' ? '?status=$_filter' : '';
      final resp = await _api.get('/admin/rentals$q');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() {
          _rentals = List<Map<String, dynamic>>.from(data['data']['rentals'] as List? ?? []);
          _loading = false;
        });
      } else {
        setState(() { _loading = false; _error = 'Failed to load rentals'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _forceComplete(String rentalId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Text('Force Complete?', style: TextStyle(fontWeight: FontWeight.w800)),
        content: const Text(
          'Mark this rental as completed? This bypasses the normal return process.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.warning),
            child: const Text('Force Complete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      final resp = await _api.post('/admin/rentals/$rentalId/complete', {});
      if (!mounted) return;
      if (resp.statusCode == 200) {
        AppToast.success(context, 'Rental Completed', 'Rental has been force-completed.');
        _load();
      } else {
        AppToast.error(context, 'Failed', 'Could not complete rental.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Error', e.toString());
    }
  }

  Future<void> _settleDispute(String rentalId, String outcome) async {
    try {
      final resp = await _api.post('/admin/rentals/$rentalId/settle', {'outcome': outcome});
      if (!mounted) return;
      if (resp.statusCode == 200) {
        AppToast.success(context, 'Dispute Settled', 'Outcome: ${outcome == 'owner_wins' ? 'Owner' : 'Renter'} wins.');
        _load();
      } else {
        AppToast.error(context, 'Failed', 'Could not settle dispute.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Error', e.toString());
    }
  }

  Color _statusColor(String status) => switch (status) {
    'ACTIVE' => AppColors.success,
    'COMPLETED' => AppColors.info,
    'CANCELLED' || 'DISPUTED' => AppColors.error,
    'VERIFICATION' || 'AWAITING_RETURN' => AppColors.warning,
    'AWAITING_DEPOSIT' || 'DEPOSITED' => AppColors.accent,
    _ => AppColors.textSecondary,
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('All Rentals'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _load),
        ],
      ),
      body: Column(
        children: [
          // Filter chips
          SizedBox(
            height: 44,
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              scrollDirection: Axis.horizontal,
              itemCount: _filters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final f = _filters[i];
                final active = _filter == f;
                return GestureDetector(
                  onTap: () { setState(() => _filter = f); _load(); },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      color: active ? AppColors.primary : AppColors.surface,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: active ? AppColors.primary : AppColors.border),
                    ),
                    child: Text(
                      f == 'ALL' ? 'All' : (AppConstants.rentalStatus[f] ?? f),
                      style: TextStyle(
                        color: active ? AppColors.white : AppColors.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _AdminError(message: _error!, onRetry: _load)
                    : _rentals.isEmpty
                        ? const Center(child: Text('No rentals found', style: TextStyle(color: AppColors.textSecondary)))
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _rentals.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (_, i) {
                                final r = _rentals[i];
                                final status = r['status'] as String? ?? '';
                                final statusColor = _statusColor(status);
                                final item = r['item'] as Map<String, dynamic>?;
                                final renter = r['renter'] as Map<String, dynamic>?;
                                return Container(
                                  decoration: BoxDecoration(
                                    color: AppColors.surface,
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(color: AppColors.border),
                                  ),
                                  padding: const EdgeInsets.all(14),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              item?['title'] as String? ?? 'Unknown Item',
                                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                            ),
                                          ),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                            decoration: BoxDecoration(
                                              color: statusColor.withValues(alpha: 0.1),
                                              borderRadius: BorderRadius.circular(999),
                                            ),
                                            child: Text(
                                              AppConstants.rentalStatus[status] ?? status,
                                              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: statusColor),
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        'Renter: ${renter?['firstName'] ?? ''} ${renter?['lastName'] ?? ''} · PHP ${(r['totalPrice'] as num?)?.toStringAsFixed(0) ?? '0'}',
                                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                      ),
                                      if (status == 'DISPUTED' || status == 'ACTIVE' || status == 'VERIFICATION') ...[
                                        const SizedBox(height: 10),
                                        Row(
                                          children: [
                                            if (status == 'ACTIVE' || status == 'VERIFICATION')
                                              Expanded(
                                                child: _SmallButton(
                                                  label: 'Force Complete',
                                                  color: AppColors.warning,
                                                  onTap: () => _forceComplete(r['id'] as String),
                                                ),
                                              ),
                                            if (status == 'DISPUTED') ...[
                                              Expanded(
                                                child: _SmallButton(
                                                  label: 'Owner Wins',
                                                  color: AppColors.primary,
                                                  onTap: () => _settleDispute(r['id'] as String, 'owner_wins'),
                                                ),
                                              ),
                                              const SizedBox(width: 8),
                                              Expanded(
                                                child: _SmallButton(
                                                  label: 'Renter Wins',
                                                  color: AppColors.secondary,
                                                  onTap: () => _settleDispute(r['id'] as String, 'renter_wins'),
                                                ),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ],
                                    ],
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
}

// ── More Tab ──────────────────────────────────────────────────────────────────

class _MoreTab extends StatelessWidget {
  const _MoreTab();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _MoreTile(
            icon: Icons.fact_check_rounded,
            iconColor: AppColors.warning,
            title: 'Verifications',
            subtitle: 'Review ML item comparison results',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const _VerificationsPage()),
            ),
          ),
          const SizedBox(height: 10),
          _MoreTile(
            icon: Icons.router_rounded,
            iconColor: AppColors.info,
            title: 'Kiosk Control',
            subtitle: 'Manage and command kiosks',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const _KioskPage()),
            ),
          ),
        ],
      ),
    );
  }
}

class _MoreTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _MoreTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: iconColor, size: 24),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  Text(subtitle, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.grey),
          ],
        ),
      ),
    );
  }
}

// ── Verifications Page ────────────────────────────────────────────────────────

class _VerificationsPage extends StatefulWidget {
  const _VerificationsPage();

  @override
  State<_VerificationsPage> createState() => _VerificationsPageState();
}

class _VerificationsPageState extends State<_VerificationsPage> {
  final _api = ApiService();
  List<Map<String, dynamic>> _verifications = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get('/admin/verifications');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() {
          _verifications = List<Map<String, dynamic>>.from(
              data['data']['verifications'] as List? ?? []);
          _loading = false;
        });
      } else {
        setState(() { _loading = false; _error = 'Failed to load verifications'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _review(String id, String status) async {
    try {
      final resp = await _api.patch('/admin/verifications/$id', {'status': status});
      if (!mounted) return;
      if (resp.statusCode == 200) {
        AppToast.success(
          context,
          status == 'APPROVED' ? 'Verification Approved' : 'Verification Rejected',
          '',
        );
        _load();
      } else {
        AppToast.error(context, 'Failed', 'Could not update verification.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Error', e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Verifications'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _AdminError(message: _error!, onRetry: _load)
              : _verifications.isEmpty
                  ? const Center(child: Text('No verifications found', style: TextStyle(color: AppColors.textSecondary)))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _verifications.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (_, i) {
                          final v = _verifications[i];
                          final decision = v['decision'] as String? ?? 'PENDING';
                          final confidence = (v['confidence'] as num?)?.toDouble() ?? 0;
                          final decisionColor = switch (decision) {
                            'APPROVED' => AppColors.success,
                            'REJECTED' => AppColors.error,
                            'PENDING' => AppColors.warning,
                            _ => AppColors.textSecondary,
                          };
                          return Container(
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: AppColors.border),
                            ),
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        'Rental ID: ${(v['rentalId'] as String? ?? '').substring(0, 8)}…',
                                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: decisionColor.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(999),
                                      ),
                                      child: Text(
                                        decision,
                                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: decisionColor),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  'Confidence: ${(confidence * 100).toStringAsFixed(1)}%',
                                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                ),
                                if (v['ocrMatch'] != null)
                                  Text(
                                    'OCR Match: ${v['ocrMatch']}',
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                  ),
                                if (decision == 'PENDING') ...[
                                  const SizedBox(height: 10),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: _SmallButton(
                                          label: 'Approve',
                                          color: AppColors.success,
                                          onTap: () => _review(v['id'] as String, 'APPROVED'),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: _SmallButton(
                                          label: 'Reject',
                                          color: AppColors.error,
                                          onTap: () => _review(v['id'] as String, 'REJECTED'),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

// ── Kiosk Page ────────────────────────────────────────────────────────────────

class _KioskPage extends StatefulWidget {
  const _KioskPage();

  @override
  State<_KioskPage> createState() => _KioskPageState();
}

class _KioskPageState extends State<_KioskPage> {
  final _api = ApiService();
  List<Map<String, dynamic>> _kiosks = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get('/admin/kiosks');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() {
          _kiosks = List<Map<String, dynamic>>.from(data['data']['kiosks'] as List? ?? []);
          _loading = false;
        });
      } else {
        setState(() { _loading = false; _error = 'Failed to load kiosks'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _sendCommand(String kioskId, String action) async {
    try {
      final resp = await _api.post('/admin/kiosks/$kioskId/command', {'action': action});
      if (!mounted) return;
      if (resp.statusCode == 200) {
        AppToast.success(context, 'Command Sent', 'Action "$action" dispatched to kiosk.');
      } else {
        AppToast.error(context, 'Failed', 'Command could not be sent.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Error', e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Kiosk Control'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _AdminError(message: _error!, onRetry: _load)
              : _kiosks.isEmpty
                  ? const Center(child: Text('No kiosks registered', style: TextStyle(color: AppColors.textSecondary)))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _kiosks.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (_, i) {
                          final k = _kiosks[i];
                          final isOnline = k['isOnline'] as bool? ?? false;
                          return Container(
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: AppColors.border),
                            ),
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: AppColors.info.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: const Icon(Icons.router_rounded, color: AppColors.info, size: 22),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            k['name'] as String? ?? 'Kiosk ${k['id']?.toString().substring(0, 8)}',
                                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                          ),
                                          Text(
                                            k['location'] as String? ?? 'Location unknown',
                                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: (isOnline ? AppColors.success : AppColors.error).withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(999),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Container(
                                            width: 7,
                                            height: 7,
                                            decoration: BoxDecoration(
                                              color: isOnline ? AppColors.success : AppColors.error,
                                              shape: BoxShape.circle,
                                            ),
                                          ),
                                          const SizedBox(width: 4),
                                          Text(
                                            isOnline ? 'Online' : 'Offline',
                                            style: TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w700,
                                              color: isOnline ? AppColors.success : AppColors.error,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    _SmallButton(
                                      label: 'Open All Doors',
                                      color: AppColors.primary,
                                      onTap: () => _sendCommand(k['id'] as String, 'open_all'),
                                    ),
                                    _SmallButton(
                                      label: 'Capture Image',
                                      color: AppColors.secondary,
                                      onTap: () => _sendCommand(k['id'] as String, 'capture_image'),
                                    ),
                                    _SmallButton(
                                      label: 'Restart',
                                      color: AppColors.warning,
                                      onTap: () => _sendCommand(k['id'] as String, 'restart'),
                                    ),
                                    _SmallButton(
                                      label: 'Diagnose',
                                      color: AppColors.info,
                                      onTap: () => _sendCommand(k['id'] as String, 'diagnose'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

// ── Shared sub-widgets ────────────────────────────────────────────────────────

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color),
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
        ],
      ),
    );
  }
}

class _AdminActionCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _AdminActionCard({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(width: 10),
            Expanded(
              child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.grey, size: 18),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String text;
  const _SectionHeader(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
    );
  }
}

class _SmallButton extends StatelessWidget {
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _SmallButton({required this.label, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12),
          ),
        ),
      ),
    );
  }
}

class _AdminError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _AdminError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppColors.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 12),
            ElevatedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
