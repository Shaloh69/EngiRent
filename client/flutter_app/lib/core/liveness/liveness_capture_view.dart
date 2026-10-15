import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../theme/tokens.dart';
import 'liveness_capture_controller.dart';

/// The guided face check, as a widget (spec F3). Layout follows the steps
/// pattern of Amazon's Face Liveness / samviva (oval, instruction card, step
/// dots) in EngiRent's own tokens. It only coaches: pictures leave through
/// [onCaptured], and the server decides.
///
/// Used by the kiosk verification screen, profile setup and "Update your face".
class LivenessCaptureView extends StatefulWidget {
  const LivenessCaptureView({
    super.key,
    required this.challenge,
    required this.onCaptured,
    this.busy = false,
    this.busyLabel = 'Checking…',
  });

  final FaceChallenge challenge;

  /// Called once with the four frames. The view then waits (shows [busyLabel])
  /// until the parent builds it again with a new [challenge] or leaves.
  final ValueChanged<LivenessCapture> onCaptured;

  /// While the parent uploads/judges the frames.
  final bool busy;
  final String busyLabel;

  @override
  State<LivenessCaptureView> createState() => _LivenessCaptureViewState();
}

class _LivenessCaptureViewState extends State<LivenessCaptureView> with WidgetsBindingObserver {
  late LivenessCaptureController _c;
  bool _delivered = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  void _start() {
    _c = LivenessCaptureController(challenge: widget.challenge)..addListener(_onChange);
    _delivered = false;
    _c.start();
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
  }

  void _onChange() {
    if (!mounted) return;
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
    _c.removeListener(_onChange);
    _c.dispose();
    super.dispose();
  }

  /// The parent calls this after it has uploaded the frames, to remove them.
  Future<void> deleteFrames() => _c.deleteFiles();

  @override
  Widget build(BuildContext context) {
    final failed = _c.phase == LivenessPhase.failed;
    final working = _c.phase == LivenessPhase.encoding || widget.busy;
    final cam = _c.camera;

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
                  CustomPaint(painter: _OvalPainter(active: _c.faceOk && !failed)),
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
                    Text(
                      _c.error ?? 'Something went wrong.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 13.5, height: 1.4),
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
              : _InstructionCard(
                  text: working ? widget.busyLabel : _c.instruction,
                  stepLabel: _c.phase == LivenessPhase.running
                      ? 'Step ${(_c.stepIndex + 1).clamp(1, 4)} of 4'
                      : null,
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

class _InstructionCard extends StatelessWidget {
  const _InstructionCard({required this.text, this.stepLabel});
  final String text;
  final String? stepLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.08),
          borderRadius: AppRadius.card,
          border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (stepLabel != null)
              Text(stepLabel!, style: const TextStyle(fontSize: 11.5, color: Color(0xFF9FBFB8))),
            const SizedBox(height: 2),
            Text(
              text,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white),
            ),
          ],
        ),
      ),
    );
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
          Container(
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

class _OvalPainter extends CustomPainter {
  _OvalPainter({required this.active});
  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    final target = Rect.fromCenter(
      center: Offset(size.width / 2, size.height * 0.46),
      width: size.width * 0.68,
      height: size.width * 0.68 * 1.3,
    );
    canvas.drawPath(
      Path.combine(PathOperation.difference, Path()..addRect(Offset.zero & size), Path()..addOval(target)),
      Paint()..color = const Color(0xFF07100E).withValues(alpha: 0.55),
    );
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..color = active ? AppColors.primaryOnDark : Colors.white.withValues(alpha: 0.4);
    if (active) {
      canvas.drawOval(target, paint);
    } else {
      for (final m in (Path()..addOval(target)).computeMetrics()) {
        var d = 0.0;
        while (d < m.length) {
          canvas.drawPath(m.extractPath(d, (d + 8).clamp(0, m.length)), paint);
          d += 14;
        }
      }
    }
  }

  @override
  bool shouldRepaint(_OvalPainter old) => old.active != active;
}
