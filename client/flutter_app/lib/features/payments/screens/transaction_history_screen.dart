import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/widgets/app_widgets.dart';

/// Checklist Stage 9 — `GET /payments` already existed and was called by
/// nothing; a student had no way to see their own payment/refund/fee
/// history at all. Read-only, own transactions only (the endpoint is
/// already scoped server-side to the caller).
class TransactionHistoryScreen extends StatefulWidget {
  const TransactionHistoryScreen({super.key});

  @override
  State<TransactionHistoryScreen> createState() => _TransactionHistoryScreenState();
}

class _Txn {
  final String id;
  final String type;
  final String status;
  final double amount;
  final DateTime createdAt;
  final String? itemTitle;

  _Txn({
    required this.id,
    required this.type,
    required this.status,
    required this.amount,
    required this.createdAt,
    this.itemTitle,
  });

  factory _Txn.fromJson(Map<String, dynamic> j) => _Txn(
        id: j['id'] as String,
        type: j['type'] as String,
        status: j['status'] as String,
        amount: (j['amount'] as num).toDouble(),
        createdAt: DateTime.parse(j['createdAt'] as String),
        itemTitle: (j['rental'] as Map<String, dynamic>?)?['item']?['title'] as String?,
      );
}

const _typeLabels = <String, String>{
  'RENTAL_PAYMENT': 'Rental payment',
  'SECURITY_DEPOSIT': 'Security deposit',
  'DEPOSIT_REFUND': 'Deposit refund',
  'LATE_FEE': 'Late fee',
  'DAMAGE_FEE': 'Damage fee',
  'EXTENSION_FEE': 'Extension fee',
  'OWNER_PAYOUT': 'Owner payout',
};

// Money coming back to the student — everything else is money going out.
const _incomingTypes = {'DEPOSIT_REFUND', 'OWNER_PAYOUT'};

class _TransactionHistoryScreenState extends State<TransactionHistoryScreen> {
  final _api = ApiService();
  final _dateFmt = DateFormat('MMM d, yyyy');
  final List<_Txn> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  bool _hasMore = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; _page = 1; _items.clear(); });
    await _fetchPage();
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _fetchPage() async {
    try {
      final resp = await _api.get('/payments?page=$_page&limit=20');
      final data = jsonDecode(resp.body);
      if (resp.statusCode == 200 && data['success'] == true) {
        final rows = (data['data']['transactions'] as List<dynamic>)
            .map((j) => _Txn.fromJson(j as Map<String, dynamic>))
            .toList();
        final totalPages = data['data']['pagination']?['totalPages'] as int? ?? 1;
        if (!mounted) return;
        setState(() {
          _items.addAll(rows);
          _hasMore = _page < totalPages;
        });
      } else {
        if (!mounted) return;
        setState(() => _error = data['error'] as String? ?? 'Could not load your transactions');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = friendlyErrorMessage(e));
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    _page++;
    await _fetchPage();
    if (mounted) setState(() => _loadingMore = false);
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Transaction History')),
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
              : _items.isEmpty
                  ? Center(
                      child: Text('No transactions yet', style: TextStyle(color: p.muted)),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: NotificationListener<ScrollEndNotification>(
                        onNotification: (n) {
                          if (n.metrics.extentAfter < 200) _loadMore();
                          return false;
                        },
                        child: ListView.separated(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          itemCount: _items.length + (_hasMore ? 1 : 0),
                          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.xs),
                          itemBuilder: (context, i) {
                            if (i >= _items.length) {
                              return const Padding(
                                padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                                child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                              );
                            }
                            final t = _items[i];
                            final incoming = _incomingTypes.contains(t.type);
                            return AppCard(
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          _typeLabels[t.type] ?? t.type,
                                          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: p.ink),
                                        ),
                                        if (t.itemTitle != null) ...[
                                          const SizedBox(height: 2),
                                          Text(t.itemTitle!, style: TextStyle(fontSize: 12.5, color: p.muted)),
                                        ],
                                        const SizedBox(height: 4),
                                        Text(_dateFmt.format(t.createdAt), style: TextStyle(fontSize: 11.5, color: p.muted)),
                                      ],
                                    ),
                                  ),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        '${incoming ? '+' : '−'}₱${t.amount.toStringAsFixed(2)}',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w800,
                                          fontSize: 14,
                                          color: incoming ? AppColors.success : p.ink,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      StatusPill(
                                        label: t.status,
                                        color: switch (t.status) {
                                          'COMPLETED' => AppColors.success,
                                          'FAILED' => AppColors.error,
                                          'REFUNDED' => AppColors.info,
                                          _ => AppColors.warning,
                                        },
                                        dense: true,
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
    );
  }
}
