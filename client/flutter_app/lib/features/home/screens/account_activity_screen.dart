import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../notifications/models/notification_service.dart';
import '../../rentals/models/rental_service.dart';

/// Checklist Stage 9 — "account activity log visible to the user." No new
/// audit table for this: rentals and notifications are each already a real,
/// timestamped record of things that happened on this account, so the
/// screen is a read-only merge of the two, newest first, rather than a new
/// backend subsystem to track a second copy of the same events.
class AccountActivityScreen extends StatefulWidget {
  const AccountActivityScreen({super.key});

  @override
  State<AccountActivityScreen> createState() => _AccountActivityScreenState();
}

class _ActivityEntry {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final DateTime at;

  _ActivityEntry({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.at,
  });
}

const _rentalStatusLabels = <String, String>{
  'PENDING': 'Requested',
  'AWAITING_DEPOSIT': 'Awaiting deposit',
  'DEPOSITED': 'Deposited — in the locker',
  'ACTIVE': 'Active — with you',
  'VERIFICATION': 'Return under verification',
  'COMPLETED': 'Completed',
  'CANCELLED': 'Cancelled',
  'DISPUTED': 'Disputed',
};

const _notifIcons = <String, IconData>{
  'BOOKING_CONFIRMED': Icons.event_available_rounded,
  'DEPOSIT_REMINDER': Icons.account_balance_wallet_rounded,
  'ITEM_READY_FOR_CLAIM': Icons.inventory_2_rounded,
  'CLAIM_REMINDER': Icons.notifications_active_rounded,
  'RENTAL_STARTED': Icons.play_circle_outline_rounded,
  'RETURN_REMINDER': Icons.alarm_rounded,
  'RETURN_OVERDUE': Icons.warning_amber_rounded,
  'VERIFICATION_SUCCESS': Icons.verified_rounded,
  'VERIFICATION_FAILED': Icons.error_outline_rounded,
  'PAYMENT_RECEIVED': Icons.payments_rounded,
  'PAYMENT_FAILED': Icons.money_off_rounded,
  'REVIEW_REQUEST': Icons.star_outline_rounded,
  'SYSTEM_ANNOUNCEMENT': Icons.campaign_rounded,
  'FEEDBACK_UPDATE': Icons.forum_rounded,
};

class _AccountActivityScreenState extends State<AccountActivityScreen> {
  final _dateFmt = DateFormat('MMM d, yyyy · h:mm a');
  bool _loading = true;
  String? _error;
  final List<_ActivityEntry> _entries = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    final results = await Future.wait([
      RentalService().getRentals(),
      NotificationService().getNotifications(),
    ]);
    final rentalsResult = results[0];
    final notifsResult = results[1];

    if (rentalsResult['success'] != true && notifsResult['success'] != true) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = (rentalsResult['error'] ?? notifsResult['error'] ?? 'Could not load your activity') as String;
      });
      return;
    }

    final entries = <_ActivityEntry>[];
    if (rentalsResult['success'] == true) {
      for (final r in (rentalsResult['rentals'] as List)) {
        entries.add(_ActivityEntry(
          icon: Icons.receipt_long_rounded,
          iconColor: AppColors.primary,
          title: 'Rental — ${r.item.title}',
          subtitle: _rentalStatusLabels[r.status] ?? r.status,
          at: r.createdAt,
        ));
      }
    }
    if (notifsResult['success'] == true) {
      for (final n in (notifsResult['notifications'] as List)) {
        entries.add(_ActivityEntry(
          icon: _notifIcons[n.type] ?? Icons.notifications_rounded,
          iconColor: AppColors.accent,
          title: n.title,
          subtitle: n.message,
          at: n.createdAt,
        ));
      }
    }
    entries.sort((a, b) => b.at.compareTo(a.at));

    if (!mounted) return;
    setState(() {
      _entries..clear()..addAll(entries);
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Account Activity')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: p.muted)),
                        const SizedBox(height: AppSpacing.sm),
                        OutlinedButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : _entries.isEmpty
                  ? Center(child: Text('No activity yet', style: TextStyle(color: p.muted)))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        itemCount: _entries.length,
                        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.xs),
                        itemBuilder: (context, i) {
                          final e = _entries[i];
                          return AppCard(
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  width: 36,
                                  height: 36,
                                  decoration: BoxDecoration(
                                    color: e.iconColor.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Icon(e.icon, size: 18, color: e.iconColor),
                                ),
                                const SizedBox(width: AppSpacing.sm),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        e.title,
                                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: p.ink),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        e.subtitle,
                                        style: TextStyle(fontSize: 12.5, color: p.muted),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(_dateFmt.format(e.at), style: TextStyle(fontSize: 11, color: p.muted)),
                                    ],
                                  ),
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
