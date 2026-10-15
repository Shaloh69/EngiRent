import 'dart:convert';

import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/liveness/liveness_capture_controller.dart';
import '../../../core/liveness/liveness_capture_view.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';

/// Face enrolment through the liveness check (spec F4): profile setup AND the
/// home-screen "Update your face with the new system now" prompt.
///
/// Pops `true` once the new face is saved or sent to an admin for review
/// (`'review'`), `false`/null if the student leaves.
///
/// Same coaching-only rule as the kiosk check: the frames go to
/// POST /auth/face/enrol, the server computes and stores the template, and it
/// decides. The template never passes through this phone.
///
/// Re-enrolment rule (ruling 2026-10-15): the new face must match the old one
/// to replace it at once. If it does not (or there is no old one), the server
/// asks for the account password and sends the face to an admin; the SAME
/// frames and nonce are then resent with the password.
class FaceEnrolScreen extends StatefulWidget {
  const FaceEnrolScreen({super.key, required this.setup, this.biometricConsent = false});

  /// First-time profile setup (needs the consent the caller already collected).
  final bool setup;
  final bool biometricConsent;

  @override
  State<FaceEnrolScreen> createState() => _FaceEnrolScreenState();
}

class _FaceEnrolScreenState extends State<FaceEnrolScreen> {
  final _api = ApiService();
  FaceChallenge? _challenge;
  Key _runKey = UniqueKey();
  String? _loadError;
  String? _message; // last result sentence (a failed step, a wrong password)
  int _rejects = 0; // each refusal shakes the ring red
  bool _busy = false;

  /// Frames kept while the student types their password.
  LivenessCapture? _held;
  String? _heldReason;
  final _pw = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadChallenge();
  }

  @override
  void dispose() {
    _discardHeld();
    _pw.dispose();
    super.dispose();
  }

  void _discardHeld() {
    final h = _held;
    _held = null;
    if (h == null) return;
    for (final f in h.frames.values) {
      f.delete().catchError((_) => f);
    }
  }

  Future<void> _loadChallenge() async {
    setState(() => _loadError = null);
    try {
      final resp = await _api.get('/auth/face/challenge');
      final body = jsonDecode(resp.body) as Map<String, dynamic>?;
      final c = FaceChallenge.fromJson((body?['data'] as Map?)?['challenge']);
      if (resp.statusCode != 200 || c == null) throw StateError('no challenge');
      if (mounted) setState(() => _challenge = c);
    } catch (_) {
      if (mounted) setState(() => _loadError = 'Could not start the face check. Check your connection and try again.');
    }
  }

  Future<void> _send(LivenessCapture cap, {String? password}) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    var keep = false;
    try {
      final resp = await _api.uploadParts(
        '/auth/face/enrol',
        fields: {
          'nonce': cap.nonce,
          'mirrored': kFramesAreMirrored ? 'true' : 'false',
          if (widget.setup) 'biometricConsent': widget.biometricConsent ? 'true' : 'false',
          if (password != null) 'password': password,
        },
        files: cap.uploadFiles,
        timeout: const Duration(seconds: 90),
      );
      Map<String, dynamic>? body;
      try {
        body = jsonDecode(resp.body) as Map<String, dynamic>?;
      } catch (_) {}
      final data = body?['data'] as Map<String, dynamic>?;

      if (resp.statusCode == 409 && body?['code'] == 'CHALLENGE_EXPIRED') {
        return await _again(FaceChallenge.fromJson(data?['challenge']), 'These steps had expired. Please follow the new steps.');
      }
      if (body?['code'] == 'WRONG_PASSWORD') {
        _discardHeld();
        return await _again(null, (body?['error'] as String?) ?? 'That password is not correct. Please do the steps again.', reload: true);
      }
      if (body?['code'] == 'APP_UPDATE_REQUIRED') {
        _discardHeld();
        if (mounted) setState(() => _busy = false);
        return _setLoadError((body?['error'] as String?) ?? 'Update the EngiRent app to continue.');
      }
      if (resp.statusCode != 200 || body == null || body['success'] != true) {
        // An outage is not a failed face: the challenge stands, do the steps again.
        return await _again(null, (body?['error'] as String?) ?? 'Could not save your face. Check your connection and try again.');
      }

      if (data?['enrolled'] == true) {
        if (mounted) Navigator.of(context).pop(true);
        return;
      }
      if (data?['pendingReview'] == true) {
        if (mounted) Navigator.of(context).pop('review');
        return;
      }
      if (data?['needsPassword'] == true) {
        // Keep the frames: they are resent with the password, same nonce.
        keep = true;
        _held = cap;
        if (mounted) {
          setState(() {
            _busy = false;
            _heldReason = body?['message'] as String?;
          });
        }
        return;
      }
      // Not live (a hat, no blink, ...): the sentence says why; new steps.
      _again(FaceChallenge.fromJson(data?['challenge']), body['message'] as String?);
    } catch (_) {
      _again(null, 'Could not reach the server. Check your connection and try again.');
    } finally {
      if (!keep) {
        for (final f in cap.frames.values) {
          try {
            await f.delete();
          } catch (_) {}
        }
      }
    }
  }

  void _setLoadError(String m) {
    if (mounted) setState(() => _loadError = m);
  }

  Future<void> _again(FaceChallenge? next, String? message, {bool reload = false}) async {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _message = message;
      if (message != null) _rejects++;
      _held = null;
      _heldReason = null;
      if (next != null) _challenge = next;
      _runKey = UniqueKey();
    });
    if (reload) await _loadChallenge();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07100E),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: Text(
          widget.setup ? 'Set up your face' : 'Update your face',
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white),
        ),
      ),
      body: SafeArea(child: _stage()),
    );
  }

  Widget _stage() {
    if (_loadError != null) {
      return _Notice(
        icon: Icons.wifi_off_rounded,
        text: _loadError!,
        button: 'Try again',
        onPressed: _loadChallenge,
      );
    }
    if (_held != null && _heldReason != null) return _passwordStage();
    final c = _challenge;
    if (c == null) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primaryOnDark));
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.sm),
          child: Text(
            widget.setup
                ? 'Follow the steps. No hat, cap or hood. Glasses are fine.'
                : 'We will check it is you with a few quick steps. No hat, cap or hood. Glasses are fine.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF9FBFB8)),
          ),
        ),
        if (_message != null)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.sm),
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: AppColors.error.withValues(alpha: 0.14),
              borderRadius: AppRadius.card,
              border: Border.all(color: AppColors.error.withValues(alpha: 0.4)),
            ),
            child: Text(_message!, style: const TextStyle(fontSize: 12.5, height: 1.4, color: Colors.white)),
          ),
        Expanded(
          child: LivenessCaptureView(
            key: _runKey,
            challenge: c,
            onCaptured: (cap) => _send(cap),
            busy: _busy,
            busyLabel: 'Saving…',
            rejectCount: _rejects,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
      ],
    );
  }

  Widget _passwordStage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: AppSpacing.lg),
          const Icon(Icons.admin_panel_settings_rounded, size: 46, color: AppColors.primaryOnDark),
          const SizedBox(height: AppSpacing.md),
          Text(
            _heldReason!,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, height: 1.5, color: Colors.white),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextField(
            controller: _pw,
            obscureText: true,
            enabled: !_busy,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              labelText: 'Your password',
              labelStyle: const TextStyle(color: Color(0xFF9FBFB8)),
              enabledBorder: OutlineInputBorder(borderSide: const BorderSide(color: Colors.white24), borderRadius: AppRadius.input),
              focusedBorder: OutlineInputBorder(borderSide: const BorderSide(color: AppColors.primaryOnDark), borderRadius: AppRadius.input),
            ),
          ),
          if (_message != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(_message!, style: const TextStyle(fontSize: 12.5, color: AppColors.error)),
          ],
          const SizedBox(height: AppSpacing.md),
          ElevatedButton(
            onPressed: _busy ? null : () => _send(_held!, password: _pw.text),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primaryOnDark,
              foregroundColor: const Color(0xFF052033),
              minimumSize: const Size(double.infinity, 48),
              shape: RoundedRectangleBorder(borderRadius: AppRadius.button),
            ),
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Send for review'),
          ),
          TextButton(
            onPressed: _busy
                ? null
                : () {
                    _discardHeld();
                    setState(() => _heldReason = null);
                    _again(null, null, reload: true);
                  },
            child: const Text('Start over', style: TextStyle(color: Color(0xFF9FBFB8))),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text, required this.button, required this.onPressed});
  final IconData icon;
  final String text;
  final String button;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: const Color(0xFF9FBFB8)),
            const SizedBox(height: AppSpacing.md),
            Text(text, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14.5, height: 1.5, color: Colors.white)),
            const SizedBox(height: AppSpacing.lg),
            ElevatedButton(onPressed: onPressed, child: Text(button)),
          ],
        ),
      ),
    );
  }
}
