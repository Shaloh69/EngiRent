import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../constants/app_colors.dart';

/// "As of" marker for cached data shown while offline — checklist Stage 4.2.
/// Shown above a list rather than replacing it, so cached content is never
/// mistaken for an empty state or for live data.
class StaleDataBanner extends StatelessWidget {
  const StaleDataBanner({super.key, required this.cachedAt});
  final DateTime cachedAt;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.history_rounded, size: 14, color: AppColors.warning),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Showing saved results from ${timeago.format(cachedAt)}',
              style: const TextStyle(fontSize: 11.5, color: AppColors.warning, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
