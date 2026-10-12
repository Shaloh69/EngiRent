import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';

/// Records the evidence video IN the app (user ruling 5: a fresh recording, not
/// a file picked from the gallery), at medium resolution so 30 seconds stays well
/// under the server's 40 MB limit. Stops by itself at 30 s. Pops with the file
/// path, or null if the student backs out.
class VideoRecorderScreen extends StatefulWidget {
  static const maxSeconds = 30;
  const VideoRecorderScreen({super.key});

  @override
  State<VideoRecorderScreen> createState() => _VideoRecorderScreenState();
}

class _VideoRecorderScreenState extends State<VideoRecorderScreen> {
  CameraController? _c;
  String? _error;
  bool _recording = false;
  int _seconds = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final cams = await availableCameras();
      final back = cams.firstWhere((c) => c.lensDirection == CameraLensDirection.back, orElse: () => cams.first);
      // No sound: the app has no microphone permission, and the problem is what
      // the item looks like, not what anyone says.
      final c = CameraController(back, ResolutionPreset.medium, enableAudio: false);
      await c.initialize();
      if (!mounted) {
        await c.dispose();
        return;
      }
      setState(() => _c = c);
    } catch (e) {
      if (mounted) setState(() => _error = 'The camera could not start. Allow camera access for EngiRent in your phone settings, then try again.');
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _c?.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final c = _c;
    if (c == null || _recording) return;
    try {
      await c.startVideoRecording();
      setState(() {
        _recording = true;
        _seconds = 0;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) return;
        setState(() => _seconds++);
        if (_seconds >= VideoRecorderScreen.maxSeconds) _stop();
      });
    } catch (_) {
      setState(() => _error = 'Recording could not start. Try again.');
    }
  }

  Future<void> _stop() async {
    final c = _c;
    if (c == null || !_recording) return;
    _timer?.cancel();
    try {
      final file = await c.stopVideoRecording();
      if (mounted) Navigator.pop(context, file.path);
    } catch (_) {
      if (mounted) setState(() => _error = 'The recording could not be saved. Try again.');
    } finally {
      if (mounted) setState(() => _recording = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        // The theme's titleTextStyle sets its own (dark) colour, which beats
        // foregroundColor, so the title was navy on black.
        titleTextStyle: Theme.of(context).appBarTheme.titleTextStyle?.copyWith(color: Colors.white),
        title: const Text('Record a video'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Text(
                _recording
                    ? 'Show the problem up close. It stops by itself at ${VideoRecorderScreen.maxSeconds} seconds.'
                    : 'Up to ${VideoRecorderScreen.maxSeconds} seconds. Show the whole item first, then the problem up close (turn it on, press the broken part, show what is missing).',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70, fontSize: 13, height: 1.4),
              ),
            ),
            Expanded(
              child: _error != null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
                      ),
                    )
                  : c == null
                      ? const Center(child: CircularProgressIndicator())
                      : Center(child: AspectRatio(aspectRatio: 1 / c.value.aspectRatio, child: CameraPreview(c))),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Column(
                children: [
                  Text(
                    '0:${_seconds.toString().padLeft(2, '0')} / 0:${VideoRecorderScreen.maxSeconds}',
                    style: TextStyle(color: _recording ? AppColors.error : Colors.white, fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                  GestureDetector(
                    onTap: c == null ? null : (_recording ? _stop : _start),
                    child: Container(
                      width: 76,
                      height: 76,
                      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 4)),
                      alignment: Alignment.center,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        width: _recording ? 30 : 58,
                        height: _recording ? 30 : 58,
                        decoration: BoxDecoration(
                          color: AppColors.error,
                          borderRadius: BorderRadius.circular(_recording ? 6 : 29),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(_recording ? 'Tap to stop' : 'Tap to record', style: const TextStyle(color: Colors.white70)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
