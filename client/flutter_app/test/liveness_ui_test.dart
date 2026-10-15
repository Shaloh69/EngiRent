import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/liveness/liveness_avatar.dart';
import 'package:engirent/core/liveness/liveness_capture_controller.dart';
import 'package:engirent/core/liveness/liveness_ring.dart';

LivenessHint hint({
  bool face = true,
  bool multi = false,
  bool far = false,
  bool close = false,
  bool out = false,
  bool centred = true,
}) =>
    hintFromFlags(
      faceDetected: face,
      multipleFaces: multi,
      tooFar: far,
      tooClose: close,
      outOfFrame: out,
      centered: centred,
    );

void main() {
  group('hintFromFlags', () {
    test('no face is searching, whatever else is true', () {
      expect(hint(face: false, far: true, multi: true), LivenessHint.searching);
    });
    test('several people beat every other problem', () {
      expect(hint(multi: true, far: true, out: true), LivenessHint.multiple);
    });
    test('too far and too close are told apart', () {
      expect(hint(far: true), LivenessHint.tooFar);
      expect(hint(close: true), LivenessHint.tooClose);
    });
    test('off centre or out of frame is one hint', () {
      expect(hint(centred: false), LivenessHint.offCentre);
      expect(hint(out: true), LivenessHint.offCentre);
    });
    test('a single, centred face is ready', () {
      expect(hint(), LivenessHint.ready);
    });
  });

  group('avatar poses', () {
    test('the turn steps go to opposite sides of the screen and come back', () {
      final left = [for (var t = 0.0; t <= 1.0; t += 0.05) poseFor('TURN_LEFT', t).turn];
      final right = [for (var t = 0.0; t <= 1.0; t += 0.05) poseFor('TURN_RIGHT', t).turn];
      expect(left.every((v) => v <= 0), isTrue);
      expect(right.every((v) => v >= 0), isTrue);
      expect(left.reduce((a, b) => a < b ? a : b), closeTo(-1, 1e-9));
      expect(right.reduce((a, b) => a > b ? a : b), closeTo(1, 1e-9));
      expect(poseFor('TURN_LEFT', 0).turn, closeTo(0, 1e-9));
      expect(poseFor('TURN_LEFT', 1).turn, closeTo(0, 1e-9));
    });

    test('the blink step closes the eyes fully, twice per loop, and opens again', () {
      final b = [for (var t = 0.0; t < 1.0; t += 0.01) poseFor('BLINK', t).blink];
      expect(b.reduce((a, c) => a > c ? a : c), greaterThan(0.95));
      expect(poseFor('BLINK', 0).blink, 0);
      var closings = 0;
      for (var i = 1; i < b.length; i++) {
        if (b[i - 1] < 0.5 && b[i] >= 0.5) closings++;
      }
      expect(closings, 2);
    });

    test('looking straight neither turns nor blinks', () {
      for (var t = 0.0; t <= 1.0; t += 0.1) {
        final p = poseFor('centre', t);
        expect(p.turn, 0);
        expect(p.blink, 0);
      }
    });

    test('a pass makes the mascot nod down and back', () {
      expect(poseFor('centre', 0, nod: 0).bob, closeTo(0, 1e-9));
      expect(poseFor('centre', 0, nod: 0.5).bob, greaterThan(0.05));
      expect(poseFor('centre', 0, nod: 1).bob, closeTo(0, 1e-9));
    });
  });

  group('render states (looked at by a person; PNG only when LIVENESS_UI_OUT is set)', () {
    Widget cell(String label, RingStyle ring, String key, {bool worried = false, double nod = 0, double t = 0.2}) {
      return SizedBox(
        width: 320,
        height: 470,
        child: Column(children: [
          Text(label, style: const TextStyle(color: Colors.white, fontSize: 12)),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Stack(fit: StackFit.expand, children: [
                const ColoredBox(color: Color(0xFF2B3A38)), // stands in for the camera picture
                Center(child: Icon(Icons.person, size: 220, color: Colors.white.withValues(alpha: 0.10))),
                CustomPaint(painter: ReactiveRingPainter(ring)),
              ]),
            ),
          ),
          const SizedBox(height: 6),
          CoachRow(
            avatar: LivenessAvatar(stepKey: key, t: t, nod: nod, worried: worried),
            text: label,
            tone: worried ? CoachTone.warn : CoachTone.normal,
          ),
        ]),
      );
    }

    RingStyle ring(LivenessHint h, String key, {double t = 0.2, double pass = 0, double fail = 0}) =>
        RingStyle(hint: h, stepKey: key, t: t, pass: pass, fail: fail, reduceMotion: false);

    testWidgets('every state paints without errors', (tester) async {
      final cells = <Widget>[
        cell('No face yet', ring(LivenessHint.searching, 'centre'), 'centre'),
        cell('Look straight (ready)', ring(LivenessHint.ready, 'centre'), 'centre'),
        cell('Blink', ring(LivenessHint.ready, 'BLINK', t: 0.6), 'BLINK', t: 0.4),
        cell('Turn left', ring(LivenessHint.ready, 'TURN_LEFT', t: 0.25), 'TURN_LEFT', t: 0.5),
        cell('Turn right', ring(LivenessHint.ready, 'TURN_RIGHT', t: 0.25), 'TURN_RIGHT', t: 0.5),
        cell('Too far (shiver)', ring(LivenessHint.tooFar, 'centre', t: 0.03), 'centre', worried: true),
        cell('Step passed', ring(LivenessHint.ready, 'BLINK', pass: 0.4), 'centre', nod: 0.5),
        cell('Refused (shake)', ring(LivenessHint.ready, 'centre', fail: 0.2), 'centre', worried: true),
      ];
      final key = GlobalKey();
      await tester.binding.setSurfaceSize(const Size(1300, 1500));
      await tester.pumpWidget(MaterialApp(
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
      ));
      expect(tester.takeException(), isNull);

      final out = Platform.environment['LIVENESS_UI_OUT'];
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
