import 'dart:convert';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/form_widgets.dart';
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
    // Consent is a full screen with its own chrome; the capture steps are
    // viewfinders and stay dark in both themes so the preview isn't washed
    // out (same reasoning as the kiosk scanner).
    return switch (_step) {
      _SetupStep.consent => _buildConsent(),
      _SetupStep.facePhoto => _buildCapture(
          step: 2,
          title: 'Take a selfie',
          instruction:
              'Line your face up inside the oval. Good, even light — no hats, '
              'sunglasses or masks.',
          why:
              'The kiosk matches this photo when you collect or return an item, '
              'so nobody else can open your locker.',
          oval: true,
        ),
      _SetupStep.idPhoto => _buildCapture(
          step: 3,
          title: 'Photograph your student ID',
          instruction:
              'Fill the frame with your ID card. Make sure your name and student '
              'number are sharp and readable.',
          why:
              'An admin checks this once to confirm you\'re enrolled. It is never '
              'shown to other students.',
          oval: false,
        ),
      _SetupStep.uploading => _buildUploading(),
      _SetupStep.done => _buildDone(),
    };
  }

  // ── Step 1: consent ─────────────────────────────────────────────────────────

  Widget _buildConsent() {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Verify your identity')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
        children: [
          const StepHeader(
            step: 1,
            total: 3,
            title: 'Before we start',
            subtitle:
                'EngiRent lockers open with your face. That means we need to store '
                'a biometric template — here is exactly what that involves.',
          ),
          const SizedBox(height: AppSpacing.lg),

          if (_errorMsg != null) ...[
            NoticeBanner(kind: NoticeKind.danger, message: _errorMsg!),
            const SizedBox(height: AppSpacing.md),
          ],

          const SectionLabel('What we collect'),
          AppCard(
            child: Column(
              children: const [
                _ConsentPoint(
                  icon: Icons.face_retouching_natural_rounded,
                  title: 'A face template',
                  body:
                      'Your selfie is converted into a numeric encoding. The kiosk '
                      'compares against that encoding — it does not send your photo '
                      'anywhere at collection time.',
                ),
                _ConsentPoint(
                  icon: Icons.badge_outlined,
                  title: 'A photo of your student ID',
                  body:
                      'Reviewed once by an administrator to confirm enrolment, then '
                      'kept only as proof of verification.',
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          const SectionLabel('Your rights'),
          AppCard(
            child: Column(
              children: const [
                _ConsentPoint(
                  icon: Icons.visibility_off_outlined,
                  title: 'Not visible to other students',
                  body:
                      'Neither your ID photo nor your face encoding is shown on your '
                      'public profile or to anyone you rent from.',
                ),
                _ConsentPoint(
                  icon: Icons.delete_outline_rounded,
                  title: 'Withdraw at any time',
                  body:
                      'Deleting your account removes the encoding and both photos. '
                      'You can also ask an administrator to erase them and switch to '
                      'manual kiosk unlock.',
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          FormSection(
            title: 'Guardian contact',
            icon: Icons.family_restroom_rounded,
            caption:
                'Optional, and only used if a dispute needs escalating for a minor.',
            children: [
              AppField(
                label: 'Guardian name',
                controller: _parentNameCtrl,
                hint: 'Optional',
                textCapitalization: TextCapitalization.words,
              ),
              AppField(
                label: 'Guardian contact number',
                controller: _parentContactCtrl,
                hint: 'Optional',
                keyboardType: TextInputType.phone,
              ),
            ],
          ),

          // The checkbox is a real gate, not a formality — the value is sent
          // to the backend as the record that consent was given.
          GestureDetector(
            onTap: () => setState(() => _consentChecked = !_consentChecked),
            behavior: HitTestBehavior.opaque,
            child: AppCard(
              borderColor: _consentChecked ? p.primary : null,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    _consentChecked
                        ? Icons.check_box_rounded
                        : Icons.check_box_outline_blank_rounded,
                    size: 21,
                    color: _consentChecked ? p.primary : p.muted,
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Text(
                      'I consent to EngiRent storing a face encoding and a photo of my '
                      'student ID for the purpose of kiosk verification.',
                      style: TextStyle(fontSize: 13, height: 1.45, color: p.ink),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: StickyActionBar(
        label: 'Agree and continue',
        icon: Icons.arrow_forward_rounded,
        onPressed: _consentChecked ? _acceptConsent : null,
      ),
    );
  }

  // ── Steps 2 & 3: capture ────────────────────────────────────────────────────

  Widget _buildCapture({
    required int step,
    required String title,
    required String instruction,
    required String why,
    required bool oval,
  }) {
    return Scaffold(
      backgroundColor: const Color(0xFF07100E),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      for (var i = 1; i <= 3; i++) ...[
                        Expanded(
                          child: Container(
                            height: 3,
                            decoration: BoxDecoration(
                              color: i <= step
                                  ? AppColors.primaryOnDark
                                  : Colors.white.withValues(alpha: 0.16),
                              borderRadius: AppRadius.circle,
                            ),
                          ),
                        ),
                        if (i < 3) const SizedBox(width: AppSpacing.hair),
                      ],
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'STEP $step OF 3',
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1,
                      color: AppColors.primaryOnDark,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.4,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.hair),
                  Text(
                    instruction,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.45,
                      color: Color(0xFF9FBFB8),
                    ),
                  ),
                ],
              ),
            ),

            if (_errorMsg != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.md, 0, AppSpacing.md, AppSpacing.sm),
                child: Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.error.withValues(alpha: 0.14),
                    borderRadius: AppRadius.input,
                    border:
                        Border.all(color: AppColors.error.withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.error_outline_rounded,
                          size: 17, color: AppColors.error),
                      const SizedBox(width: AppSpacing.xs),
                      Expanded(
                        child: Text(
                          _errorMsg!,
                          style: const TextStyle(
                              fontSize: 12.5, height: 1.4, color: Colors.white),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            Expanded(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                child: _camReady && _camCtrl != null
                    ? ClipRRect(
                        borderRadius: AppRadius.card,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            FittedBox(
                              fit: BoxFit.cover,
                              child: SizedBox(
                                width: _camCtrl!.value.previewSize?.height ?? 1,
                                height: _camCtrl!.value.previewSize?.width ?? 1,
                                child: CameraPreview(_camCtrl!),
                              ),
                            ),
                            // Alignment guide. Without it people photographed
                            // their whole torso, or an ID at an angle, and the
                            // encoding step failed with no obvious cause.
                            CustomPaint(
                              painter: _GuidePainter(oval: oval),
                            ),
                          ],
                        ),
                      )
                    : Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: const [
                            SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppColors.primaryOnDark),
                            ),
                            SizedBox(height: AppSpacing.sm),
                            Text(
                              'Starting the camera…',
                              style: TextStyle(
                                  fontSize: 13, color: Color(0xFF9FBFB8)),
                            ),
                          ],
                        ),
                      ),
              ),
            ),

            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.lock_outline_rounded,
                          size: 14, color: Color(0xFF7FA39C)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          why,
                          style: const TextStyle(
                            fontSize: 11.5,
                            height: 1.4,
                            color: Color(0xFF7FA39C),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  GestureDetector(
                    onTap: _camReady ? _capture : null,
                    child: Container(
                      width: 68,
                      height: 68,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: _camReady
                              ? AppColors.primaryOnDark
                              : Colors.white24,
                          width: 3,
                        ),
                      ),
                      child: Center(
                        child: Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: _camReady
                                ? AppColors.primaryOnDark
                                : Colors.white24,
                          ),
                          child: Icon(
                            Icons.camera_alt_rounded,
                            size: 22,
                            color: _camReady
                                ? const Color(0xFF04211D)
                                : Colors.white54,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Step 4: uploading ───────────────────────────────────────────────────────

  Widget _buildUploading() {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                width: 34,
                height: 34,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
              const SizedBox(height: AppSpacing.xl),
              Text(
                'Setting up your profile',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                  color: AppPalette.of(context).ink,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Building your face encoding and uploading your ID. '
                'This usually takes a few seconds — keep the app open.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  height: 1.5,
                  color: AppPalette.of(context).muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Step 5: done ────────────────────────────────────────────────────────────

  Widget _buildDone() {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.success.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                  border: Border.all(
                      color: AppColors.success.withValues(alpha: 0.4),
                      width: 1.5),
                ),
                child: const Icon(Icons.verified_rounded,
                    size: 44, color: AppColors.success),
              ),
              const SizedBox(height: AppSpacing.xl),
              Text(
                'You\'re verified',
                style: TextStyle(
                  fontSize: 23,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.5,
                  color: p.ink,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Your student ID is pending a quick admin check. You can browse and '
                'rent right away — kiosk lockers now open with your face.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13.5, height: 1.5, color: p.muted),
              ),
              const SizedBox(height: AppSpacing.xxl),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: () => Navigator.pushNamedAndRemoveUntil(
                      context, '/home', (_) => false),
                  child: const Text(
                    'Start browsing',
                    style:
                        TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One point in the consent list. Keeps icon/title/body alignment consistent
/// so the disclosure reads as a checklist rather than a wall of legal text.
class _ConsentPoint extends StatelessWidget {
  const _ConsentPoint({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: p.primary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: p.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  body,
                  style: TextStyle(fontSize: 12.5, height: 1.45, color: p.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Alignment guide over the camera preview — an oval for the selfie, a
/// card-shaped rectangle for the student ID.
class _GuidePainter extends CustomPainter {
  _GuidePainter({required this.oval});
  final bool oval;

  @override
  void paint(Canvas canvas, Size size) {
    final Rect target = oval
        ? Rect.fromCenter(
            center: Offset(size.width / 2, size.height * 0.44),
            width: size.width * 0.66,
            height: size.width * 0.86,
          )
        : Rect.fromCenter(
            center: Offset(size.width / 2, size.height / 2),
            width: size.width * 0.86,
            // ID-1 card ratio (85.6 × 54 mm).
            height: size.width * 0.86 * (54 / 85.6),
          );

    final guide = Path();
    if (oval) {
      guide.addOval(target);
    } else {
      guide.addRRect(
          RRect.fromRectAndRadius(target, const Radius.circular(6)));
    }

    canvas.drawPath(
      Path.combine(
          PathOperation.difference, Path()..addRect(Offset.zero & size), guide),
      Paint()..color = const Color(0xFF07100E).withValues(alpha: 0.55),
    );

    canvas.drawPath(
      guide,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = AppColors.primaryOnDark,
    );
  }

  @override
  bool shouldRepaint(_GuidePainter old) => old.oval != oval;
}
