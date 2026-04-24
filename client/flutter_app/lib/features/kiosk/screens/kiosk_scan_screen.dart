import 'dart:async';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/socket_service.dart';

enum _Phase { scanning, waiting, success, failed }

class KioskScanScreen extends StatefulWidget {
  final String rentalId;

  /// 'place'    — owner deposits item at kiosk  (AWAITING_DEPOSIT)
  /// 'retrieve' — renter picks up item           (DEPOSITED)
  /// 'return'   — renter returns item            (ACTIVE)
  final String mode;

  const KioskScanScreen({
    super.key,
    required this.rentalId,
    required this.mode,
  });

  @override
  State<KioskScanScreen> createState() => _KioskScanScreenState();
}

class _KioskScanScreenState extends State<KioskScanScreen> {
  final _scannerCtrl = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );

  _Phase _phase = _Phase.scanning;
  String _errorMessage = '';
  final List<StreamSubscription<Map<String, dynamic>>> _subs = [];
  Timer? _timeout;

  @override
  void initState() {
    super.initState();
    final sock = SocketService.instance;
    _subs.add(sock.onFaceVerified.listen(_onFaceVerified));
    _subs.add(sock.onFaceFailed.listen(_onFaceFailed));
    _subs.add(sock.onKioskScanError.listen(_onScanError));
  }

  @override
  void dispose() {
    _scannerCtrl.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    _timeout?.cancel();
    super.dispose();
  }

  // ── Scanner callback ────────────────────────────────────────────────────────

  void _onDetect(BarcodeCapture capture) {
    if (_phase != _Phase.scanning) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;

    _scannerCtrl.stop();

    final userId = SocketService.instance.currentUserId ?? '';

    SocketService.instance.emit('app:kiosk_scan', {
      'token': raw,
      'rentalId': widget.rentalId,
      'mode': widget.mode,
      'userId': userId,
    });

    setState(() => _phase = _Phase.waiting);

    // Timeout matches kiosk QR TTL (90 s) plus a small buffer
    _timeout = Timer(const Duration(seconds: 95), () {
      if (_phase == _Phase.waiting && mounted) {
        setState(() {
          _phase = _Phase.failed;
          _errorMessage = 'No response from kiosk. Please try again.';
        });
      }
    });
  }

  // ── Socket event handlers ───────────────────────────────────────────────────

  void _onFaceVerified(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    _timeout?.cancel();
    if (mounted) setState(() => _phase = _Phase.success);
  }

  void _onFaceFailed(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    _timeout?.cancel();
    if (mounted) {
      setState(() {
        _phase = _Phase.failed;
        _errorMessage = 'Face verification failed. Please try again.';
      });
    }
  }

  void _onScanError(Map<String, dynamic> data) {
    // Ignore errors meant for a different rental
    final id = data['rentalId'];
    if (id != null && id != widget.rentalId) return;
    _timeout?.cancel();
    if (mounted) {
      setState(() {
        _phase = _Phase.failed;
        _errorMessage = (data['message'] as String?)?.isNotEmpty == true
            ? data['message'] as String
            : 'Kiosk error. Please try again.';
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  void _retry() {
    setState(() {
      _phase = _Phase.scanning;
      _errorMessage = '';
    });
    _scannerCtrl.start();
  }

  String get _modeLabel => switch (widget.mode) {
        'place' => 'Place Item at Kiosk',
        'retrieve' => 'Pick Up Item',
        _ => 'Return Item to Kiosk',
      };

  String get _waitingLabel => switch (widget.mode) {
        'place' => 'Placing item…',
        'retrieve' => 'Picking up item…',
        _ => 'Returning item…',
      };

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_modeLabel),
        actions: _phase == _Phase.scanning
            ? [
                ValueListenableBuilder(
                  valueListenable: _scannerCtrl,
                  builder: (_, state, __) => IconButton(
                    icon: Icon(
                      state.torchState == TorchState.on
                          ? Icons.flash_on
                          : Icons.flash_off,
                    ),
                    onPressed: _scannerCtrl.toggleTorch,
                  ),
                ),
              ]
            : null,
      ),
      body: switch (_phase) {
        _Phase.scanning => _buildScanner(),
        _Phase.waiting  => _buildWaiting(),
        _Phase.success  => _buildResult(success: true),
        _Phase.failed   => _buildResult(success: false),
      },
    );
  }

  // ── Scanner view ─────────────────────────────────────────────────────────────

  Widget _buildScanner() {
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          color: AppColors.primary.withValues(alpha: 0.07),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _modeLabel,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Point your camera at the QR code displayed on the kiosk screen. '
                'After scanning, stand in front of the kiosk camera for face verification.',
                style: TextStyle(fontSize: 13),
              ),
            ],
          ),
        ),
        Expanded(
          child: Stack(
            children: [
              MobileScanner(
                controller: _scannerCtrl,
                onDetect: _onDetect,
              ),
              Center(
                child: Container(
                  width: 240,
                  height: 240,
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.primary, width: 3),
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            'Align the kiosk QR code inside the frame',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 13,
            ),
          ),
        ),
      ],
    );
  }

  // ── Waiting view ─────────────────────────────────────────────────────────────

  Widget _buildWaiting() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(strokeWidth: 3),
            const SizedBox(height: 28),
            Text(
              _waitingLabel,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            const Text(
              'QR code scanned successfully.\n\nPlease stand in front of the kiosk camera for identity verification.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15),
            ),
            const SizedBox(height: 32),
            Text(
              'Keep the app open until verification completes.',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 13,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  // ── Result view ───────────────────────────────────────────────────────────────

  Widget _buildResult({required bool success}) {
    final successLabel = switch (widget.mode) {
      'place'    => 'Item placed successfully!\nYour locker is now locked.',
      'retrieve' => 'Item released!\nYou can now collect your item.',
      _          => 'Item returned successfully!',
    };

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              success ? Icons.check_circle_rounded : Icons.cancel_rounded,
              size: 80,
              color: success ? AppColors.success : AppColors.error,
            ),
            const SizedBox(height: 24),
            Text(
              success ? 'Identity Verified' : 'Verification Failed',
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              success ? successLabel : _errorMessage,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15),
            ),
            const SizedBox(height: 36),
            if (success)
              ElevatedButton(
                onPressed: () => Navigator.pop(context, true),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 52),
                ),
                child: const Text('Done'),
              )
            else ...[
              ElevatedButton(
                onPressed: _retry,
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 52),
                ),
                child: const Text('Try Again'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => Navigator.pop(context, false),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 52),
                ),
                child: const Text('Cancel'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
