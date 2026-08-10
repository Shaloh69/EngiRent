import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/rental_widgets.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../kiosk/screens/kiosk_scan_screen.dart';
import '../../messages/screens/conversation_screen.dart';
import '../../payments/screens/payment_webview_screen.dart';
import '../../reviews/screens/reviews_screen.dart';

class RentalDetailScreen extends StatefulWidget {
  final String rentalId;
  const RentalDetailScreen({super.key, required this.rentalId});

  @override
  State<RentalDetailScreen> createState() => _RentalDetailScreenState();
}

class _RentalDetailScreenState extends State<RentalDetailScreen> {
  final _api = ApiService();
  final _dateFmt = DateFormat('MMM d, yyyy');
  RentalModel? _rental;
  bool _loading = true;
  String? _error;
  bool _cancelling = false;
  // Set when a checkout attempt was cancelled/failed, so a "Report a
  // problem" link can appear right where it happened (checklist 3.2)
  // instead of only being reachable from Profile after the fact.
  bool _paymentIssue = false;

  // Checklist Stage 8 — the renter's on-time rate, shown only to the owner
  // (the party who actually benefits from knowing it) and only once there's
  // real history to show — a first-time renter isn't "unreliable", they're
  // just new.
  double? _renterOnTimeRate;
  int _renterRentalCount = 0;
  bool _changingDates = false;

  RentalParty? get _otherParty {
    final myId = SocketService.instance.currentUserId;
    if (_rental == null || myId == null) return null;
    return _rental!.otherParty(myId);
  }

  bool get _iAmOwner =>
      _rental?.renter != null &&
      _rental!.renter!.id != SocketService.instance.currentUserId;

  Future<void> _loadRenterReputation() async {
    final renter = _rental?.renter;
    if (renter == null || !_iAmOwner) return;
    try {
      final resp = await _api.get('/reviews/user/${renter.id}?limit=1');
      if (!mounted) return;
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final rep = data['data']?['reputation'] as Map<String, dynamic>?;
        setState(() {
          _renterOnTimeRate = (rep?['onTimeRate'] as num?)?.toDouble();
          _renterRentalCount = (rep?['totalRentalsAsRenter'] as num?)?.toInt() ?? 0;
        });
      }
    } catch (_) {
      // Informational only — never blocks viewing the rental.
    }
  }

  void _openConversation() {
    final other = _otherParty;
    if (other == null || _rental == null) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ConversationScreen(
          rentalId: _rental!.id,
          otherPartyName: other.fullName,
          otherPartyImage: other.profileImage,
        ),
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get('/rentals/${widget.rentalId}');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() {
          _rental = RentalModel.fromJson(data['data']['rental'] as Map<String, dynamic>);
          _loading = false;
        });
        _loadRenterReputation();
      } else {
        setState(() { _loading = false; _error = 'Failed to load rental'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = friendlyErrorMessage(e); });
    }
  }

  Future<void> _initiatePayment() async {
    if (_rental == null) return;
    AppToast.info(context, 'Opening Checkout…');
    try {
      // Matches paymentController.ts's real route/response shape: POST
      // /payments (not /payments/create-checkout, which doesn't exist), and
      // { transaction, paymentUrl } (not checkoutUrl/sessionId — the
      // transaction's own id doubles as the "session" id for status polling).
      final resp = await _api.post('/payments', {
        'rentalId': _rental!.id,
        'type': 'RENTAL_PAYMENT',
      });
      if (resp.statusCode == 201 || resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final checkoutUrl = data['data']['paymentUrl'] as String?;
        final sessionId = data['data']['transaction']?['id'] as String?;
        if (checkoutUrl == null || sessionId == null) return;
        if (!mounted) return;
        final result = await Navigator.push<PaymentResult>(
          context,
          MaterialPageRoute(
            builder: (_) => PaymentWebViewScreen(
              checkoutUrl: checkoutUrl,
              checkoutSessionId: sessionId,
              rentalId: _rental!.id,
            ),
          ),
        );
        if (!mounted) return;
        if (result == PaymentResult.success) {
          setState(() => _paymentIssue = false);
          AppToast.success(context, 'Payment Successful!', 'Your rental is now confirmed.');
          _load();
        } else if (result == PaymentResult.cancelled) {
          setState(() => _paymentIssue = true);
          AppToast.warning(context, 'Payment Cancelled', 'You can pay again anytime.');
        }
      } else {
        final data = jsonDecode(resp.body);
        final msg = data['message'] as String? ?? 'Could not open checkout.';
        if (!mounted) return;
        AppToast.error(context, 'Checkout Failed', msg);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network Error', friendlyErrorMessage(e));
    }
  }

  Future<void> _openKioskScan(String mode) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => KioskScanScreen(rentalId: _rental!.id, mode: mode),
      ),
    );
    if (result == true && mounted) {
      AppToast.success(
        context,
        _modeToastTitle(mode),
        _modeToastDesc(mode),
      );
      _load();
    }
  }

  String _modeToastTitle(String mode) => switch (mode) {
    'place' => 'Item Deposited',
    'retrieve' => 'Item Collected',
    'return' => 'Item Returned',
    _ => 'Done',
  };

  String _modeToastDesc(String mode) => switch (mode) {
    'place' => 'Item placed in kiosk. Renter can now collect it.',
    'retrieve' => 'Enjoy your rental!',
    'return' => 'Return received. Awaiting verification.',
    _ => '',
  };

  Future<void> _cancelRental() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Text('Cancel Rental?', style: TextStyle(fontWeight: FontWeight.w800)),
        content: Text(
          'Cancel your rental for "${_rental!.item.title}"? '
          'This action cannot be undone.',
          style: TextStyle(color: AppPalette.of(context).muted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep It'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Yes, Cancel'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _cancelling = true);
    try {
      final resp = await _api.post('/rentals/${_rental!.id}/cancel', {});
      if (!mounted) return;
      if (resp.statusCode == 200) {
        AppToast.success(context, 'Rental Cancelled', 'Your booking has been cancelled.');
        _load();
      } else {
        final data = jsonDecode(resp.body);
        AppToast.error(context, 'Cancel Failed', data['message'] ?? 'Could not cancel rental.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network Error', friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  /// Checklist Stage 9 — PATCH /rentals/:id/dates. `firstDate` starts the
  /// day after the rental's own startDate (a return date on or before
  /// pickup makes no sense); `lastDate` is a generous 90-day window, same
  /// horizon the initial checkout date picker already uses.
  Future<void> _changeReturnDate() async {
    final rental = _rental;
    if (rental == null) return;
    final firstSelectable = rental.startDate.add(const Duration(days: 1));
    final picked = await showDatePicker(
      context: context,
      initialDate: rental.endDate.isBefore(firstSelectable) ? firstSelectable : rental.endDate,
      firstDate: firstSelectable,
      lastDate: DateTime.now().add(const Duration(days: 90)),
      helpText: 'New return date',
      // Inherit the app theme rather than overriding it — an explicit
      // ColorScheme.light override elsewhere in this app once produced a
      // white-on-white picker in dark mode; don't reintroduce that.
      builder: (context, child) => child!,
    );
    if (picked == null || !mounted) return;
    if (picked.year == rental.endDate.year &&
        picked.month == rental.endDate.month &&
        picked.day == rental.endDate.day) {
      return;
    }

    setState(() => _changingDates = true);
    try {
      final resp = await _api.patch('/rentals/${rental.id}/dates', {
        'endDate': picked.toIso8601String(),
      });
      final data = jsonDecode(resp.body);
      if (!mounted) return;
      if (resp.statusCode == 200 && data['success'] == true) {
        final fee = (data['data']?['extensionFeeCharged'] as num?)?.toDouble() ?? 0;
        AppToast.success(
          context,
          data['message'] as String? ?? 'Dates updated',
          fee > 0
              ? '₱${fee.toStringAsFixed(2)} will be deducted from your deposit at return.'
              : 'Your return date has been updated.',
        );
        _load();
      } else {
        AppToast.error(context, 'Could not change dates',
            (data['error'] as String?) ?? 'Please try again.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network Error', friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _changingDates = false);
    }
  }

  Future<void> _initiateDispute() async {
    final reasonCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Text('File a Dispute', style: TextStyle(fontWeight: FontWeight.w800)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Describe the issue with the return verification.',
              style: TextStyle(color: AppPalette.of(context).muted, fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Reason',
                hintText: 'e.g. Item was returned in good condition…',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Submit Dispute'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      final resp = await _api.post('/rentals/${_rental!.id}/dispute', {
        'reason': reasonCtrl.text.trim().isEmpty
            ? 'Verification disputed by user'
            : reasonCtrl.text.trim(),
      });
      if (!mounted) return;
      if (resp.statusCode == 200) {
        AppToast.success(context, 'Dispute Filed', 'Our team will review your case.');
        _load();
      } else {
        final data = jsonDecode(resp.body);
        final msg = data['message'] as String? ?? 'Could not file dispute.';
        if (!mounted) return;
        AppToast.error(context, 'Dispute Failed', msg);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network Error', friendlyErrorMessage(e));
    }
  }

  Color _statusColor(String status) => switch (status) {
    'ACTIVE' => AppColors.success,
    'COMPLETED' => AppColors.info,
    'CANCELLED' || 'DISPUTED' => AppColors.error,
    'VERIFICATION' => AppColors.warning,
    'AWAITING_DEPOSIT' || 'DEPOSITED' => AppColors.accent,
    _ => AppColors.grey,
  };

  bool get _canCancel =>
      _rental != null &&
      ['PENDING', 'AWAITING_DEPOSIT'].contains(_rental!.status);

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Rental Details'),
        actions: [
          // Checklist Stage 5.2 — reachable from rental detail. Only shown
          // once the rental (and so the other party) has actually loaded.
          if (_rental != null && _otherParty != null)
            IconButton(
              icon: const Icon(Icons.chat_bubble_outline_rounded),
              tooltip: 'Message ${_otherParty!.fullName}',
              onPressed: _openConversation,
            ),
          if (_canCancel)
            IconButton(
              icon: const Icon(Icons.cancel_outlined),
              color: AppColors.error,
              tooltip: 'Cancel Rental',
              onPressed: _cancelling ? null : _cancelRental,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorView(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
                    children: [
                      // Hero image
                      if (_rental!.item.firstImage.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(16),
                            child: CachedNetworkImage(
                              imageUrl: _rental!.item.firstImage,
                              height: 200,
                              width: double.infinity,
                              fit: BoxFit.cover,
                              errorWidget: (_, __, ___) => Container(
                                height: 200,
                                color: p.surfaceAlt,
                                child: const Icon(Icons.image_not_supported, size: 48, color: AppColors.grey),
                              ),
                            ),
                          ),
                        ),

                      // Title + status
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              _rental!.item.title,
                              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: p.ink),
                            ),
                          ),
                          const SizedBox(width: 10),
                          // AnimatedSwitcher (keyed by status) + a pulsing
                          // dot on ACTIVE — the design mandate calls for
                          // "every state transition in the active-rental
                          // flow" to animate, "not a static status badge."
                          // No Lottie/Rive asset was available in this
                          // environment (see AnimatedLock's equivalent note
                          // in the Kiosk migration); this is the same
                          // hand-built-animation substitute applied here.
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 350),
                            transitionBuilder: (child, anim) => ScaleTransition(
                              scale: anim,
                              child: FadeTransition(opacity: anim, child: child),
                            ),
                            child: _StatusBadge(
                              key: ValueKey(_rental!.status),
                              label: AppConstants.rentalStatus[_rental!.status] ?? _rental!.status,
                              color: _statusColor(_rental!.status),
                              pulse: _rental!.status == 'ACTIVE',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Order-tracking timeline (mandate §2.2), modelled on
                      // the order_status / FlutterShop tracking pattern. The
                      // animated badge above says where the rental IS; this
                      // says what happens next — the actual question someone
                      // has while their deposit is sitting in escrow.
                      const SectionLabel('Progress'),
                      OrderTimeline(status: _rental!.status),
                      const SizedBox(height: 20),

                      // Info grid
                      _InfoCard(children: [
                        _InfoGrid(items: [
                          _InfoItem(icon: Icons.payments_rounded, label: 'Total Price',    value: 'PHP ${_rental!.totalPrice.toStringAsFixed(2)}'),
                          _InfoItem(icon: Icons.shield_rounded,   label: 'Deposit',        value: 'PHP ${_rental!.securityDeposit.toStringAsFixed(2)}'),
                          _InfoItem(icon: Icons.play_circle_outline, label: 'Start Date',  value: _dateFmt.format(_rental!.startDate)),
                          _InfoItem(icon: Icons.stop_circle_outlined, label: 'End Date',   value: _dateFmt.format(_rental!.endDate)),
                        ]),
                        if (_rental!.daysRemaining > 0) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppColors.info.withValues(alpha: 0.08),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.timer_outlined, size: 15, color: AppColors.info),
                                const SizedBox(width: 6),
                                Text(
                                  '${_rental!.daysRemaining} day${_rental!.daysRemaining == 1 ? '' : 's'} remaining',
                                  style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.w600, fontSize: 13),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ]),
                      const SizedBox(height: 14),

                      // Checklist Stage 8 — surfaced only to the owner, and
                      // only once there's real history; omitted cleanly
                      // otherwise rather than showing a misleading "0%".
                      if (_iAmOwner && _renterRentalCount > 0 && _otherParty != null) ...[
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          decoration: BoxDecoration(
                            color: p.surfaceAlt,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: p.border),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.schedule_rounded, size: 16, color: AppColors.info),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  '${_otherParty!.fullName} returns on time '
                                  '${(((_renterOnTimeRate ?? 0) * 100).round())}% of the time '
                                  '($_renterRentalCount rental${_renterRentalCount == 1 ? '' : 's'})',
                                  style: TextStyle(fontSize: 12.5, color: p.ink, fontWeight: FontWeight.w600),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 14),
                      ],

                      // Action buttons
                      _InfoCard(children: [
                        const _SectionLabel('Actions'),
                        const SizedBox(height: 12),
                        if (_rental!.status == 'PENDING')
                          _ActionButton(
                            icon: Icons.payment_rounded,
                            label: 'Pay Now to Confirm',
                            gradient: AppColors.accentGradient,
                            onTap: _initiatePayment,
                          ),
                        if (_rental!.status == 'AWAITING_DEPOSIT')
                          _ActionButton(
                            icon: Icons.lock_open_rounded,
                            label: 'Place Item at Kiosk',
                            gradient: AppColors.primaryGradient,
                            onTap: () => _openKioskScan('place'),
                          ),
                        if (_rental!.status == 'DEPOSITED')
                          _ActionButton(
                            icon: Icons.inventory_2_rounded,
                            label: 'Pick Up Item from Kiosk',
                            gradient: AppColors.primaryGradient,
                            onTap: () => _openKioskScan('retrieve'),
                          ),
                        if (_rental!.status == 'ACTIVE')
                          _ActionButton(
                            icon: Icons.assignment_return_rounded,
                            label: 'Return Item to Kiosk',
                            gradient: AppColors.primaryGradient,
                            onTap: () => _openKioskScan('return'),
                          ),
                        if (_rental!.status == 'VERIFICATION')
                          _ActionButton(
                            icon: Icons.gavel_rounded,
                            label: 'Dispute this Return',
                            gradient: const LinearGradient(
                              colors: [Color(0xFFEF4444), Color(0xFFDC2626)],
                            ),
                            onTap: _initiateDispute,
                          ),
                        if (_rental!.status == 'COMPLETED') ...[
                          _ActionButton(
                            icon: Icons.star_rounded,
                            label: 'Leave a Review',
                            gradient: const LinearGradient(colors: [Color(0xFFF59E0B), Color(0xFFD97706)]),
                            onTap: () async {
                              final submitted = await showModalBottomSheet<bool>(
                                context: context,
                                isScrollControlled: true,
                                shape: const RoundedRectangleBorder(
                                  borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                                ),
                                builder: (_) => PostReviewSheet(
                                  rentalId: _rental!.id,
                                  reviewType: 'ITEM',
                                ),
                              );
                              if (!mounted) return;
                              if (submitted == true) {
                                // ignore: use_build_context_synchronously
                                AppToast.success(context, 'Review Submitted!', 'Thank you for your feedback.');
                              }
                            },
                          ),
                        ],
                        // Checklist Stage 9 — "extend/shorten a rental,
                        // better than the late-fee path, currently the
                        // only option." Renter only, and only while the
                        // dates still matter (not PENDING — nothing's
                        // committed yet; not a terminal status).
                        if (!_iAmOwner &&
                            ['AWAITING_DEPOSIT', 'DEPOSITED', 'ACTIVE']
                                .contains(_rental!.status)) ...[
                          const SizedBox(height: 10),
                          OutlinedButton.icon(
                            onPressed: _changingDates ? null : _changeReturnDate,
                            icon: _changingDates
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.edit_calendar_outlined, size: 17),
                            label: const Text('Change return date'),
                          ),
                        ],
                        if (['CANCELLED', 'DISPUTED', 'COMPLETED', 'VERIFICATION']
                            .contains(_rental!.status))
                          Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            alignment: Alignment.center,
                            child: Text(
                              _statusMessage(_rental!.status),
                              textAlign: TextAlign.center,
                              style: TextStyle(color: p.muted, fontSize: 13),
                            ),
                          ),
                        // Checklist 3.2's third contextual entry point — a
                        // disputed rental is exactly the moment a student
                        // wants to reach an actual admin, not just read
                        // "under review" and wait.
                        if (_rental!.status == 'DISPUTED')
                          Center(
                            child: TextButton.icon(
                              onPressed: () => Navigator.pushNamed(
                                context,
                                '/feedback/new',
                                arguments: {
                                  'category': 'OTHER',
                                  'body': 'About my disputed rental: ',
                                  'contextNote':
                                      'Filed from a disputed rental — it\'s attached automatically.',
                                  'screen': 'RentalDetailScreen(disputed)',
                                  'rentalId': _rental!.id,
                                },
                              ),
                              icon: const Icon(Icons.flag_outlined, size: 15),
                              label: const Text('Report a problem with this dispute'),
                            ),
                          ),
                        // Second contextual entry point — appears right where
                        // the payment actually failed, not only from Profile
                        // after the fact.
                        if (_paymentIssue)
                          Center(
                            child: TextButton.icon(
                              onPressed: () => Navigator.pushNamed(
                                context,
                                '/feedback/new',
                                arguments: {
                                  'category': 'PAYMENT_PROBLEM',
                                  'body': 'My payment for this rental didn\'t go through: ',
                                  'contextNote':
                                      'Filed after a cancelled checkout — the rental is attached automatically.',
                                  'screen': 'RentalDetailScreen(payment)',
                                  'rentalId': _rental!.id,
                                },
                              ),
                              icon: const Icon(Icons.flag_outlined, size: 15),
                              label: const Text('Report a problem with this payment'),
                            ),
                          ),
                        if (_canCancel) ...[
                          const SizedBox(height: 8),
                          GestureDetector(
                            onTap: _cancelling ? null : _cancelRental,
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              alignment: Alignment.center,
                              child: _cancelling
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.error),
                                    )
                                  : const Text(
                                      'Cancel this rental',
                                      style: TextStyle(
                                        color: AppColors.error,
                                        fontWeight: FontWeight.w600,
                                        decoration: TextDecoration.underline,
                                      ),
                                    ),
                            ),
                          ),
                        ],
                      ]),
                    ],
                  ),
                ),
    );
  }

  String _statusMessage(String status) => switch (status) {
    'CANCELLED' => 'This rental has been cancelled.',
    'DISPUTED' => 'This rental is under review. Our team will contact you.',
    'COMPLETED' => 'Rental complete! Thank you for using EngiRent.',
    'VERIFICATION' => 'Item verification in progress…',
    _ => '',
  };
}

// ── Sub-widgets ──────────────────────────────────────────────────────────────

class _StatusBadge extends StatefulWidget {
  final String label;
  final Color color;
  final bool pulse;
  const _StatusBadge({super.key, required this.label, required this.color, this.pulse = false});

  @override
  State<_StatusBadge> createState() => _StatusBadgeState();
}

class _StatusBadgeState extends State<_StatusBadge> with SingleTickerProviderStateMixin {
  late final AnimationController _pulseCtrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: widget.color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.pulse) ...[
            FadeTransition(
              opacity: Tween(begin: 0.35, end: 1.0).animate(_pulseCtrl),
              child: Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
              ),
            ),
            const SizedBox(width: 6),
          ],
          Text(
            widget.label,
            style: TextStyle(color: widget.color, fontWeight: FontWeight.w700, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  final List<Widget> children;
  const _InfoCard({required this.children});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: p.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Text(
      text,
      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: p.muted),
    );
  }
}

class _InfoGrid extends StatelessWidget {
  final List<_InfoItem> items;
  const _InfoGrid({required this.items});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < items.length; i += 2)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              children: [
                Expanded(child: items[i]),
                const SizedBox(width: 10),
                if (i + 1 < items.length) Expanded(child: items[i + 1]) else const Spacer(),
              ],
            ),
          ),
      ],
    );
  }
}

class _InfoItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoItem({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 13, color: p.muted),
            const SizedBox(width: 5),
            Text(label, style: TextStyle(fontSize: 11, color: p.muted)),
          ]),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: p.ink)),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final LinearGradient gradient;
  final VoidCallback onTap;
  const _ActionButton({required this.icon, required this.label, required this.gradient, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(vertical: 15),
        decoration: BoxDecoration(
          gradient: gradient,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: gradient.colors.first.withValues(alpha: 0.28),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: AppColors.white, size: 20),
            const SizedBox(width: 10),
            Text(label, style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w700, fontSize: 15)),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppColors.error),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center, style: TextStyle(color: AppPalette.of(context).muted)),
            const SizedBox(height: 16),
            ElevatedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
