import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import '../../l10n/app_localizations.dart';
import '../constants/app_colors.dart';
import '../constants/app_constants.dart';
import '../models/item_model.dart';
import '../theme/tokens.dart';
import 'app_widgets.dart';

/// Product card — mandate §2.2.
///
/// Structure follows the FlutterShop / flutter_ecommerce_template pattern
/// (fixed-aspect image, then a compact info block), re-themed to "Machined
/// Vault": square-ish corners, 1px palette-tinted border, no drop shadow.
///
/// Carries what a renter actually needs to decide, which the previous list
/// row did not: the price *with its unit*, availability, rating, and the
/// deposit — the last one matters here in a way it wouldn't in normal
/// e-commerce, because the deposit is usually far larger than the daily rate
/// and is the number that surprises people.
class ItemCard extends StatelessWidget {
  const ItemCard({super.key, required this.item, this.onTap});

  final ItemModel item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final l10n = AppLocalizations.of(context)!;

    return AppCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Fixed 4:3 image. A fixed ratio is what keeps a two-column grid
          // from turning ragged when photos have different dimensions.
          ClipRRect(
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(AppRadius.md),
            ),
            child: AspectRatio(
              aspectRatio: 4 / 3,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _ItemImage(item: item),
                  // Availability is a state, not a label — it reads over the
                  // photo so it's visible while scanning the grid.
                  Positioned(
                    top: AppSpacing.xs,
                    left: AppSpacing.xs,
                    child: StatusPill(
                      label: item.isAvailable ? l10n.available : l10n.rented,
                      color: item.isAvailable
                          ? AppColors.success
                          : AppColors.warning,
                      dense: true,
                    ),
                  ),
                ],
              ),
            ),
          ),

          Padding(
            padding: const EdgeInsets.all(AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                    color: p.ink,
                  ),
                ),
                const SizedBox(height: AppSpacing.hair),

                Text(
                  AppConstants.categories[item.category] ?? item.category,
                  style: TextStyle(fontSize: 11, color: p.muted),
                ),
                const SizedBox(height: AppSpacing.xs),

                // Price carries its unit. "₱50" alone is ambiguous on a
                // rental listing — per day? total? — and that ambiguity is
                // exactly what makes people distrust a marketplace.
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    MonoText(
                      '₱${item.pricePerDay.toStringAsFixed(0)}',
                      size: 16,
                      weight: FontWeight.w600,
                      color: p.primary,
                    ),
                    Text(
                      '/day',
                      style: TextStyle(fontSize: 11, color: p.muted),
                    ),
                    const Spacer(),
                    if (item.averageRating > 0) ...[
                      Icon(Icons.star_rounded,
                          size: 13, color: AppColors.secondary),
                      const SizedBox(width: 1),
                      MonoText(
                        item.averageRating.toStringAsFixed(1),
                        size: 11,
                        color: p.muted,
                      ),
                    ],
                  ],
                ),

                const SizedBox(height: AppSpacing.hair),
                Text(
                  '₱${item.securityDeposit.toStringAsFixed(0)} deposit, refunded',
                  style: TextStyle(fontSize: 10.5, color: p.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemImage extends StatelessWidget {
  const _ItemImage({required this.item});
  final ItemModel item;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    if (item.images.isEmpty) {
      return Container(
        color: p.surfaceAlt,
        child: Icon(Icons.inventory_2_outlined, color: p.muted, size: 30),
      );
    }
    return CachedNetworkImage(
      imageUrl: item.images.first,
      fit: BoxFit.cover,
      placeholder: (_, __) => Container(color: p.surfaceAlt),
      errorWidget: (_, __, ___) => Container(
        color: p.surfaceAlt,
        child: Icon(Icons.broken_image_outlined, color: p.muted, size: 26),
      ),
    );
  }
}

/// Skeleton placeholder — mandate §2.2 requires these instead of a centred
/// spinner while a grid loads. A spinner says "something is happening"; a
/// skeleton says "a grid of cards is coming" and keeps the layout from
/// jumping when the data lands.
class ItemCardSkeleton extends StatelessWidget {
  const ItemCardSkeleton({super.key});

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
        padding: EdgeInsets.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            AspectRatio(
              aspectRatio: 4 / 3,
              child: Container(color: p.surfaceAlt),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _bar(p.surfaceAlt, double.infinity, 11),
                  const SizedBox(height: AppSpacing.hair + 2),
                  _bar(p.surfaceAlt, 70, 9),
                  const SizedBox(height: AppSpacing.xs),
                  _bar(p.surfaceAlt, 90, 13),
                  const SizedBox(height: AppSpacing.hair + 2),
                  _bar(p.surfaceAlt, 110, 8),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bar(Color c, double w, double h) => Container(
        width: w,
        height: h,
        decoration: BoxDecoration(color: c, borderRadius: AppRadius.input),
      );
}

/// Horizontally-scrolling category rail — mandate §2.2 explicitly replaces
/// the previous wrapped blob of chips, which gave every category equal
/// weight and pushed real content below the fold on small screens.
class CategoryRail extends StatelessWidget {
  const CategoryRail({
    super.key,
    required this.selected,
    required this.onSelect,
  });

  /// null = "All".
  final String? selected;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    final entries = AppConstants.categories.entries.toList();

    return SizedBox(
      // Grows with the user's font scale so chips never clip (§1.7).
      height: scaledHeight(context, 34),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        itemCount: entries.length + 1,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
        itemBuilder: (context, i) {
          if (i == 0) {
            return _Chip(
              label: 'All',
              active: selected == null,
              onTap: () => onSelect(null),
            );
          }
          final e = entries[i - 1];
          return _Chip(
            label: e.value,
            active: selected == e.key,
            onTap: () => onSelect(e.key),
          );
        },
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.active, required this.onTap});
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: AppMotion.fast,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: active ? p.primary : p.surface,
          borderRadius: AppRadius.input,
          border: Border.all(color: active ? p.primary : p.border),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: active ? FontWeight.w700 : FontWeight.w500,
            color: active
                ? (Theme.of(context).brightness == Brightness.dark
                    ? const Color(0xFF04211D)
                    : Colors.white)
                : p.muted,
          ),
        ),
      ),
    );
  }
}

/// Grid delegate for item cards — mandate §1.7.
///
/// Replaces a hardcoded `childAspectRatio`, which assumed the card's text
/// block was a fixed height. It isn't: Android's display font-size setting
/// scales every label, and at the larger settings the title, price and
/// deposit lines grew past the tile and clipped. That's what users on other
/// phones were reporting.
///
/// Instead of guessing a ratio, this measures: the image is a known 4:3
/// fraction of the tile width, and the info block below it is the sum of its
/// own line heights run through the active [TextScaler] plus its fixed gaps.
/// Tiles therefore get taller as text gets bigger, rather than clipping.
SliverGridDelegate itemGridDelegate(
  BuildContext context, {
  double horizontalPadding = AppSpacing.md * 2,
}) {
  final media = MediaQuery.of(context);
  final width = media.size.width;
  final scaler = media.textScaler;

  final columns = width > 900 ? 4 : (width > 600 ? 3 : 2);
  final available =
      width - horizontalPadding - AppSpacing.sm * (columns - 1);
  final tileWidth = available / columns;

  // Card image is AspectRatio(4/3).
  final imageHeight = tileWidth * 3 / 4;

  // Info block: two title lines, category, the price row, and the deposit
  // line. Line box ≈ fontSize × height factor; 1.25 for the title (set
  // explicitly), ~1.3 for the rest under the default Material text height.
  final text = scaler.scale(13.5) * 1.25 * 2 // title, maxLines: 2
      + scaler.scale(11) * 1.3 // category
      + scaler.scale(16) * 1.3 // price row (tallest child)
      + scaler.scale(10.5) * 1.3; // deposit line

  const gaps = AppSpacing.hair + AppSpacing.xs + AppSpacing.hair;
  const padding = AppSpacing.sm * 2;

  return SliverGridDelegateWithFixedCrossAxisCount(
    crossAxisCount: columns,
    crossAxisSpacing: AppSpacing.sm,
    mainAxisSpacing: AppSpacing.sm,
    // +2 absorbs sub-pixel rounding in the line-box estimate; without it a
    // card can land a fraction of a logical pixel over and stripe.
    mainAxisExtent: imageHeight + text + gaps + padding + 2,
  );
}
