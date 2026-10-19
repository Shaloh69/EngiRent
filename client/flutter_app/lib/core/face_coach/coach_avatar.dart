import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../theme/tokens.dart';

/// The coach (spec F3, 2026-10-15): a small mascot that shows what to do next,
/// with a speech bubble for the words. Drawn in code (no assets), in the app's
/// own teal.
///
/// It demonstrates in the same left/right the student sees in the camera
/// preview (the front camera is mirrored, like a mirror): when it says "turn to
/// your left" the mascot's face moves toward the left of the screen, and the
/// ring's arrow is on that side too. Coaching only; the server decides.

/// Where the mascot's face is at time [t] (0..1, looping) for a step key:
/// `centre | BLINK | TURN_LEFT | TURN_RIGHT`.
class AvatarPose {
  const AvatarPose({required this.turn, required this.blink, required this.bob});

  /// -1 = fully toward the screen's left, +1 = toward the right.
  final double turn;

  /// 0 = eyes open, 1 = eyes shut.
  final double blink;

  /// Vertical offset in head-heights (a tiny idle bob, or a nod after a pass).
  final double bob;
}

double _smooth(double x) => x * x * (3 - 2 * x);

/// Out and back with a hold in the middle: 0..0.35 out, 0.35..0.65 hold, 0.65..1 back.
double _outAndBack(double t) {
  if (t < 0.35) return _smooth(t / 0.35);
  if (t < 0.65) return 1;
  return 1 - _smooth((t - 0.65) / 0.35);
}

AvatarPose poseFor(String key, double t, {double nod = 0}) {
  final idle = math.sin(t * 2 * math.pi) * 0.012;
  final nodDip = math.sin(nod.clamp(0.0, 1.0) * math.pi) * 0.09;
  switch (key) {
    case 'BLINK':
      // Two slow, full blinks per loop so the movement reads as "close them fully".
      final u = (t * 2) % 1.0;
      final shut = u > 0.30 && u < 0.62 ? math.sin((u - 0.30) / 0.32 * math.pi) : 0.0;
      return AvatarPose(turn: 0, blink: shut, bob: idle + nodDip);
    case 'TURN_LEFT':
      return AvatarPose(turn: -_outAndBack(t), blink: 0, bob: idle + nodDip);
    case 'TURN_RIGHT':
      return AvatarPose(turn: _outAndBack(t), blink: 0, bob: idle + nodDip);
    default: // 'centre': looking straight, a friendly idle
      return AvatarPose(turn: 0, blink: 0, bob: idle + nodDip);
  }
}

class LivenessAvatar extends StatelessWidget {
  const LivenessAvatar({
    super.key,
    required this.stepKey,
    required this.t,
    this.nod = 0,
    this.size = 76,
    this.worried = false,
    this.reduceMotion = false,
  });

  final String stepKey;

  /// Looping animation time, 0..1.
  final double t;

  /// 0..1 progress of the "step passed" nod.
  final double nod;
  final double size;

  /// A face problem (too far, several people): the mascot looks concerned.
  final bool worried;
  final bool reduceMotion;

  @override
  Widget build(BuildContext context) {
    // Reduced motion: hold the end pose of the step instead of moving.
    final pose = reduceMotion ? poseFor(stepKey, 0.5) : poseFor(stepKey, t, nod: nod);
    return ExcludeSemantics(
      child: SizedBox(
        width: size,
        height: size,
        child: CustomPaint(
          painter: _AvatarPainter(pose: pose, worried: worried),
        ),
      ),
    );
  }
}

class _AvatarPainter extends CustomPainter {
  _AvatarPainter({required this.pose, required this.worried});
  final AvatarPose pose;
  final bool worried;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width;
    final c = Offset(s / 2, s / 2 + pose.bob * s);
    final headW = s * 0.84 * (1 - 0.10 * pose.turn.abs()); // narrows a little as it turns
    final headH = s * 0.84;
    final head = Rect.fromCenter(center: c.translate(pose.turn * s * 0.05, 0), width: headW, height: headH);

    // Soft glow behind the head.
    canvas.drawCircle(
      c,
      s * 0.50,
      Paint()
        ..color = AppColors.primaryOnDark.withValues(alpha: 0.18)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10),
    );

    // Far-side ear shows when the head turns, like a real profile.
    if (pose.turn.abs() > 0.15) {
      final side = pose.turn > 0 ? -1.0 : 1.0; // the ear on the side the face turns AWAY from
      final ear = Rect.fromCenter(
        center: Offset(head.center.dx + side * headW * 0.50, head.center.dy),
        width: s * 0.10,
        height: s * 0.22,
      );
      canvas.drawOval(ear, Paint()..color = const Color(0xFF2FA89B).withValues(alpha: pose.turn.abs().clamp(0.0, 1.0)));
    }

    // Head: rounded, teal gradient.
    final headPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xFF63E0D2), Color(0xFF1F9C90)],
      ).createShader(head);
    canvas.drawRRect(RRect.fromRectAndRadius(head, Radius.circular(s * 0.34)), headPaint);

    // Face features slide further than the head, which is what sells the turn.
    final fx = c.dx + pose.turn * s * 0.17;
    final fy = c.dy - s * 0.04;
    final eyeDx = s * 0.15 * (1 - 0.30 * pose.turn.abs());
    final eyeW = s * 0.13;
    final eyeH = s * 0.17;
    for (final side in const [-1.0, 1.0]) {
      final ex = fx + side * eyeDx;
      // Eyes nearer the turn direction look slightly larger (perspective).
      final grow = 1 + 0.12 * pose.turn * side;
      final eye = Rect.fromCenter(center: Offset(ex, fy), width: eyeW * grow, height: eyeH * grow);
      canvas.drawOval(eye, Paint()..color = Colors.white);
      // Pupils look where the head turns.
      final pupil = Offset(ex + pose.turn * eyeW * 0.22, fy + (worried ? -eyeH * 0.05 : 0));
      canvas.drawCircle(pupil, eyeW * 0.30, Paint()..color = const Color(0xFF07302C));
      canvas.drawCircle(pupil.translate(-eyeW * 0.08, -eyeH * 0.10), eyeW * 0.09, Paint()..color = Colors.white);
      // Eyelid: grows from the top to cover the whole eye while blinking.
      if (pose.blink > 0.02) {
        final lid = Rect.fromLTRB(eye.left - 1, eye.top - 1, eye.right + 1, eye.top + (eye.height + 2) * pose.blink);
        canvas.save();
        canvas.clipPath(Path()..addOval(eye.inflate(1)));
        canvas.drawRect(lid, Paint()..color = const Color(0xFF3CC2B3));
        canvas.restore();
        if (pose.blink > 0.6) {
          // A closed lid line.
          canvas.drawLine(
            Offset(eye.left + 1, eye.center.dy),
            Offset(eye.right - 1, eye.center.dy),
            Paint()
              ..color = const Color(0xFF07302C)
              ..strokeWidth = s * 0.018
              ..strokeCap = StrokeCap.round,
          );
        }
      }
    }

    // Mouth: a smile, or a small flat/concerned line.
    final mouthY = fy + s * 0.22;
    final mouthW = s * 0.16;
    final mouth = Path();
    if (worried) {
      mouth.moveTo(fx - mouthW / 2, mouthY + s * 0.015);
      mouth.quadraticBezierTo(fx, mouthY - s * 0.02, fx + mouthW / 2, mouthY + s * 0.015);
    } else {
      mouth.moveTo(fx - mouthW / 2, mouthY);
      mouth.quadraticBezierTo(fx, mouthY + s * 0.07, fx + mouthW / 2, mouthY);
    }
    canvas.drawPath(
      mouth,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color(0xFF07302C)
        ..strokeWidth = s * 0.026
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(_AvatarPainter old) => old.pose != pose || old.worried != worried;
}

/// The mascot with its words: [avatar] [bubble with a tail pointing at it].
class CoachRow extends StatelessWidget {
  const CoachRow({super.key, required this.avatar, required this.text, this.stepLabel, this.tone = CoachTone.normal});

  final Widget avatar;
  final String text;
  final String? stepLabel;
  final CoachTone tone;

  @override
  Widget build(BuildContext context) {
    final border = switch (tone) {
      CoachTone.normal => Colors.white.withValues(alpha: 0.16),
      CoachTone.warn => AppColors.warning.withValues(alpha: 0.7),
      CoachTone.good => AppColors.success.withValues(alpha: 0.7),
    };
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        avatar,
        const SizedBox(width: 4),
        CustomPaint(size: const Size(10, 18), painter: _TailPainter(border)),
        Expanded(
          child: Semantics(
            liveRegion: true,
            child: AnimatedContainer(
              duration: AppMotion.fast,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.09),
                borderRadius: AppRadius.card,
                border: Border.all(color: border, width: tone == CoachTone.normal ? 1 : 1.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (stepLabel != null)
                    Text(stepLabel!, style: const TextStyle(fontSize: 11.5, color: Color(0xFF9FBFB8))),
                  Text(
                    text,
                    style: const TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

enum CoachTone { normal, warn, good }

class _TailPainter extends CustomPainter {
  _TailPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Path()
      ..moveTo(size.width, 0)
      ..lineTo(0, size.height / 2)
      ..lineTo(size.width, size.height)
      ..close();
    canvas.drawPath(p, Paint()..color = Colors.white.withValues(alpha: 0.09));
    canvas.drawPath(
      p,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = color,
    );
  }

  @override
  bool shouldRepaint(_TailPainter old) => old.color != color;
}
