import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/models/item_model.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../models/item_service.dart';
import 'create_item_screen.dart';

/// Checklist Stage 2.1 — `GET /items/my-items`, `PUT /items/:id` and
/// `DELETE /items/:id` all existed on the server and were called by nothing.
/// An owner could publish a listing and then never see it again: no way to
/// fix a typo, correct a price, swap a bad photo, or take it down when the
/// item breaks or they graduate. This screen is that missing surface.
///
/// Layout follows the seller-inventory pattern (Universal Listings template):
/// a status-first row per item, so an owner scanning the list can tell at a
/// glance what's earning, what's tied up, and what's hidden — without
/// opening anything.
class MyListingsScreen extends StatefulWidget {
  const MyListingsScreen({super.key});

  @override
  State<MyListingsScreen> createState() => _MyListingsScreenState();
}

class _MyListingsScreenState extends State<MyListingsScreen> {
  final _service = ItemService();
  bool _loading = true;
  String? _error;
  List<MyListingModel> _listings = [];

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
    final result = await _service.getMyItems();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success'] == true) {
        _listings = result['items'] as List<MyListingModel>;
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  Future<void> _createNew() async {
    final changed = await Navigator.pushNamed(context, '/items/create');
    if (changed == true) _load();
  }

  Future<void> _edit(MyListingModel listing) async {
    final changed = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => CreateItemScreen(editListing: listing),
      ),
    );
    if (changed == true) _load();
  }

  Future<void> _toggleListed(MyListingModel listing) async {
    final currentlyListed = listing.item.isListed;
    final result = await _service.updateItem(
      listing.item.id,
      isListed: !currentlyListed,
    );
    if (!mounted) return;
    if (result['success'] == true) {
      AppToast.success(
        context,
        currentlyListed ? 'Listing hidden' : 'Listing relisted',
        currentlyListed
            ? 'It no longer appears in browse. Relist any time from here.'
            : 'It\'s visible in browse again.',
      );
      _load();
    } else {
      AppToast.error(context, 'Could not update listing',
          (result['error'] as String?) ?? 'Please try again.');
    }
  }

  Future<void> _delete(MyListingModel listing) async {
    // Blocked client-side with the reason, not left to a 400 the API would
    // return anyway (checklist 2.4's stated bar) — the server still enforces
    // this independently in case state changed between load and tap.
    if (!listing.canDelete) {
      final rental = listing.activeRental;
      AppToast.error(
        context,
        'Can\'t delete while rented',
        rental != null
            ? '${rental.renterName} currently has this item, due back '
                '${DateFormat('MMM d').format(rental.endDate)}. Unlist it instead — '
                'that hides it from browse without touching the rental.'
            : 'A rental is in progress. Unlist it instead.',
      );
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Delete this listing?'),
        content: Text(
          '"${listing.item.title}" will stop appearing anywhere in the app '
          'and this can\'t be undone from here. Reviews already left on it '
          'are kept — they\'re part of your rental history, not the listing\'s.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final result = await _service.deleteItem(listing.item.id);
    if (!mounted) return;
    if (result['success'] == true) {
      setState(() => _listings.removeWhere((l) => l.item.id == listing.item.id));
      AppToast.success(context, 'Listing deleted', null);
    } else {
      AppToast.error(context, 'Could not delete listing',
          (result['error'] as String?) ?? 'Please try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('My Listings'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'List an item',
            onPressed: _createNew,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: 4,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (_, __) => const _ListingCardSkeleton(),
      );
    }

    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        children: [
          const SizedBox(height: 60),
          AppEmptyState(
            icon: Icons.error_outline_rounded,
            title: 'Couldn\'t load your listings',
            body: _error,
            action: FilledButton(onPressed: _load, child: const Text('Retry')),
          ),
        ],
      );
    }

    if (_listings.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        children: [
          const SizedBox(height: 60),
          AppEmptyState(
            icon: Icons.inventory_2_outlined,
            title: 'No listings yet',
            body: 'List something you own so other students can rent it.',
            action: FilledButton.icon(
              onPressed: _createNew,
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('List an item'),
            ),
          ),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.md),
      itemCount: _listings.length,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, i) => Stagger(
        index: i,
        child: _ListingCard(
          listing: _listings[i],
          onEdit: () => _edit(_listings[i]),
          onToggleListed: () => _toggleListed(_listings[i]),
          onDelete: () => _delete(_listings[i]),
        ),
      ),
    );
  }
}

class _ListingCard extends StatelessWidget {
  const _ListingCard({
    required this.listing,
    required this.onEdit,
    required this.onToggleListed,
    required this.onDelete,
  });

  final MyListingModel listing;
  final VoidCallback onEdit;
  final VoidCallback onToggleListed;
  final VoidCallback onDelete;

  ({String label, Color color}) _statusMeta(Color mutedColor) =>
      switch (listing.listingState) {
        'RENTED' => (label: 'Rented', color: AppColors.info),
        // Grey, theme-aware — the only status here that isn't a fixed
        // semantic colour, since "hidden by the owner" isn't good, bad, or
        // in-progress the way the other three states are.
        'UNLISTED' => (label: 'Unlisted', color: mutedColor),
        'UNAVAILABLE' => (label: 'Unavailable', color: AppColors.warning),
        _ => (label: 'Available', color: AppColors.success),
      };

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final item = listing.item;
    final status = _statusMeta(p.muted);
    final currentlyListed = item.isListed;
    // Both can be true at once — an owner can hide a currently-rented item
    // from future bookers without touching the rental in progress. The
    // status pill shows "Rented" (the more consequential fact); this line
    // surfaces the other one so it isn't lost.
    final hiddenWhileRented = listing.listingState == 'RENTED' && !currentlyListed;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: AppRadius.input,
                child: item.firstImage.isEmpty
                    ? Container(
                        width: 64,
                        height: 64,
                        color: p.surfaceAlt,
                        child: Icon(Icons.inventory_2_outlined, color: p.muted, size: 22),
                      )
                    : CachedNetworkImage(
                        imageUrl: item.firstImage,
                        width: 64,
                        height: 64,
                        fit: BoxFit.cover,
                        placeholder: (_, __) => Container(color: p.surfaceAlt),
                        errorWidget: (_, __, ___) => Container(
                          color: p.surfaceAlt,
                          child: Icon(Icons.broken_image_outlined, color: p.muted, size: 18),
                        ),
                      ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontWeight: FontWeight.w700, fontSize: 14, color: p.ink),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        StatusPill(label: status.label, color: status.color, dense: true),
                      ],
                    ),
                    const SizedBox(height: 3),
                    MonoText('₱${item.pricePerDay.toStringAsFixed(0)}/day',
                        size: 12.5, color: p.primary),
                    const SizedBox(height: 2),
                    Text(
                      '${listing.rentalCount} rental${listing.rentalCount == 1 ? '' : 's'} · '
                      '${listing.reviewCount} review${listing.reviewCount == 1 ? '' : 's'}',
                      style: TextStyle(fontSize: 11, color: p.muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (listing.activeRental != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.xs, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.info.withValues(alpha: 0.10),
                borderRadius: AppRadius.input,
              ),
              child: Row(
                children: [
                  Icon(Icons.person_outline_rounded, size: 14, color: AppColors.info),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      '${listing.activeRental!.renterName} · returns '
                      '${DateFormat('MMM d').format(listing.activeRental!.endDate)}'
                      '${hiddenWhileRented ? ' · hidden from browse' : ''}',
                      style: const TextStyle(fontSize: 11, color: AppColors.info),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.xs),
          const Divider(height: 1),
          Row(
            children: [
              _CardAction(
                icon: Icons.edit_outlined,
                label: 'Edit',
                onTap: onEdit,
              ),
              _CardAction(
                icon: currentlyListed
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                label: currentlyListed ? 'Unlist' : 'Relist',
                onTap: onToggleListed,
              ),
              _CardAction(
                icon: Icons.delete_outline_rounded,
                label: 'Delete',
                color: AppColors.error,
                // Always tappable — a blocked delete still needs to explain
                // itself, which onDelete does before refusing. A disabled
                // button here would just be a dead end with no reason shown.
                onTap: onDelete,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CardAction extends StatelessWidget {
  const _CardAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final fg = color ?? p.muted;
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.input,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 15, color: fg),
              const SizedBox(width: 5),
              Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ListingCardSkeleton extends StatelessWidget {
  const _ListingCardSkeleton();

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Shimmer.fromColors(
      baseColor: p.surfaceAlt,
      highlightColor:
          isDark ? AppColors.borderDarkMode : Colors.white.withValues(alpha: 0.85),
      child: AppCard(
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Row(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(color: p.surfaceAlt, borderRadius: AppRadius.input),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(height: 13, width: 160, color: p.surfaceAlt),
                  const SizedBox(height: 8),
                  Container(height: 11, width: 90, color: p.surfaceAlt),
                  const SizedBox(height: 8),
                  Container(height: 10, width: 120, color: p.surfaceAlt),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
