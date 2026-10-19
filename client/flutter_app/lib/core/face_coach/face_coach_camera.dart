import 'dart:async';
import 'dart:io';
import 'dart:ui' show Rect, Size;

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

import 'face_hint.dart';

/// The front camera for the one-photo face check, plus on-phone face detection
/// that ONLY coaches (the ring and the guide react to it).
///
/// Design rule after the reverted liveness attempt (2026-10-15, "too buggy"):
/// nothing here can stop a student from taking the photo. If the detector
/// fails, is slow, or this phone's frame format is not supported, the hint just
/// stays "searching" and the shutter works exactly as it did before. The photo
/// is taken with `takePicture()`, the same call the old screen used, and the
/// server judges it the same way.
class FaceCoachCamera extends ChangeNotifier {
  CameraController? camera;
  String? error;
  LivenessHint hint = LivenessHint.searching;

  FaceDetector? _detector;
  bool _busy = false;
  bool _disposed = false;
  bool _streaming = false;
  int _rotation = 0;
  DateTime _lastNotify = DateTime.fromMillisecondsSinceEpoch(0);

  // Opening the camera is slow and the app can be paused part-way (the
  // permission dialog alone does it). Only one start runs at a time; a pause
  // bumps the generation so a start that finishes afterwards releases its
  // camera instead of keeping a second one open.
  bool _starting = false;
  bool _paused = false;
  int _generation = 0;

  bool get isReady => camera != null && camera!.value.isInitialized && error == null;

  Future<void> start() async {
    if (_disposed || _starting || _paused) return;
    _starting = true;
    final gen = _generation;
    try {
      await _open(gen);
    } finally {
      _starting = false;
    }
    // Paused and resumed while that start was still opening: open again now.
    if (!_disposed && !_paused && camera == null && error == null && gen != _generation) {
      await start();
    }
  }

  Future<void> _open(int gen) async {
    // A controller whose initialize() threw still holds the camera until it is
    // disposed (the old screen leaked it); every failure path releases it.
    CameraController? pending;
    var coaching = true;
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        error = 'No camera available on this device.';
        notifyListeners();
        return;
      }
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      _rotation = front.sensorOrientation;
      CameraController ctrl = CameraController(
        front,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: defaultTargetPlatform == TargetPlatform.iOS
            ? ImageFormatGroup.bgra8888
            : ImageFormatGroup.nv21,
      );
      pending = ctrl;
      try {
        await ctrl.initialize();
      } catch (_) {
        pending = null;
        await ctrl.dispose();
        // Failed because the app was paused part-way, not because of the
        // format: don't open anything now, the resume opens it again.
        if (_disposed || _paused || gen != _generation) return;
        // This phone won't open the camera in the detector's frame format:
        // fall back to exactly the old camera (no coaching, photo unchanged).
        coaching = false;
        ctrl = CameraController(front, ResolutionPreset.high, enableAudio: false);
        pending = ctrl;
        await ctrl.initialize();
      }
      pending = null;
      if (_disposed || _paused || gen != _generation) {
        await ctrl.dispose();
        return;
      }
      camera = ctrl;
      error = null;
      notifyListeners();
    } catch (e) {
      final leaked = pending;
      if (leaked != null) {
        try {
          await leaked.dispose();
        } catch (_) {}
      }
      // A failure caused by a pause part-way through is not this phone's
      // camera being broken: the resume opens it again.
      if (_disposed || gen != _generation) return;
      error = 'Camera unavailable: $e';
      notifyListeners();
      return;
    }
    if (!coaching) return;
    // Coaching from here on: any failure leaves the camera and the photo as
    // they are, with the hint stuck on "searching".
    try {
      _detector ??= FaceDetector(options: FaceDetectorOptions(performanceMode: FaceDetectorMode.fast));
      await _startStream();
    } catch (_) {}
  }

  Future<void> _startStream() async {
    final ctrl = camera;
    if (_disposed || ctrl == null || !ctrl.value.isInitialized || ctrl.value.isStreamingImages) return;
    try {
      await ctrl.startImageStream(_onImage);
      _streaming = true;
    } catch (_) {
      // Coaching is optional: without a stream the photo still works.
      _streaming = false;
    }
  }

  Future<void> _stopStream() async {
    final ctrl = camera;
    _streaming = false;
    if (ctrl == null || !ctrl.value.isInitialized || !ctrl.value.isStreamingImages) return;
    try {
      await ctrl.stopImageStream();
    } catch (_) {}
  }

  Future<void> _onImage(CameraImage image) async {
    if (_busy || _disposed || !_streaming || _detector == null) return;
    _busy = true;
    try {
      final plane = image.planes.first;
      final format = InputImageFormatValue.fromRawValue(image.format.raw);
      final rotation = InputImageRotationValue.fromRawValue(_rotation);
      if (format == null || rotation == null) return;
      final faces = await _detector!.processImage(
        InputImage.fromBytes(
          bytes: plane.bytes,
          metadata: InputImageMetadata(
            size: Size(image.width.toDouble(), image.height.toDouble()),
            rotation: rotation,
            format: format,
            bytesPerRow: plane.bytesPerRow,
          ),
        ),
      );
      if (_disposed) return;
      final upright = (_rotation == 90 || _rotation == 270)
          ? Size(image.height.toDouble(), image.width.toDouble())
          : Size(image.width.toDouble(), image.height.toDouble());
      final Rect? box = faces.isEmpty ? null : faces.first.boundingBox;
      hint = hintFor(
        faceCount: faces.length,
        box: box,
        image: upright,
        yawDeg: faces.isEmpty ? null : faces.first.headEulerAngleY,
      );
      final now = DateTime.now();
      if (now.difference(_lastNotify).inMilliseconds > 120) {
        _lastNotify = now;
        notifyListeners();
      }
    } catch (_) {
      // A frame that fails is simply skipped.
    } finally {
      _busy = false;
    }
  }

  /// Takes the photo exactly as the old screen did. Coaching pauses while it
  /// does; call [resumeCoaching] if the student has to try again.
  Future<File> takePhoto() async {
    final ctrl = camera;
    if (ctrl == null || !ctrl.value.isInitialized) throw StateError('Camera not ready');
    await _stopStream();
    final x = await ctrl.takePicture();
    return File(x.path);
  }

  Future<void> resumeCoaching() => _startStream();

  Future<void> onAppPaused() async {
    if (_paused) return;
    _paused = true;
    _generation++;
    final ctrl = camera;
    camera = null;
    _streaming = false;
    hint = LivenessHint.searching;
    notifyListeners();
    try {
      if (ctrl != null && ctrl.value.isStreamingImages) await ctrl.stopImageStream();
    } catch (_) {}
    await ctrl?.dispose();
  }

  Future<void> onAppResumed() async {
    if (_disposed) return;
    _paused = false;
    if (camera == null && !_starting) await start();
  }

  @override
  void dispose() {
    _disposed = true;
    final ctrl = camera;
    camera = null;
    unawaited(() async {
      try {
        if (ctrl != null && ctrl.value.isStreamingImages) await ctrl.stopImageStream();
      } catch (_) {}
      await ctrl?.dispose();
    }());
    final detector = _detector;
    _detector = null;
    if (detector != null) unawaited(detector.close().catchError((_) {}));
    super.dispose();
  }
}
