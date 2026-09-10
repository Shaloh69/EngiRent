import 'dart:convert';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/loading_primitives.dart';

enum _Phase { framing, captured, uploading, exhausted }

/// Identity verification, done on the user's own phone — design mandate
/// §2.13. Until 2026-09-03 this step happened at the kiosk, on a dedicated
/// face camera; that camera has been physically removed, and this screen is
/// what replaced it.
///
/// This screen only ever *captures*. It never decides anything — the photo
/// goes to POST /kiosk/verify-face, node_server calls the ML service, and
/// node_server alone opens the locker. See faceVerificationService.ts's own
/// header comment for why that split is the entire security model here: a
/// client that could assert "verified" would be a client that could open any
/// locker.
///
/// On a real match, the server-side outcome reaches the *kiosk scan* screen
/// underneath this one via the existing `face:verified` socket event — that
/// screen already has success/failure UI wired to it, so this page's own job
/// on success is just to get out of the way (pop back to it). Retryable
/// mismatches are handled entirely here, from the direct HTTP response —
/// deliberately not routed through a socket event, so retrying doesn't
/// flicker the screen underneath.
class FaceVerifyScreen extends StatefulWidget {
  final String rentalId;

  /// 'place' | 'retrieve' | 'return' — same vocabulary KioskScanScreen uses.
  final String mode;

  /// Named only so a "report a problem" on exhaustion can say which physical
  /// kiosk this happened at.
  final String? kioskId;

  /// When this kiosk session expires, as an ABSOLUTE instant from the server
  /// (E3.2 / `ANIMATION-AND-LOADING-SPEC.md` §2.3). Null when the server did
  /// not send one — the countdown then renders nothing rather than guessing a
  /// local 120 seconds, which would drift and overstate the time left.
  final DateTime? sessionExpiresAt;

  const FaceVerifyScreen({
    super.key,
    required this.rentalId,
    required this.mode,
    this.kioskId,
    this.sessionExpiresAt,
  });

  @override
  State<FaceVerifyScreen> createState() => _FaceVerifyScreenState();
}

class _FaceVerifyScreenState extends State<FaceVerifyScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  CameraController? _camCtrl;
  bool _camReady = false;
  String? _cameraError;

  _Phase _phase = _Phase.framing;
  File? _shot;
  String? _errorMsg;
  int? _attemptsRemaining;

  final _api = ApiService();
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initCamera();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    );
    if (!WidgetsBinding.instance.platformDispatcher.accessibilityFeatures
        .disableAnimations) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pulse.dispose();
    _camCtrl?.dispose();
    super.dispose();
  }

  // ── Lifecycle — a camera page that black-screens after an app switch is
  // the most common bug in this screen type (design mandate §2.13). ────────

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final ctrl = _camCtrl;
    if (ctrl == null || !ctrl.value.isInitialized) return;
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      _camCtrl = null;
      setState(() => _camReady = false);
      ctrl.dispose();
    } else if (state == AppLifecycleState.resumed && _camCtrl == null) {
      _initCamera();
    }
  }

  // ── Camera ───────────────────────────────────────────────────────────────────

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() => _cameraError = 'No camera available on this device.');
        return;
      }
      final frontCam = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      final ctrl = CameraController(frontCam, ResolutionPreset.high, enableAudio: false);
      await ctrl.initialize();
      if (!mounted) {
        await ctrl.dispose();
        return;
      }
      setState(() {
        _camCtrl = ctrl;
        _camReady = true;
        _cameraError = null;
      });
    } catch (e) {
      if (mounted) setState(() => _cameraError = 'Camera unavailable: $e');
    }
  }

  Future<void> _capture() async {
    if (_camCtrl == null || !_camCtrl!.value.isInitialized) return;
    try {
      final xFile = await _camCtrl!.takePicture();
      setState(() {
        _shot = File(xFile.path);
        _phase = _Phase.captured;
      });
      await _submit();
    } catch (e) {
      setState(() => _errorMsg = 'Capture failed: $e');
    }
  }

  Future<void> _submit() async {
    if (_shot == null) return;
    setState(() {
      _phase = _Phase.uploading;
      _errorMsg = null;
    });

    try {
      final resp = await _api.uploadFile(
        '/kiosk/verify-face',
        _shot!,
        'file',
        extraFields: {'rentalId': widget.rentalId},
      );

      final body = jsonDecode(resp.body) as Map<String, dynamic>?;

      if (resp.statusCode != 200 || body == null || body['success'] != true) {
        setState(() {
          _phase = _Phase.framing;
          _shot = null;
          _errorMsg = (body?['message'] as String?) ??
              'Verification failed — check your connection and try again.';
        });
        return;
      }

      final data = body['data'] as Map<String, dynamic>?;
      final verified = data?['verified'] == true;

      if (verified) {
        // The kiosk-scan screen underneath already has success/failure UI
        // wired to the same server-side outcome via the `face:verified`
        // socket event — this page's job ends here.
        if (mounted) Navigator.of(context).pop(true);
        return;
      }

      final mustRescan = data?['mustRescan'] == true;
      final attemptsRemaining = data?['attemptsRemaining'] as int?;

      if (mustRescan) {
        setState(() {
          _phase = _Phase.exhausted;
          _errorMsg = (body['message'] as String?) ??
              "We couldn't match your face after several tries.";
        });
        return;
      }

      setState(() {
        _phase = _Phase.framing;
        _shot = null;
        _attemptsRemaining = attemptsRemaining;
        _errorMsg = (body['message'] as String?) ??
            "We couldn't match your face — please try again.";
      });
    } catch (e) {
      setState(() {
        _phase = _Phase.framing;
        _shot = null;
        _errorMsg = 'Could not reach the server — check your connection and try again.';
      });
    }
  }

  // ── Copy ─────────────────────────────────────────────────────────────────────

  String get _headline => switch (widget.mode) {
        'place' => 'Verify to open the drop-off locker',
        'retrieve' => 'Verify to unlock your item',
        _ => 'Verify to return your item',
      };

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07100E),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: const Text(
          'Identity Verification',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.xs, AppSpacing.md, AppSpacing.sm),
              child: Text(
                _headline,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ),
            Expanded(child: _buildStage()),
            _buildFooter(),
          ],
        ),
      ),
    );
  }

  Widget _buildStage() {
    if (_phase == _Phase.exhausted) {
      return _ExhaustedPanel(
        message: _errorMsg ?? "We couldn't match your face after several tries.",
        kioskId: widget.kioskId,
        onRescan: () => Navigator.of(context).pop('rescan'),
      );
    }

    if (_cameraError != null) {
      return _MessagePanel(icon: Icons.videocam_off_rounded, message: _cameraError!);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      child: ClipRRect(
        borderRadius: AppRadius.card,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (_camReady && _camCtrl != null)
              FittedBox(
                fit: BoxFit.cover,
                child: SizedBox(
                  width: _camCtrl!.value.previewSize?.height ?? 1,
                  height: _camCtrl!.value.previewSize?.width ?? 1,
                  child: CameraPreview(_camCtrl!),
                ),
              )
            else
              const ColoredBox(
                color: Color(0xFF0D1B18),
                child: Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: AppColors.primaryOnDark),
                  ),
                ),
              ),
            // The state progression a KYC selfie step is expected to carry
            // (design mandate §2.13): dotted + disabled while not ready,
            // solid + enabled once framed. This app has no on-device face
            // detector to gate the outline on an actual face, so "framed" is
            // simplified to "camera ready" — the oval and instruction still
            // teach correct framing, and a bad photo is caught server-side.
            CustomPaint(
              painter: _OvalGuidePainter(active: _camReady && _phase == _Phase.framing),
            ),
            if (_phase == _Phase.uploading)
              Container(
                color: Colors.black.withValues(alpha: 0.55),
                child: const Center(
                  child: SizedBox(
                    width: 32,
                    height: 32,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildFooter() {
    if (_phase == _Phase.exhausted) return const SizedBox.shrink();

    final String instr;
    final bool shutterEnabled;
    switch (_phase) {
      case _Phase.framing:
        instr = _cameraError != null
            ? 'Camera unavailable'
            : (_camReady ? 'Center your face in the frame' : 'Starting the camera…');
        shutterEnabled = _camReady && _cameraError == null;
        break;
      case _Phase.captured:
        instr = 'Got it — checking…';
        shutterEnabled = false;
        break;
      case _Phase.uploading:
        instr = 'Verifying…';
        shutterEnabled = false;
        break;
      case _Phase.exhausted:
        instr = '';
        shutterEnabled = false;
        break;
    }

    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_errorMsg != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.error.withValues(alpha: 0.14),
                borderRadius: AppRadius.card,
                border: Border.all(color: AppColors.error.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline_rounded, size: 16, color: AppColors.error),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Builder(builder: (context) {
                      final remaining = _attemptsRemaining;
                      final suffix = remaining != null
                          ? ' ($remaining ${remaining == 1 ? "try" : "tries"} left)'
                          : '';
                      return Text(
                        '${_errorMsg!}$suffix',
                        style: const TextStyle(fontSize: 12.5, height: 1.4, color: Colors.white),
                      );
                    }),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          // E3.2 / spec §1.3: an indeterminate indicator for the round-trip
          // (duration genuinely unknown, so no percentage), with the session
          // countdown and the attempt budget beside it. Before this the screen
          // showed the word "Verifying…" and nothing else, and the 120s
          // session — the constraint most likely to expire on someone
          // mid-attempt — was completely invisible to them.
          if (_phase == _Phase.uploading)
            AppIndeterminateProgress(
              label: instr,
              attemptLabel: _attemptsRemaining != null
                  ? 'Attempt ${4 - _attemptsRemaining!} of 4'
                  : null,
            )
          else
            Text(
              instr,
              style: const TextStyle(fontSize: 13, color: Color(0xFF9FBFB8)),
            ),
          const SizedBox(height: AppSpacing.xs),
          // Renders nothing at all when the server sent no deadline.
          AppSessionCountdown(deadline: widget.sessionExpiresAt),
          const SizedBox(height: AppSpacing.sm),
          GestureDetector(
            onTap: shutterEnabled ? _capture : null,
            child: AnimatedOpacity(
              opacity: shutterEnabled ? 1 : 0.35,
              duration: AppMotion.fast,
              child: Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 3),
                ),
                padding: const EdgeInsets.all(4),
                child: const DecoratedBox(
                  decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ExhaustedPanel extends StatelessWidget {
  final String message;
  final String? kioskId;
  final VoidCallback onRescan;

  const _ExhaustedPanel({required this.message, required this.kioskId, required this.onRescan});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.face_retouching_off_rounded, size: 48, color: AppColors.error),
            const SizedBox(height: AppSpacing.md),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, color: Colors.white, height: 1.5),
            ),
            const SizedBox(height: AppSpacing.lg),
            ElevatedButton(
              onPressed: onRescan,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryOnDark,
                foregroundColor: const Color(0xFF052033),
                minimumSize: const Size(double.infinity, 48),
                shape: RoundedRectangleBorder(borderRadius: AppRadius.button),
              ),
              child: const Text('Scan the kiosk QR code again'),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessagePanel extends StatelessWidget {
  final IconData icon;
  final String message;

  const _MessagePanel({required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: const Color(0xFF9FBFB8)),
            const SizedBox(height: AppSpacing.sm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: Color(0xFF9FBFB8)),
            ),
          ],
        ),
      ),
    );
  }
}

/// Oval framing cutout, same technique as ProfileSetupScreen's own guide
/// painter (Path.combine difference for the scrim) — deliberately not
/// imported from there since that one is private to its file. `active`
/// switches the outline from a dotted/dim "not ready" state to a solid one,
/// per the KYC pattern named in the design mandate §2.13.
class _OvalGuidePainter extends CustomPainter {
  _OvalGuidePainter({required this.active});
  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    final Rect target = Rect.fromCenter(
      center: Offset(size.width / 2, size.height * 0.46),
      width: size.width * 0.68,
      height: size.width * 0.68 * 1.3,
    );
    final oval = Path()..addOval(target);

    canvas.drawPath(
      Path.combine(PathOperation.difference, Path()..addRect(Offset.zero & size), oval),
      Paint()..color = const Color(0xFF07100E).withValues(alpha: 0.55),
    );

    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..color = active ? AppColors.primaryOnDark : Colors.white.withValues(alpha: 0.4);

    if (active) {
      canvas.drawOval(target, paint);
    } else {
      _drawDashedOval(canvas, target, paint);
    }
  }

  void _drawDashedOval(Canvas canvas, Rect rect, Paint paint) {
    const dashLength = 8.0;
    const gapLength = 6.0;
    final path = Path()..addOval(rect);
    final metrics = path.computeMetrics();
    for (final metric in metrics) {
      double distance = 0;
      while (distance < metric.length) {
        final next = distance + dashLength;
        canvas.drawPath(
          metric.extractPath(distance, next.clamp(0, metric.length)),
          paint,
        );
        distance = next + gapLength;
      }
    }
  }

  @override
  bool shouldRepaint(_OvalGuidePainter old) => old.active != active;
}
