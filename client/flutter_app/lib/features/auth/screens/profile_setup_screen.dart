import 'dart:convert';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/api_service.dart';
import '../providers/auth_provider.dart';

enum _SetupStep { facePhoto, idPhoto, uploading, done }

class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final _parentNameCtrl = TextEditingController();
  final _parentContactCtrl = TextEditingController();

  _SetupStep _step = _SetupStep.facePhoto;
  CameraController? _camCtrl;
  List<CameraDescription> _cameras = [];
  bool _camReady = false;

  File? _faceFile;
  File? _idFile;
  String? _errorMsg;

  final _api = ApiService();

  @override
  void initState() {
    super.initState();
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

  Future<String?> _uploadImage(File file) async {
    final resp = await _api.uploadFile('/upload/image', file, 'file');
    if (resp.statusCode == 200) {
      final data = jsonDecode(resp.body);
      return data['url'] as String?;
    }
    return null;
  }

  Future<void> _submit() async {
    if (_faceFile == null || _idFile == null) return;
    setState(() => _errorMsg = null);

    try {
      // 1. Register face encoding via ML service
      final mlDio = Dio();
      final mlForm = FormData.fromMap({
        'image': await MultipartFile.fromFile(_faceFile!.path, filename: 'face.jpg'),
      });
      final mlResp = await mlDio.post(
        '${AppConstants.mlServiceUrl}/register-face',
        data: mlForm,
      );
      List<double>? encoding;
      if (mlResp.statusCode == 200) {
        final mlData = mlResp.data is String ? jsonDecode(mlResp.data) : mlResp.data;
        if (mlData['success'] == true && mlData['encoding'] != null) {
          encoding = List<double>.from(mlData['encoding']);
        }
      }

      // 2. Upload face photo and ID photo to server storage
      final faceUrl = await _uploadImage(_faceFile!);
      final idUrl = await _uploadImage(_idFile!);

      if (faceUrl == null || idUrl == null) {
        setState(() {
          _step = _SetupStep.facePhoto;
          _errorMsg = 'Upload failed. Check your connection and try again.';
        });
        return;
      }

      // 3. Complete profile on Node server
      final completeResp = await _api.post('/auth/profile/complete', {
        'profileImageUrl': faceUrl,
        'idImageUrl': idUrl,
        if (encoding != null) 'faceEncoding': encoding,
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
