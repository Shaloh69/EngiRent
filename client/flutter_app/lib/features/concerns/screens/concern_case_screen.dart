import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../concern_api.dart';
import '../widgets/evidence_widgets.dart';
import 'report_concern_screen.dart';

/// Concerns v2: one case as one of its two students sees it. What happened,
/// what happens next, both sides' statements, photos and video, the decision in
/// plain words, and paying what is owed. Refreshes itself when the case changes.
/// With [restricted], it is shown in place of the app until the debt is paid.
class ConcernCaseScreen extends StatefulWidget {
  final String concernId;
  final bool restricted;
  const ConcernCaseScreen({super.key, required this.concernId, this.restricted = false});

  @override
  State<ConcernCaseScreen> createState() => _ConcernCaseScreenState();
}

class _ConcernCaseScreenState extends State<ConcernCaseScreen> {
  Map<String, dynamic>? _c;
  String? _error;
  StreamSubscription? _sub;
  final _reference = TextEditingController();
  bool _paying = false;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = SocketService.instance.onConcernUpdate.listen((e) {
      if (e['concernId'] == widget.concernId) _load();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final c = await ConcernApi.get(widget.concernId);
      if (!mounted) return;
      setState(() {
        _c = c;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _answer() async {
    final c = _c!;
    final sent = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => ReportConcernScreen(
          kind: c['kind'] as String,
          concernId: c['id'] as String,
          referenceNo: c['referenceNo'] as String?,
          itemTitle: c['itemTitle'] as String,
          requirement: Map<String, dynamic>.from(c['respondRequirement'] as Map),
          closesAt: c['responseDueAt'] as String?,
        ),
      ),
    );
    if (sent == true) _load();
  }

  Future<void> _pay() async {
    setState(() => _paying = true);
    try {
      await ConcernApi.pay(widget.concernId, _reference.text.trim());
      if (!mounted) return;
      AppToast.success(context, 'Payment sent', 'Staff will confirm it. Your account stays limited until then.');
      _reference.clear();
      _load();
    } catch (e) {
      if (mounted) AppToast.error(context, 'Not sent', e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !widget.restricted,
        title: Text(c == null ? 'Case' : c['referenceNo'] as String),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded), tooltip: 'Refresh')],
      ),
      body: _error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
          : c == null
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(onRefresh: _load, child: _body(context, c)),
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> c) {
    final p = AppPalette.of(context);
    final status = c['status'] as String;
    final evidence = List<Map<String, dynamic>>.from((c['evidence'] as List).map((e) => Map<String, dynamic>.from(e as Map)));
    final reporterParty = c['reporterParty'] as String;
    final mineFirst = c['viewerRole'] == 'REPORTER';
    final reporterEv = evidence.where((e) => e['party'] == reporterParty).toList();
    final otherEv = evidence.where((e) => e['party'] != null && e['party'] != reporterParty).toList();
    final decision = c['decision'] as Map?;
    final payment = c['payment'] as Map?;
    final events = List<Map<String, dynamic>>.from((c['events'] as List).map((e) => Map<String, dynamic>.from(e as Map)));
    final otherParty = ConcernText.party(reporterParty == 'RENTER' ? 'OWNER' : 'RENTER');
    final reportTitle = mineFirst ? 'Your report' : "${ConcernText.party(reporterParty)}'s report";
    final answerTitle = mineFirst ? "$otherParty's answer" : 'Your answer';
    final due = ConcernText.when(c['responseDueAt'] as String?);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        if (widget.restricted)
          AppCard(
            color: AppColors.error.withValues(alpha: 0.08),
            borderColor: AppColors.error.withValues(alpha: 0.4),
            child: const Text(
              'Your account is limited until the amount below is paid. You can still open this case and pay.',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        if (widget.restricted) const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            // Pill under the title: beside it, a long status squeezed the title
            // into a narrow column.
            Text(c['title'] as String, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            StatusPill(
              label: ConcernText.status(status, mine: mineFirst, settled: c['settled'] == true),
              color: ConcernText.statusColor(status, settled: c['settled'] == true),
            ),
            const SizedBox(height: 6),
            Text('${c['itemTitle']} · reported ${ConcernText.when((events.isNotEmpty ? events.first['at'] : null) as String?)}',
                style: TextStyle(color: p.muted)),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          color: AppColors.info.withValues(alpha: 0.08),
          borderColor: AppColors.info.withValues(alpha: 0.35),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.info_outline_rounded, color: AppColors.info),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('What happens next', style: TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(c['nextStep'] as String, style: const TextStyle(height: 1.4)),
              ]),
            ),
          ]),
        ),
        if (c['canRespond'] == true) ...[
          const SizedBox(height: 12),
          ElevatedButton.icon(onPressed: _answer, icon: const Icon(Icons.reply_rounded), label: const Text('Give your side')),
        ],
        if (decision != null) ...[
          const SizedBox(height: 12),
          _DecisionCard(kind: c['kind'] as String, d: Map<String, dynamic>.from(decision), events: events, viewerParty: c['viewerParty'] as String),
        ],
        if (payment != null) ...[
          const SizedBox(height: 12),
          _paymentCard(context, Map<String, dynamic>.from(payment)),
        ],
        const SizedBox(height: 16),
        _Side(label: reportTitle, evidence: reporterEv, empty: 'No evidence.'),
        const SizedBox(height: 12),
        _Side(
          label: answerTitle,
          evidence: otherEv,
          empty: c['respondedAt'] != null
              ? 'Answered without photos or video.'
              : status == 'AWAITING_RESPONSE'
                  ? (mineFirst ? 'No answer yet. They can answer until $due.' : 'You have not answered yet. You can answer until $due.')
                  : (mineFirst ? 'They did not answer.' : 'You did not answer.'),
        ),
        const SizedBox(height: 16),
        const SectionLabel('Timeline'),
        for (final e in events)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.circle, size: 8, color: p.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${e['actor'] == 'SYSTEM' ? 'EngiRent' : ConcernText.party(e['actor'] as String?)} · ${ConcernText.when(e['at'] as String?)}',
                      style: TextStyle(fontSize: 12, color: p.muted)),
                  Text(e['message'] as String, style: const TextStyle(height: 1.35)),
                ]),
              ),
            ]),
          ),
      ],
    );
  }

  Widget _paymentCard(BuildContext context, Map<String, dynamic> pay) {
    final p = AppPalette.of(context);
    final pending = pay['pending'] as Map?;
    return AppCard(
      color: AppColors.warning.withValues(alpha: 0.08),
      borderColor: AppColors.warning.withValues(alpha: 0.45),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('You owe ${ConcernText.peso(pay['amount'] as num?)}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        if (pending != null)
          Text(
            'Your payment (reference ${pending['paymentReferenceNo']}) was sent on ${ConcernText.when(pending['createdAt'] as String?)}. '
            'Staff will confirm it ${pay['confirmWindow']}; your account stays limited until then.',
            style: const TextStyle(height: 1.4),
          )
        else ...[
          Text(
            'Send it by ${pay['channel']} to ${pay['accountName'] ?? 'EngiRent'}${pay['accountNumber'] != null ? ' (${pay['accountNumber']})' : ''}, '
            'with ${pay['reference']} in the message. Then enter the reference number from your receipt below.',
            style: const TextStyle(height: 1.4),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _reference,
            decoration: const InputDecoration(labelText: 'Reference number from your receipt'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 10),
          ElevatedButton(
            onPressed: _reference.text.trim().length >= 4 && !_paying ? _pay : null,
            child: Text(_paying ? 'Sending…' : 'I have sent it'),
          ),
          const SizedBox(height: 4),
          Text('Staff confirm it ${pay['confirmWindow']}. Your account limit lifts when they do.', style: TextStyle(fontSize: 12, color: p.muted)),
        ],
      ]),
    );
  }
}

class _Side extends StatelessWidget {
  final String label;
  final List<Map<String, dynamic>> evidence;
  final String empty;
  const _Side({required this.label, required this.evidence, required this.empty});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final statement = evidence.where((e) => e['type'] == 'STATEMENT').firstOrNull;
    final photos = evidence.where((e) => e['type'] == 'PHOTO' && e['url'] != null).toList();
    final videos = evidence.where((e) => e['type'] == 'VIDEO' && e['url'] != null).toList();
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        if (statement == null && photos.isEmpty && videos.isEmpty)
          Text(empty, style: TextStyle(color: p.muted))
        else ...[
          if (statement != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: p.surfaceAlt, borderRadius: BorderRadius.circular(10)),
              child: Text(statement['text'] as String? ?? '', style: const TextStyle(height: 1.4)),
            ),
          if (photos.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: [for (final ph in photos) EvidencePhoto(url: ph['url'] as String)]),
          ],
          for (final v in videos) ...[
            const SizedBox(height: 10),
            EvidenceVideo(key: ValueKey(v['id']), url: v['url'] as String),
          ],
        ],
      ]),
    );
  }
}

class _DecisionCard extends StatelessWidget {
  final String kind;
  final Map<String, dynamic> d;
  final List<Map<String, dynamic>> events;
  final String viewerParty;
  const _DecisionCard({required this.kind, required this.d, required this.events, required this.viewerParty});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final decided = events.where((e) => e['type'] == 'DECIDED' || e['type'] == 'CLOSED').lastOrNull;
    final pct = d['responsibilityPct'] as num?;
    final rows = <MapEntry<String, String>>[
      if (pct != null && kind != 'RETURN_CHECK')
        MapEntry(kind == 'DEFECT_ON_RECEIPT' ? 'Owner responsible' : 'Renter responsible', '$pct%'),
      if (kind == 'DEFECT_ON_RECEIPT') MapEntry('Rent given back to the renter', ConcernText.peso(d['refundAmount'] as num?)),
      if (kind == 'DAMAGE_ON_RETURN') ...[
        MapEntry('Damage assessed', ConcernText.peso(d['assessedAmount'] as num?)),
        MapEntry('Taken from the deposit', ConcernText.peso(d['fromDeposit'] as num?)),
        if (((d['amountOwed'] as num?) ?? 0) > 0)
          if (d['owedPaidAt'] != null) ...[
            // Two short rows: InfoRow gives its value full width, so one long
            // "₱200.00 · Oct 15, 11:18 PM" squeezed the label to a column.
            MapEntry('Paid by the renter', ConcernText.peso(d['amountOwed'] as num?)),
            MapEntry('Payment confirmed', ConcernText.when(d['owedPaidAt'] as String?)),
          ] else
            MapEntry('Still owed by the renter', ConcernText.peso(d['amountOwed'] as num?)),
      ],
    ];
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.gavel_rounded, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text('The decision · ${ConcernText.when(d['decidedAt'] as String?)}',
                style: const TextStyle(fontWeight: FontWeight.w800)),
          ),
        ]),
        const SizedBox(height: 8),
        for (final r in rows) InfoRow(label: r.key, value: r.value),
        if (decided != null) ...[
          const SizedBox(height: 8),
          Text(decided['message'] as String, style: const TextStyle(height: 1.4)),
        ] else if (d['note'] != null) ...[
          const SizedBox(height: 8),
          Text(d['note'] as String, style: TextStyle(color: p.muted, height: 1.4)),
        ],
      ]),
    );
  }
}
