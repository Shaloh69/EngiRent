import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/face_coach/coach_avatar.dart';
import 'package:engirent/core/face_coach/coach_ring.dart';
import 'package:engirent/core/face_coach/face_hint.dart';

/// The coaching look on the one-photo face check (2026-10-15, after the
/// liveness revamp was reverted to branch `face-liveness`). Coaching only: none
/// of this decides anything or blocks the photo.
void main() {
  const image = Size(720, 960);
  Rect centred(double widthShare) {
    final w = image.width * widthShare;
    return Rect.fromCenter(center: Offset(image.width / 2, image.height / 2), width: w, height: w * 1.25);
  }

  group('hintFor (what the ring and guide say)', () {
    test('no face, or no size information, is searching', () {
      expect(hintFor(faceCount: 0), LivenessHint.searching);
      expect(hintFor(faceCount: 1, box: centred(0.5)), LivenessHint.searching);
    });
    test('two people beat every other problem', () {
      expect(hintFor(faceCount: 2, box: centred(0.1), image: image), LivenessHint.multiple);
    });
    test('a small face is too far, a huge one too close', () {
      expect(hintFor(faceCount: 1, box: centred(0.2), image: image), LivenessHint.tooFar);
      expect(hintFor(faceCount: 1, box: centred(0.9), image: image), LivenessHint.tooClose);
    });
    test('a face off to the side, or turned away, is off centre', () {
      final side = centred(0.5).shift(const Offset(200, 0));
      expect(hintFor(faceCount: 1, box: side, image: image), LivenessHint.offCentre);
      expect(hintFor(faceCount: 1, box: centred(0.5), image: image, yawDeg: 30), LivenessHint.offCentre);
    });
    test('a single, centred, frontal face of a good size is ready', () {
      expect(hintFor(faceCount: 1, box: centred(0.5), image: image, yawDeg: 3), LivenessHint.ready);
    });
    test('every hint has its own sentence', () {
      expect(LivenessHint.values.map(coachText).toSet().length, LivenessHint.values.length);
    });
  });

  group('the guide (mascot) for the one-photo check', () {
    test('looking straight neither turns nor blinks', () {
      for (var t = 0.0; t <= 1.0; t += 0.1) {
        final p = poseFor('centre', t);
        expect(p.turn, 0);
        expect(p.blink, 0);
      }
    });
  });

  group('render states (looked at by a person; PNG only when FACE_COACH_OUT is set)', () {
    Widget cell(String label, LivenessHint h, {double fail = 0, double t = 0.2}) {
      final worried = h != LivenessHint.ready && h != LivenessHint.searching;
      return SizedBox(
        width: 320,
        height: 470,
        child: Column(
          children: [
            Text(label, style: const TextStyle(color: Colors.white, fontSize: 12)),
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    const ColoredBox(color: Color(0xFF2B3A38)),
                    Center(child: Icon(Icons.person, size: 220, color: Colors.white.withValues(alpha: 0.10))),
                    CustomPaint(
                      painter: ReactiveRingPainter(
                        RingStyle(hint: h, stepKey: 'centre', t: t, pass: 0, fail: fail, reduceMotion: false),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 6),
            CoachRow(
              avatar: LivenessAvatar(stepKey: 'centre', t: t, worried: worried),
              text: coachText(h),
              tone: h == LivenessHint.ready ? CoachTone.good : (worried ? CoachTone.warn : CoachTone.normal),
            ),
          ],
        ),
      );
    }

    testWidgets('every state paints without errors', (tester) async {
      final cells = <Widget>[
        cell('No face yet', LivenessHint.searching),
        cell('Ready', LivenessHint.ready),
        cell('Too far (shiver)', LivenessHint.tooFar, t: 0.03),
        cell('Two people', LivenessHint.multiple, t: 0.03),
        cell('Off centre', LivenessHint.offCentre, t: 0.03),
        cell('No match (shake)', LivenessHint.ready, fail: 0.2),
      ];
      final key = GlobalKey();
      await tester.binding.setSurfaceSize(const Size(1000, 1000));
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          home: Scaffold(
            backgroundColor: const Color(0xFF07100E),
            body: Center(
              child: RepaintBoundary(
                key: key,
                child: ColoredBox(
                  color: const Color(0xFF07100E),
                  child: Wrap(spacing: 8, runSpacing: 8, children: cells),
                ),
              ),
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      final out = Platform.environment['FACE_COACH_OUT'];
      if (out != null) {
        await tester.runAsync(() async {
          final boundary = key.currentContext!.findRenderObject() as RenderRepaintBoundary;
          final image = await boundary.toImage(pixelRatio: 1.0);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await File(out).writeAsBytes(bytes!.buffer.asUint8List());
        });
      }
    });
  });
}
