import 'dart:convert';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/loading_primitives.dart';
import '../../../core/face_coach/coach_avatar.dart';
import '../../../core/face_coach/coach_ring.dart';
import '../../../core/face_coach/face_coach_camera.dart';
import '../../../core/face_coach/face_hint.dart';

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

  const FaceVerifyScreen({super.key, required this.rentalId, required this.mode, this.kioskId, this.sessionExpiresAt});

  @override
  State<FaceVerifyScreen> createState() => _FaceVerifyScreenState();
}

class _FaceVerifyScreenState extends State<FaceVerifyScreen> with TickerProviderStateMixin, WidgetsBindingObserver {
  // The one-photo check as before; the camera now also feeds on-phone face
  // detection that ONLY coaches (ring + guide). It can never block the photo:
  // see FaceCoachCamera's header.
  final FaceCoachCamera _coach = FaceCoachCamera();
  bool get _camReady => _coach.isReady;
  String? get _cameraError => _coach.error;

  late final AnimationController _loop = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800));
  late final AnimationController _shake = AnimationController(vsync: this, duration: const Duration(milliseconds: 650));
  bool get _reduceMotion => WidgetsBinding.instance.platformDispatcher.accessibilityFeatures.disableAnimations;

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
    _coach.addListener(_onCoach);
    _coach.start();
    if (!_reduceMotion) _loop.repeat();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));
    if (!WidgetsBinding.instance.platformDispatcher.accessibilityFeatures.disableAnimations) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pulse.dispose();
    _loop.dispose();
    _shake.dispose();
    _coach.removeListener(_onCoach);
    _coach.dispose();
    super.dispose();
  }

  void _onCoach() {
    if (mounted) setState(() {});
  }

  /// A refusal (no match, an error): shake the ring red and coach again.
  void _refused() {
    if (!mounted) return;
    if (!_reduceMotion) _shake.forward(from: 0);
    _coach.resumeCoaching();
  }

  // ── Lifecycle — a camera page that black-screens after an app switch is
  // the most common bug in this screen type (design mandate §2.13). ────────

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      _coach.onAppPaused();
    } else if (state == AppLifecycleState.resumed) {
      _coach.onAppResumed();
    }
  }

  // One capture at a time: a quick double tap used to start a second
  // takePicture before the first had moved the screen out of framing.
  bool _capturing = false;

  Future<void> _capture() async {
    if (!_camReady || _capturing || _phase != _Phase.framing) return;
    _capturing = true;
    try {
      final file = await _coach.takePhoto();
      if (!mounted) return;
      setState(() {
        _shot = file;
        _phase = _Phase.captured;
      });
      await _submit();
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorMsg = 'Capture failed: $e');
      _refused();
    } finally {
      _capturing = false;
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
        if (!mounted) return;
        setState(() {
          _phase = _Phase.framing;
          _shot = null;
          _errorMsg = (body?['message'] as String?) ?? 'Verification failed — check your connection and try again.';
        });
        _refused();
        return;
      }

      final data = body['data'] as Map<String, dynamic>?;
      final verified = data?['verified'] == true;

      if (verified) {
        // The kiosk-scan screen underneath already has success/failure UI
        // wired to the same server-side outcome via the `face:verified`
        // socket event — this page's job ends here.
        // Dispute v2: hand the server's answer back (what is owed before a
        // door opens, or why nothing can happen now); everything else
        // continues through the `face:verified` socket event as before.
        final action = data?['action'];
        if (mounted) {
          Navigator.of(context).pop(
            action == 'dispute_pay' || action == 'none'
                ? <String, dynamic>{...?data, 'message': body['message']}
                : true,
          );
        }
        return;
      }

      final mustRescan = data?['mustRescan'] == true;
      final attemptsRemaining = data?['attemptsRemaining'] as int?;

      if (mustRescan) {
        if (!mounted) return;
        setState(() {
          _phase = _Phase.exhausted;
          _errorMsg = (body['message'] as String?) ?? "We couldn't match your face after several tries.";
        });
        return;
      }

      if (!mounted) return;
      setState(() {
        _phase = _Phase.framing;
        _shot = null;
        _attemptsRemaining = attemptsRemaining;
        _errorMsg = (body['message'] as String?) ?? "We couldn't match your face — please try again.";
      });
      _refused();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.framing;
        _shot = null;
        _errorMsg = 'Could not reach the server — check your connection and try again.';
      });
      _refused();
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
              padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.xs, AppSpacing.md, AppSpacing.sm),
              child: Text(
                _headline,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white),
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
            if (_camReady && _coach.camera != null)
              FittedBox(
                fit: BoxFit.cover,
                child: SizedBox(
                  width: _coach.camera!.value.previewSize?.height ?? 1,
                  height: _coach.camera!.value.previewSize?.width ?? 1,
                  child: CameraPreview(_coach.camera!),
                ),
              )
            else
              const ColoredBox(
                color: Color(0xFF0D1B18),
                child: Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primaryOnDark),
                  ),
                ),
              ),
            // The reactive ring (design mandate §2.13 state progression):
            // dim dashes while no face is seen, a breathing glow when ready,
            // an amber shiver when too far / too close / off centre / several
            // people, a red shake when the server refuses. Coaching only — the
            // shutter is never gated on it; a bad photo is caught server-side.
            AnimatedBuilder(
              animation: Listenable.merge([_loop, _shake]),
              builder: (context, _) => CustomPaint(
                painter: ReactiveRingPainter(
                  RingStyle(
                    hint: _phase == _Phase.framing ? _coach.hint : LivenessHint.ready,
                    stepKey: 'centre',
                    t: _loop.value,
                    pass: 0,
                    fail: _shake.isAnimating ? _shake.value : 0,
                    reduceMotion: _reduceMotion,
                  ),
                ),
              ),
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
                    child: Builder(
                      builder: (context) {
                        final remaining = _attemptsRemaining;
                        final suffix = remaining != null
                            ? ' ($remaining ${remaining == 1 ? "try" : "tries"} left)'
                            : '';
                        return Text(
                          '${_errorMsg!}$suffix',
                          style: const TextStyle(fontSize: 12.5, height: 1.4, color: Colors.white),
                        );
                      },
                    ),
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
              attemptLabel: _attemptsRemaining != null ? 'Attempt ${4 - _attemptsRemaining!} of 4' : null,
            )
          else if (_phase == _Phase.framing && _camReady)
            CoachRow(
              avatar: AnimatedBuilder(
                animation: _loop,
                builder: (_, __) => LivenessAvatar(
                  stepKey: 'centre',
                  t: _loop.value,
                  worried: _coach.hint != LivenessHint.ready && _coach.hint != LivenessHint.searching,
                  reduceMotion: _reduceMotion,
                ),
              ),
              text: coachText(_coach.hint),
              tone: _coach.hint == LivenessHint.ready
                  ? CoachTone.good
                  : (_coach.hint == LivenessHint.searching ? CoachTone.normal : CoachTone.warn),
            )
          else
            Text(instr, style: const TextStyle(fontSize: 13, color: Color(0xFF9FBFB8))),
          const SizedBox(height: AppSpacing.xs),
          // Renders nothing at all when the server sent no deadline.
          AppSessionCountdown(deadline: widget.sessionExpiresAt),
          const SizedBox(height: AppSpacing.sm),
          Semantics(
            button: true,
            enabled: shutterEnabled,
            label: 'Take the photo',
            child: GestureDetector(
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
