import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:smooth_page_indicator/smooth_page_indicator.dart';
import 'dart:convert';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/item_model.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_avatar.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../messages/screens/conversation_screen.dart';
import '../../reviews/screens/reviews_screen.dart';

/// Product detail — rebuilt on the shopping-template pattern (mandate §2.2).
///
/// Structure follows the e-commerce reference: full-bleed image gallery with
/// a page indicator, a sticky price/CTA bar pinned to the bottom so the
/// primary action is always reachable, and the supporting detail scrolling
/// underneath. `_rentNow` and the route contract are unchanged.
class ItemDetailScreen extends StatefulWidget {
  final ItemModel item;
  const ItemDetailScreen({super.key, required this.item});

  @override
  State<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

class _ItemDetailScreenState extends State<ItemDetailScreen> {
  final _pageController = PageController();
  final _api = ApiService();
  bool _findingConversation = false;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _rentNow() {
    Navigator.pushNamed(
      context,
      '/rentals/create',
      arguments: {'item': widget.item},
    );
  }

  /// Checklist Stage 5.2's second entry point. Messaging is scoped to a
  /// rental, and item detail doesn't carry one — so this looks for an
  /// existing rental of this item by the signed-in student (reusing
  /// GET /rentals, already used elsewhere, rather than adding a new
  /// itemId-filtered endpoint just for this) and opens that conversation.
  /// Absent one, it says so rather than pretending a "message the owner
  /// about a listing" feature exists when only rental-scoped messaging does.
  Future<void> _messageOwner() async {
    if (_findingConversation) return;
    setState(() => _findingConversation = true);
    try {
      final resp = await _api.get('/rentals?type=rented&limit=50');
      final data = jsonDecode(resp.body);
      if (!mounted) return;
      if (resp.statusCode != 200 || data['success'] != true) {
        AppToast.error(context, 'Could not check your rentals', 'Please try again.');
        return;
      }
      final rentals = (data['data']['rentals'] as List<dynamic>)
          .map((j) => RentalModel.fromJson(j as Map<String, dynamic>))
          .toList();
      final match = rentals.where((r) => r.item.id == widget.item.id).toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      if (match.isEmpty) {
        AppToast.info(context, 'No active rental for this item',
            'Messaging opens once you\'ve rented it — book it, then message from Rental Details.');
        return;
      }
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ConversationScreen(
            rentalId: match.first.id,
            otherPartyName: '${widget.item.owner.firstName} ${widget.item.owner.lastName}',
            otherPartyImage: widget.item.owner.profileImage,
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _findingConversation = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final theme = Theme.of(context);
    final item = widget.item;

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // Full-bleed gallery. A rental decision is made mostly on the photo,
          // so it gets the top third rather than a thumbnail.
          SliverAppBar(
            expandedHeight: 320,
            pinned: true,
            backgroundColor: p.surface,
            foregroundColor: p.ink,
            leading: _CircleBtn(
              icon: Icons.arrow_back,
              onTap: () => Navigator.pop(context),
            ),
            flexibleSpace: FlexibleSpaceBar(
              background: _Gallery(item: item, controller: _pageController),
            ),
          ),

          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      StatusPill(
                        label: item.isAvailable ? 'Available' : 'Rented out',
                        color: item.isAvailable
                            ? AppColors.success
                            : AppColors.warning,
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      StatusPill(
                        label: AppConstants.categories[item.category] ??
                            item.category,
                        color: p.primary,
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),

                  Text(
                    item.title,
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontSize: 23, height: 1.2),
                  ),
                  const SizedBox(height: AppSpacing.xs),

                  Row(
                    children: [
                      if (item.averageRating > 0) ...[
                        Icon(Icons.star_rounded,
                            size: 16, color: AppColors.secondary),
                        const SizedBox(width: 2),
                        MonoText(item.averageRating.toStringAsFixed(1),
                            size: 13, color: p.ink),
                        const SizedBox(width: AppSpacing.hair),
                      ],
                      Text(
                        '${item.totalRentals} rental${item.totalRentals == 1 ? "" : "s"}',
                        style: TextStyle(fontSize: 12.5, color: p.muted),
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => ReviewsScreen(itemId: item.id),
                          ),
                        ),
                        child: const Text('See reviews'),
                      ),
                    ],
                  ),

                  const SizedBox(height: AppSpacing.md),

                  // Cost breakdown as a real table. The deposit is the number
                  // that surprises people, so it is stated alongside the rate
                  // rather than discovered at checkout.
                  const SectionLabel('What it costs'),
                  AppCard(
                    child: Column(
                      children: [
                        InfoRow(
                          label: 'Daily rate',
                          value: '₱${item.pricePerDay.toStringAsFixed(0)}',
                        ),
                        if (item.pricePerWeek != null)
                          InfoRow(
                            label: 'Weekly rate',
                            value: '₱${item.pricePerWeek!.toStringAsFixed(0)}',
                          ),
                        if (item.pricePerMonth != null)
                          InfoRow(
                            label: 'Monthly rate',
                            value: '₱${item.pricePerMonth!.toStringAsFixed(0)}',
                          ),
                        Divider(color: p.border, height: AppSpacing.md),
                        InfoRow(
                          label: 'Security deposit (refundable)',
                          value: '₱${item.securityDeposit.toStringAsFixed(0)}',
                          valueColor: p.primary,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.hair),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.shield_outlined, size: 13, color: p.muted),
                      const SizedBox(width: AppSpacing.hair + 2),
                      Expanded(
                        child: Text(
                          'Your deposit is held in escrow and returned after the item passes its return check.',
                          style: TextStyle(fontSize: 11.5, color: p.muted),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: AppSpacing.lg),
                  const SectionLabel('Condition & description'),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.grade_outlined,
                                size: 15, color: p.primary),
                            const SizedBox(width: AppSpacing.hair + 2),
                            Text(
                              _prettyCondition(item.condition),
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: p.ink,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          item.description.isEmpty
                              ? 'No description provided.'
                              : item.description,
                          style: TextStyle(
                              fontSize: 13.5, height: 1.5, color: p.muted),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: AppSpacing.lg),
                  const SectionLabel('Listed by'),
                  AppCard(
                    child: Row(
                      children: [
                        // Was initials-only — it never attempted the
                        // owner's photo at all, even when one existed.
                        AppAvatar(
                          name: '${item.owner.firstName} ${item.owner.lastName}',
                          imageUrl: item.owner.profileImage,
                          radius: 20,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${item.owner.firstName} ${item.owner.lastName}',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 14,
                                  color: p.ink,
                                ),
                              ),
                              Text(
                                'Fellow UCLM student',
                                style:
                                    TextStyle(fontSize: 12, color: p.muted),
                              ),
                            ],
                          ),
                        ),
                        if (item.owner.id != SocketService.instance.currentUserId)
                          IconButton(
                            icon: _findingConversation
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.chat_bubble_outline_rounded, size: 19),
                            tooltip: 'Message ${item.owner.firstName}',
                            onPressed: _findingConversation ? null : _messageOwner,
                          ),
                        TextButton(
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  ReviewsScreen(userId: item.owner.id),
                            ),
                          ),
                          child: const Text('Ratings'),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: AppSpacing.lg),
                  const SectionLabel('How the handover works'),
                  AppCard(
                    child: Column(
                      children: const [
                        _Step(
                          n: '01',
                          text:
                              'You pay. The rental fee and deposit are held, not sent to the owner yet.',
                        ),
                        _Step(
                          n: '02',
                          text:
                              'The owner deposits the item into a campus locker. Cameras record its condition.',
                        ),
                        _Step(
                          n: '03',
                          text:
                              'You collect it with a QR code and a face check — no meeting up required.',
                        ),
                        _Step(
                          n: '04',
                          text:
                              'Return it to the locker. Your deposit comes back once it passes its check.',
                          last: true,
                        ),
                      ],
                    ),
                  ),

                  // Clears the sticky bottom bar.
                  const SizedBox(height: 96),
                ],
              ),
            ),
          ),
        ],
      ),

      // Sticky price + CTA. In a shopping flow the primary action should never
      // require scrolling back to find it.
      bottomNavigationBar: Container(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.sm,
          AppSpacing.md,
          AppSpacing.sm + MediaQuery.of(context).padding.bottom,
        ),
        decoration: BoxDecoration(
          color: p.surface,
          border: Border(top: BorderSide(color: p.border)),
        ),
        child: Row(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Rental rate',
                    style: TextStyle(fontSize: 10.5, color: p.muted)),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      '₱${item.pricePerDay.toStringAsFixed(0)}',
                      style: AppTheme.mono(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                          color: p.primary),
                    ),
                    Text('/day',
                        style: TextStyle(fontSize: 12, color: p.muted)),
                  ],
                ),
              ],
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: ElevatedButton(
                onPressed: item.isAvailable ? _rentNow : null,
                child: Text(item.isAvailable ? 'Request rental' : 'Unavailable'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// LIKE_NEW -> Like new. The API sends enum-style condition values and,
/// unlike categories, there's no display-name map for them in AppConstants.
String _prettyCondition(String raw) {
  if (raw.isEmpty) return 'Unspecified';
  final words = raw.toLowerCase().split('_');
  return words.first[0].toUpperCase() +
      words.first.substring(1) +
      (words.length > 1 ? ' ${words.sublist(1).join(' ')}' : '');
}

class _Gallery extends StatelessWidget {
  const _Gallery({required this.item, required this.controller});
  final ItemModel item;
  final PageController controller;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);

    if (item.images.isEmpty) {
      return Container(
        color: p.surfaceAlt,
        child: Icon(Icons.inventory_2_outlined, size: 60, color: p.muted),
      );
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        PageView.builder(
          controller: controller,
          itemCount: item.images.length,
          itemBuilder: (_, i) => CachedNetworkImage(
            imageUrl: item.images[i],
            fit: BoxFit.cover,
            placeholder: (_, __) => Container(color: p.surfaceAlt),
            errorWidget: (_, __, ___) => Container(
              color: p.surfaceAlt,
              child: Icon(Icons.broken_image_outlined, color: p.muted),
            ),
          ),
        ),
        if (item.images.length > 1)
          Positioned(
            bottom: AppSpacing.sm,
            left: 0,
            right: 0,
            child: Center(
              child: SmoothPageIndicator(
                controller: controller,
                count: item.images.length,
                effect: WormEffect(
                  dotHeight: 5,
                  dotWidth: 16,
                  radius: AppRadius.xs,
                  spacing: 5,
                  dotColor: Colors.white.withValues(alpha: 0.45),
                  activeDotColor: Colors.white,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.n, required this.text, this.last = false});
  final String n;
  final String text;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: last ? 0 : AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MonoText(n, size: 11, color: p.primary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 12.5, height: 1.45, color: p.muted),
            ),
          ),
        ],
      ),
    );
  }
}

class _CircleBtn extends StatelessWidget {
  const _CircleBtn({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xs),
      child: Material(
        color: p.surface.withValues(alpha: 0.9),
        borderRadius: AppRadius.button,
        child: InkWell(
          borderRadius: AppRadius.button,
          onTap: onTap,
          child: Icon(icon, size: 19, color: p.ink),
        ),
      ),
    );
  }
}
