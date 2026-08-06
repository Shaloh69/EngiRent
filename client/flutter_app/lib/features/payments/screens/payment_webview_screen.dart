import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../../../core/services/api_service.dart';
import '../../../core/constants/app_colors.dart';

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
  // webview_flutter only ships Android/iOS platform implementations — there
  // is no Flutter Web or Windows/Linux/macOS desktop WebView, so building a
  // WebViewController on those platforms throws immediately at
  // construction. Fall back to opening the checkout URL in the system
  // browser + polling for the result instead, rather than crashing.
  bool get _supportsInAppWebView =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  WebViewController? _controller;
  bool _loading = true;
  bool _polling = false;
  bool _externalLaunched = false;
  Timer? _pollTimer;
  final _api = ApiService();

  // Must match the paths paymentController.ts's createPayment() actually
  // builds (successUrl/cancelUrl both use the plural "/payments/...") — this
  // previously read "/payment/..." (singular), so `uri.path.contains(...)`
  // could never match a real redirect; only the `status` query-param check
  // below ever caught it.
  static const String _successPath = '/payments/success';
  static const String _cancelPath = '/payments/cancel';

  @override
  void initState() {
    super.initState();
    if (_supportsInAppWebView) {
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
    } else {
      _loading = false;
      // Deliberately NOT auto-launched here: by the time initState runs,
      // we're several async ticks removed from the original "Pay Now" tap
      // (the payment-creation API call, then Navigator.push, then this
      // widget building) — Chrome's popup blocker silently drops a
      // window.open() that far from a trusted user gesture, so the tab
      // would never actually appear with no visible error. Showing a
      // button and launching from *its* onPressed is a fresh, direct user
      // gesture the browser will actually allow.
    }
  }

  Future<void> _launchExternally() async {
    await launchUrl(Uri.parse(widget.checkoutUrl), mode: LaunchMode.externalApplication);
    if (!mounted) return;
    setState(() => _externalLaunched = true);
    _startPolling();
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
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) => _pollStatus());
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
      body: _supportsInAppWebView
          ? Stack(
              children: [
                WebViewWidget(controller: _controller!),
                if (_loading) const Center(child: CircularProgressIndicator()),
              ],
            )
          : _ExternalCheckoutFallback(
              launched: _externalLaunched,
              onOpenAgain: _launchExternally,
              onCheckStatus: _pollStatus,
            ),
    );
  }
}

// Shown on platforms with no in-app WebView (Flutter Web, Windows/Linux/
// macOS desktop) — the real checkout still opened in the system browser,
// this just explains what's happening and lets the user confirm once done.
class _ExternalCheckoutFallback extends StatelessWidget {
  final bool launched;
  final VoidCallback onOpenAgain;
  final VoidCallback onCheckStatus;

  const _ExternalCheckoutFallback({
    required this.launched,
    required this.onOpenAgain,
    required this.onCheckStatus,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.open_in_new, size: 48, color: AppColors.primary),
            const SizedBox(height: 16),
            Text(
              launched ? 'Checkout opened in your browser' : 'No in-app checkout on this platform',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              launched
                  ? 'Complete the payment in the browser tab, then come back and tap "I\'ve Paid".'
                  : 'Tap below to open checkout in your browser, complete the payment there, '
                        'then come back and tap "I\'ve Paid".',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            // Launched directly from this button's onPressed — a fresh,
            // direct user gesture — rather than automatically on screen
            // load. A browser only allows window.open()/launchUrl() to
            // actually surface a new tab when it's this close to the click
            // that triggered it; call it from anywhere further removed
            // (e.g. initState after an awaited API call) and the popup
            // blocker silently drops it with no visible error at all.
            ElevatedButton.icon(
              onPressed: onOpenAgain,
              icon: const Icon(Icons.open_in_new, size: 18),
              label: Text(launched ? 'Reopen Checkout Page' : 'Open Checkout'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: onCheckStatus,
              child: const Text("I've Paid — Check Status"),
            ),
          ],
        ),
      ),
    );
  }
}
