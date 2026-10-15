import '../../disputes/screens/guardian_screen.dart';
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
import 'face_enrol_screen.dart';

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
  // Ruling 12 (Dispute v2): the guardian is required, with the Terms clause.
  bool _guardianConsent = false;

  bool get _guardianValid =>
      _parentNameCtrl.text.trim().length >= 2 &&
      _parentContactCtrl.text.replaceAll(RegExp(r'\D'), '').length >= 7 &&
      _guardianConsent;

  bool _faceDone = false;
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
    _runFaceCheck();
  }

  /// Face liveness (2026-10-15): the guided check replaces the single selfie.
  /// The server saves the template itself; nothing about the face comes back
  /// to this screen except "saved".
  Future<void> _runFaceCheck() async {
    final ok = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(
        builder: (_) => FaceEnrolScreen(setup: true, biometricConsent: _consentChecked),
      ),
    );
    if (!mounted) return;
    if (ok == true) {
      setState(() {
        _faceDone = true;
        _step = _SetupStep.idPhoto;
        _errorMsg = null;
      });
      await _initCamera(rear: true);
    } else {
      setState(() => _errorMsg = 'Your face check is not finished yet.');
    }
  }

  Future<void> _initCamera({bool rear = false}) async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) return;
      final cam = _cameras.firstWhere(
        (c) => c.lensDirection == (rear ? CameraLensDirection.back : CameraLensDirection.front),
        orElse: () => _cameras.first,
      );
      _camCtrl = CameraController(cam, ResolutionPreset.high, enableAudio: false);
      await _camCtrl!.initialize();
      if (mounted) setState(() => _camReady = true);
    } catch (e) {
      if (mounted) setState(() => _errorMsg = 'Camera unavailable: $e');
    }
  }

  Future<void> _capture() async {
    if (_camCtrl == null || !_camCtrl!.value.isInitialized) return;
    try {
      final xFile = await _camCtrl!.takePicture();
      final file = File(xFile.path);
      if (_step == _SetupStep.idPhoto) {
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
    if (!_faceDone || _idFile == null) return;
    setState(() => _errorMsg = null);

    try {
      // The face was saved by POST /auth/face/enrol (the guided liveness
      // check): the server computed and stored the template, so none is sent
      // from here. A template this client supplied would never be trusted as
      // a liveness enrolment anyway (completeProfile writes it as version 1).

      // 1. Upload the ID photo.
      final idResp = await _api.uploadFile('/auth/id-photo', _idFile!, 'file');
      if (idResp.statusCode != 200) {
        setState(() {
          _step = _SetupStep.idPhoto;
          _errorMsg = 'ID photo upload failed. Check your connection and try again.';
        });
        await _initCamera(rear: true);
        return;
      }

      // 2. Complete the profile. The backend derives both photo paths from
      // the authenticated user (never a client-supplied URL).
      final completeResp = await _api.post('/auth/profile/complete', {
        // Required by the backend. Only ever sent because the user already
        // passed through the mandatory consent screen before any capture.
        'biometricConsent': _consentChecked,
        'parentName': _parentNameCtrl.text.trim(),
        'parentContact': _parentContactCtrl.text.trim(),
        'guardianConsent': _guardianConsent,
      });

      if (completeResp.statusCode == 200) {
        if (!mounted) return;
        final auth = context.read<AuthProvider>();
        await auth.loadUser();
        setState(() => _step = _SetupStep.done);
      } else {
        setState(() {
          _step = _SetupStep.idPhoto;
          _errorMsg = 'Profile setup failed. Please try again.';
        });
        await _initCamera(rear: true);
      }
    } catch (e) {
      setState(() {
        _step = _SetupStep.idPhoto;
        _errorMsg = 'Error: $e';
      });
      await _initCamera(rear: true);
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
      _SetupStep.facePhoto => _buildFaceStart(),
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
                'Required. EngiRent runs in partnership with UCLM; your parent or guardian is '
                'contacted only if a rental dispute is not resolved by its deadline.',
            children: [
              AppField(
                label: 'Parent or guardian full name',
                controller: _parentNameCtrl,
                hint: 'Required',
                textCapitalization: TextCapitalization.words,
                onChanged: (_) => setState(() {}),
              ),
              AppField(
                label: 'Their contact number',
                controller: _parentContactCtrl,
                hint: 'Required',
                keyboardType: TextInputType.phone,
                onChanged: (_) => setState(() {}),
              ),
              CheckboxListTile(
                value: _guardianConsent,
                onChanged: (v) => setState(() => _guardianConsent = v ?? false),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                title: Text(GuardianScreen.termsClause, style: TextStyle(fontSize: 12.5, height: 1.4, color: p.ink)),
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
        onPressed: _consentChecked && _guardianValid ? _acceptConsent : null,
      ),
    );
  }

  // ── Steps 2 & 3: capture ────────────────────────────────────────────────────

  Widget _buildFaceStart() {
    return Scaffold(
      backgroundColor: const Color(0xFF07100E),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.face_retouching_natural_rounded, size: 56, color: AppColors.primaryOnDark),
              const SizedBox(height: AppSpacing.lg),
              const Text(
                'Check your face',
                style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: Colors.white),
              ),
              const SizedBox(height: AppSpacing.xs),
              const Text(
                'Look at the camera, blink, and turn your head left and right as asked. '
                'No hats, caps or hoods. Glasses are fine.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13.5, height: 1.5, color: Color(0xFF9FBFB8)),
              ),
              if (_errorMsg != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(_errorMsg!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: AppColors.error)),
              ],
              const SizedBox(height: AppSpacing.xl),
              ElevatedButton(
                onPressed: _runFaceCheck,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryOnDark,
                  foregroundColor: const Color(0xFF052033),
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(borderRadius: AppRadius.button),
                ),
                child: const Text('Start'),
              ),
            ],
          ),
        ),
      ),
    );
  }

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
                  Semantics(
                    label: 'Capture photo',
                    button: true,
                    enabled: _camReady,
                    excludeSemantics: true,
                    child: GestureDetector(
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
