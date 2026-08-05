import 'dart:convert';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';
import '../providers/auth_provider.dart';

enum _SetupStep { consent, facePhoto, idPhoto, uploading, done }

class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final _parentNameCtrl = TextEditingController();
  final _parentContactCtrl = TextEditingController();

  _SetupStep _step = _SetupStep.consent;
  CameraController? _camCtrl;
  List<CameraDescription> _cameras = [];
  bool _camReady = false;
  bool _consentChecked = false;

  File? _faceFile;
  File? _idFile;
  String? _errorMsg;

  final _api = ApiService();

  @override
  void initState() {
    super.initState();
    // Camera init is deferred until consent is given (_acceptConsent) — no
    // biometric capture surface should even be ready before the user has
    // explicitly agreed to it.
  }

  void _acceptConsent() {
    setState(() => _step = _SetupStep.facePhoto);
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) return;
      // Prefer front camera for face, fall back to first
      final frontCam = _cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => _cameras.first,
      );
      _camCtrl = CameraController(frontCam, ResolutionPreset.high, enableAudio: false);
      await _camCtrl!.initialize();
      if (mounted) setState(() => _camReady = true);
    } catch (e) {
      if (mounted) setState(() => _errorMsg = 'Camera unavailable: $e');
    }
  }

  Future<void> _switchToRearCamera() async {
    await _camCtrl?.dispose();
    final rearCam = _cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.back,
      orElse: () => _cameras.first,
    );
    _camCtrl = CameraController(rearCam, ResolutionPreset.high, enableAudio: false);
    await _camCtrl!.initialize();
    if (mounted) setState(() {});
  }

  Future<void> _capture() async {
    if (_camCtrl == null || !_camCtrl!.value.isInitialized) return;
    try {
      final xFile = await _camCtrl!.takePicture();
      final file = File(xFile.path);
      if (_step == _SetupStep.facePhoto) {
        setState(() {
          _faceFile = file;
          _step = _SetupStep.idPhoto;
        });
        await _switchToRearCamera();
      } else if (_step == _SetupStep.idPhoto) {
        setState(() {
          _idFile = file;
          _step = _SetupStep.uploading;
        });
        await _submit();
      }
    } catch (e) {
      setState(() => _errorMsg = 'Capture error: $e');
    }
  }

  Future<void> _submit() async {
    if (_faceFile == null || _idFile == null) return;
    setState(() => _errorMsg = null);

    try {
      // 1. Register face encoding — via the Node backend's proxy endpoint,
      // NOT a direct call to the ML service. The ML service is gated by a
      // server-to-server API key; that secret must never ship inside this
      // app's bundle (it would be extractable from the APK), so the backend
      // holds the key and forwards the request instead.
      //
      // This is a hard requirement, not a nice-to-have: unlike the old
      // behavior (silently continuing with no encoding on any failure), a
      // failure here now blocks profile completion entirely. A profile
      // "completed" with no face encoding would silently disable kiosk face
      // verification for that student with no indication anything was wrong.
      final faceBytes = await _faceFile!.readAsBytes();
      if (faceBytes.isEmpty) {
        setState(() {
          _step = _SetupStep.facePhoto;
          _errorMsg = 'Face photo capture failed (empty file). Please retake it.';
        });
        return;
      }

      final registerResp = await _api.uploadFile('/auth/register-face', _faceFile!, 'file');
      if (registerResp.statusCode != 200) {
        setState(() {
          _step = _SetupStep.facePhoto;
          _errorMsg = 'Face registration failed. Please retake your selfie and try again.';
        });
        return;
      }
      final registerData = jsonDecode(registerResp.body);
      final mlData = registerData['data'] as Map<String, dynamic>?;
      if (mlData == null || mlData['success'] != true || mlData['encoding'] == null) {
        setState(() {
          _step = _SetupStep.facePhoto;
          _errorMsg = (mlData?['message'] as String?) ??
              'Could not extract a face encoding from that photo. Ensure good lighting and try again.';
        });
        return;
      }
      final encoding = List<double>.from(mlData['encoding']);

      // 2. Upload the ID photo. (The face photo was already stored by
      // /auth/register-face above — no separate upload needed for it.)
      final idResp = await _api.uploadFile('/auth/id-photo', _idFile!, 'file');
      if (idResp.statusCode != 200) {
        setState(() {
          _step = _SetupStep.facePhoto;
          _errorMsg = 'ID photo upload failed. Check your connection and try again.';
        });
        return;
      }

      // 3. Complete profile on Node server. Note: no profileImageUrl/
      // idImageUrl here — the backend derives both paths itself from the
      // authenticated user's ID (they were just written by register-face
      // and id-photo above), rather than trusting a client-supplied URL.
      final completeResp = await _api.post('/auth/profile/complete', {
        'faceEncoding': encoding,
        // Required by the backend — completeProfile() rejects the request
        // without it. Only ever sent because the user already passed through
        // the mandatory consent screen (_step.consent) before any capture
        // began; this flag is not a formality, it's what the backend uses as
        // its record that explicit consent was given.
        'biometricConsent': _consentChecked,
        if (_parentNameCtrl.text.isNotEmpty) 'parentName': _parentNameCtrl.text.trim(),
        if (_parentContactCtrl.text.isNotEmpty) 'parentContact': _parentContactCtrl.text.trim(),
      });

      if (completeResp.statusCode == 200) {
        if (!mounted) return;
        final auth = context.read<AuthProvider>();
        await auth.loadUser();
        setState(() => _step = _SetupStep.done);
      } else {
        setState(() {
          _step = _SetupStep.facePhoto;
          _errorMsg = 'Profile setup failed. Please try again.';
        });
      }
    } catch (e) {
      setState(() {
        _step = _SetupStep.facePhoto;
        _errorMsg = 'Error: $e';
      });
    }
  }

  @override
  void dispose() {
    _camCtrl?.dispose();
    _parentNameCtrl.dispose();
    _parentContactCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Complete Your Profile'),
        automaticallyImplyLeading: false,
      ),
      body: switch (_step) {
        _SetupStep.consent => _ConsentView(
            checked: _consentChecked,
            onCheckedChanged: (v) => setState(() => _consentChecked = v),
            onContinue: _consentChecked ? _acceptConsent : null,
          ),
        _SetupStep.done => _DoneView(onContinue: () => Navigator.pushReplacementNamed(context, '/home')),
        _SetupStep.uploading => const Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 16),
                Text('Setting up your profile…', style: TextStyle(fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        _SetupStep.facePhoto || _SetupStep.idPhoto => _CameraView(
            step: _step,
            camCtrl: _camCtrl,
            camReady: _camReady,
            errorMsg: _errorMsg,
            parentNameCtrl: _parentNameCtrl,
            parentContactCtrl: _parentContactCtrl,
            onCapture: _capture,
          ),
      },
    );
  }
}

/// Explicit, separate biometric consent capture — distinct from general
/// terms-of-service acceptance, per RA 10173 (Data Privacy Act) expectations
/// for processing sensitive personal information. Must be affirmatively
/// checked before any camera/capture UI becomes reachable.
class _ConsentView extends StatelessWidget {
  final bool checked;
  final ValueChanged<bool> onCheckedChanged;
  final VoidCallback? onContinue;

  const _ConsentView({
    required this.checked,
    required this.onCheckedChanged,
    required this.onContinue,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.fingerprint, size: 48, color: AppColors.primary),
            const SizedBox(height: 16),
            const Text(
              'Before we continue',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            const Text(
              'To use EngiRent Hub\'s kiosk, we need to collect a selfie, a photo '
              'of your school ID, and a face-recognition template derived from '
              'your selfie. This is biometric data, and we\'re asking for your '
              'explicit consent before capturing it — separate from the general '
              'terms of service.',
              style: TextStyle(fontSize: 14, height: 1.4),
            ),
            const SizedBox(height: 12),
            const Text(
              'What this is used for:',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
            ),
            const SizedBox(height: 4),
            const Text(
              '• Verifying it\'s really you when you deposit, claim, or return an '
              'item at the kiosk\n'
              '• Nothing else — this data is never used for attendance, '
              'analytics, or any purpose beyond kiosk identity verification',
              style: TextStyle(fontSize: 13, height: 1.5),
            ),
            const SizedBox(height: 12),
            const Text(
              'You can request permanent deletion of this data at any time from '
              'your Profile settings, which also deactivates your account.',
              style: TextStyle(fontSize: 13, height: 1.4, fontStyle: FontStyle.italic),
            ),
            const Spacer(),
            InkWell(
              onTap: () => onCheckedChanged(!checked),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Checkbox(value: checked, onChanged: (v) => onCheckedChanged(v ?? false)),
                  const SizedBox(width: 4),
                  const Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(top: 12),
                      child: Text(
                        'I understand and explicitly consent to EngiRent Hub capturing '
                        'and storing my face photo, ID photo, and face-recognition '
                        'template as described above.',
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: onContinue,
              style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 52)),
              child: const Text('I Agree — Continue'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CameraView extends StatelessWidget {
  final _SetupStep step;
  final CameraController? camCtrl;
  final bool camReady;
  final String? errorMsg;
  final TextEditingController parentNameCtrl;
  final TextEditingController parentContactCtrl;
  final VoidCallback onCapture;

  const _CameraView({
    required this.step,
    required this.camCtrl,
    required this.camReady,
    required this.errorMsg,
    required this.parentNameCtrl,
    required this.parentContactCtrl,
    required this.onCapture,
  });

  @override
  Widget build(BuildContext context) {
    final isFace = step == _SetupStep.facePhoto;
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          color: AppColors.primary.withValues(alpha: 0.08),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                    child: Center(child: Text(isFace ? '1' : '2', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800))),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    isFace ? 'Step 1 of 3 — Take a Selfie' : 'Step 2 of 3 — Photograph Your ID',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                isFace
                    ? 'Face the camera directly. Ensure good lighting. This photo will be used to verify your identity at the kiosk.'
                    : 'Hold your school ID card flat and fully in frame. Both sides are not required.',
                style: const TextStyle(fontSize: 13),
              ),
            ],
          ),
        ),
        Expanded(
          child: camReady && camCtrl != null
              ? ClipRect(child: CameraPreview(camCtrl!))
              : const Center(child: CircularProgressIndicator()),
        ),
        if (isFace) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: parentNameCtrl,
                    decoration: const InputDecoration(labelText: 'Parent/Guardian Name (optional)', isDense: true),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: parentContactCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Parent/Guardian Phone (optional)', isDense: true),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (errorMsg != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Text(errorMsg!, style: const TextStyle(color: AppColors.error), textAlign: TextAlign.center),
          ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: ElevatedButton.icon(
            onPressed: onCapture,
            icon: const Icon(Icons.camera_alt),
            label: Text(isFace ? 'Capture Selfie' : 'Capture ID Photo'),
            style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 52)),
          ),
        ),
      ],
    );
  }
}

class _DoneView extends StatelessWidget {
  final VoidCallback onContinue;
  const _DoneView({required this.onContinue});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.check_circle, size: 80, color: AppColors.success),
            const SizedBox(height: 20),
            const Text('Profile Complete!', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            const Text(
              'Your identity photos have been saved. You can now access kiosk workflows.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 28),
            ElevatedButton(
              onPressed: onContinue,
              style: ElevatedButton.styleFrom(minimumSize: const Size(200, 52)),
              child: const Text('Go to Home'),
            ),
          ],
        ),
      ),
    );
  }
}
