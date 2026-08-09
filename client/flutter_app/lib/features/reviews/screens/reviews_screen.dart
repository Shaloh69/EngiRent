import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_avatar.dart';
import '../../../core/widgets/app_widgets.dart';

/// Reviews — mandate §2.2, modelled on the product-reviews pattern from the
/// shopping references.
///
/// The previous version was a flat list of `Card`s. A list alone can't answer
/// the question people open reviews for — "is this generally good?" — so it
/// now leads with an average, a count, and a rating distribution, which is
/// what every shopping surface shows above the individual reviews.
class ReviewsScreen extends StatefulWidget {
  /// Show reviews for an item or user depending on which param is set.
  final String? itemId;
  final String? userId;
  const ReviewsScreen({super.key, this.itemId, this.userId});

  @override
  State<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends State<ReviewsScreen> {
  final _api = ApiService();
  List<Map<String, dynamic>> _reviews = [];
  bool _loading = true;
  String? _error;
  int? _starFilter;

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
    try {
      final endpoint = widget.itemId != null
          ? '/reviews/item/${widget.itemId}'
          : '/reviews/user/${widget.userId}';
      final resp = await _api.get(endpoint);
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() {
          _reviews =
              List<Map<String, dynamic>>.from(data['data']['reviews'] as List);
          _loading = false;
        });
      } else {
        setState(() {
          _loading = false;
          _error = 'Failed to load reviews';
        });
      }
    } catch (e) {
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  double get _average {
    if (_reviews.isEmpty) return 0;
    final sum = _reviews.fold<double>(
        0, (t, r) => t + ((r['rating'] as num?)?.toDouble() ?? 0));
    return sum / _reviews.length;
  }

  /// Count per star value, 5 → 1.
  List<int> get _distribution {
    final counts = List<int>.filled(5, 0);
    for (final r in _reviews) {
      final v = ((r['rating'] as num?)?.round() ?? 0).clamp(1, 5);
      counts[5 - v]++;
    }
    return counts;
  }

  @override
  Widget build(BuildContext context) {
    final visible = _starFilter == null
        ? _reviews
        : _reviews
            .where((r) => ((r['rating'] as num?)?.round() ?? 0) == _starFilter)
            .toList();

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: Text(widget.itemId != null ? 'Item Reviews' : 'User Reviews'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? ListView(
                padding: const EdgeInsets.all(AppSpacing.md),
                children: const [
                  _ReviewSkeleton(),
                  SizedBox(height: AppSpacing.xs),
                  _ReviewSkeleton(),
                  SizedBox(height: AppSpacing.xs),
                  _ReviewSkeleton(),
                ],
              )
            : _error != null
                ? AppEmptyState(
                    icon: Icons.wifi_off_rounded,
                    title: 'Couldn\'t load reviews',
                    body: _error,
                    action: OutlinedButton(
                      onPressed: _load,
                      child: const Text('Try again'),
                    ),
                  )
                : _reviews.isEmpty
                    ? const AppEmptyState(
                        icon: Icons.reviews_outlined,
                        title: 'No reviews yet',
                        body:
                            'Reviews appear here once a rental is completed and both '
                            'sides have had a chance to rate each other.',
                      )
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(AppSpacing.md,
                            AppSpacing.md, AppSpacing.md, AppSpacing.lg),
                        children: [
                          _RatingSummary(
                            average: _average,
                            total: _reviews.length,
                            distribution: _distribution,
                            selected: _starFilter,
                            onSelect: (v) => setState(
                                () => _starFilter = _starFilter == v ? null : v),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          SectionLabel(
                            _starFilter == null
                                ? 'All reviews'
                                : '$_starFilter-star reviews',
                            trailing: _starFilter != null
                                ? GestureDetector(
                                    onTap: () =>
                                        setState(() => _starFilter = null),
                                    child: Text(
                                      'Clear',
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                        color: AppPalette.of(context).primary,
                                      ),
                                    ),
                                  )
                                : null,
                          ),
                          if (visible.isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                  vertical: AppSpacing.xl),
                              child: Text(
                                'No $_starFilter-star reviews.',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                    fontSize: 13,
                                    color: AppPalette.of(context).muted),
                              ),
                            )
                          else
                            for (var i = 0; i < visible.length; i++)
                              Padding(
                                padding:
                                    const EdgeInsets.only(bottom: AppSpacing.xs),
                                child: Stagger(
                                  index: i,
                                  child: _ReviewCard(review: visible[i]),
                                ),
                              ),
                        ],
                      ),
      ),
    );
  }
}

/// Average, count and distribution. The bars are tappable filters — the
/// standard shopping affordance for "show me only the 1-star ones".
class _RatingSummary extends StatelessWidget {
  const _RatingSummary({
    required this.average,
    required this.total,
    required this.distribution,
    required this.selected,
    required this.onSelect,
  });

  final double average;
  final int total;
  final List<int> distribution;
  final int? selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return AppCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              MonoText(average.toStringAsFixed(1), size: 34, color: p.ink),
              const SizedBox(height: 2),
              StarRow(rating: average, size: 13),
              const SizedBox(height: AppSpacing.hair),
              Text(
                '$total review${total == 1 ? '' : 's'}',
                style: TextStyle(fontSize: 11.5, color: p.muted),
              ),
            ],
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              children: [
                for (var i = 0; i < 5; i++)
                  _DistributionBar(
                    stars: 5 - i,
                    count: distribution[i],
                    total: total,
                    active: selected == 5 - i,
                    onTap: () => onSelect(5 - i),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DistributionBar extends StatelessWidget {
  const _DistributionBar({
    required this.stars,
    required this.count,
    required this.total,
    required this.active,
    required this.onTap,
  });

  final int stars;
  final int count;
  final int total;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final fraction = total == 0 ? 0.0 : count / total;
    return GestureDetector(
      onTap: count == 0 ? null : onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2.5),
        child: Row(
          children: [
            SizedBox(
              width: 10,
              child: MonoText(
                '$stars',
                size: 10.5,
                weight: FontWeight.w400,
                color: active ? p.primary : p.muted,
              ),
            ),
            const SizedBox(width: AppSpacing.hair),
            Expanded(
              child: ClipRRect(
                borderRadius: AppRadius.circle,
                child: Stack(
                  children: [
                    Container(height: 6, color: p.surfaceAlt),
                    AnimatedFractionallySizedBox(
                      duration: AppMotion.base,
                      curve: AppMotion.ease,
                      widthFactor: fraction,
                      child: Container(
                        height: 6,
                        color: active ? p.primary : AppColors.warning,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.hair),
            SizedBox(
              width: 22,
              child: MonoText(
                '$count',
                size: 10.5,
                weight: FontWeight.w400,
                color: p.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Non-interactive star row. Replaces `RatingBarIndicator` at display sites so
/// half-stars render consistently and the widget doesn't drag in gesture
/// handling it never uses.
class StarRow extends StatelessWidget {
  const StarRow({super.key, required this.rating, this.size = 14, this.color});

  final double rating;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.warning;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= 5; i++)
          Icon(
            rating >= i
                ? Icons.star_rounded
                : (rating >= i - 0.5
                    ? Icons.star_half_rounded
                    : Icons.star_outline_rounded),
            size: size,
            color: c,
          ),
      ],
    );
  }
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review});
  final Map<String, dynamic> review;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final author = review['author'] as Map<String, dynamic>?;
    final rating = (review['rating'] as num?)?.toDouble() ?? 0;
    final comment = review['comment'] as String?;
    final name =
        '${author?['firstName'] ?? ''} ${author?['lastName'] ?? ''}'.trim();

    final createdRaw = review['createdAt'] as String?;
    final created = createdRaw == null ? null : DateTime.tryParse(createdRaw);

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Avatars go through AppAvatar: the profile endpoint requires a
              // Bearer token, so a bare NetworkImage 401'd and left a blank
              // circle for every reviewer.
              AppAvatar(
                name: name,
                imageUrl: author?['profileImage'] as String?,
                radius: 17,
              ),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name.isEmpty ? 'EngiRent user' : name,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: p.ink,
                      ),
                    ),
                    if (created != null)
                      Text(
                        DateFormat('MMM d, yyyy').format(created),
                        style: TextStyle(fontSize: 11, color: p.muted),
                      ),
                  ],
                ),
              ),
              StarRow(rating: rating, size: 14),
            ],
          ),
          if (comment != null && comment.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              comment,
              style: TextStyle(fontSize: 13, height: 1.5, color: p.muted),
            ),
          ],
        ],
      ),
    );
  }
}

class _ReviewSkeleton extends StatelessWidget {
  const _ReviewSkeleton();

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration:
                BoxDecoration(color: p.surfaceAlt, shape: BoxShape.circle),
          ),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(height: 11, width: 120, color: p.surfaceAlt),
                const SizedBox(height: AppSpacing.xs),
                Container(height: 9, width: double.infinity, color: p.surfaceAlt),
                const SizedBox(height: 5),
                Container(height: 9, width: 180, color: p.surfaceAlt),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Write-a-review sheet. The star control is now large and tappable with a
/// word for each value — a 5-point scale with no labels means every rater is
/// using a slightly different scale.
class PostReviewSheet extends StatefulWidget {
  final String rentalId;
  final String reviewType; // 'ITEM' or 'USER'
  const PostReviewSheet(
      {super.key, required this.rentalId, required this.reviewType});

  @override
  State<PostReviewSheet> createState() => _PostReviewSheetState();
}

class _PostReviewSheetState extends State<PostReviewSheet> {
  final _api = ApiService();
  final _commentCtrl = TextEditingController();
  double _rating = 5;
  bool _submitting = false;

  static const _words = {
    1: 'Poor',
    2: 'Below expectations',
    3: 'Okay',
    4: 'Good',
    5: 'Excellent',
  };

  /// Tappable prompts. Blank comment boxes get skipped; a starting phrase
  /// roughly doubles the odds of getting written feedback at all.
  List<String> get _prompts => widget.reviewType == 'ITEM'
      ? const [
          'Exactly as described',
          'Well looked after',
          'Everything included',
          'Had some wear',
        ]
      : const [
          'Dropped off on time',
          'Easy to deal with',
          'Clear communication',
          'Returned in good shape',
        ];

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      final resp = await _api.post('/reviews', {
        'rentalId': widget.rentalId,
        'rating': _rating.toInt(),
        'comment': _commentCtrl.text.trim().isEmpty
            ? null
            : _commentCtrl.text.trim(),
        'reviewType': widget.reviewType,
      });
      if (!mounted) return;
      if (resp.statusCode == 201) {
        Navigator.pop(context, true);
      } else {
        final data = jsonDecode(resp.body);
        AppToast.error(context, 'Couldn\'t submit review',
            data['error']?.toString() ?? 'Please try again.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network error', e.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppRadius.md),
        ),
        border: Border.all(color: p.border),
      ),
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.xs,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 34,
              height: 3,
              decoration: BoxDecoration(
                color: p.border,
                borderRadius: AppRadius.circle,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            widget.reviewType == 'ITEM'
                ? 'Rate this item'
                : 'Rate the other person',
            style: TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
              color: p.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.hair),
          Text(
            widget.reviewType == 'ITEM'
                ? 'Was it as described and in the condition you expected?'
                : 'Were they on time, easy to deal with, and fair?',
            style: TextStyle(fontSize: 13, height: 1.4, color: p.muted),
          ),
          const SizedBox(height: AppSpacing.lg),

          Center(
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 1; i <= 5; i++)
                      GestureDetector(
                        onTap: () => setState(() => _rating = i.toDouble()),
                        child: Padding(
                          padding:
                              const EdgeInsets.symmetric(horizontal: AppSpacing.hair),
                          child: AnimatedScale(
                            duration: AppMotion.fast,
                            scale: _rating >= i ? 1.0 : 0.86,
                            child: Icon(
                              _rating >= i
                                  ? Icons.star_rounded
                                  : Icons.star_outline_rounded,
                              size: 40,
                              color: _rating >= i ? AppColors.warning : p.border,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  _words[_rating.toInt()] ?? '',
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: p.ink,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          Text(
            'Add a comment (optional)',
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: p.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.hair + 2,
            runSpacing: AppSpacing.hair + 2,
            children: [
              for (final prompt in _prompts)
                GestureDetector(
                  onTap: () {
                    final existing = _commentCtrl.text.trim();
                    _commentCtrl.text =
                        existing.isEmpty ? prompt : '$existing. $prompt';
                    _commentCtrl.selection = TextSelection.fromPosition(
                      TextPosition(offset: _commentCtrl.text.length),
                    );
                    setState(() {});
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.xs + 2, vertical: 5),
                    decoration: BoxDecoration(
                      borderRadius: AppRadius.input,
                      border: Border.all(color: p.border),
                    ),
                    child: Text(
                      prompt,
                      style: TextStyle(fontSize: 11.5, color: p.muted),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          TextField(
            controller: _commentCtrl,
            maxLines: 4,
            maxLength: 500,
            textCapitalization: TextCapitalization.sentences,
            style: TextStyle(fontSize: 14, color: p.ink),
            decoration: const InputDecoration(
              hintText: 'What should the next person know?',
              counterText: '',
              isDense: true,
              contentPadding: EdgeInsets.all(AppSpacing.sm),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            height: 46,
            child: ElevatedButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text(
                      'Submit review',
                      style:
                          TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
