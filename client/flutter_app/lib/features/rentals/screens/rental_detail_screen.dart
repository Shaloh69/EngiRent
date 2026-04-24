import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/api_service.dart';
import '../../payments/screens/payment_webview_screen.dart';

class RentalDetailScreen extends StatefulWidget {
  final String rentalId;
  const RentalDetailScreen({super.key, required this.rentalId});

  @override
  State<RentalDetailScreen> createState() => _RentalDetailScreenState();
}

class _RentalDetailScreenState extends State<RentalDetailScreen> {
  final _api = ApiService();
  RentalModel? _rental;
  bool _loading = true;
  String? _error;

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
          if (result == PaymentResult.success) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Payment successful!')),
            );
            _load();
          }
        }
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not create checkout session')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Color _statusColor(String status) {
    return switch (status) {
      'ACTIVE' => AppColors.success,
      'COMPLETED' => AppColors.info,
      'CANCELLED' || 'DISPUTED' => AppColors.error,
      'VERIFICATION' => AppColors.warning,
      _ => AppColors.textSecondary,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rental Details')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(_error!),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_rental!.item.firstImage.isNotEmpty)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: CachedNetworkImage(
                            imageUrl: _rental!.item.firstImage,
                            height: 200,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            errorWidget: (_, __, ___) => Container(
                              height: 200,
                              color: AppColors.greyLight,
                              child: const Icon(Icons.image_not_supported, size: 48),
                            ),
                          ),
                        ),
                      const SizedBox(height: 16),
                      Row(children: [
                        Expanded(child: Text(_rental!.item.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: _statusColor(_rental!.status).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            AppConstants.rentalStatus[_rental!.status] ?? _rental!.status,
                            style: TextStyle(color: _statusColor(_rental!.status), fontWeight: FontWeight.w700, fontSize: 12),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 16),
                      _InfoRow('Total Price', 'PHP ${_rental!.totalPrice.toStringAsFixed(2)}'),
                      _InfoRow('Security Deposit', 'PHP ${_rental!.securityDeposit.toStringAsFixed(2)}'),
                      _InfoRow('Start Date', _fmt(_rental!.startDate)),
                      _InfoRow('End Date', _fmt(_rental!.endDate)),
                      _InfoRow('Days Remaining', '${_rental!.daysRemaining} day(s)'),
                      const SizedBox(height: 20),
                      if (_rental!.status == 'PENDING')
                        ElevatedButton.icon(
                          onPressed: _initiatePayment,
                          icon: const Icon(Icons.payment),
                          label: const Text('Pay Now'),
                          style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 52)),
                        ),
                    ],
                  ),
                ),
    );
  }

  String _fmt(DateTime dt) => '${dt.month}/${dt.day}/${dt.year}';
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textSecondary)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
