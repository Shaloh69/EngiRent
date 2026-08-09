import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/models/feedback_model.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_widgets.dart';
import '../models/feedback_service.dart';
import 'send_feedback_screen.dart';

/// Profile → Send Feedback lands here first, not straight into the compose
/// form — checklist Stage 3.2 explicitly requires the loop not be one-way:
/// a student who already filed a report should be able to check what
/// happened to it, not just fire a report into the dark a second time.
class FeedbackScreen extends StatefulWidget {
  const FeedbackScreen({super.key});

  @override
  State<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends State<FeedbackScreen> {
  final _service = FeedbackService();
  bool _loading = true;
  String? _error;
  List<FeedbackReport> _reports = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await _service.getMine();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success'] == true) {
        _reports = result['items'] as List<FeedbackReport>;
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  Future<void> _compose() async {
    final sent = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const SendFeedbackScreen()),
    );
    if (sent == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Feedback & Support')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _compose,
        icon: const Icon(Icons.add_rounded),
        label: const Text('New report'),
      ),
      body: RefreshIndicator(onRefresh: _load, child: _buildBody(context)),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        children: [
          const SizedBox(height: 60),
          AppEmptyState(
            icon: Icons.error_outline_rounded,
            title: 'Couldn\'t load your reports',
            body: _error,
            action: FilledButton(onPressed: _load, child: const Text('Retry')),
          ),
        ],
      );
    }
    if (_reports.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        children: [
          const SizedBox(height: 60),
          AppEmptyState(
            icon: Icons.forum_outlined,
            title: 'No reports yet',
            body: 'Hit a bug, a kiosk problem, or have a suggestion? '
                'Tell us and an admin will follow up.',
            action: FilledButton.icon(
              onPressed: _compose,
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Send feedback'),
            ),
          ),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 90),
      itemCount: _reports.length,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, i) => Stagger(index: i, child: _ReportCard(report: _reports[i])),
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report});
  final FeedbackReport report;

  ({String label, Color color}) get _statusMeta => switch (report.status) {
        'ACKNOWLEDGED' => (label: 'Being looked at', color: AppColors.info),
        'RESOLVED' => (label: 'Resolved', color: AppColors.success),
        _ => (label: 'Received', color: AppColors.warning),
      };

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final status = _statusMeta;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  kFeedbackCategories[report.category] ?? report.category,
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: p.ink),
                ),
              ),
              StatusPill(label: status.label, color: status.color, dense: true),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            report.body,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 13, color: p.muted, height: 1.35),
          ),
          const SizedBox(height: 6),
          Text(
            DateFormat('MMM d, y · h:mm a').format(report.createdAt),
            style: TextStyle(fontSize: 10.5, color: p.muted),
          ),
          if (report.status == 'RESOLVED' && (report.adminNote?.isNotEmpty ?? false)) ...[
            const SizedBox(height: AppSpacing.xs),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.xs),
              decoration: BoxDecoration(
                color: AppColors.success.withValues(alpha: 0.08),
                borderRadius: AppRadius.input,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_circle_outline_rounded, size: 14, color: AppColors.success),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      report.adminNote!,
                      style: const TextStyle(fontSize: 12, color: AppColors.success, height: 1.3),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
