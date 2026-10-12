import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';

/// Shown on the locker screen when the quick check asks for a retry (user
/// request 2026-10-12): the AI's own sentence and what the locker camera saw,
/// so the person at the open door can see WHY ("More than one object is in the
/// locker") instead of a generic "reposition the item". The server sends the
/// reason and up to three signed photo URLs only to the person who placed it.
///
/// Sits on the dark locker screen, so it is built for white text. A photo that
/// cannot load (an expired link, no signal) shows a plain placeholder and never
/// blocks the rest of the screen.
class RetryFeedbackCard extends StatelessWidget {
  final String? reason;
  final bool reposition;
  final List<String> imageUrls;

  const RetryFeedbackCard({
    super.key,
    required this.reason,
    required this.reposition,
    required this.imageUrls,
  });

  /// Whether there is anything to show: the card is skipped entirely otherwise,
  /// leaving the screen's own generic line in charge.
  static bool hasContent(String? reason, List<String> imageUrls) =>
      (reason != null && reason.trim().isNotEmpty) || imageUrls.isNotEmpty;

  /// The attempt the person is now on after a retry. The server's
  /// `attemptNumber` is the check that JUST ran (`returnAttemptCount + 1`, so
  /// 1 on the first retry); the next one is that plus one. D-118: copying it
  /// as-is left the screen on attempt 1 after the first retry, and everything
  /// here only shows from attempt 2, so the AI's reason and the photos never
  /// appeared on a real retry.
  static int attemptAfterRetry(Object? checkedAttempt, int current) {
    // Without a number, the check that ran was at least the first one.
    final checked = checkedAttempt is num ? checkedAttempt.toInt() : (current < 1 ? 1 : current);
    return checked + 1;
  }

  @override
  Widget build(BuildContext context) {
    final hasReason = reason != null && reason!.trim().isNotEmpty;
    return Container(
      key: const ValueKey('retry-feedback-card'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.visibility_rounded, size: 18, color: AppColors.warning),
              const SizedBox(width: 8),
              Text(
                reposition ? 'Why the AI asked you to move it' : 'What the AI said',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Colors.white),
              ),
            ],
          ),
          if (hasReason) ...[
            const SizedBox(height: 8),
            Text(
              reason!.trim(),
              key: const ValueKey('retry-feedback-reason'),
              style: const TextStyle(fontSize: 14, height: 1.4, color: Colors.white),
            ),
          ],
          if (imageUrls.isNotEmpty) ...[
            const SizedBox(height: 12),
            _Photo(url: imageUrls.first, onTap: () => _open(context, imageUrls.first), large: true),
            if (imageUrls.length > 1) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  for (final url in imageUrls.skip(1))
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: _Photo(url: url, onTap: () => _open(context, url), large: false),
                      ),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 6),
            const Text(
              'This is what the locker camera saw. Tap a photo to enlarge it.',
              style: TextStyle(fontSize: 11.5, color: Colors.white60),
            ),
          ],
        ],
      ),
    );
  }

  void _open(BuildContext context, String url) {
    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(
          children: [
            InteractiveViewer(
              child: Image.network(url, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const _Missing(height: 240)),
            ),
            Positioned(
              top: 4,
              right: 4,
              child: IconButton(
                icon: const Icon(Icons.close_rounded, color: Colors.white),
                tooltip: 'Close',
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Photo extends StatelessWidget {
  final String url;
  final VoidCallback onTap;
  final bool large;
  const _Photo({required this.url, required this.onTap, required this.large});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Photo from the locker camera',
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: AspectRatio(
            aspectRatio: large ? 16 / 9 : 4 / 3,
            child: Image.network(
              url,
              key: ValueKey('retry-photo-$url'),
              fit: BoxFit.cover,
              loadingBuilder: (context, child, progress) => progress == null
                  ? child
                  : const ColoredBox(
                      color: Color(0x22FFFFFF),
                      child: Center(
                        child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
                      ),
                    ),
              errorBuilder: (_, __, ___) => const _Missing(),
            ),
          ),
        ),
      ),
    );
  }
}

class _Missing extends StatelessWidget {
  final double? height;
  const _Missing({this.height});

  @override
  Widget build(BuildContext context) => Container(
        height: height,
        color: const Color(0x22FFFFFF),
        alignment: Alignment.center,
        child: const Padding(
          padding: EdgeInsets.all(8),
          child: Text(
            'Photo not available',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: Colors.white60),
          ),
        ),
      );
}
