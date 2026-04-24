import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/utils/toast_utils.dart';
import '../../kiosk/screens/kiosk_scan_screen.dart';
import '../../payments/screens/payment_webview_screen.dart';

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
      } else {
        setState(() { _loading = false; _error = 'Failed to load rental'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _initiatePayment() async {
    if (_rental == null) return;
    AppToast.info(context, 'Opening Checkout…');
    try {
      final resp = await _api.post('/payments/create-checkout', {
        'rentalId': _rental!.id,
        'type': 'RENTAL_PAYMENT',
      });
      if (resp.statusCode == 201 || resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final checkoutUrl = data['data']['checkoutUrl'] as String?;
        final sessionId = data['data']['sessionId'] as String?;
        if (checkoutUrl != null && sessionId != null && mounted) {
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
            AppToast.success(context, 'Payment Successful!', 'Your rental is now confirmed.');
            _load();
          } else if (result == PaymentResult.cancelled) {
            AppToast.warning(context, 'Payment Cancelled', 'You can pay again anytime.');
          }
        }
      } else {
        final data = jsonDecode(resp.body);
        AppToast.error(context, 'Checkout Failed', data['message'] ?? 'Could not open checkout.');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network Error', e.toString());
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
          style: const TextStyle(color: AppColors.textSecondary),
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
      if (mounted) AppToast.error(context, 'Network Error', e.toString());
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  Color _statusColor(String status) => switch (status) {
    'ACTIVE' => AppColors.success,
    'COMPLETED' => AppColors.info,
    'CANCELLED' || 'DISPUTED' => AppColors.error,
    'VERIFICATION' || 'AWAITING_RETURN' => AppColors.warning,
    'AWAITING_DEPOSIT' || 'DEPOSITED' => AppColors.accent,
    _ => AppColors.textSecondary,
  };

  bool get _canCancel =>
      _rental != null &&
      ['PENDING', 'AWAITING_DEPOSIT'].contains(_rental!.status);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Rental Details'),
        actions: [
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
                                color: AppColors.greyLight,
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
                              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                            ),
                          ),
                          const SizedBox(width: 10),
                          _StatusBadge(
                            label: AppConstants.rentalStatus[_rental!.status] ?? _rental!.status,
                            color: _statusColor(_rental!.status),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

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
                        if (_rental!.status == 'COMPLETED') ...[
                          _ActionButton(
                            icon: Icons.star_rounded,
                            label: 'Leave a Review',
                            gradient: const LinearGradient(colors: [Color(0xFFF59E0B), Color(0xFFD97706)]),
                            onTap: () => Navigator.pushNamed(
                              context,
                              '/reviews',
                              arguments: {'itemId': _rental!.item.id},
                            ),
                          ),
                        ],
                        if (['CANCELLED', 'DISPUTED', 'COMPLETED', 'VERIFICATION', 'AWAITING_RETURN']
                            .contains(_rental!.status))
                          Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            alignment: Alignment.center,
                            child: Text(
                              _statusMessage(_rental!.status),
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
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
    'AWAITING_RETURN' => 'Waiting for the item to be returned to the kiosk.',
    _ => '',
  };
}

// ── Sub-widgets ──────────────────────────────────────────────────────────────

class _StatusBadge extends StatelessWidget {
  final String label;
  final Color color;
  const _StatusBadge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  final List<Widget> children;
  const _InfoCard({required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
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
    return Text(
      text,
      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.textSecondary),
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
            Icon(icon, size: 13, color: AppColors.textSecondary),
            const SizedBox(width: 5),
            Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          ]),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.textPrimary)),
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
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 16),
            ElevatedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
