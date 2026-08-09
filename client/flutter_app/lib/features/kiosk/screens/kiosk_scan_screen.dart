import 'dart:async';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/theme/tokens.dart';

enum _Phase { scanning, waiting, success, failed }

/// Kiosk hand-off — mandate §2.2.
///
/// This screen deliberately stays dark in both themes. It is a viewfinder:
/// a light chrome around a live camera feed washes out the preview and makes
/// the scan target harder to find, which is the one thing the screen exists
/// to do. Everything outside the camera frame still uses the Vault palette.
///
/// The rebuild adds what the bare scanner never told the user: which step of
/// the hand-off they're on, what to point the camera at, and — during the
/// face-verification wait — that something is happening at the kiosk and not
/// on their phone.
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

class _KioskScanScreenState extends State<KioskScanScreen>
    with SingleTickerProviderStateMixin {
  final _scannerCtrl = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );

  _Phase _phase = _Phase.scanning;
  String _errorMessage = '';
  // Captured from face:failed/kiosk:scan_error so a "Report a problem" tap
  // can name which physical kiosk this happened at — the phone never talks
  // to a kiosk directly, so this is otherwise unknowable app-side.
  String? _kioskId;
  final List<StreamSubscription<Map<String, dynamic>>> _subs = [];
  Timer? _timeout;
  late final AnimationController _sweep;
  bool _torchOn = false;

  @override
  void initState() {
    super.initState();
    final sock = SocketService.instance;
    _subs.add(sock.onFaceVerified.listen(_onFaceVerified));
    _subs.add(sock.onFaceFailed.listen(_onFaceFailed));
    _subs.add(sock.onKioskScanError.listen(_onScanError));

    _sweep = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    );
    // Mandate §1.5 — motion freezes under reduced-motion rather than
    // disappearing, so the frame still reads as a scan target.
    if (!WidgetsBinding.instance.platformDispatcher.accessibilityFeatures
        .disableAnimations) {
      _sweep.repeat();
    }
  }

  @override
  void dispose() {
    _sweep.dispose();
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

    // Best-effort fallback so even a total timeout (no server event at all
    // comes back) still has something to attach to a feedback report — the
    // token's own format is "{kiosk_id}:{token_id}:{ts}:{sig}" (see the
    // server's matching comment in index.ts). Overwritten below by an
    // authoritative server-echoed kioskId whenever one arrives.
    final tokenKioskId = raw.split(':').firstOrNull;
    if (tokenKioskId != null && tokenKioskId.isNotEmpty) {
      _kioskId = tokenKioskId;
    }

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
          _errorMessage = 'No response from the kiosk. The code may have expired — '
              'tap refresh on the kiosk screen and scan the new one.';
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
        _errorMessage =
            'The kiosk couldn\'t match your face. Stand square to the camera in '
            'good light, remove hats or sunglasses, and try again.';
        // Only overwrite the QR-derived fallback with an authoritative
        // value — this event always carries one, but guard anyway so a
        // stray null can't erase a fallback that was actually correct.
        _kioskId = (data['kioskId'] as String?) ?? _kioskId;
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
            : 'The kiosk reported an error. Please try again.';
        _kioskId = (data['kioskId'] as String?) ?? _kioskId;
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
        'place' => 'Drop off at kiosk',
        'retrieve' => 'Collect your item',
        _ => 'Return to kiosk',
      };

  String get _waitingLabel => switch (widget.mode) {
        'place' => 'Opening a locker…',
        'retrieve' => 'Unlocking your locker…',
        _ => 'Confirming your return…',
      };

  /// What the user physically does after the QR scan. The face-verification
  /// step happens at the kiosk, not on the phone — without saying so, people
  /// held their phone up to their face and waited.
  String get _waitingDetail => switch (widget.mode) {
        'place' =>
          'Look at the kiosk camera. Once it recognises you, a locker door opens — '
              'place the item inside and close it.',
        'retrieve' =>
          'Look at the kiosk camera. Once it recognises you, your locker opens.',
        _ =>
          'Look at the kiosk camera. Once it recognises you, open the locker and '
              'place the item back inside.',
      };

  String get _successLabel => switch (widget.mode) {
        'place' => 'Locker open — place your item inside',
        'retrieve' => 'Locker open — take your item',
        _ => 'Locker open — put the item back',
      };

  List<String> get _steps => switch (widget.mode) {
        'place' => const [
            'Scan the QR code on the kiosk screen',
            'Look at the kiosk camera to verify',
            'Place the item in the open locker',
          ],
        'retrieve' => const [
            'Scan the QR code on the kiosk screen',
            'Look at the kiosk camera to verify',
            'Take your item from the open locker',
          ],
        _ => const [
            'Scan the QR code on the kiosk screen',
            'Look at the kiosk camera to verify',
            'Return the item to the open locker',
          ],
      };

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07100E),
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: Text(
          _modeLabel,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
        actions: [
          if (_phase == _Phase.scanning)
            IconButton(
              tooltip: _torchOn ? 'Torch off' : 'Torch on',
              icon: Icon(
                _torchOn ? Icons.flashlight_on_rounded : Icons.flashlight_off_rounded,
                color: _torchOn ? AppColors.warning : Colors.white,
              ),
              onPressed: () {
                _scannerCtrl.toggleTorch();
                setState(() => _torchOn = !_torchOn);
              },
            ),
        ],
      ),
      body: switch (_phase) {
        _Phase.scanning => _buildScanning(),
        _Phase.waiting => _buildWaiting(),
        _Phase.success => _buildResult(
            icon: Icons.lock_open_rounded,
            color: AppColors.success,
            title: _successLabel,
            body:
                'Close the door when you\'re done — the kiosk confirms automatically.',
            primaryLabel: 'Done',
            onPrimary: () => Navigator.pop(context, true),
          ),
        _Phase.failed => _buildResult(
            icon: Icons.error_outline_rounded,
            color: AppColors.error,
            title: 'Hand-off didn\'t complete',
            body: _errorMessage,
            primaryLabel: 'Scan again',
            onPrimary: _retry,
            secondaryLabel: 'Cancel',
            onSecondary: () => Navigator.pop(context, false),
            // Checklist 3.2 — a report filed from here already knows which
            // kiosk and which rental; the student shouldn't have to look
            // either up.
            tertiaryLabel: 'Report this problem',
            onTertiary: () => Navigator.pushNamed(
              context,
              '/feedback/new',
              arguments: {
                'category': 'KIOSK_PROBLEM',
                'body': _errorMessage,
                'contextNote':
                    'Filed from a kiosk hand-off that didn\'t complete — the '
                    'kiosk and rental are attached automatically.',
                'screen': 'KioskScanScreen',
                'rentalId': widget.rentalId,
                'kioskId': _kioskId,
              },
            ),
          ),
      },
    );
  }

  Widget _buildScanning() {
    return Stack(
      fit: StackFit.expand,
      children: [
        MobileScanner(controller: _scannerCtrl, onDetect: _onDetect),

        // Dim everything but the scan window so the target is unambiguous.
        AnimatedBuilder(
          animation: _sweep,
          builder: (context, _) => CustomPaint(
            painter: _ScanFramePainter(progress: _sweep.value),
          ),
        ),

        // Instructions, anchored to the bottom so they never cover the frame.
        Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            width: double.infinity,
            padding: EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg + MediaQuery.paddingOf(context).bottom,
            ),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Colors.transparent, Color(0xE607100E), Color(0xFF07100E)],
                stops: [0, 0.45, 1],
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'POINT AT THE KIOSK SCREEN',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                    color: AppColors.primaryOnDark,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                for (var i = 0; i < _steps.length; i++) ...[
                  _StepLine(
                    number: i + 1,
                    text: _steps[i],
                    active: i == 0,
                  ),
                  if (i < _steps.length - 1) const SizedBox(height: 7),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildWaiting() {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Pulsing ring: the wait is on the kiosk's face check, which can
            // take a few seconds. A bare spinner read as "the app is stuck".
            SizedBox(
              width: 110,
              height: 110,
              child: AnimatedBuilder(
                animation: _sweep,
                builder: (context, child) => CustomPaint(
                  painter: _PulsePainter(progress: _sweep.value),
                  child: child,
                ),
                child: const Center(
                  child: Icon(Icons.face_retouching_natural_rounded,
                      size: 38, color: AppColors.primaryOnDark),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              _waitingLabel,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              _waitingDetail,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.5,
                color: Color(0xFF9FBFB8),
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel',
                  style: TextStyle(color: Color(0xFF7FA39C))),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResult({
    required IconData icon,
    required Color color,
    required String title,
    required String body,
    required String primaryLabel,
    required VoidCallback onPrimary,
    String? secondaryLabel,
    VoidCallback? onSecondary,
    String? tertiaryLabel,
    VoidCallback? onTertiary,
  }) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.14),
                shape: BoxShape.circle,
                border: Border.all(color: color.withValues(alpha: 0.4), width: 1.5),
              ),
              child: Icon(icon, size: 44, color: color),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                height: 1.2,
                letterSpacing: -0.4,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.5,
                color: Color(0xFF9FBFB8),
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: onPrimary,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryOnDark,
                  foregroundColor: const Color(0xFF04211D),
                ),
                child: Text(
                  primaryLabel,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 14.5),
                ),
              ),
            ),
            if (secondaryLabel != null) ...[
              const SizedBox(height: AppSpacing.xs),
              TextButton(
                onPressed: onSecondary,
                child: Text(secondaryLabel,
                    style: const TextStyle(color: Color(0xFF7FA39C))),
              ),
            ],
            if (tertiaryLabel != null) ...[
              const SizedBox(height: AppSpacing.hair),
              TextButton.icon(
                onPressed: onTertiary,
                icon: const Icon(Icons.flag_outlined, size: 15, color: Color(0xFF7FA39C)),
                label: Text(tertiaryLabel,
                    style: const TextStyle(color: Color(0xFF7FA39C), fontSize: 12.5)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StepLine extends StatelessWidget {
  const _StepLine({
    required this.number,
    required this.text,
    required this.active,
  });

  final int number;
  final String text;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 18,
          height: 18,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active
                ? AppColors.primaryOnDark
                : Colors.white.withValues(alpha: 0.10),
            borderRadius: AppRadius.circle,
          ),
          child: Text(
            '$number',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: active ? const Color(0xFF04211D) : Colors.white70,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.xs),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 13,
              height: 1.35,
              fontWeight: active ? FontWeight.w600 : FontWeight.w400,
              color: active ? Colors.white : const Color(0xFF9FBFB8),
            ),
          ),
        ),
      ],
    );
  }
}

/// Dims the frame outside the scan window and draws corner brackets plus a
/// travelling scan line. Brackets are the near-universal QR affordance —
/// without them a full-screen camera gives no hint where to aim.
class _ScanFramePainter extends CustomPainter {
  _ScanFramePainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final side = size.width * 0.68;
    final rect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height * 0.42),
      width: side,
      height: side,
    );
    final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(6));

    // Scrim everywhere except the window.
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect(Offset.zero & size),
        Path()..addRRect(rrect),
      ),
      Paint()..color = const Color(0xFF07100E).withValues(alpha: 0.72),
    );

    final bracket = Paint()
      ..color = AppColors.primaryOnDark
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    const arm = 26.0;
    // Four corners, two strokes each.
    for (final (corner, dx, dy) in [
      (rect.topLeft, 1.0, 1.0),
      (rect.topRight, -1.0, 1.0),
      (rect.bottomLeft, 1.0, -1.0),
      (rect.bottomRight, -1.0, -1.0),
    ]) {
      canvas.drawLine(corner, corner.translate(arm * dx, 0), bracket);
      canvas.drawLine(corner, corner.translate(0, arm * dy), bracket);
    }

    // Travelling scan line. Ping-pongs so it never jumps.
    final t = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    final y = rect.top + rect.height * t;
    canvas.drawLine(
      Offset(rect.left + 6, y),
      Offset(rect.right - 6, y),
      Paint()
        ..shader = const LinearGradient(
          colors: [
            Colors.transparent,
            AppColors.primaryOnDark,
            Colors.transparent,
          ],
        ).createShader(Rect.fromLTWH(rect.left, y - 1, rect.width, 2))
        ..strokeWidth = 2,
    );
  }

  @override
  bool shouldRepaint(_ScanFramePainter old) => old.progress != progress;
}

/// Expanding rings behind the waiting state's face icon.
class _PulsePainter extends CustomPainter {
  _PulsePainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    for (var i = 0; i < 3; i++) {
      final t = (progress + i / 3) % 1.0;
      canvas.drawCircle(
        center,
        size.width * (0.32 + 0.18 * t),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..color = AppColors.primaryOnDark.withValues(alpha: (1 - t) * 0.5),
      );
    }
  }

  @override
  bool shouldRepaint(_PulsePainter old) => old.progress != progress;
}
