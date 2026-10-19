import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:camera_platform_interface/camera_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:engirent/core/face_coach/coach_avatar.dart';
import 'package:engirent/core/face_coach/coach_ring.dart';
import 'package:engirent/features/kiosk/screens/face_verify_screen.dart';

/// The one-photo face screen end to end on a fake camera: it opens, coaches,
/// takes the photo, and on a refusal goes back to framing with coaching on and
/// the shutter usable again. (Widget tests answer every HTTP request with an
/// error, which is exactly the refusal path.)
class _Cam extends CameraPlatform {
  final Directory dir;
  _Cam(this.dir);
  int pictures = 0;

  /// When set, takePicture waits for it (a slow camera, to double-tap into).
  Completer<void>? holdPicture;
  final Set<int> streaming = {};
  final _init = StreamController<CameraInitializedEvent>.broadcast();
  final _never = StreamController<CameraErrorEvent>.broadcast();

  @override
  Future<List<CameraDescription>> availableCameras() async => const [
    CameraDescription(name: 'front', lensDirection: CameraLensDirection.front, sensorOrientation: 270),
  ];
  @override
  Stream<DeviceOrientationChangedEvent> onDeviceOrientationChanged() => const Stream.empty();
  @override
  Future<int> createCameraWithSettings(CameraDescription d, MediaSettings? s) async => 1;
  @override
  Stream<CameraInitializedEvent> onCameraInitialized(int id) => _init.stream;
  @override
  Stream<CameraErrorEvent> onCameraError(int id) => _never.stream;
  @override
  Future<void> initializeCamera(int id, {ImageFormatGroup imageFormatGroup = ImageFormatGroup.unknown}) async {
    scheduleMicrotask(
      () => _init.add(CameraInitializedEvent(id, 960, 720, ExposureMode.auto, true, FocusMode.auto, true)),
    );
  }

  @override
  bool supportsImageStreaming() => true;
  @override
  Stream<CameraImageData> onStreamedFrameAvailable(int id, {CameraImageStreamOptions? options}) =>
      StreamController<CameraImageData>(onListen: () => streaming.add(id), onCancel: () => streaming.remove(id)).stream;
  @override
  Future<XFile> takePicture(int id) async {
    pictures++;
    final h = holdPicture;
    if (h != null) await h.future;
    final f = File('${dir.path}/face_$pictures.jpg')..writeAsBytesSync(const [0xFF, 0xD8, 0xFF, 0xD9]);
    return XFile(f.path);
  }

  @override
  Widget buildPreview(int id) => const ColoredBox(color: Colors.grey);
  @override
  Future<void> dispose(int id) async => streaming.remove(id);
}

void main() {
  late Directory dir;
  late _Cam cam;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('face_verify_test');
    cam = _Cam(dir);
    CameraPlatform.instance = cam;
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(() => dir.deleteSync(recursive: true));

  Future<void> realWait(WidgetTester tester, [int ms = 300]) =>
      tester.runAsync(() => Future<void>.delayed(Duration(milliseconds: ms)));

  testWidgets('opens with the ring and the guide, takes the photo, and a refusal lets the student try again', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(400, 860));
    await tester.pumpWidget(
      const MaterialApp(
        home: FaceVerifyScreen(rentalId: 'r1', mode: 'retrieve'),
      ),
    );
    await realWait(tester);
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(CameraPreview), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w is CustomPaint && w.painter is ReactiveRingPainter), findsOneWidget);
    expect(find.byType(CoachRow), findsOneWidget);
    expect(
      find.text('Looking for your face…'),
      findsOneWidget,
      reason: 'no face seen yet: coaching says so, but the shutter still works',
    );
    expect(cam.streaming, isNotEmpty, reason: 'coaching is running');

    final shutter = find.bySemanticsLabel('Take the photo');
    expect(shutter, findsOneWidget);
    await tester.tap(shutter);
    await tester.pump();
    await realWait(tester, 800);
    await tester.pump(const Duration(milliseconds: 100));
    await realWait(tester, 300);
    await tester.pump(const Duration(milliseconds: 700));

    expect(cam.pictures, 1, reason: 'the photo is taken even with no face detected (coaching never blocks)');
    // Refused (every HTTP request fails in a widget test): back to framing,
    // the message shown, coaching on again, shutter usable.
    expect(find.textContaining('try again'), findsOneWidget);
    expect(find.byType(CoachRow), findsOneWidget);
    expect(cam.streaming, isNotEmpty, reason: 'coaching resumed after the refusal');

    await tester.tap(shutter);
    await tester.pump();
    await realWait(tester, 800);
    await tester.pump(const Duration(milliseconds: 700));
    expect(cam.pictures, 2, reason: 'a second try takes a second photo');

    await tester.pumpWidget(const SizedBox());
    await realWait(tester);
  });

  Future<void> openScreen(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 860));
    await tester.pumpWidget(
      const MaterialApp(
        home: FaceVerifyScreen(rentalId: 'r1', mode: 'retrieve'),
      ),
    );
    await realWait(tester);
    await tester.pump(const Duration(milliseconds: 100));
  }

  testWidgets('a quick double tap takes ONE photo and shows no capture error', (tester) async {
    await openScreen(tester);
    cam.holdPicture = Completer<void>();
    final shutter = find.bySemanticsLabel('Take the photo');
    await tester.tap(shutter);
    await tester.pump(const Duration(milliseconds: 40));
    await tester.tap(shutter, warnIfMissed: false);
    await tester.pump(const Duration(milliseconds: 40));
    cam.holdPicture!.complete();
    cam.holdPicture = null;
    await tester.pump();
    await realWait(tester, 800);
    await tester.pump(const Duration(milliseconds: 700));
    expect(cam.pictures, 1);
    expect(find.textContaining('Capture failed'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await realWait(tester);
  });

  testWidgets('leaving the screen while the photo uploads does not throw', (tester) async {
    await openScreen(tester);
    await tester.tap(find.bySemanticsLabel('Take the photo'));
    await tester.pump();
    await realWait(tester, 30);
    await tester.pump();
    expect(cam.pictures, 1, reason: 'the photo exists and the upload is under way');
    await tester.pumpWidget(const SizedBox());
    await realWait(tester, 800);
    await tester.pump(const Duration(milliseconds: 300));
  });

  testWidgets('leaving the screen while the camera takes the photo does not throw', (tester) async {
    await openScreen(tester);
    cam.holdPicture = Completer<void>();
    await tester.tap(find.bySemanticsLabel('Take the photo'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    cam.holdPicture!.complete();
    await realWait(tester, 500);
    await tester.pump(const Duration(milliseconds: 300));
  });
}
