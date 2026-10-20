import '../../concerns/widgets/rental_concern_section.dart';
import 'dart:async';
import '../../disputes/dispute_api.dart';
import '../../disputes/screens/dispute_case_screen.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/rental_widgets.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../auth/providers/auth_provider.dart';
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
  // Guards a double-tap on Pay Now. The server now de-duplicates PENDING
  // transactions too, but a second in-flight request would still open a
  // second instructions sheet over the first.
  bool _startingPayment = false;
  StreamSubscription<Map<String, dynamic>>? _paymentApprovedSub;
  StreamSubscription<Map<String, dynamic>>? _paymentRejectedSub;
  StreamSubscription<Map<String, dynamic>>? _reconnectSub;
  StreamSubscription<Map<String, dynamic>>? _depositConfirmedSub;
  StreamSubscription<Map<String, dynamic>>? _anyChangeSub;

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

  /// Who is looking at this rental, for deciding which ACTIONS to offer.
  /// `null` when it cannot be known yet, in which case every action is shown,
  /// the pre-D-79 behaviour, rather than hiding a renter's only way to pay.
  ///
  /// Deliberately not `_iAmOwner`: that reads the SOCKET's user id, which is
  /// null until the socket connects, and `renter.id != null` then reads as
  /// "I am the owner" — which would hide Pay from the very person who owes it.
  /// AuthProvider holds the signed-in user from login onward.
  bool? get _viewerIsOwner {
    final ownerId = _rental?.item.owner?.id;
    final myId = context.read<AuthProvider>().user?.id ??
        SocketService.instance.currentUserId;
    if (ownerId == null || myId == null) return null;
    return ownerId == myId;
  }

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

    // PAYMENTS RULING item 3. Under manual payments the admin's approval is
    // the only confirmation that exists — no webhook, no checkout redirect —
    // so without these the renter watches an "awaiting confirmation" panel
    // that never changes until they think to pull-to-refresh.
    _paymentApprovedSub =
        SocketService.instance.onPaymentApproved.listen((event) {
      if (!mounted || event['rentalId'] != widget.rentalId) return;
      setState(() => _paymentIssue = false);
      AppToast.success(
        context,
        'Payment Confirmed',
        event['fullyPaid'] == true
            ? 'An admin confirmed your payment. Your rental is confirmed.'
            : 'An admin confirmed your payment. One more payment to go.',
      );
      _load();
    });

    _paymentRejectedSub =
        SocketService.instance.onPaymentRejected.listen((event) {
      if (!mounted || event['rentalId'] != widget.rentalId) return;
      setState(() => _paymentIssue = true);
      AppToast.error(
        context,
        'Payment Not Confirmed',
        'An admin could not match your payment. Check the reference you sent, then try again.',
      );
      _load();
    });

    // E2.2's other half. This screen's whole state — payment status, rental
    // status, the transactions array that decides whether "Pay Now" or
    // "awaiting confirmation" is shown — arrives by socket. An admin
    // approving a payment while this socket was down leaves the renter
    // looking at a Pay Now button for money they have already sent.
    _reconnectSub = SocketService.instance.onReconnected.listen((_) {
      if (!mounted) return;
      _load();
    });

    // D-87d. The renter is deliberately blocked from collecting until the
    // deposited item is confirmed, so this screen shows a "we're confirming
    // it" note with no button. That note has to clear itself: the
    // confirmation arrives seconds to hours later from the full verification
    // model or an admin, and without this the renter sits on a stale screen
    // and concludes the app is stuck. Same reasoning as the payment
    // subscriptions above.
    // 2026-10-13 (found live): the return-check events (under review,
    // approved, disputed) and case updates never refreshed this screen, so a
    // screen left open kept a stale state: the concern button stayed after the
    // admin approved, or never appeared when the return went to review. Any
    // event about THIS rental now reloads it. The specific listeners above and
    // below keep their own toasts.
    _anyChangeSub = SocketService.instance.onAnyRentalChange.listen((event) {
      if (!mounted || event['rentalId'] != widget.rentalId) return;
      _load();
    });

    _depositConfirmedSub =
        SocketService.instance.onDepositConfirmed.listen((event) {
      if (!mounted || event['rentalId'] != widget.rentalId) return;
      AppToast.success(
        context,
        'Item Confirmed',
        'Your item has been confirmed and is ready to pick up.',
      );
      _load();
    });
  }

  @override
  void dispose() {
    _paymentApprovedSub?.cancel();
    _paymentRejectedSub?.cancel();
    _reconnectSub?.cancel();
    _depositConfirmedSub?.cancel();
    _anyChangeSub?.cancel();
    super.dispose();
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

  /// [type] is the payment to start or re-open. D-79: this used to hardcode
  /// RENTAL_PAYMENT, so the deposit — which the server requires before a
  /// rental can reach the kiosk — could never be paid from the app.
  Future<void> _initiatePayment(String type) async {
    if (_rental == null || _startingPayment) return;
    setState(() => _startingPayment = true);
    AppToast.info(context, 'Preparing payment…');
    try {
      // Matches paymentController.ts's real route/response shape: POST
      // /payments (not /payments/create-checkout, which doesn't exist), and
      // { transaction, paymentUrl } (not checkoutUrl/sessionId — the
      // transaction's own id doubles as the "session" id for status polling).
      // Re-posting a type that is already PENDING returns that same row
      // (paymentController reuses the live transaction), which is what makes
      // "View payment details" safe.
      final resp = await _api.post('/payments', {
        'rentalId': _rental!.id,
        'type': type,
      });
      if (resp.statusCode == 201 || resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final payload = (data['data'] as Map<String, dynamic>?) ?? const {};
        final checkoutUrl = payload['paymentUrl'] as String?;
        final sessionId = payload['transaction']?['id'] as String?;
        final instructions = payload['instructions'] as Map<String, dynamic>?;

        // Manual payments — the live configuration since the 2026-09-06
        // ruling. There is no checkout page to open: the server answers with
        // what to send and where, the renter pays out of band, and an admin
        // confirms receipt. Reload first so the panel below picks up the new
        // PENDING transaction even if the sheet is dismissed immediately.
        if (payload['paymentMode'] == 'MANUAL' || instructions != null) {
          await _load();
          if (!mounted) return;
          setState(() => _paymentIssue = false);
          await _showPaymentInstructions(instructions ?? const {});
          return;
        }

        // D-23. This used to be a bare `return`, which meant that any
        // response without a payment URL made Pay Now do nothing at all —
        // no error, no toast, no state change. The user reported it as
        // "the button is dead", and it was invisible from the server side.
        if (checkoutUrl == null || sessionId == null) {
          if (!mounted) return;
          setState(() => _paymentIssue = true);
          AppToast.error(
            context,
            'Could not start payment',
            'The server accepted the request but sent no way to pay. '
                'Nothing has been charged — please try again or report a problem.',
          );
          return;
        }
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
    } finally {
      if (mounted) setState(() => _startingPayment = false);
    }
  }

  /// What the renter has to do with their own money, shown the moment they
  /// ask to pay. Deliberately a sheet over the rental rather than a route:
  /// the dedicated payment-instructions screen is a separate, gated
  /// deliverable (PAYMENTS RULING item 4 — it needs a TEMPLATE-LINKS.md row
  /// before it can be built) and this is the honest minimum until then.
  Future<void> _showPaymentInstructions(Map<String, dynamic> ins) async {
    final p = AppPalette.of(context);
    final amount = (ins['amount'] as num?)?.toDouble();
    final channel = ins['channel'] as String? ?? 'GCash';
    final accountName = ins['accountName'] as String?;
    final accountNumber = ins['accountNumber'] as String?;
    final reference = ins['reference'] as String?;
    final window = ins['confirmWindow'] as String? ?? 'within 24 hours';
    final isDeposit = ins['type'] == 'SECURITY_DEPOSIT';

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: p.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: p.border,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                isDeposit ? 'Send your security deposit' : 'Send your payment',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: p.ink,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'EngiRent confirms payments by hand — an admin checks the '
                'money arrived, then confirms your rental $window.',
                style: TextStyle(fontSize: 13, height: 1.4, color: p.muted),
              ),
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: p.surfaceAlt,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: p.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Amount to send',
                        style: TextStyle(fontSize: 12, color: p.muted)),
                    const SizedBox(height: 2),
                    Text(
                      amount == null ? '—' : 'PHP ${amount.toStringAsFixed(2)}',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        color: p.ink,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _PayLine(label: 'Send via', value: channel),
              if (accountName != null && accountName.isNotEmpty)
                _PayLine(label: 'Account name', value: accountName),
              if (accountNumber != null && accountNumber.isNotEmpty)
                _PayLine(
                  label: '$channel number',
                  value: accountNumber,
                  copyable: true,
                ),
              if (reference != null && reference.isNotEmpty)
                _PayLine(
                  label: 'Quote this reference',
                  value: reference,
                  copyable: true,
                ),
              // Nothing above is a promise that the money moved. Saying so is
              // the whole point: the previous flow implied a completed payment
              // the moment a checkout page opened.
              if (accountNumber == null || accountNumber.isEmpty) ...[
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.info_outline_rounded,
                        size: 16, color: AppColors.warning),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'No payment number is configured yet. Message the '
                        'EngiRent admin for where to send this.',
                        style: TextStyle(fontSize: 12.5, color: p.muted),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.pop(sheetContext),
                  child: const Text('I have sent it'),
                ),
              ),
              const SizedBox(height: 4),
              Center(
                child: Text(
                  'Your rental stays pending until an admin confirms.',
                  style: TextStyle(fontSize: 11.5, color: p.muted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
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
    // E6.R — the owner uses the same kiosk step to take a returned item back.
    'retrieve' when _viewerIsOwner == true =>
      'Your item is back with you. This rental is complete.',
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

  /// Dispute v2: open this rental's case (the latest one).
  Future<void> _openDispute() async {
    try {
      final cases = await DisputeApi.mine();
      final mine = cases.where((d) => d['rentalId'] == _rental!.id).toList();
      if (!mounted) return;
      if (mine.isEmpty) {
        AppToast.info(context, 'No case yet', 'An admin is still reviewing this return.');
        return;
      }
      await Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => DisputeCaseScreen(disputeId: mine.first['id'] as String)),
      );
      _load();
    } catch (e) {
      if (mounted) AppToast.error(context, 'Could not open the case', friendlyErrorMessage(e));
    }
  }

  // E3.1: was a second, private copy of the status table that disagreed with
  // rental_widgets.dart's — it had no PENDING arm at all, so the app's most
  // common rental state rendered as a banned generic grey here and as gold two
  // files away. Now the one shared definition.
  Color _statusColor(String status) =>
      rentalStatusColor(status, brightness: Theme.of(context).brightness);

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
                                child: const Icon(Icons.image_not_supported, size: 48, color: AppColors.textDisabled),
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
                          // Owner: the rent they receive. Renter: rent + fees (2026-10-21).
                          _viewerIsOwner == true
                              ? _InfoItem(icon: Icons.payments_rounded, label: 'Rent (you receive)', value: 'PHP ${_rental!.totalPrice.toStringAsFixed(2)}')
                              : _InfoItem(icon: Icons.payments_rounded, label: 'Total Price', value: 'PHP ${_rental!.renterTotal.toStringAsFixed(2)}'),
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
                        // A PENDING rental means two different things under
                        // manual payments: nothing sent yet, or sent and
                        // waiting on a human. Offering "Pay Now" in the second
                        // case invites paying twice.
                        // D-79 follow-up: the owner was shown the renter's
                        // pay buttons and no word about what happens next.
                        if (_rental!.status == 'PENDING' && _viewerIsOwner == true)
                          _NextStepNote(
                            text: '${_rental!.renter?.firstName ?? 'The renter'} still has to pay the '
                                'rental fee and the security deposit, and an admin has to '
                                'confirm both. You will be notified when it is time to '
                                'place the item in the kiosk.',
                          ),
                        if (_rental!.status == 'PENDING' && _viewerIsOwner != true) ...[
                          if (_rental!.awaitingPaymentType != null) ...[
                            _AwaitingPaymentPanel(rental: _rental!),
                            const SizedBox(height: 12),
                            _ActionButton(
                              icon: Icons.receipt_long_rounded,
                              label: 'View payment details',
                              gradient: AppColors.accentGradient,
                              onTap: () =>
                                  _initiatePayment(_rental!.awaitingPaymentType!),
                            ),
                          ],
                          // D-79. Offered alongside a payment under review
                          // too: the renter should not have to wait for an
                          // admin between sending the fee and the deposit.
                          if (_rental!.nextPaymentType != null) ...[
                            if (_rental!.awaitingPaymentType != null)
                              const SizedBox(height: 12),
                            _ActionButton(
                              icon: Icons.payment_rounded,
                              label: _rental!.nextPaymentType == 'SECURITY_DEPOSIT'
                                  ? 'Pay security deposit · PHP ${_rental!.securityDeposit.toStringAsFixed(2)}'
                                  : 'Pay rental fee · PHP ${_rental!.renterTotal.toStringAsFixed(2)}',
                              gradient: AppColors.accentGradient,
                              onTap: () =>
                                  _initiatePayment(_rental!.nextPaymentType!),
                            ),
                            if (_rental!.nextPaymentType == 'SECURITY_DEPOSIT') ...[
                              const SizedBox(height: 6),
                              Text(
                                'Both the rental fee and the security deposit '
                                'must be confirmed before the owner can place '
                                'the item in the kiosk. The deposit is held '
                                'and returned after the item comes back, minus '
                                'any damage or late fees.',
                                style: TextStyle(
                                  fontSize: 12,
                                  height: 1.4,
                                  color: AppPalette.of(context).muted,
                                ),
                              ),
                            ],
                          ],
                        ],
                        if (_rental!.status == 'AWAITING_DEPOSIT' && _viewerIsOwner == false)
                          const _NextStepNote(
                            text: 'Payment confirmed. The owner now places the item in the '
                                'kiosk — you will be notified when it is ready to pick up.',
                          ),
                        if (_rental!.status == 'AWAITING_DEPOSIT' && _viewerIsOwner != false)
                          _ActionButton(
                            icon: Icons.lock_open_rounded,
                            label: 'Place Item at Kiosk',
                            gradient: AppColors.primaryGradient,
                            onTap: () => _openKioskScan('place'),
                          ),
                        if (_rental!.status == 'DEPOSITED' && _viewerIsOwner == true)
                          _NextStepNote(
                            text: _rental!.depositAwaitingConfirmation
                                ? 'Your item is in the kiosk. We\'re confirming it '
                                    'matches the listing, then the renter can pick it up.'
                                : 'The item is in the kiosk. The renter picks it up next.',
                          ),
                        // D-87d — the pickup button used to appear the moment a
                        // rental reached DEPOSITED, whatever the item check
                        // said. Since the fast check at the locker cannot
                        // approve anything, that meant offering collection on
                        // an item nobody had confirmed; the server now refuses
                        // to open the bay in that state, so the button led
                        // straight to a rejection at the kiosk. Show the wait
                        // instead, and the button only once it is real.
                        if (_rental!.status == 'DEPOSITED' &&
                            _viewerIsOwner != true &&
                            _rental!.depositAwaitingConfirmation)
                          const _NextStepNote(
                            text: 'The owner has dropped your item off. We\'re '
                                'confirming it matches the listing before you collect '
                                'it — usually a few minutes. You\'ll be notified the '
                                'moment it\'s ready.',
                          ),
                        if (_rental!.status == 'DEPOSITED' &&
                            _viewerIsOwner != true &&
                            !_rental!.depositAwaitingConfirmation)
                          _ActionButton(
                            icon: Icons.inventory_2_rounded,
                            label: 'Pick Up Item from Kiosk',
                            gradient: AppColors.primaryGradient,
                            onTap: () => _openKioskScan('retrieve'),
                          ),
                        if (_rental!.status == 'ACTIVE' && _viewerIsOwner != true)
                          _ActionButton(
                            icon: Icons.assignment_return_rounded,
                            label: 'Return Item to Kiosk',
                            gradient: AppColors.primaryGradient,
                            onTap: () => _openKioskScan('return'),
                          ),
                        // E6.R — the item is sitting where its owner collects it
                        // (a passed return, or one released after a dispute or
                        // cancellation). For a passed return, this pickup is
                        // what completes the rental.
                        if (_rental!.awaitingOwnerPickup && _viewerIsOwner == true)
                          _ActionButton(
                            icon: Icons.inventory_2_rounded,
                            label: 'Collect Your Item from the Kiosk',
                            gradient: AppColors.primaryGradient,
                            onTap: () => _openKioskScan('retrieve'),
                          ),
                        if (_rental!.returnApproved && _viewerIsOwner != true)
                          const _NextStepNote(
                            text: 'Return approved — your security deposit refund is on '
                                'its way. The owner collects the item next, and you can '
                                'leave a review once they have.',
                          ),
                        // Concerns v2 (2026-10-13): replaces the old "Raise a
                        // concern about this return" button. Shows every report
                        // this student can make now (defect after pickup, damage
                        // after the return, a concern while the return is being
                        // checked), each with its deadline, plus the cases on
                        // this rental and, for the renter, the deposit hold.
                        RentalConcernSection(
                          key: ValueKey('concerns-${_rental!.id}-${_rental!.status}-${_rental!.verificationStatus}'),
                          rentalId: _rental!.id,
                          itemTitle: _rental!.item.title,
                        ),
                        // E6.R (user ruling): only the renter reviews the item.
                        // The server refuses an owner's ITEM review as well.
                        if (_rental!.status == 'COMPLETED' && _viewerIsOwner == false) ...[
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
                        // Dispute v2: the case itself (renter: everything; owner: status).
                        if (_rental!.status == 'DISPUTED')
                          _ActionButton(
                            icon: Icons.gavel_rounded,
                            label: 'Open the dispute',
                            gradient: const LinearGradient(colors: [Color(0xFFEF4444), Color(0xFFDC2626)]),
                            onTap: _openDispute,
                          ),
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
        // THE WHITE PRICES (reported 2026-09-17, diagnosed from a screenshot
        // 2026-09-18). This was `AppColors.background` — a *static* constant
        // holding the light theme's near-white. The value text below uses
        // `p.ink`, which IS palette-aware and resolves to white in dark mode.
        // White on white: the four figures a renter most needs to see — total
        // price, deposit and both dates — were invisible, and these were the
        // only white panels on an otherwise dark page.
        //
        // The label survived only because `p.muted` is grey in both themes,
        // which is why the cards looked like empty boxes with headings rather
        // than like a rendering fault.
        //
        // Lesson worth keeping: a static colour next to a palette-aware one is
        // the bug. Both sides of a contrast pair have to come from the same
        // source of truth, so this now takes its panel colour from the same
        // palette its text does.
        color: p.surfaceAlt,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: p.border),
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


/// One label/value row in the payment-instructions sheet. `copyable` exists
/// because the two values that matter most — the number to send to and the
/// reference to quote — are things a renter has to retype into another app,
/// and mistyping either is what makes a payment unmatchable later.
class _PayLine extends StatelessWidget {
  final String label;
  final String value;
  final bool copyable;
  const _PayLine({
    required this.label,
    required this.value,
    this.copyable = false,
  });

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(fontSize: 12, color: p.muted)),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: p.ink,
                  ),
                ),
              ],
            ),
          ),
          if (copyable)
            IconButton(
              tooltip: 'Copy',
              visualDensity: VisualDensity.compact,
              icon: Icon(Icons.copy_rounded, size: 18, color: p.muted),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
                AppToast.info(context, 'Copied', label);
              },
            ),
        ],
      ),
    );
  }
}

/// Shown while a payment has been requested and a human has yet to confirm
/// it arrived. This state did not exist before the manual-payments ruling —
/// PayMongo either confirmed or did not, within seconds. Now the honest
/// answer is "someone is checking", and saying nothing reads as a failure.
/// A plain statement of whose turn it is, for the party who has nothing to
/// press. Token colours only, so it reads in both themes.
class _NextStepNote extends StatelessWidget {
  final String text;
  const _NextStepNote({required this.text});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: p.surfaceAlt,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: p.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, size: 16, color: p.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 12.5, height: 1.4, color: p.ink)),
          ),
        ],
      ),
    );
  }
}

class _AwaitingPaymentPanel extends StatelessWidget {
  final RentalModel rental;
  const _AwaitingPaymentPanel({required this.rental});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final pending = rental.transactions
        .where((t) => t.isAwaitingConfirmation)
        .toList();
    final total = pending.fold<double>(0, (sum, t) => sum + t.amount);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.hourglass_top_rounded,
              size: 18, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Waiting for confirmation',
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w800,
                    color: p.ink,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'PHP ${total.toStringAsFixed(2)} is recorded as sent. An '
                  'admin checks the money arrived before your rental is '
                  'confirmed — you do not need to send this again.',
                  style: TextStyle(fontSize: 12.5, height: 1.4, color: p.muted),
                ),
                if (pending.any((t) => t.paymentReferenceNo != null)) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Reference: '
                    '${pending.firstWhere((t) => t.paymentReferenceNo != null).paymentReferenceNo}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: p.ink,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
