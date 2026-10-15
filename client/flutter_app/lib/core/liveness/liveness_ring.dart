import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import 'liveness_capture_controller.dart';

/// The oval you look into (spec F3, 2026-10-15): it tells you what the camera
/// is seeing and where to look, without words.
///
///  - no face: dim dashes slowly crawl around the oval ("searching")
///  - ready: a solid ring with a soft breathing glow
///  - turn steps: a band of light sweeps along the side to turn toward, with
///    chevrons just outside the oval pointing that way
///  - blink step: the ring breathes faster, the glow tightens
///  - too far / too close / off centre / several people: an amber ring that
///    shivers sideways
///  - a step passed: a green ripple flies outward
///  - the server refused: the ring shakes red once
///
/// Sides are in the camera preview's own (mirrored) left and right, the same as
/// the avatar. Coaching only; nothing here decides anything.
class RingStyle {
  const RingStyle({
    required this.hint,
    required this.stepKey,
    required this.t,
    required this.pass,
    required this.fail,
    required this.reduceMotion,
  });

  final LivenessHint hint;

  /// `centre | BLINK | TURN_LEFT | TURN_RIGHT`.
  final String stepKey;

  /// Looping time 0..1.
  final double t;

  /// One-shot effect progress, 0..1 (0 = idle / finished).
  final double pass;
  final double fail;
  final bool reduceMotion;
}

class ReactiveRingPainter extends CustomPainter {
  ReactiveRingPainter(this.style) : super();
  final RingStyle style;

  static Rect ovalFor(Size size) => Rect.fromCenter(
        center: Offset(size.width / 2, size.height * 0.46),
        width: size.width * 0.68,
        height: size.width * 0.68 * 1.3,
      );

  static const _amber = Color(0xFFFFB84D);
  static const _red = Color(0xFFFF6B6B);

  @override
  void paint(Canvas canvas, Size size) {
    final st = style;
    var oval = ovalFor(size);

    // Dim everything outside the oval so the face is the only bright thing.
    canvas.drawPath(
      Path.combine(PathOperation.difference, Path()..addRect(Offset.zero & size), Path()..addOval(oval)),
      Paint()..color = const Color(0xFF07100E).withValues(alpha: 0.55),
    );

    final problem = st.hint == LivenessHint.tooFar ||
        st.hint == LivenessHint.tooClose ||
        st.hint == LivenessHint.offCentre ||
        st.hint == LivenessHint.multiple;
    final searching = st.hint == LivenessHint.searching;

    // Shiver (a problem with the face) and shake (a refusal): move the ring itself.
    var dx = 0.0;
    if (!st.reduceMotion) {
      if (problem) dx += math.sin(st.t * 2 * math.pi * 9) * size.width * 0.006;
      if (st.fail > 0) dx += math.sin(st.fail * math.pi * 6) * (1 - st.fail) * size.width * 0.035;
    }
    oval = oval.shift(Offset(dx, 0));

    final base = st.fail > 0
        ? Color.lerp(AppColors.primaryOnDark, _red, (1 - st.fail).clamp(0.0, 1.0) * 1.0)!
        : problem
            ? _amber
            : AppColors.primaryOnDark;

    // Soft glow (breathing when ready; faster for the blink step).
    if (!searching) {
      final speed = st.stepKey == 'BLINK' ? 2.0 : 1.0;
      final breathe = st.reduceMotion ? 0.5 : (math.sin(st.t * 2 * math.pi * speed) + 1) / 2;
      canvas.drawOval(
        oval.inflate(2),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 10 + 6 * breathe
          ..color = base.withValues(alpha: 0.16 + 0.14 * breathe)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 9),
      );
    }

    // The ring itself: dashes that crawl when searching, solid otherwise.
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = searching ? 2.5 : 3.2
      ..strokeCap = StrokeCap.round
      ..color = searching ? Colors.white.withValues(alpha: 0.42) : base;
    if (searching) {
      _dashed(canvas, oval, ring, phase: st.reduceMotion ? 0 : st.t * 22);
    } else {
      canvas.drawOval(oval, ring);
    }

    // Turn steps: a band of light running along the side to turn toward, plus
    // chevrons outside the oval pointing that way.
    final turn = st.stepKey == 'TURN_LEFT' ? -1.0 : st.stepKey == 'TURN_RIGHT' ? 1.0 : 0.0;
    if (turn != 0 && !searching) {
      _sweep(canvas, oval, turn, st);
      _chevrons(canvas, oval, turn, st);
    }

    // A step passed: a green ripple flies outward and fades.
    if (st.pass > 0 && st.pass < 1) {
      final grow = Curves.easeOutCubic.transform(st.pass);
      canvas.drawOval(
        oval.inflate(6 + size.width * 0.16 * grow),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 4 * (1 - st.pass) + 1
          ..color = AppColors.success.withValues(alpha: (1 - st.pass) * 0.9),
      );
      canvas.drawOval(
        oval,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 4
          ..color = AppColors.success.withValues(alpha: (1 - st.pass) * 0.8),
      );
    }
  }

  void _dashed(Canvas canvas, Rect rect, Paint paint, {required double phase}) {
    const dash = 8.0, gap = 7.0;
    for (final m in (Path()..addOval(rect)).computeMetrics()) {
      var d = -(phase % (dash + gap));
      while (d < m.length) {
        final a = math.max(0.0, d);
        final b = math.min(m.length, d + dash);
        if (b > a) canvas.drawPath(m.extractPath(a, b), paint);
        d += dash + gap;
      }
    }
  }

  /// A bright arc over the oval's turn-side, sliding up and down it so the
  /// eye is pulled that way.
  void _sweep(Canvas canvas, Rect oval, double turn, RingStyle st) {
    final progress = st.reduceMotion ? 0.5 : (math.sin(st.t * 2 * math.pi) + 1) / 2;
    // Angle 0 = right, pi = left (canvas y grows downward). Centre the band on
    // that side and let it slide +/- 35 degrees.
    final mid = turn > 0 ? 0.0 : math.pi;
    final slide = (progress - 0.5) * 2 * (math.pi * 0.19);
    final sweep = math.pi * 0.30;
    final start = mid - sweep / 2 + slide * (turn > 0 ? 1 : -1);
    canvas.drawArc(
      oval,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 8
        ..strokeCap = StrokeCap.round
        ..color = Colors.white.withValues(alpha: 0.35)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
    );
    canvas.drawArc(
      oval,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4.4
        ..strokeCap = StrokeCap.round
        ..color = Colors.white,
    );
  }

  /// Three chevrons beside the oval on the turn side; they march outward.
  void _chevrons(Canvas canvas, Rect oval, double turn, RingStyle st) {
    final phase = st.reduceMotion ? 0.0 : st.t * 3 % 1.0;
    for (var i = 0; i < 3; i++) {
      final f = ((i / 3) + phase) % 1.0;
      final x = oval.center.dx + turn * (oval.width / 2 + 14 + f * 34);
      final y = oval.center.dy;
      final alpha = math.sin(f * math.pi).clamp(0.0, 1.0) * 0.95;
      final path = Path()
        ..moveTo(x - turn * 7, y - 12)
        ..lineTo(x + turn * 5, y)
        ..lineTo(x - turn * 7, y + 12);
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 4
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..color = Colors.white.withValues(alpha: alpha),
      );
    }
  }

  @override
  bool shouldRepaint(ReactiveRingPainter old) =>
      old.style.hint != style.hint ||
      old.style.stepKey != style.stepKey ||
      old.style.t != style.t ||
      old.style.pass != style.pass ||
      old.style.fail != style.fail ||
      old.style.reduceMotion != style.reduceMotion;
}
