import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../auth/providers/auth_provider.dart';
import '../../kiosk/screens/kiosk_scan_screen.dart';
import '../dispute_api.dart';

/// Dispute System v2 (user rulings 2026-10-11).
///
/// For the RENTER this is the case in full (ruling 14): the countdown, the
/// amount owed and the fee schedule, the steps in kiosk order, the
/// consequences, the AI's reason in plain words, and every message they were
/// sent. When [restricted] it IS the app (ruling 3): no back to Home, only the
/// things the renter is allowed to do. The server enforces the restriction;
/// this screen only makes it clear.
///
/// For the OWNER it is a status page (ruling 9): they are out of the dispute,
/// their payout is held, and they are told when the item is back.
class DisputeCaseScreen extends StatefulWidget {
  final String disputeId;
  final bool restricted;

  const DisputeCaseScreen({super.key, required this.disputeId, this.restricted = false});

  @override
  State<DisputeCaseScreen> createState() => _DisputeCaseScreenState();
}

class _DisputeCaseScreenState extends State<DisputeCaseScreen> {
  Map<String, dynamic>? _c;
  String? _error;
  bool _loading = true;
  Timer? _ticker;
  final List<StreamSubscription> _subs = [];

  static final _peso = NumberFormat.currency(locale: 'en_PH', symbol: '₱', decimalDigits: 2);
  static final _when = DateFormat('MMM d, y · h:mm a');

  @override
  void initState() {
    super.initState();
    _load();
    _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
    _subs.add(SocketService.instance.onDisputeUpdate.listen((_) => _load(quiet: true)));
    _subs.add(SocketService.instance.onReturnDisputed.listen((_) => _load(quiet: true)));
  }

  @override
  void dispose() {
    _ticker?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) setState(() => _loading = true);
    try {
      final c = await DisputeApi.get(widget.disputeId);
      if (!mounted) return;
      setState(() {
        _c = c;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = friendlyErrorMessage(e);
        _loading = false;
      });
    }
  }

  String _countdown(String? iso) {
    if (iso == null) return '—';
    final ms = DateTime.parse(iso).difference(DateTime.now());
    final abs = ms.abs();
    final d = abs.inDays, h = abs.inHours % 24, m = abs.inMinutes % 60;
    final span = d > 0 ? '$d d $h h' : (h > 0 ? '$h h $m min' : '$m min');
    return ms.isNegative ? 'Overdue by $span' : '$span left';
  }

  String _fmt(String? iso) => iso == null ? '—' : _when.format(DateTime.parse(iso).toLocal());

  Future<void> _payAndReturn() async {
    final c = _c!;
    final done = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => KioskScanScreen(rentalId: c['rentalId'] as String, mode: 'dispute', disputeId: c['id'] as String),
      ),
    );
    if (done == true && mounted) AppToast.success(context, 'Return placed', 'An admin will check it and tell you.');
    _load(quiet: true);
  }

  Future<void> _collect() async {
    final wi = _c!['wrongItem'] as Map<String, dynamic>;
    final done = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => KioskScanScreen(rentalId: wi['kioskTarget'] as String, mode: 'collect'),
      ),
    );
    if (done == true && mounted) AppToast.success(context, 'Item collected', 'Thanks for collecting your item.');
    _load(quiet: true);
  }

  Future<void> _requestReview() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Think this is a mistake?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Tell us why. An admin will look at the locker photos again and reply in this case. '
              'Until then the steps and the deadline still apply.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(controller: ctrl, maxLines: 4, decoration: const InputDecoration(labelText: 'Your reason')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Request a review')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await DisputeApi.requestReview(widget.disputeId, ctrl.text.trim());
      if (mounted) AppToast.success(context, 'Review requested', 'An admin will reply in this case.');
      _load(quiet: true);
    } catch (e) {
      if (mounted) AppToast.error(context, 'Could not send', friendlyErrorMessage(e));
    }
  }

  void _contactSupport() {
    Navigator.pushNamed(context, '/feedback/new', arguments: {
      'category': 'OTHER',
      'body': 'About my dispute ${_c?['referenceNo'] ?? ''}: ',
      'contextNote': 'Filed from a dispute — the case is attached automatically.',
      'screen': 'DisputeCaseScreen',
      'rentalId': _c?['rentalId'],
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final c = _c;
    final isRenter = c?['role'] == 'RENTER';

    return PopScope(
      canPop: !widget.restricted,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: !widget.restricted,
          title: Text(c == null ? 'Dispute' : 'Dispute ${c['referenceNo']}'),
          actions: [
            if (widget.restricted)
              IconButton(
                tooltip: 'Log out',
                icon: const Icon(Icons.logout_rounded),
                onPressed: () => context.read<AuthProvider>().logout(),
              ),
          ],
        ),
        body: _loading && c == null
            ? const Center(child: CircularProgressIndicator())
            : _error != null && c == null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        OutlinedButton(onPressed: _load, child: const Text('Try again')),
                      ]),
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: () => _load(quiet: true),
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                      children: isRenter ? _renterView(c!, p) : _ownerView(c!, p),
                    ),
                  ),
      ),
    );
  }

  // ── Renter ────────────────────────────────────────────────────────────────

  List<Widget> _renterView(Map<String, dynamic> c, AppPalette p) {
    final status = c['status'] as String;
    final active = ['OPEN', 'PAYMENT_PENDING', 'PAID', 'RETURN_REVIEW'].contains(status);
    final money = (c['money'] as Map<String, dynamic>?) ?? const {};
    final wi = c['wrongItem'] as Map<String, dynamic>?;
    final verdict = c['aiVerdict'] as Map<String, dynamic>?;
    final prompt = c['prompt'] as Map<String, dynamic>?;
    final owed = (money['owed'] as num?)?.toDouble() ?? 0;
    final overdue = c['deadlineAt'] != null && DateTime.parse(c['deadlineAt'] as String).isBefore(DateTime.now());
    final history = ((c['history'] as List?) ?? const []).cast<Map<String, dynamic>>();

    return [
      if (widget.restricted)
        Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.error.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.error.withValues(alpha: 0.45)),
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.lock_rounded, color: AppColors.error),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                c['suspendedUntilReview'] == true
                    ? 'Your account is suspended until an admin reviews it. You can still finish this case below.'
                    : 'Your account is restricted until this case is resolved. You can only view it, collect your own item, '
                        'pay, return the correct item, and request a review or contact support.',
                style: TextStyle(color: p.ink, fontSize: 13.5, height: 1.4, fontWeight: FontWeight.w600),
              ),
            ),
          ]),
        ),
      if (active) ...[
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(prompt?['title'] as String? ?? 'Return disputed', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: p.ink)),
            const SizedBox(height: 10),
            Row(children: [
              Icon(Icons.timer_outlined, color: overdue ? AppColors.error : AppColors.warning),
              const SizedBox(width: 8),
              Text(_countdown(c['deadlineAt'] as String?),
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 20, color: overdue ? AppColors.error : p.ink)),
            ]),
            Text('Deadline: ${_fmt(c['deadlineAt'] as String?)}', style: TextStyle(color: p.muted, fontSize: 12.5)),
            const Divider(height: 22),
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Amount owed now', style: TextStyle(color: p.muted, fontSize: 12.5)),
                  Text(_peso.format(owed), style: TextStyle(fontWeight: FontWeight.w900, fontSize: 26, color: p.ink)),
                ]),
              ),
              if (money['frozen'] == true)
                Chip(label: const Text('Frozen: payment submitted'), backgroundColor: AppColors.info.withValues(alpha: 0.15)),
            ]),
            if ((money['pending'] as num? ?? 0) > 0)
              Text('${_peso.format(money['pending'])} submitted, waiting for confirmation.', style: TextStyle(color: p.muted, fontSize: 12.5)),
            if ((money['paid'] as num? ?? 0) > 0)
              Text('Paid so far: ${_peso.format(money['paid'])}', style: TextStyle(color: p.muted, fontSize: 12.5)),
          ]),
        ),
        const SizedBox(height: 12),
        _section(p, 'What to do', [
          _step(p, 1, 'Go to the kiosk, scan the QR code and pay the amount owed. It stops growing once you pay.',
              done: ['PAID', 'RETURN_REVIEW'].contains(status)),
          _step(p, 2, 'Put the correct ${c['itemTitle']} in the locker when the upper door opens.', done: status == 'RETURN_REVIEW'),
          _step(
            p,
            3,
            wi == null
                ? 'Collect the item you left at the kiosk.'
                : 'Collect the item you left from locker ${wi['lockerNumber']}, ${wi['door'] == 'bottom_door' ? 'lower' : 'upper'} door, at any time. You do not need to pay first.',
            done: wi?['collectedAt'] != null,
          ),
        ]),
        const SizedBox(height: 12),
        if (status != 'RETURN_REVIEW')
          FilledButton.icon(
            onPressed: _payAndReturn,
            icon: const Icon(Icons.qr_code_scanner_rounded),
            label: Text(owed > 0 ? 'Pay ${_peso.format(owed)} and return at the kiosk' : 'Return the item at the kiosk'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)),
          ),
        if (status == 'RETURN_REVIEW')
          AppCard(
            child: Text('You placed an item for the return. An admin is checking it now and will tell you the result here.',
                style: TextStyle(color: p.ink)),
          ),
        if (wi != null && wi['collectable'] == true) ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _collect,
            icon: const Icon(Icons.inventory_2_outlined),
            label: Text('Collect my item (locker ${wi['lockerNumber']})'),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
          ),
        ],
        if (wi != null && wi['moving'] == true) ...[
          const SizedBox(height: 10),
          Text('Your item is being moved to the lower door of locker ${wi['lockerNumber']}. You can collect it in a minute.',
              style: TextStyle(color: p.muted, fontSize: 12.5)),
        ],
        const SizedBox(height: 12),
      ] else
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(status == 'CANCELLED' ? 'Case cancelled' : 'Case closed',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: p.ink)),
            const SizedBox(height: 6),
            Text('Closed ${_fmt(c['resolvedAt'] as String?)}', style: TextStyle(color: p.muted)),
          ]),
        ),
      if (verdict != null) ...[
        const SizedBox(height: 12),
        _section(p, 'What the AI saw', [
          Text(verdict['headline'] as String? ?? '', style: TextStyle(fontWeight: FontWeight.w700, color: p.ink)),
          const SizedBox(height: 6),
          ...((verdict['points'] as List?) ?? const []).map((pt) => Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text('• $pt', style: TextStyle(color: p.muted, fontSize: 13, height: 1.35)),
              )),
          const SizedBox(height: 6),
          Text('An admin looked at the locker photos and made the decision; the AI alone never does.',
              style: TextStyle(color: p.muted, fontSize: 12, fontStyle: FontStyle.italic)),
        ]),
      ],
      if (active) ...[
        const SizedBox(height: 12),
        _feeTable(p, money),
      ],
      if (prompt != null) ...[
        const SizedBox(height: 12),
        _section(p, 'The full notice', [
          Text(prompt['message'] as String? ?? '', style: TextStyle(color: p.ink, fontSize: 13, height: 1.45)),
        ]),
      ],
      const SizedBox(height: 12),
      _section(p, 'History', [
        for (final h in history.reversed)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_fmt(h['at'] as String?), style: TextStyle(color: p.muted, fontSize: 11.5)),
              Text((h['title'] as String?) ?? _eventLabel(h['type'] as String? ?? ''),
                  style: TextStyle(color: p.ink, fontWeight: FontWeight.w600, fontSize: 13.5)),
            ]),
          ),
      ]),
      const SizedBox(height: 16),
      if (active && c['reviewRequestedAt'] == null)
        OutlinedButton.icon(
          onPressed: _requestReview,
          icon: const Icon(Icons.rate_review_outlined),
          label: const Text('Think this is a mistake? Request a review'),
        ),
      if (c['reviewRequestedAt'] != null)
        Text('Review requested ${_fmt(c['reviewRequestedAt'] as String?)}. An admin will reply here.',
            textAlign: TextAlign.center, style: TextStyle(color: p.muted, fontSize: 12.5)),
      TextButton.icon(
        onPressed: _contactSupport,
        icon: const Icon(Icons.support_agent_rounded),
        label: const Text('Contact support'),
      ),
    ];
  }

  Widget _feeTable(AppPalette p, Map<String, dynamic> money) {
    final schedule = ((money['schedule'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final capFromReplacement = money['feeCapSource'] == 'REPLACEMENT_VALUE';
    return _section(p, 'How the fee grows', [
      Text('Counted from ${_fmt(money['feeStartAt'] as String?)}:', style: TextStyle(color: p.muted, fontSize: 12.5)),
      const SizedBox(height: 6),
      for (final b in schedule)
        Row(children: [
          Expanded(child: Text('Days ${b['fromDay']}${b['toDay'] != null ? '-${b['toDay']}' : '+'}', style: TextStyle(color: p.ink))),
          Text('${_peso.format(b['perDay'])} a day', style: TextStyle(color: p.ink, fontWeight: FontWeight.w600)),
        ]),
      const SizedBox(height: 6),
      Text(
        capFromReplacement
            ? 'Never more than ${_peso.format(money['feeCap'])}, the item\'s replacement value.'
            : 'Never more than ${_peso.format(money['feeCap'])} (30 days of the daily price, until the owner states the item\'s replacement value).',
        style: TextStyle(color: p.muted, fontSize: 12.5),
      ),
    ]);
  }

  // ── Owner ─────────────────────────────────────────────────────────────────

  List<Widget> _ownerView(Map<String, dynamic> c, AppPalette p) {
    final verdict = c['aiVerdict'] as Map<String, dynamic>?;
    final messages = ((c['messages'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final closed = ['RESOLVED', 'CANCELLED'].contains(c['status']);
    return [
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(closed ? 'This dispute is closed' : 'Your item\'s return is under dispute',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: p.ink)),
          const SizedBox(height: 8),
          Text(
            closed
                ? (c['resolution'] == 'CORRECT_ITEM_RETURNED'
                    ? 'Your item is back and checked. Collect it at the kiosk from the rental page.'
                    : 'An admin closed this case. See the messages below.')
                : 'You do not need to do anything. The renter must return your ${c['itemTitle']}; we will tell you as soon as it is back and checked. Your payout is on hold until then.',
            style: TextStyle(color: p.ink, height: 1.4),
          ),
        ]),
      ),
      if (verdict != null) ...[
        const SizedBox(height: 12),
        _section(p, 'What the AI saw', [
          Text(verdict['headline'] as String? ?? '', style: TextStyle(fontWeight: FontWeight.w700, color: p.ink)),
          ...((verdict['points'] as List?) ?? const [])
              .map((pt) => Text('• $pt', style: TextStyle(color: p.muted, fontSize: 13, height: 1.35))),
        ]),
      ],
      const SizedBox(height: 12),
      _section(p, 'Messages to you', [
        for (final m in messages.reversed)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_fmt(m['at'] as String?), style: TextStyle(color: p.muted, fontSize: 11.5)),
              Text(m['title'] as String? ?? '', style: TextStyle(color: p.ink, fontWeight: FontWeight.w700)),
              Text(m['message'] as String? ?? '', style: TextStyle(color: p.ink, fontSize: 13, height: 1.4)),
            ]),
          ),
      ]),
    ];
  }

  // ── Bits ──────────────────────────────────────────────────────────────────

  Widget _section(AppPalette p, String title, List<Widget> children) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: TextStyle(fontWeight: FontWeight.w800, color: p.ink)),
          const SizedBox(height: 8),
          ...children,
        ]),
      );

  Widget _step(AppPalette p, int n, String text, {bool done = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(
            radius: 12,
            backgroundColor: done ? AppColors.success : p.primary,
            child: done
                ? const Icon(Icons.check, size: 14, color: Colors.white)
                : Text('$n', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(color: p.ink, height: 1.4))),
        ]),
      );

  String _eventLabel(String type) => switch (type) {
        'PAYMENT_SUBMITTED' => 'Payment submitted',
        'PAYMENT_CONFIRMED' => 'Payment confirmed',
        'PAYMENT_REJECTED' => 'Payment not completed',
        'FEES_FROZEN' => 'Fees frozen',
        'FEES_RESUMED' => 'Fees resumed',
        'WRONG_ITEM_COLLECTED' => 'You collected your item',
        'CORRECT_ITEM_PLACED' => 'You placed an item for the return',
        'KIOSK_VISIT' => 'You were at the kiosk',
        'KIOSK_VISIT_ENDED' => 'Kiosk visit ended',
        'REVIEW_REQUESTED' => 'You requested a review',
        'DEADLINE_CHANGED' => 'Deadline changed',
        'OPENED' => 'Case opened',
        'RESOLVED' => 'Case closed',
        _ => type.replaceAll('_', ' ').toLowerCase(),
      };
}
