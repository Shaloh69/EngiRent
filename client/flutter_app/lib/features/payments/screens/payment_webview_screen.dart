import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../../../core/services/api_service.dart';

enum PaymentResult { success, cancelled, pending }

class PaymentWebViewScreen extends StatefulWidget {
  final String checkoutUrl;
  final String checkoutSessionId;
  final String rentalId;

  const PaymentWebViewScreen({
    super.key,
    required this.checkoutUrl,
    required this.checkoutSessionId,
    required this.rentalId,
  });

  @override
  State<PaymentWebViewScreen> createState() => _PaymentWebViewScreenState();
}

class _PaymentWebViewScreenState extends State<PaymentWebViewScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  bool _polling = false;
  Timer? _pollTimer;
  final _api = ApiService();

  static const String _successPath = '/payment/success';
  static const String _cancelPath = '/payment/cancel';

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) => setState(() => _loading = true),
          onPageFinished: (_) => setState(() => _loading = false),
          onNavigationRequest: _handleNavigation,
        ),
      )
      ..loadRequest(Uri.parse(widget.checkoutUrl));
  }

  NavigationDecision _handleNavigation(NavigationRequest request) {
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.navigate;

    if (uri.path.contains(_successPath) || uri.queryParameters['status'] == 'paid') {
      _finalize(PaymentResult.success);
      return NavigationDecision.prevent;
    }
    if (uri.path.contains(_cancelPath) || uri.queryParameters['status'] == 'cancelled') {
      _finalize(PaymentResult.cancelled);
      return NavigationDecision.prevent;
    }
    return NavigationDecision.navigate;
  }

  Future<void> _startPolling() async {
    if (_polling) return;
    setState(() => _polling = true);
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _pollStatus());
  }

  Future<void> _pollStatus() async {
    try {
      final resp = await _api.get('/payments/status/${widget.checkoutSessionId}');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final status = data['data']?['status'] as String?;
        if (status == 'paid' || status == 'COMPLETED') {
          _finalize(PaymentResult.success);
        } else if (status == 'cancelled' || status == 'FAILED') {
          _finalize(PaymentResult.cancelled);
        }
      }
    } catch (_) {}
  }

  void _finalize(PaymentResult result) {
    _pollTimer?.cancel();
    if (!mounted) return;
    Navigator.pop(context, result);
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Payment'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => _finalize(PaymentResult.cancelled),
        ),
        actions: [
          if (!_polling)
            TextButton.icon(
              onPressed: _startPolling,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Check Status'),
            ),
          if (_polling)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
            ),
        ],
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading)
            const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}
