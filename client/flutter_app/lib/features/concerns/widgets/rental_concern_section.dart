import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/widgets/app_widgets.dart';
import '../concern_api.dart';
import '../screens/concern_case_screen.dart';
import '../screens/report_concern_screen.dart';

/// Concerns v2 on the rental screen. Replaces the old "Raise a concern about
/// this return" button (which vanished the moment a return was approved, could
/// be pressed again and again, and never refreshed). It shows:
///  - the reports this student can make right now, each with its deadline;
///  - every case on this rental, with its status, tappable;
///  - for the renter, whether their deposit is being held and until when.
/// Everything comes from GET /concerns/options, so it is never out of step with
/// the server, and it reloads whenever anything about this rental changes.
class RentalConcernSection extends StatefulWidget {
  final String rentalId;
  final String itemTitle;
  const RentalConcernSection({super.key, required this.rentalId, required this.itemTitle});

  @override
  State<RentalConcernSection> createState() => _RentalConcernSectionState();
}

class _RentalConcernSectionState extends State<RentalConcernSection> {
  Map<String, dynamic>? _o;
  StreamSubscription? _sub;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = SocketService.instance.onAnyRentalChange.listen((e) {
      if (e['rentalId'] == widget.rentalId) _load();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final o = await ConcernApi.options(widget.rentalId).catchError((_) => null);
    if (mounted) setState(() => _o = o);
  }

  Future<void> _report(Map<String, dynamic> w) async {
    // Held before the await: sending a report fires concern:update, the rental
    // screen reloads and rebuilds this section, so by the time the report
    // screen pops this State is no longer mounted and the case would never open.
    final nav = Navigator.of(context);
    final id = await nav.push<String>(
      MaterialPageRoute(
        builder: (_) => ReportConcernScreen(
          kind: w['kind'] as String,
          rentalId: widget.rentalId,
          itemTitle: widget.itemTitle,
          requirement: Map<String, dynamic>.from(w['requirement'] as Map),
          closesAt: w['closesAt'] as String?,
        ),
      ),
    );
    if (id != null && nav.mounted) {
      nav.push(MaterialPageRoute(builder: (_) => ConcernCaseScreen(concernId: id)));
    }
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final o = _o;
    if (o == null) return const SizedBox.shrink();
    final p = AppPalette.of(context);
    final windows = List<Map<String, dynamic>>.from((o['windows'] as List).map((w) => Map<String, dynamic>.from(w as Map)))
        .where((w) => w['canReport'] == true)
        .toList();
    final cases = List<Map<String, dynamic>>.from((o['cases'] as List).map((c) => Map<String, dynamic>.from(c as Map)));
    final hold = o['depositHoldUntil'] as String?;
    final isRenter = o['viewer'] == 'RENTER';
    if (windows.isEmpty && cases.isEmpty && !(isRenter && hold != null)) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 16),
        const SectionLabel('Problems with this rental'),
        if (isRenter && hold != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: AppCard(
              color: AppColors.info.withValues(alpha: 0.08),
              borderColor: AppColors.info.withValues(alpha: 0.35),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.lock_clock_rounded, color: AppColors.info),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Your deposit is held until ${ConcernText.when(hold)} while the owner checks the item. '
                    'If they report no damage, it is refunded automatically.',
                    style: const TextStyle(height: 1.4),
                  ),
                ),
              ]),
            ),
          ),
        for (final c in cases)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              onTap: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => ConcernCaseScreen(concernId: c['id'] as String)));
                _load();
              },
              child: Row(children: [
                const Icon(Icons.report_gmailerrorred_rounded),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(ConcernText.title(c['kind'] as String), style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text('${c['referenceNo']} · ${c['mine'] == true ? 'you reported it' : 'reported about you'}',
                        style: TextStyle(fontSize: 12, color: p.muted)),
                    const SizedBox(height: 6),
                    StatusPill(
                      label: ConcernText.status(c['status'] as String, mine: c['mine'] == true, settled: c['settled'] == true),
                      color: ConcernText.statusColor(c['status'] as String, settled: c['settled'] == true),
                      dense: true,
                    ),
                  ]),
                ),
                const Icon(Icons.chevron_right_rounded),
              ]),
            ),
          ),
        for (final w in windows)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              onPressed: () => _report(w),
              style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14), alignment: Alignment.centerLeft),
              child: Row(children: [
                const Icon(Icons.flag_rounded),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(ConcernText.button(w['kind'] as String), style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(
                      w['closesAt'] != null
                          ? 'You can report this until ${ConcernText.when(w['closesAt'] as String?)}'
                          : ConcernText.openUntil(w['kind'] as String),
                      style: TextStyle(fontSize: 12, color: p.muted),
                    ),
                  ]),
                ),
              ]),
            ),
          ),
      ],
    );
  }
}
