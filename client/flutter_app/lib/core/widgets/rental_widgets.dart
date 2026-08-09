import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import '../constants/app_colors.dart';
import '../constants/app_constants.dart';
import '../models/rental_model.dart';
import '../theme/tokens.dart';
import 'app_widgets.dart';

/// Rental status → semantic colour. One definition, so a status can't be
/// amber on one screen and grey on another.
Color rentalStatusColor(String status) => switch (status) {
      'ACTIVE' => AppColors.success,
      'COMPLETED' => AppColors.info,
      'CANCELLED' || 'DISPUTED' => AppColors.error,
      'AWAITING_DEPOSIT' || 'DEPOSITED' => AppColors.accent,
      'VERIFICATION' => AppColors.warning,
      'PENDING' => AppColors.secondary,
      _ => AppColors.grey,
    };

/// The lifecycle, in order. Used by [OrderTimeline] to work out which steps
/// are done, current, and still ahead.
const List<({String key, String label, String detail})> rentalLifecycle = [
  (
    key: 'PENDING',
    label: 'Requested',
    detail: 'Waiting for payment to be completed.'
  ),
  (
    key: 'AWAITING_DEPOSIT',
    label: 'Paid — awaiting drop-off',
    detail: 'Your money is held. The owner now deposits the item at the kiosk.'
  ),
  (
    key: 'DEPOSITED',
    label: 'In the locker',
    detail: 'The item is in the locker and ready for you to collect.'
  ),
  (
    key: 'ACTIVE',
    label: 'With you',
    detail: 'Collected. Return it to the kiosk before the due date.'
  ),
  (
    key: 'VERIFICATION',
    label: 'Return check',
    detail: 'Returned. The AI condition check is comparing before/after photos.'
  ),
  (
    key: 'COMPLETED',
    label: 'Settled',
    detail: 'Deposit refunded and the owner paid out.'
  ),
];

/// Order-history row — mandate §2.2. Modelled on the order-history pattern
/// from the FlutterShop / order_status references: thumbnail, what it is,
/// where it's up to, and the money, all readable in one glance without
/// opening the detail page.
class RentalCard extends StatelessWidget {
  const RentalCard({super.key, required this.rental, this.onTap});

  final RentalModel rental;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final fmt = DateFormat('MMM d');
    final color = rentalStatusColor(rental.status);
    final label = AppConstants.rentalStatus[rental.status] ?? rental.status;

    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: AppRadius.input,
            child: SizedBox(
              width: 64,
              height: 64,
              child: rental.item.images.isEmpty
                  ? Container(
                      color: p.surfaceAlt,
                      child: Icon(Icons.inventory_2_outlined,
                          color: p.muted, size: 22),
                    )
                  : CachedNetworkImage(
                      imageUrl: rental.item.images.first,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(color: p.surfaceAlt),
                      errorWidget: (_, __, ___) => Container(
                        color: p.surfaceAlt,
                        child: Icon(Icons.broken_image_outlined,
                            color: p.muted, size: 20),
                      ),
                    ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        rental.item.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: p.ink,
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.hair),
                    StatusPill(label: label, color: color, dense: true),
                  ],
                ),
                const SizedBox(height: AppSpacing.hair),
                Row(
                  children: [
                    Icon(Icons.event_outlined, size: 12, color: p.muted),
                    const SizedBox(width: 3),
                    MonoText(
                      '${fmt.format(rental.startDate)} – ${fmt.format(rental.endDate)}',
                      size: 11,
                      weight: FontWeight.w400,
                      color: p.muted,
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.xs),
                Row(
                  children: [
                    MonoText(
                      '₱${rental.totalPrice.toStringAsFixed(0)}',
                      size: 14,
                      color: p.primary,
                    ),
                    Text(' rental',
                        style: TextStyle(fontSize: 11, color: p.muted)),
                    const Spacer(),
                    // Days-remaining is the single most useful number on an
                    // active rental and was previously buried in the detail
                    // page only.
                    if (rental.status == 'ACTIVE')
                      _DueChip(endDate: rental.endDate),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DueChip extends StatelessWidget {
  const _DueChip({required this.endDate});
  final DateTime endDate;

  @override
  Widget build(BuildContext context) {
    final days = endDate.difference(DateTime.now()).inDays;
    final overdue = days < 0;
    final soon = days <= 1 && !overdue;
    final color = overdue
        ? AppColors.error
        : (soon ? AppColors.warning : AppColors.success);
    final text = overdue
        ? '${days.abs()}d overdue'
        : (days == 0 ? 'Due today' : '${days}d left');
    return StatusPill(label: text, color: color, dense: true);
  }
}

/// Vertical progress timeline — mandate §2.2, modelled on the order-tracking
/// pattern (abdulawalarif/order_status and FlutterShop's tracking screen).
///
/// Replaces a lone status badge, which told the user where they were but not
/// what happens next — the actual question someone has when their money is
/// sitting in escrow.
class OrderTimeline extends StatelessWidget {
  const OrderTimeline({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);

    // Terminal states aren't points on the happy path, so the timeline is
    // replaced by a single explanatory row rather than shown half-complete.
    if (status == 'CANCELLED' || status == 'DISPUTED') {
      final color = rentalStatusColor(status);
      return AppCard(
        child: Row(
          children: [
            Icon(
              status == 'CANCELLED'
                  ? Icons.cancel_outlined
                  : Icons.gavel_rounded,
              color: color,
              size: 20,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                status == 'CANCELLED'
                    ? 'This rental was cancelled. Anything already paid is refunded.'
                    : 'This rental is under dispute. An admin is reviewing the evidence.',
                style: TextStyle(fontSize: 13, color: p.muted),
              ),
            ),
          ],
        ),
      );
    }

    final currentIndex =
        rentalLifecycle.indexWhere((s) => s.key == status).clamp(0, rentalLifecycle.length - 1);

    return AppCard(
      child: Column(
        children: [
          for (var i = 0; i < rentalLifecycle.length; i++)
            _TimelineRow(
              step: rentalLifecycle[i],
              state: i < currentIndex
                  ? _StepState.done
                  : (i == currentIndex ? _StepState.current : _StepState.upcoming),
              isLast: i == rentalLifecycle.length - 1,
            ),
        ],
      ),
    );
  }
}

enum _StepState { done, current, upcoming }

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.step,
    required this.state,
    required this.isLast,
  });

  final ({String key, String label, String detail}) step;
  final _StepState state;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final active = state != _StepState.upcoming;
    final color = state == _StepState.current ? p.primary : p.muted;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 16,
                height: 16,
                margin: const EdgeInsets.only(top: 2),
                decoration: BoxDecoration(
                  color: state == _StepState.current
                      ? p.primary
                      : (state == _StepState.done
                          ? p.primary.withValues(alpha: 0.22)
                          : Colors.transparent),
                  borderRadius: AppRadius.circle,
                  border: Border.all(
                    color: active ? p.primary : p.border,
                    width: 1.5,
                  ),
                ),
                child: state == _StepState.done
                    ? Icon(Icons.check, size: 10, color: p.primary)
                    : null,
              ),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 1.5,
                    margin: const EdgeInsets.symmetric(vertical: 2),
                    color: state == _StepState.done ? p.primary : p.border,
                  ),
                ),
            ],
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    step.label,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight:
                          state == _StepState.current ? FontWeight.w700 : FontWeight.w600,
                      color: active ? p.ink : p.muted,
                    ),
                  ),
                  // Only the current step explains itself — showing every
                  // detail line at once turns the timeline into a wall of
                  // text and buries where the user actually is.
                  if (state == _StepState.current) ...[
                    const SizedBox(height: 2),
                    Text(
                      step.detail,
                      style: TextStyle(fontSize: 12, height: 1.4, color: color),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Skeleton for the rentals list, matching RentalCard's shape.
class RentalCardSkeleton extends StatelessWidget {
  const RentalCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Shimmer.fromColors(
      baseColor: p.surfaceAlt,
      highlightColor: isDark
          ? AppColors.borderDarkMode
          : Colors.white.withValues(alpha: 0.85),
      child: AppCard(
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Row(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration:
                  BoxDecoration(color: p.surfaceAlt, borderRadius: AppRadius.input),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(height: 12, width: 150, color: p.surfaceAlt),
                  const SizedBox(height: AppSpacing.xs),
                  Container(height: 9, width: 100, color: p.surfaceAlt),
                  const SizedBox(height: AppSpacing.xs),
                  Container(height: 12, width: 70, color: p.surfaceAlt),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
