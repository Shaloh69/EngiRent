import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' show Size;

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_liveness_actions/flutter_liveness_actions.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

/// Face liveness capture (2026-10-15, docs/redesign/SPEC-FACE-LIVENESS.md F3).
///
/// COACHING ONLY. This controller guides the student through the steps the
/// SERVER chose (a random order, see [FaceChallenge]) and keeps the best frame
/// of each step. It decides nothing: the server re-checks every step on the
/// frames, and a phone that lies about having blinked simply fails there.
///
/// Logic comes from `flutter_liveness_actions` (MIT, pvlKryu): its analyzer
/// turns ML Kit's eye-open probabilities and head yaw into blink / turn
/// signals, and its flow controller walks the steps. What it does NOT do is
/// keep pictures (it stores nothing by design) and use an order we hand it, so
/// this file adds a sequence factory for the server's order and the
/// best-frame selection.
///
/// Left and right: ML Kit's headEulerAngleY is positive when the face points
/// at the right of the CAMERA IMAGE (Google's face-detection concepts page).
/// On an unmirrored, upright front-camera frame that is the STUDENT'S left,
/// and the package calls a positive yaw "right". So the server's TURN_LEFT is
/// the package's turnHeadRight and vice versa ([kStudentLeftIsPackageRight]).
/// This is the first thing to check on a real phone.
const bool kStudentLeftIsPackageRight = true;

/// The challenge the server issued: the order of the three steps + a nonce.
class FaceChallenge {
  const FaceChallenge({required this.order, required this.nonce});

  /// Subset/permutation of BLINK, TURN_LEFT, TURN_RIGHT.
  final List<String> order;
  final String nonce;

  static FaceChallenge? fromJson(Object? json) {
    if (json is! Map) return null;
    final order = json['order'];
    final nonce = json['nonce'];
    if (order is! List || nonce is! String) return null;
    final steps = order.map((e) => e.toString()).toList();
    const known = {'BLINK', 'TURN_LEFT', 'TURN_RIGHT'};
    if (steps.length != 3 || steps.toSet().length != 3 || !steps.every(known.contains)) return null;
    return FaceChallenge(order: steps, nonce: nonce);
  }
}

/// The four JPEG frames, ready to upload, and the nonce they answer.
class LivenessCapture {
  const LivenessCapture({required this.nonce, required this.frames});
  final String nonce;

  /// Keys: centre, blink, turn_left, turn_right.
  final Map<String, File> frames;

  List<MapEntry<String, String>> get uploadFiles =>
      frames.entries.map((e) => MapEntry(e.key, e.value.path)).toList();
}

/// What the screen shows right now.
enum LivenessPhase { starting, running, encoding, done, failed }

class _Candidate {
  _Candidate(this.bytes, this.width, this.height, this.stride, this.rotation, this.score);
  final Uint8List bytes;
  final int width;
  final int height;
  final int stride;
  final int rotation;
  final double score;
}

class _OrderedSequenceFactory extends ChallengeSequenceFactory {
  const _OrderedSequenceFactory(this.nonce, this.types, this.timeout);
  final String nonce;
  final List<FaceActionType> types;
  final Duration timeout;

  @override
  FaceChallengeSequence create(FaceChallengeConfig config) {
    return FaceChallengeSequence(
      sequenceId: 'server-$nonce',
      challengeNonce: nonce,
      steps: [
        for (var i = 0; i < types.length; i++)
          FaceChallengeStep(
            id: 'step-$i',
            type: types[i],
            instruction: '',
            status: ChallengeStepStatus.pending,
            timeout: timeout,
          ),
      ],
    );
  }
}

class LivenessCaptureController extends ChangeNotifier {
  LivenessCaptureController({required this.challenge});

  final FaceChallenge challenge;

  // Step 0 is "look straight"; 1..3 follow the server's order.
  static const _stepTimeout = Duration(seconds: 12);

  CameraController? camera;
  LivenessPhase phase = LivenessPhase.starting;
  String? error;

  /// Which of the four steps is current (0 = look straight, 1..3 = challenge).
  int stepIndex = 0;

  /// 'centre' | 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT' for [stepIndex].
  String get currentKey => stepIndex == 0 ? 'centre' : challenge.order[(stepIndex - 1).clamp(0, 2)];

  /// Short line under the oval; what to do right now.
  String instruction = 'Looking for your face…';

  /// True when a single face is being seen (the oval turns solid).
  bool faceOk = false;

  /// The finished capture, once [phase] is [LivenessPhase.done].
  LivenessCapture? capture;

  FaceDetector? _detector;
  FaceActionAnalyzer? _analyzer;
  ChallengeFlowController? _flow;
  StreamSubscription<FaceChallengeEvent>? _events;
  bool _busy = false;
  bool _disposed = false;
  int _rotation = 0;

  _Candidate? _candidate;
  final Map<String, _Candidate> _final = {};
  DateTime _lastNotify = DateTime.fromMillisecondsSinceEpoch(0);

  static FaceActionType _typeFor(String serverStep) {
    switch (serverStep) {
      case 'BLINK':
        return FaceActionType.blinkOnce;
      case 'TURN_LEFT':
        return kStudentLeftIsPackageRight ? FaceActionType.turnHeadRight : FaceActionType.turnHeadLeft;
      default:
        return kStudentLeftIsPackageRight ? FaceActionType.turnHeadLeft : FaceActionType.turnHeadRight;
    }
  }

  /// Human instruction for a step key.
  static String instructionFor(String key) => switch (key) {
        'centre' => 'Look straight at the camera',
        'BLINK' => 'Blink slowly, closing your eyes fully',
        'TURN_LEFT' => 'Slowly turn your head to your left',
        _ => 'Slowly turn your head to your right',
      };

  Future<void> start() async {
    if (_disposed) return;
    phase = LivenessPhase.starting;
    error = null;
    stepIndex = 0;
    _final.clear();
    _candidate = null;
    instruction = instructionFor('centre');
    notifyListeners();

    try {
      if (defaultTargetPlatform != TargetPlatform.android) {
        throw StateError('The face check is only available on Android in this version.');
      }
      final cameras = await availableCameras();
      final front = cameras.where((c) => c.lensDirection == CameraLensDirection.front);
      if (front.isEmpty) throw StateError('No front camera on this phone.');
      _rotation = front.first.sensorOrientation;

      final ctrl = CameraController(
        front.first,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.nv21,
      );
      await ctrl.initialize();
      if (_disposed) {
        await ctrl.dispose();
        return;
      }
      camera = ctrl;

      _detector = FaceDetector(
        options: FaceDetectorOptions(
          enableClassification: true,
          performanceMode: FaceDetectorMode.fast,
        ),
      );
      // The phone asks for a bit more than the server (20 degrees) so a turn
      // that passes here has room to pass there; ML Kit and the server's
      // landmark solver do not measure yaw identically.
      _analyzer = FaceActionAnalyzer(
        config: const FaceActionConfig(yawLeftThreshold: -25, yawRightThreshold: 25),
      );
      _restartFlow();

      phase = LivenessPhase.running;
      await ctrl.startImageStream(_onImage);
      notifyListeners();
    } catch (e) {
      _fail('$e'.replaceFirst('Bad state: ', ''));
    }
  }

  void _restartFlow() {
    _events?.cancel();
    final types = <FaceActionType>[
      FaceActionType.centerFace,
      for (final s in challenge.order) _typeFor(s),
    ];
    _flow = ChallengeFlowController(
      sequenceFactory: _OrderedSequenceFactory(challenge.nonce, types, _stepTimeout),
    );
    _events = _flow!.events.listen(_onFlowEvent);
    stepIndex = 0;
    _candidate = null;
    _final.clear();
  }

  void _onFlowEvent(FaceChallengeEvent e) {
    if (_disposed) return;
    switch (e.type) {
      case FaceChallengeEventType.stepPassed:
        final key = currentKey;
        final c = _candidate;
        if (c != null) _final[key] = c;
        _candidate = null;
        stepIndex = (stepIndex + 1).clamp(0, 3);
        instruction = instructionFor(currentKey);
        notifyListeners();
      case FaceChallengeEventType.challengeCompleted:
        unawaited(_finish());
      case FaceChallengeEventType.stepFailed:
      case FaceChallengeEventType.challengeFailed:
        _fail('That took too long. Please try again.');
      default:
        break;
    }
  }

  /// The student pressed "Try again" after a timeout: same challenge, fresh run.
  Future<void> retry() async {
    if (_disposed) return;
    final cam = camera;
    if (cam == null || !cam.value.isInitialized) return start();
    error = null;
    phase = LivenessPhase.running;
    _restartFlow();
    instruction = instructionFor('centre');
    if (!cam.value.isStreamingImages) await cam.startImageStream(_onImage);
    notifyListeners();
  }

  Future<void> _onImage(CameraImage image) async {
    if (_busy || _disposed || phase != LivenessPhase.running) return;
    _busy = true;
    try {
      final plane = image.planes.first;
      final input = InputImage.fromBytes(
        bytes: plane.bytes,
        metadata: InputImageMetadata(
          size: Size(image.width.toDouble(), image.height.toDouble()),
          rotation: InputImageRotationValue.fromRawValue(_rotation) ?? InputImageRotation.rotation0deg,
          format: InputImageFormat.nv21,
          bytesPerRow: plane.bytesPerRow,
        ),
      );
      final faces = await _detector!.processImage(input);
      if (_disposed || phase != LivenessPhase.running) return;

      final upright = (_rotation == 90 || _rotation == 270)
          ? Size(image.height.toDouble(), image.width.toDouble())
          : Size(image.width.toDouble(), image.height.toDouble());
      final frame = const MlKitFaceAdapter().fromFaces(faces, imageSize: upright, timestamp: DateTime.now());
      final result = _analyzer!.analyze(frame);
      final sig = result.signal;

      faceOk = sig.singleFaceDetected;
      if (!sig.faceDetected) {
        instruction = 'Looking for your face…';
      } else if (sig.multipleFacesDetected) {
        instruction = 'Only one person in the picture, please';
      } else if (sig.faceTooFar) {
        instruction = 'Move a little closer';
      } else if (sig.faceTooClose) {
        instruction = 'Move a little further away';
      } else {
        instruction = instructionFor(currentKey);
      }

      if (sig.singleFaceDetected) {
        _offerCandidate(plane, image, frame);
        _flow!.processSignal(sig);
      }
      final now = DateTime.now();
      if (now.difference(_lastNotify).inMilliseconds > 90) {
        _lastNotify = now;
        notifyListeners();
      }
    } catch (_) {
      // A dropped frame is not an error; the next one will do.
    } finally {
      _busy = false;
    }
  }

  /// Keep the best frame so far for the current step, copying its bytes only
  /// when it beats the last one.
  void _offerCandidate(Plane plane, CameraImage image, FaceActionFrame f) {
    final l = f.leftEyeOpenProbability ?? 0.5;
    final r = f.rightEyeOpenProbability ?? 0.5;
    final yaw = f.headEulerAngleY ?? 0.0; // positive = face points at the image's right
    final bothOpen = math.min(l, r);
    final meanOpen = (l + r) / 2;
    final double score;
    switch (currentKey) {
      case 'centre':
        score = bothOpen - yaw.abs() / 40.0; // eyes open and frontal
      case 'BLINK':
        score = -meanOpen; // the most closed eyes
      case 'TURN_LEFT':
        score = yaw; // the student's left is the image's right (positive yaw)
      default:
        score = -yaw;
    }
    final best = _candidate;
    if (best != null && score <= best.score) return;
    _candidate = _Candidate(
      Uint8List.fromList(plane.bytes),
      image.width,
      image.height,
      plane.bytesPerRow,
      _rotation,
      score,
    );
  }

  Future<void> _finish() async {
    if (phase == LivenessPhase.encoding || phase == LivenessPhase.done) return;
    phase = LivenessPhase.encoding;
    instruction = 'Checking…';
    notifyListeners();
    try {
      final cam = camera;
      if (cam != null && cam.value.isStreamingImages) await cam.stopImageStream();

      final keys = ['centre', ...challenge.order];
      final missing = keys.where((k) => _final[k] == null).toList();
      if (missing.isNotEmpty) {
        throw StateError('Could not keep a picture for every step. Please try again.');
      }
      final dir = await getTemporaryDirectory();
      final stamp = DateTime.now().millisecondsSinceEpoch;
      final files = <String, File>{};
      final jpegs = await Future.wait(keys.map((k) {
        final c = _final[k]!;
        return compute(_encodeNv21Jpeg, <String, Object>{
          'bytes': c.bytes,
          'w': c.width,
          'h': c.height,
          'stride': c.stride,
          'rot': c.rotation,
        });
      }));
      for (var i = 0; i < keys.length; i++) {
        final field = switch (keys[i]) {
          'centre' => 'centre',
          'BLINK' => 'blink',
          'TURN_LEFT' => 'turn_left',
          _ => 'turn_right',
        };
        final f = File('${dir.path}/face_${stamp}_$field.jpg');
        await f.writeAsBytes(jpegs[i], flush: true);
        files[field] = f;
      }
      capture = LivenessCapture(nonce: challenge.nonce, frames: files);
      _final.clear();
      phase = LivenessPhase.done;
      notifyListeners();
    } catch (e) {
      _fail('$e'.replaceFirst('Bad state: ', ''));
    }
  }

  void _fail(String message) {
    if (_disposed) return;
    error = message;
    phase = LivenessPhase.failed;
    final cam = camera;
    if (cam != null && cam.value.isStreamingImages) {
      unawaited(cam.stopImageStream().catchError((_) {}));
    }
    notifyListeners();
  }

  /// Pause the camera when the app is backgrounded.
  Future<void> onAppPaused() async {
    final cam = camera;
    if (cam != null && cam.value.isInitialized && cam.value.isStreamingImages) {
      try {
        await cam.stopImageStream();
      } catch (_) {}
    }
  }

  Future<void> onAppResumed() async {
    final cam = camera;
    if (_disposed || cam == null || !cam.value.isInitialized) return;
    if (phase == LivenessPhase.running && !cam.value.isStreamingImages) {
      await cam.startImageStream(_onImage);
    }
  }

  /// Delete the temporary JPEGs once uploaded (they are biometric data).
  Future<void> deleteFiles() async {
    final c = capture;
    if (c == null) return;
    for (final f in c.frames.values) {
      try {
        await f.delete();
      } catch (_) {}
    }
    capture = null;
  }

  @override
  void dispose() {
    _disposed = true;
    _events?.cancel();
    final cam = camera;
    camera = null;
    if (cam != null) {
      unawaited(() async {
        try {
          if (cam.value.isStreamingImages) await cam.stopImageStream();
        } catch (_) {}
        await cam.dispose();
      }());
    }
    _detector?.close();
    super.dispose();
  }
}

/// NV21 -> upright, size-capped JPEG. Runs in an isolate (`compute`).
Uint8List _encodeNv21Jpeg(Map<String, Object> a) {
  final bytes = a['bytes'] as Uint8List;
  final w = a['w'] as int;
  final h = a['h'] as int;
  var stride = a['stride'] as int;
  final rot = a['rot'] as int;
  if (stride < w || stride * h * 3 ~/ 2 > bytes.length) stride = w;
  if (stride * h * 3 ~/ 2 > bytes.length) {
    throw StateError('Unsupported camera format on this phone.');
  }
  final image = img.Image(width: w, height: h);
  final vuBase = stride * h;
  for (var y = 0; y < h; y++) {
    final yRow = y * stride;
    final uvRow = vuBase + (y >> 1) * stride;
    for (var x = 0; x < w; x++) {
      final yy = bytes[yRow + x];
      final uvIndex = uvRow + (x & ~1);
      final v = bytes[uvIndex] - 128;
      final u = bytes[uvIndex + 1] - 128;
      final r = (yy + 1.402 * v).round().clamp(0, 255);
      final g = (yy - 0.344136 * u - 0.714136 * v).round().clamp(0, 255);
      final b = (yy + 1.772 * u).round().clamp(0, 255);
      image.setPixelRgb(x, y, r, g, b);
    }
  }
  var out = rot == 0 ? image : img.copyRotate(image, angle: rot);
  const maxSide = 960;
  final longest = math.max(out.width, out.height);
  if (longest > maxSide) {
    out = img.copyResize(
      out,
      width: out.width >= out.height ? maxSide : null,
      height: out.height > out.width ? maxSide : null,
    );
  }
  return Uint8List.fromList(img.encodeJpg(out, quality: 88));
}
