import 'dart:convert';
import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/liveness/liveness_capture_controller.dart';
import '../../../core/liveness/liveness_capture_view.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/loading_primitives.dart';

/// Identity verification, done on the user's own phone: design mandate
/// §2.13, and since 2026-10-15 a guided liveness check instead of one photo
/// (docs/redesign/SPEC-FACE-LIVENESS.md).
///
/// The server issues the challenge (a random order of blink / turn left / turn
/// right plus a nonce) when the kiosk session opens, and again after every
/// failed attempt. This screen only ever *captures*: [LivenessCaptureView]
/// coaches the student and keeps four frames, they go to
/// POST /kiosk/verify-face with the nonce, node_server calls the ML service
/// (which re-checks every step on the frames), and node_server alone opens the
/// locker. A client that could assert "verified" could open any locker.
///
/// On a real match, the server-side outcome reaches the *kiosk scan* screen
/// underneath this one via the existing `face:verified` socket event, so this
/// page's own job on success is just to get out of the way (pop back to it).
/// Retryable misses are handled here, from the direct HTTP response, so
/// retrying doesn't flicker the screen underneath.
class FaceVerifyScreen extends StatefulWidget {
  final String rentalId;

  /// 'place' | 'retrieve' | 'return' — same vocabulary KioskScanScreen uses.
  final String mode;

  /// Named only so a "report a problem" on exhaustion can say which physical
  /// kiosk this happened at.
  final String? kioskId;

  /// When this kiosk session expires, as an ABSOLUTE instant from the server
  /// (E3.2 / `ANIMATION-AND-LOADING-SPEC.md` §2.3). Null when the server did
  /// not send one — the countdown then renders nothing rather than guessing a
  /// local 120 seconds, which would drift and overstate the time left.
  final DateTime? sessionExpiresAt;

  /// The first challenge, from the `kiosk:face_required` event. Null when the
  /// server did not send one (an old server): the screen then says so.
  final FaceChallenge? challenge;

  const FaceVerifyScreen({
    super.key,
    required this.rentalId,
    required this.mode,
    this.kioskId,
    this.sessionExpiresAt,
    this.challenge,
  });

  @override
  State<FaceVerifyScreen> createState() => _FaceVerifyScreenState();
}

class _FaceVerifyScreenState extends State<FaceVerifyScreen> {
  final _api = ApiService();

  FaceChallenge? _challenge;
  Key _runKey = UniqueKey();
  bool _uploading = false;
  bool _exhausted = false;
  String? _errorMsg;
  String? _blockedMsg; // a refusal a retry cannot fix (update your face, etc.)
  int? _attemptsRemaining;
  int _rejects = 0; // each server refusal shakes the ring red

  @override
  void initState() {
    super.initState();
    _challenge = widget.challenge;
  }

  Future<void> _onCaptured(LivenessCapture cap) async {
    if (_uploading) return;
    setState(() {
      _uploading = true;
      _errorMsg = null;
    });
    try {
      final resp = await _api.uploadParts(
        '/kiosk/verify-face',
        fields: {'rentalId': widget.rentalId, 'nonce': cap.nonce, 'mirrored': kFramesAreMirrored ? 'true' : 'false'},
        files: cap.uploadFiles,
        timeout: const Duration(seconds: 90),
      );
      Map<String, dynamic>? body;
      try {
        body = jsonDecode(resp.body) as Map<String, dynamic>?;
      } catch (_) {}
      final data = body?['data'] as Map<String, dynamic>?;

      // The steps expired or were already used: take the new ones and go again.
      if (resp.statusCode == 409 && body?['code'] == 'CHALLENGE_EXPIRED') {
        _next(FaceChallenge.fromJson(data?['challenge']), 'These steps had expired. Please follow the new steps.');
        return;
      }

      // Refusals a retry cannot fix: say what to do instead of looping.
      final code = body?['code'] as String?;
      if (code == 'FACE_UPDATE_REQUIRED' || code == 'FACE_REVIEW_PENDING' || code == 'APP_UPDATE_REQUIRED') {
        if (mounted) {
          setState(() {
            _uploading = false;
            _blockedMsg = (body?['error'] as String?) ?? 'Verification is not available for this account right now.';
          });
        }
        return;
      }

      if (resp.statusCode != 200 || body == null || body['success'] != true) {
        // The same challenge stands (an outage or a network error is not an
        // attempt), so the same steps are simply done again.
        _next(
          null,
          (body?['error'] as String?) ??
              (body?['message'] as String?) ??
              'Verification failed — check your connection and try again.',
          restart: true,
        );
        return;
      }

      if (data?['verified'] == true) {
        // The kiosk-scan screen underneath already has success/failure UI
        // wired to the same server-side outcome via the `face:verified`
        // socket event. Dispute v2: hand the server's answer back (what is
        // owed before a door opens, or why nothing can happen now).
        final action = data?['action'];
        if (mounted) {
          Navigator.of(context).pop(
            action == 'dispute_pay' || action == 'none'
                ? <String, dynamic>{...?data, 'message': body['message']}
                : true,
          );
        }
        return;
      }

      if (data?['mustRescan'] == true) {
        if (mounted) {
          setState(() {
            _uploading = false;
            _exhausted = true;
            _errorMsg = (body?['message'] as String?) ?? "We couldn't verify your face after several tries.";
          });
        }
        return;
      }

      _attemptsRemaining = data?['attemptsRemaining'] as int?;
      _next(
        FaceChallenge.fromJson(data?['challenge']),
        (body['message'] as String?) ?? "We couldn't verify your face — please try again.",
        restart: true,
      );
    } catch (_) {
      _next(null, 'Could not reach the server — check your connection and try again.', restart: true);
    } finally {
      // The frames are biometric data: never leave them on the phone.
      for (final f in cap.frames.values) {
        try {
          await f.delete();
        } catch (_) {}
      }
    }
  }

  /// Show [message] and run the check again, on [next] when the server sent a
  /// new challenge, else on the one we have.
  void _next(FaceChallenge? next, String? message, {bool restart = false}) {
    if (!mounted) return;
    setState(() {
      _uploading = false;
      _errorMsg = message;
      if (message != null) _rejects++;
      if (next != null) _challenge = next;
      if (restart) _runKey = UniqueKey();
    });
  }

  // ── Copy ─────────────────────────────────────────────────────────────────────

  String get _headline => switch (widget.mode) {
        'place' => 'Verify to open the drop-off locker',
        'retrieve' => 'Verify to unlock your item',
        _ => 'Verify to return your item',
      };

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07100E),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: const Text(
          'Identity Verification',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.xs, AppSpacing.md, AppSpacing.sm),
              child: Text(
                _headline,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white),
              ),
            ),
            Expanded(child: _buildStage()),
            _buildFooter(),
          ],
        ),
      ),
    );
  }

  Widget _buildStage() {
    if (_exhausted) {
      return _ExhaustedPanel(
        message: _errorMsg ?? "We couldn't verify your face after several tries.",
        kioskId: widget.kioskId,
        onRescan: () => Navigator.of(context).pop('rescan'),
      );
    }
    if (_blockedMsg != null) {
      return _BlockedPanel(message: _blockedMsg!, onClose: () => Navigator.of(context).pop('rescan'));
    }
    final c = _challenge;
    if (c == null) {
      return const _MessagePanel(
        icon: Icons.sync_problem_rounded,
        message: 'The kiosk did not send the steps for this check. Scan its QR code again.',
      );
    }
    return LivenessCaptureView(
      key: _runKey,
      challenge: c,
      onCaptured: _onCaptured,
      busy: _uploading,
      busyLabel: 'Verifying…',
      rejectCount: _rejects,
    );
  }

  Widget _buildFooter() {
    if (_exhausted || _blockedMsg != null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_errorMsg != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
              padding: const EdgeInsets.all(AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.error.withValues(alpha: 0.14),
                borderRadius: AppRadius.card,
                border: Border.all(color: AppColors.error.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline_rounded, size: 16, color: AppColors.error),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Builder(builder: (context) {
                      final remaining = _attemptsRemaining;
                      final suffix = remaining != null ? ' ($remaining ${remaining == 1 ? "try" : "tries"} left)' : '';
                      return Text(
                        '${_errorMsg!}$suffix',
                        style: const TextStyle(fontSize: 12.5, height: 1.4, color: Colors.white),
                      );
                    }),
                  ),
                ],
              ),
            ),
          if (_uploading)
            AppIndeterminateProgress(
              label: 'Verifying…',
              attemptLabel: _attemptsRemaining != null ? 'Attempt ${4 - _attemptsRemaining!} of 4' : null,
            ),
          // Renders nothing at all when the server sent no deadline.
          AppSessionCountdown(deadline: widget.sessionExpiresAt),
        ],
      ),
    );
  }
}

class _BlockedPanel extends StatelessWidget {
  final String message;
  final VoidCallback onClose;
  const _BlockedPanel({required this.message, required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.face_retouching_natural_rounded, size: 48, color: AppColors.primaryOnDark),
            const SizedBox(height: AppSpacing.md),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: Colors.white, height: 1.5)),
            const SizedBox(height: AppSpacing.lg),
            ElevatedButton(
              onPressed: onClose,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryOnDark,
                foregroundColor: const Color(0xFF052033),
                minimumSize: const Size(double.infinity, 48),
                shape: RoundedRectangleBorder(borderRadius: AppRadius.button),
              ),
              child: const Text('OK'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExhaustedPanel extends StatelessWidget {
  final String message;
  final String? kioskId;
  final VoidCallback onRescan;

  const _ExhaustedPanel({required this.message, required this.kioskId, required this.onRescan});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.face_retouching_off_rounded, size: 48, color: AppColors.error),
            const SizedBox(height: AppSpacing.md),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, color: Colors.white, height: 1.5),
            ),
            const SizedBox(height: AppSpacing.lg),
            ElevatedButton(
              onPressed: onRescan,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryOnDark,
                foregroundColor: const Color(0xFF052033),
                minimumSize: const Size(double.infinity, 48),
                shape: RoundedRectangleBorder(borderRadius: AppRadius.button),
              ),
              child: const Text('Scan the kiosk QR code again'),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessagePanel extends StatelessWidget {
  final IconData icon;
  final String message;

  const _MessagePanel({required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: const Color(0xFF9FBFB8)),
            const SizedBox(height: AppSpacing.sm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: Color(0xFF9FBFB8)),
            ),
          ],
        ),
      ),
    );
  }
}
