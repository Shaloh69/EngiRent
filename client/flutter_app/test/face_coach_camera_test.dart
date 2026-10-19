import 'dart:async';

import 'package:camera/camera.dart';
import 'package:camera_platform_interface/camera_platform_interface.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/face_coach/face_coach_camera.dart';

/// A camera platform that records what is open, so the tests can catch the bug
/// class that matters on a real phone: a second camera left open (the next
/// open fails, "camera in use"), a black preview after an app switch, or the
/// coaching stream stopping the photo from being taken.
class _FakeCamera extends CameraPlatform {
  int _nextId = 1;
  final Set<int> open = {};
  final Set<int> streaming = {};
  final Map<int, StreamController<CameraInitializedEvent>> _init = {};
  int created = 0;
  int pictures = 0;

  /// When set, initializeCamera waits for it (to pause the app mid-open).
  Completer<void>? hold;

  /// Waits only for the Nth initializeCamera call (1-based).
  final Map<int, Completer<void>> holdCall = {};
  int _inits = 0;

  /// Phones that refuse the detector's frame format.
  bool rejectStreamFormat = false;

  /// Android takes the camera away when the app goes to the background: a
  /// camera opened before that is dead (black preview) even if its open
  /// "succeeds" afterwards — or, with [revokedOpenThrows], its open fails.
  final Set<int> dead = {};
  bool revokedOpenThrows = false;
  void revoke() => dead.addAll(open);

  /// While the app is in the background every open fails (Android).
  bool background = false;

  @override
  Future<List<CameraDescription>> availableCameras() async => const [
    CameraDescription(name: 'front', lensDirection: CameraLensDirection.front, sensorOrientation: 270),
  ];

  @override
  Stream<DeviceOrientationChangedEvent> onDeviceOrientationChanged() => const Stream.empty();

  @override
  Future<int> createCameraWithSettings(CameraDescription d, MediaSettings? s) async {
    created++;
    final id = _nextId++;
    open.add(id);
    _init[id] = StreamController<CameraInitializedEvent>.broadcast();
    return id;
  }

  @override
  Stream<CameraInitializedEvent> onCameraInitialized(int cameraId) => _init[cameraId]!.stream;

  @override
  Stream<CameraErrorEvent> onCameraError(int cameraId) => _never.stream;
  final _never = StreamController<CameraErrorEvent>.broadcast();

  @override
  Future<void> initializeCamera(int cameraId, {ImageFormatGroup imageFormatGroup = ImageFormatGroup.unknown}) async {
    final h = hold;
    if (h != null) await h.future;
    final n = ++_inits;
    if (holdCall[n] != null) await holdCall[n]!.future;
    if (background || (revokedOpenThrows && dead.contains(cameraId))) {
      throw PlatformException(code: 'CameraAccess', message: 'camera disconnected');
    }
    if (rejectStreamFormat && imageFormatGroup != ImageFormatGroup.unknown) {
      throw PlatformException(code: 'format', message: 'unsupported frame format');
    }
    scheduleMicrotask(
      () => _init[cameraId]!.add(
        CameraInitializedEvent(cameraId, 960, 720, ExposureMode.auto, true, FocusMode.auto, true),
      ),
    );
  }

  @override
  bool supportsImageStreaming() => true;

  bool streamThrows = false;

  @override
  Stream<CameraImageData> onStreamedFrameAvailable(int cameraId, {CameraImageStreamOptions? options}) {
    if (streamThrows) throw PlatformException(code: 'stream', message: 'image stream unavailable');
    final c = StreamController<CameraImageData>(
      onListen: () => streaming.add(cameraId),
      onCancel: () => streaming.remove(cameraId),
    );
    return c.stream;
  }

  @override
  Future<XFile> takePicture(int cameraId) async {
    pictures++;
    return XFile('face_$pictures.jpg');
  }

  @override
  Future<void> dispose(int cameraId) async {
    open.remove(cameraId);
    streaming.remove(cameraId);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _FakeCamera fake;

  setUp(() {
    fake = _FakeCamera();
    CameraPlatform.instance = fake;
  });

  Future<void> settle() async {
    for (var i = 0; i < 20; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  test('start opens exactly one camera and starts coaching', () async {
    final c = FaceCoachCamera();
    await c.start();
    expect(c.isReady, isTrue);
    expect(c.error, isNull);
    expect(fake.open.length, 1);
    expect(fake.streaming.length, 1);
    c.dispose();
    await settle();
    expect(fake.open, isEmpty);
  });

  test('a second start while opening does not open a second camera', () async {
    fake.hold = Completer<void>();
    final c = FaceCoachCamera();
    final a = c.start();
    final b = c.start();
    await settle();
    fake.hold!.complete();
    await Future.wait([a, b]);
    await settle();
    expect(fake.created, 1);
    expect(fake.open.length, 1);
    c.dispose();
  });

  test('paused while opening (the permission dialog): no stray camera, and resume opens one', () async {
    fake.hold = Completer<void>();
    final c = FaceCoachCamera();
    final opening = c.start();
    await settle();
    fake.revoke();
    await c.onAppPaused();
    final resuming = c.onAppResumed();
    fake.hold!.complete();
    fake.hold = null;
    await Future.wait([opening, resuming]);
    await settle();
    expect(c.isReady, isTrue, reason: 'the preview must not stay black after the dialog');
    expect(c.error, isNull);
    expect(
      fake.dead.contains(c.camera!.cameraId),
      isFalse,
      reason: 'the camera opened before the pause is dead; a fresh one must be used',
    );
    expect(fake.open.length, 1, reason: 'the first, abandoned camera must be released');
    c.dispose();
    await settle();
    expect(fake.open, isEmpty);
  });

  test('paused while opening and that open FAILS: no error shown, resume opens a working camera', () async {
    fake.hold = Completer<void>();
    fake.revokedOpenThrows = true;
    final c = FaceCoachCamera();
    final opening = c.start();
    await settle();
    fake.revoke();
    fake.background = true;
    await c.onAppPaused();
    fake.hold!.complete();
    fake.hold = null;
    await opening;
    await settle();
    expect(c.error, isNull, reason: 'a pause is not a broken camera');
    expect(fake.open, isEmpty, reason: 'nothing may be opened while in the background');
    expect(fake.created, 1, reason: 'a pause must not be mistaken for a format rejection');
    fake.background = false;
    await c.onAppResumed();
    await settle();
    expect(c.isReady, isTrue);
    expect(c.error, isNull);
    c.dispose();
  });

  test('paused while opening and never resumed: nothing is left open', () async {
    fake.hold = Completer<void>();
    final c = FaceCoachCamera();
    final opening = c.start();
    await settle();
    await c.onAppPaused();
    fake.hold!.complete();
    await opening;
    await settle();
    expect(fake.open, isEmpty);
    expect(c.isReady, isFalse);
    expect(c.error, isNull, reason: 'a pause is not a broken camera');
    c.dispose();
  });

  test('app switch after the camera is ready: released on pause, reopened on resume', () async {
    final c = FaceCoachCamera();
    await c.start();
    await c.onAppPaused();
    expect(fake.open, isEmpty);
    expect(c.isReady, isFalse);
    await c.onAppResumed();
    await settle();
    expect(c.isReady, isTrue);
    expect(fake.open.length, 1);
    c.dispose();
  });

  test('the photo is taken while coaching (stream stopped first), and coaching resumes', () async {
    final c = FaceCoachCamera();
    await c.start();
    expect(fake.streaming.length, 1);
    final f = await c.takePhoto();
    expect(f.path, 'face_1.jpg');
    expect(fake.pictures, 1);
    expect(fake.streaming, isEmpty);
    await c.resumeCoaching();
    expect(fake.streaming.length, 1);
    // A retry takes a second photo just the same.
    await c.takePhoto();
    expect(fake.pictures, 2);
    c.dispose();
  });

  test('a phone that rejects the frame format still gets the old camera and can take the photo', () async {
    fake.rejectStreamFormat = true;
    final c = FaceCoachCamera();
    await c.start();
    await settle();
    expect(c.isReady, isTrue);
    expect(c.error, isNull);
    expect(fake.open.length, 1, reason: 'the rejected controller is released');
    expect(fake.streaming, isEmpty, reason: 'no coaching on this phone, nothing else changes');
    await c.takePhoto();
    expect(fake.pictures, 1);
    c.dispose();
  });

  test('coaching fails (no image stream): camera ready, no error, photo works', () async {
    fake.streamThrows = true;
    final c = FaceCoachCamera();
    await c.start();
    await settle();
    expect(c.isReady, isTrue);
    expect(c.error, isNull);
    expect(fake.streaming, isEmpty);
    await c.takePhoto();
    expect(fake.pictures, 1);
    c.dispose();
  });

  test('format rejected, then paused while the plain camera opens: no error, resume opens it', () async {
    fake.rejectStreamFormat = true;
    fake.holdCall[2] = Completer<void>();
    final c = FaceCoachCamera();
    final opening = c.start();
    await settle();
    fake.background = true;
    await c.onAppPaused();
    fake.holdCall[2]!.complete();
    await opening;
    await settle();
    expect(c.error, isNull, reason: 'a pause is not a broken camera');
    expect(fake.open, isEmpty);
    fake.background = false;
    await c.onAppResumed();
    await settle();
    expect(c.isReady, isTrue);
    expect(c.error, isNull);
    c.dispose();
  });

  test('takePhoto before the camera is ready fails cleanly (the screen ignores the tap)', () async {
    final c = FaceCoachCamera();
    expect(c.takePhoto(), throwsStateError);
    c.dispose();
  });
}
