import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../theme/tokens.dart';
import 'liveness_avatar.dart';
import 'liveness_capture_controller.dart';
import 'liveness_ring.dart';

/// The guided face check, as a widget (spec F3). A mascot coach shows and says
/// what to do, the oval reacts to what the camera sees (it dims, pulses,
/// shivers, sweeps toward the side to turn, ripples green on a pass, shakes red
/// on a refusal), and four step dots track progress. Layout follows the steps
/// pattern of Amazon's Face Liveness / samviva in EngiRent's own tokens. It
/// only coaches: pictures leave through [onCaptured], and the server decides.
///
/// Used by the kiosk verification screen, profile setup and "Update your face".
class LivenessCaptureView extends StatefulWidget {
  const LivenessCaptureView({
    super.key,
    required this.challenge,
    required this.onCaptured,
    this.busy = false,
    this.busyLabel = 'Checking…',
    this.rejectCount = 0,
  });

  final FaceChallenge challenge;

  /// Called once with the four frames. The view then waits (shows [busyLabel])
  /// until the parent builds it again with a new [challenge] or leaves.
  final ValueChanged<LivenessCapture> onCaptured;

  /// While the parent uploads/judges the frames.
  final bool busy;
  final String busyLabel;

  /// The parent adds one each time the server refuses a try: the ring shakes red.
  final int rejectCount;

  @override
  State<LivenessCaptureView> createState() => _LivenessCaptureViewState();
}

class _LivenessCaptureViewState extends State<LivenessCaptureView>
    with WidgetsBindingObserver, TickerProviderStateMixin {
  late LivenessCaptureController _c;
  bool _delivered = false;

  late final AnimationController _loop =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1800));
  late final AnimationController _flash =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 850));
  late final AnimationController _shake =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 650));
  late final AnimationController _nod =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 600));

  int _seenPass = 0;
  int _seenFail = 0;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  void _start() {
    _c = LivenessCaptureController(challenge: widget.challenge)..addListener(_onChange);
    _delivered = false;
    _seenPass = 0;
    _seenFail = 0;
    _c.start();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.of(context).disableAnimations;
    if (_reduceMotion) {
      _loop.stop();
    } else if (!_loop.isAnimating) {
      _loop.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant LivenessCaptureView old) {
    super.didUpdateWidget(old);
    // A new challenge (the previous attempt was judged) means a fresh run.
    if (old.challenge.nonce != widget.challenge.nonce) {
      _c.removeListener(_onChange);
      _c.deleteFiles();
      _c.dispose();
      _start();
    }
    if (widget.rejectCount != old.rejectCount && !_reduceMotion) {
      _shake.forward(from: 0);
    }
  }

  void _onChange() {
    if (!mounted) return;
    if (_c.passCount != _seenPass) {
      _seenPass = _c.passCount;
      if (!_reduceMotion) {
        _flash.forward(from: 0);
        _nod.forward(from: 0);
      }
    }
    if (_c.failCount != _seenFail) {
      _seenFail = _c.failCount;
      if (!_reduceMotion) _shake.forward(from: 0);
    }
    if (_c.phase == LivenessPhase.done && !_delivered && _c.capture != null) {
      _delivered = true;
      widget.onCaptured(_c.capture!);
    }
    setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _c.onAppResumed();
    } else if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      _c.onAppPaused();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _loop.dispose();
    _flash.dispose();
    _shake.dispose();
    _nod.dispose();
    _c.removeListener(_onChange);
    _c.dispose();
    super.dispose();
  }

  /// The parent calls this after it has uploaded the frames, to remove them.
  Future<void> deleteFrames() => _c.deleteFiles();

  bool get _problem =>
      _c.hint == LivenessHint.tooFar ||
      _c.hint == LivenessHint.tooClose ||
      _c.hint == LivenessHint.offCentre ||
      _c.hint == LivenessHint.multiple;

  @override
  Widget build(BuildContext context) {
    final failed = _c.phase == LivenessPhase.failed;
    final working = _c.phase == LivenessPhase.encoding || widget.busy;
    final cam = _c.camera;
    final stepKey = _c.currentKey;

    return Column(
      children: [
        _StepDots(order: widget.challenge.order, stepIndex: _c.stepIndex, done: _c.phase == LivenessPhase.done),
        const SizedBox(height: AppSpacing.sm),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: ClipRRect(
              borderRadius: AppRadius.card,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (cam != null && cam.value.isInitialized)
                    FittedBox(
                      fit: BoxFit.cover,
                      child: SizedBox(
                        width: cam.value.previewSize?.height ?? 1,
                        height: cam.value.previewSize?.width ?? 1,
                        child: CameraPreview(cam),
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
                  AnimatedBuilder(
                    animation: Listenable.merge([_loop, _flash, _shake]),
                    builder: (context, _) => CustomPaint(
                      painter: ReactiveRingPainter(RingStyle(
                        hint: failed ? LivenessHint.ready : _c.hint,
                        stepKey: working || _c.phase == LivenessPhase.starting ? 'centre' : stepKey,
                        t: _loop.value,
                        pass: _flash.isAnimating ? _flash.value : 0,
                        fail: _shake.isAnimating ? _shake.value : 0,
                        reduceMotion: _reduceMotion,
                      )),
                    ),
                  ),
                  if (working)
                    Container(
                      color: Colors.black.withValues(alpha: 0.55),
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const SizedBox(
                              width: 32,
                              height: 32,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            Text(
                              _c.phase == LivenessPhase.encoding ? 'Checking…' : widget.busyLabel,
                              style: const TextStyle(color: Colors.white, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: failed
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CoachRow(
                      avatar: AnimatedBuilder(
                        animation: _loop,
                        builder: (_, __) => LivenessAvatar(stepKey: 'centre', t: _loop.value, worried: true, reduceMotion: _reduceMotion),
                      ),
                      text: _c.error ?? 'Something went wrong.',
                      tone: CoachTone.warn,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    ElevatedButton(
                      onPressed: _c.camera == null ? _restartFromScratch : _c.retry,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primaryOnDark,
                        foregroundColor: const Color(0xFF052033),
                        minimumSize: const Size(double.infinity, 48),
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.button),
                      ),
                      child: const Text('Try again'),
                    ),
                  ],
                )
              : CoachRow(
                  avatar: AnimatedBuilder(
                    animation: Listenable.merge([_loop, _nod]),
                    builder: (_, __) => LivenessAvatar(
                      stepKey: working ? 'centre' : stepKey,
                      t: _loop.value,
                      nod: _nod.isAnimating ? _nod.value : 0,
                      worried: _problem,
                      reduceMotion: _reduceMotion,
                    ),
                  ),
                  text: working ? widget.busyLabel : _c.instruction,
                  stepLabel: _c.phase == LivenessPhase.running ? 'Step ${(_c.stepIndex + 1).clamp(1, 4)} of 4' : null,
                  tone: _problem ? CoachTone.warn : CoachTone.normal,
                ),
        ),
      ],
    );
  }

  void _restartFromScratch() {
    _c.removeListener(_onChange);
    _c.dispose();
    setState(_start);
  }
}

class _StepDots extends StatelessWidget {
  const _StepDots({required this.order, required this.stepIndex, required this.done});
  final List<String> order;
  final int stepIndex;
  final bool done;

  static IconData _icon(String key) => switch (key) {
        'centre' => Icons.face_rounded,
        'BLINK' => Icons.visibility_off_rounded,
        'TURN_LEFT' => Icons.arrow_back_rounded,
        _ => Icons.arrow_forward_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final keys = ['centre', ...order];
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < keys.length; i++) ...[
          if (i > 0) Container(width: 18, height: 2, color: Colors.white24),
          AnimatedContainer(
            duration: AppMotion.base,
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: (done || i < stepIndex)
                  ? AppColors.primaryOnDark
                  : (i == stepIndex ? Colors.white.withValues(alpha: 0.18) : Colors.transparent),
              border: Border.all(
                color: (done || i <= stepIndex) ? AppColors.primaryOnDark : Colors.white24,
                width: 1.5,
              ),
            ),
            child: Icon(
              (done || i < stepIndex) ? Icons.check_rounded : _icon(keys[i]),
              size: 17,
              color: (done || i < stepIndex) ? const Color(0xFF052033) : Colors.white,
            ),
          ),
        ],
      ],
    );
  }
}
