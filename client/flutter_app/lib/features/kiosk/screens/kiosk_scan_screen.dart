import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/services/api_service.dart';
import '../../../core/liveness/liveness_capture_controller.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/theme/tokens.dart';
import '../widgets/retry_feedback_card.dart';
import 'face_verify_screen.dart';
import '../../payments/screens/payment_webview_screen.dart';

enum _Phase { scanning, waiting, pay, bay, checking, success, failed }

/// Kiosk hand-off — mandate §2.2.
///
/// This screen deliberately stays dark in both themes. It is a viewfinder:
/// a light chrome around a live camera feed washes out the preview and makes
/// the scan target harder to find, which is the one thing the screen exists
/// to do. Everything outside the camera frame still uses the Vault palette.
///
/// The rebuild adds what the bare scanner never told the user: which step of
/// the hand-off they're on, what to point the camera at, and — during the
/// face-verification wait — that something is happening at the kiosk and not
/// on their phone.
class KioskScanScreen extends StatefulWidget {
  final String rentalId;

  /// 'place'    — owner deposits item at kiosk  (AWAITING_DEPOSIT)
  /// 'retrieve' — renter picks up item           (DEPOSITED)
  /// 'return'   — renter returns item            (ACTIVE)
  /// 'dispute'  — Dispute v2: the renter pays at the kiosk, THEN the upper
  ///              door opens for the correct item (ruling 6)   (DISPUTED)
  /// 'collect'  — Dispute v2: the renter takes back their OWN wrong item
  ///              (ruling 8); [rentalId] is then the `wi:<disputeId>` target
  final String mode;

  /// The case, for 'dispute' (the payment is made against it).
  final String? disputeId;

  const KioskScanScreen({
    super.key,
    required this.rentalId,
    required this.mode,
    this.disputeId,
  });

  @override
  State<KioskScanScreen> createState() => _KioskScanScreenState();
}

class _KioskScanScreenState extends State<KioskScanScreen>
    with SingleTickerProviderStateMixin {
  final _scannerCtrl = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );

  _Phase _phase = _Phase.scanning;
  String _errorMessage = '';
  // What the AI said on the last retry and the locker photos it was looking at
  // (user request 2026-10-12). Cleared when the item is checked again.
  String? _retryReason;
  bool _retryReposition = false;
  List<String> _retryImages = const [];
  // Captured from face:failed/kiosk:scan_error so a "Report a problem" tap
  // can name which physical kiosk this happened at — the phone never talks
  // to a kiosk directly, so this is otherwise unknowable app-side.
  String? _kioskId;
  final List<StreamSubscription<Map<String, dynamic>>> _subs = [];
  Timer? _timeout;
  late final AnimationController _sweep;
  bool _torchOn = false;

  // ── The bay step (2026-09-14) ──────────────────────────────────────────
  // The door used to open by itself the instant a face verified, and the
  // kiosk photographed the bay 20s later on a timer. Someone still reading
  // their phone missed the window, and a RETRY re-opened the door with no
  // second photo ever scheduled (D-78, seen on hardware). Both steps are
  // now taps, so the person is at the bay with a hand free when it unlocks.
  final _api = ApiService();
  String? _bayNumber;
  int _doorSeconds = 0;
  Timer? _doorTicker;
  bool _busy = false;
  String? _bayError;

  /// D-87b. The check that runs while the student stands at the locker is the
  /// FAST tier — it skips whatever does not fit ~25 seconds, so anything short
  /// of a clear pass comes back PENDING and goes to a human. That is a normal,
  /// frequent outcome, not a failure: the item is in the locker and the rental
  /// has moved on. Showing it under the same "all set" wording as an approval
  /// would be a lie in one direction; showing it as an error would be a lie in
  /// the other. It gets its own wording.
  bool _awaitingReview = false;
  int _attempt = 0;

  @override
  void initState() {
    super.initState();
    final sock = SocketService.instance;
    _subs.add(sock.onFaceVerified.listen(_onFaceVerified));
    _subs.add(sock.onFaceFailed.listen(_onFaceFailed));
    // The item-check verdicts. A deposit and a return each have their own
    // retry event, and this screen is the one place a person can act on it.
    _subs.add(sock.onDepositRetry.listen(_onItemRetry));
    _subs.add(sock.onReturnRetry.listen(_onItemRetry));
    _subs.add(sock.onDepositApproved.listen(_onItemApproved));
    _subs.add(sock.onDepositRejected.listen(_onItemRejected));
    // A return's three outcomes each have their OWN event, and until now none
    // of the three were listened to here — found 2026-09-22 from a real return
    // that scored PENDING on attempt 2: the server logged sending
    // `return:under_review` to the renter, the renter's phone never left
    // "Checking locker NN", because nothing on this screen was subscribed to
    // it. The same gap existed for a REJECTED return (`return:disputed`) and
    // even a cleanly APPROVED one (`rental:completed` — the return path's
    // completion event; deposits never reach it, they finish at DEPOSITED).
    _subs.add(sock.onReturnUnderReview.listen(_onReturnUnderReview));
    _subs.add(sock.onReturnDisputed.listen(_onReturnDisputed));
    _subs.add(sock.onRentalCompleted.listen(_onRentalCompleted));
    // E6.R — an approved return no longer completes the rental (the owner's
    // pickup does), so the renter's success arrives as `return:approved`.
    _subs.add(sock.onReturnApproved.listen(_onRentalCompleted));
    _subs.add(sock.onKioskScanError.listen(_onScanError));
    _subs.add(sock.onKioskFaceRequired.listen(_onFaceRequired));
    // Dispute v2 — the visit ended (10 minutes) or a payment failed.
    _subs.add(sock.onDisputeVisitEnded.listen(_onVisitEnded));
    _subs.add(sock.onPaymentRejected.listen(_onDisputePaymentRejected));

    _sweep = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    );
    // Mandate §1.5 — motion freezes under reduced-motion rather than
    // disappearing, so the frame still reads as a scan target.
    if (!WidgetsBinding.instance.platformDispatcher.accessibilityFeatures
        .disableAnimations) {
      _sweep.repeat();
    }
  }

  @override
  void dispose() {
    _sweep.dispose();
    _scannerCtrl.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    _timeout?.cancel();
    _doorTicker?.cancel();
    super.dispose();
  }

  /// Deliberately has no button. The verdict arrives by socket a few seconds
  /// later and moves this screen on by itself — offering "Done" here would
  /// invite people to walk away from a check that can still say "try again".
  Widget _buildChecking() {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(
              width: 44,
              height: 44,
              child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.info),
            ),
            const SizedBox(height: 22),
            Text(
              _bayNumber == null
                  ? 'Checking the locker'
                  : 'Checking locker ${_bayNumber!.padLeft(2, '0')}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Keep the door closed. The kiosk is photographing the inside of the '
              'locker and comparing it with the listing photo. This takes a few '
              'seconds — do not leave yet.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13.5, height: 1.5, color: Colors.white70),
            ),
          ],
        ),
      ),
    );
  }

  // ── The bay step ─────────────────────────────────────────────────────────

  bool get _needsPhoto => widget.mode == 'place' || widget.mode == 'return' || widget.mode == 'dispute';

  Widget _buildBay() {
    final bay = _bayNumber == null ? 'Your locker' : 'Locker ${_bayNumber!.padLeft(2, '0')}';
    final open = _doorSeconds > 0;

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(
              open ? Icons.lock_open_rounded : Icons.lock_outline_rounded,
              size: 56,
              color: open ? AppColors.success : Colors.white,
            ),
            const SizedBox(height: 16),
            Text(
              bay,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _attempt > 1
                  ? 'Attempt $_attempt — reposition the item so the whole of it is visible, then check it again.'
                  : 'You are verified. Open the locker when you are standing in front of it.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, height: 1.45, color: Colors.white70),
            ),
            const SizedBox(height: 24),

            // A retry: say what the AI saw, with the locker camera's own photo.
            if (_attempt > 1 && RetryFeedbackCard.hasContent(_retryReason, _retryImages)) ...[
              RetryFeedbackCard(
                reason: _retryReason,
                reposition: _retryReposition,
                imageUrls: _retryImages,
              ),
              const SizedBox(height: 16),
            ],

            // The countdown only exists while a door is actually unlocked.
            if (open) ...[
              Container(
                padding: const EdgeInsets.symmetric(vertical: 18),
                decoration: BoxDecoration(
                  color: AppColors.success.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.success.withValues(alpha: 0.45)),
                ),
                child: Column(
                  children: [
                    Text(
                      '$_doorSeconds',
                      style: const TextStyle(
                        fontSize: 44,
                        fontWeight: FontWeight.w800,
                        color: AppColors.success,
                      ),
                    ),
                    const Text(
                      'seconds to open the door',
                      style: TextStyle(fontSize: 13, color: Colors.white70),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
            ],

            // The physical instruction the kiosk cannot give: the door is
            // unlocked, not opened, and the lit bay is the one to push.
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.lightbulb_rounded, size: 18, color: AppColors.warning),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'PUSH the door of the locker that lights up — a light turns on '
                      'when it unlocks. The lock only holds it shut; it does not swing '
                      'open by itself.',
                      style: TextStyle(fontSize: 13, height: 1.45, color: Colors.white),
                    ),
                  ),
                ],
              ),
            ),

            if (_bayError != null) ...[
              const SizedBox(height: 14),
              Text(
                _bayError!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: AppColors.error),
              ),
            ],

            const SizedBox(height: 22),
            FilledButton.icon(
              onPressed: _busy ? null : _openBay,
              icon: const Icon(Icons.lock_open_rounded),
              label: Text(open ? 'Open Kiosk Again' : 'Open Kiosk Now'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 12),

            if (_needsPhoto)
              OutlinedButton.icon(
                onPressed: _busy ? null : _itemPlaced,
                icon: const Icon(Icons.check_circle_outline_rounded),
                label: Text(widget.mode == 'return'
                    ? 'Item is back inside — check it'
                    : 'Item is placed — check it'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(54),
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Colors.white54),
                ),
              )
            else
              OutlinedButton.icon(
                onPressed: () => Navigator.pop(context, true),
                icon: const Icon(Icons.done_rounded),
                label: const Text('I have my item — done'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(54),
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Colors.white54),
                ),
              ),

            if (_needsPhoto) ...[
              const SizedBox(height: 10),
              const Text(
                'Close the door before checking. The kiosk photographs the inside '
                'of the locker and compares it with the listing photo.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, height: 1.4, color: Colors.white60),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // ── Scanner callback ────────────────────────────────────────────────────────

  void _onDetect(BarcodeCapture capture) {
    if (_phase != _Phase.scanning) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;

    _scannerCtrl.stop();

    // Best-effort fallback so even a total timeout (no server event at all
    // comes back) still has something to attach to a feedback report — the
    // token's own format is "{kiosk_id}:{token_id}:{ts}:{sig}" (see the
    // server's matching comment in index.ts). Overwritten below by an
    // authoritative server-echoed kioskId whenever one arrives.
    final tokenKioskId = raw.split(':').firstOrNull;
    if (tokenKioskId != null && tokenKioskId.isNotEmpty) {
      _kioskId = tokenKioskId;
    }

    final userId = SocketService.instance.currentUserId ?? '';

    SocketService.instance.emit('app:kiosk_scan', {
      'token': raw,
      'rentalId': widget.rentalId,
      'mode': widget.mode,
      'userId': userId,
    });

    setState(() => _phase = _Phase.waiting);

    // Timeout matches kiosk QR TTL (90 s) plus a small buffer
    _timeout = Timer(const Duration(seconds: 95), () {
      if (_phase == _Phase.waiting && mounted) {
        setState(() {
          _phase = _Phase.failed;
          _errorMessage = 'No response from the kiosk. The code may have expired — '
              'tap refresh on the kiosk screen and scan the new one.';
        });
      }
    });
  }

  // ── Socket event handlers ───────────────────────────────────────────────────

  bool _faceScreenOpen = false;

  /// The kiosk validated our scan and is now waiting on us — time to open the
  /// on-phone verification page (design mandate §2.13). This is the moment
  /// the flow moves from "scanned a code" to "prove it's you".
  void _onFaceRequired(Map<String, dynamic> data) async {
    if (data['rentalId'] != widget.rentalId) return;
    if (_faceScreenOpen || !mounted) return;
    _timeout?.cancel();
    _faceScreenOpen = true;

    final result = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(
        builder: (_) => FaceVerifyScreen(
          rentalId: widget.rentalId,
          mode: widget.mode,
          kioskId: (data['kioskId'] as String?) ?? _kioskId,
          // Face liveness: the random step order + nonce the server chose.
          challenge: FaceChallenge.fromJson(data['challenge']),
          // E3.2 / spec 2.3. The server's ABSOLUTE deadline for this kiosk
          // session, forwarded untouched. Null on an older server, and the
          // countdown then renders nothing rather than inventing 120s.
          sessionExpiresAt: switch (data['expiresAt']) {
            final int ms => DateTime.fromMillisecondsSinceEpoch(ms),
            _ => null,
          },
        ),
      ),
    );

    _faceScreenOpen = false;
    if (!mounted) return;

    // 'rescan' means the session ran out of retries — FaceVerifyScreen
    // already explained why; back here, just go back to scanning.
    if (result == 'rescan') {
      _retry();
    }
    // Dispute v2: the face verified, and the server answered with what the
    // renter owes before any door opens (ruling 6), or with why nothing can
    // happen right now. Neither comes as a socket event.
    if (result is Map) {
      final action = result['action'];
      if (action == 'dispute_pay') {
        final d = (result['dispute'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
        setState(() {
          _owed = (d['amount'] as num?)?.toDouble();
          _visitExpiresAt = d['expiresAt'] is int ? DateTime.fromMillisecondsSinceEpoch(d['expiresAt'] as int) : null;
          _payMode = d['pendingTransactionId'] != null ? 'SUBMITTED' : null;
          _phase = _Phase.pay;
        });
      } else if (action == 'none' && _phase != _Phase.bay) {
        setState(() {
          _phase = _Phase.failed;
          _errorMessage = (result['message'] as String?) ?? 'Nothing can be done at the kiosk for this right now.';
        });
      }
    }
    // On a real success, `_onFaceVerified` already fired the socket event
    // while FaceVerifyScreen was on top (this screen's State stayed alive
    // underneath), so `_phase` is already "success" by the time we get here
    // — nothing else to do.
  }

  void _onFaceVerified(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    _timeout?.cancel();
    if (!mounted) return;
    setState(() {
      _bayNumber = data['lockerNumber']?.toString();
      // 'retrieve' opens the bottom door server-side the moment the face
      // verifies, because the item is already sitting in the lower
      // compartment and the owner is standing at it. Everything else waits
      // for the tap below.
      _phase = _Phase.bay;
      _bayError = null;
    });
  }

  /// "Open Kiosk Now". The server decides which bay and which door from the
  /// grant its own verification made; this sends nothing but the rental.
  Future<void> _openBay() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _bayError = null;
    });
    try {
      final resp = await _api.post('/kiosk/open-bay', {'rentalId': widget.rentalId});
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      if (resp.statusCode == 200) {
        final data = (body['data'] as Map<String, dynamic>?) ?? const {};
        final secs = (data['doorOpenSeconds'] as num?)?.toInt() ?? 15;
        if (!mounted) return;
        setState(() {
          _bayNumber = data['lockerNumber']?.toString() ?? _bayNumber;
          _doorSeconds = secs;
        });
        _doorTicker?.cancel();
        _doorTicker = Timer.periodic(const Duration(seconds: 1), (t) {
          if (!mounted) return t.cancel();
          setState(() => _doorSeconds = _doorSeconds > 0 ? _doorSeconds - 1 : 0);
          if (_doorSeconds == 0) t.cancel();
        });
      } else {
        if (!mounted) return;
        setState(() => _bayError = body['message'] as String? ??
            'The kiosk could not open that locker.');
      }
    } catch (e) {
      if (mounted) setState(() => _bayError = friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// "Item is placed" — asks the kiosk to photograph the bay NOW, instead of
  /// a blind timer deciding when to look.
  Future<void> _itemPlaced() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _bayError = null;
    });
    try {
      final resp = await _api.post('/kiosk/item-placed', {'rentalId': widget.rentalId});
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      if (!mounted) return;
      if (resp.statusCode == 200) {
        _doorTicker?.cancel();
        setState(() {
          _doorSeconds = 0;
          _phase = _Phase.checking;
          _retryReason = null;
          _retryImages = const [];
        });
      } else {
        setState(() => _bayError = body['message'] as String? ??
            'The kiosk could not check that locker.');
      }
    } catch (e) {
      if (mounted) setState(() => _bayError = friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// A RETRY verdict is the case this whole screen exists for: the door is
  /// re-opened by the server, the person repositions the item, and taps
  /// "Item is placed" again. Before D-78's fix nothing ever looked again.
  void _onItemRetry(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    if (!mounted) return;
    final reason = data['reason'];
    final urls = data['imageUrls'];
    setState(() {
      _attempt = RetryFeedbackCard.attemptAfterRetry(data['attemptNumber'], _attempt);
      _phase = _Phase.bay;
      _bayError = null;
      _retryReason = reason is String && reason.trim().isNotEmpty ? reason : null;
      _retryReposition = data['reposition'] == true;
      _retryImages = urls is List ? urls.whereType<String>().toList(growable: false) : const [];
    });
  }

  /// Verification itself is fully handled on FaceVerifyScreen now (design
  /// mandate §2.13) — a bad face match never reaches this event at all, it's
  /// resolved directly from that screen's own HTTP response so retrying
  /// there doesn't flicker this screen underneath. By the time this DOES
  /// fire, the face already matched; it's node_server reporting it couldn't
  /// complete the rest of the step (e.g. no free locker at this kiosk right
  /// now) — always carries its own `message`, so that's shown verbatim
  /// rather than a canned "face not recognised" line that would be wrong.
  void _onItemApproved(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    if (!mounted) return;
    // D-87b: the server sends the decision alongside this event. APPROVED means
    // the pipeline cleared it outright; anything else reaching here means
    // "accepted, a person will confirm it". Both are successes for the student
    // standing at the locker — they differ only in what happens next, and that
    // difference is the part the screen has to say out loud.
    final decision = (data['decision'] as String?)?.toUpperCase();
    setState(() {
      _awaitingReview = decision != null && decision != 'APPROVED';
      _phase = _Phase.success;
    });
  }

  void _onItemRejected(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    if (!mounted) return;
    setState(() {
      _phase = _Phase.failed;
      _errorMessage =
          'The kiosk could not match this item to the listing photo after several tries. '
          'An admin has been notified — take your item back out if the door is open.';
    });
  }

  /// A RETURN's check came back PENDING — the same "accepted, a person will
  /// confirm it" outcome `_onItemApproved` already handles for a deposit, just
  /// reached over a different event because a return has no `decision` field
  /// on this one (`return:under_review` only ever fires for PENDING; a clean
  /// approval goes through `_onRentalCompleted` instead, and a REJECTED one
  /// through `_onReturnDisputed`).
  void _onReturnUnderReview(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    if (!mounted) return;
    setState(() {
      _awaitingReview = true;
      _phase = _Phase.success;
    });
  }

  /// A RETURN was rejected — the item did not match on the final attempt, and
  /// the rental is now DISPUTED. Deliberately its own message, not
  /// `_onItemRejected`'s: that one tells a DEPOSIT's owner to take their item
  /// back out, which would be wrong instructions to a RENTER mid-return — the
  /// item is released to the OWNER while the dispute is resolved, not handed
  /// back across the counter to whoever is standing here.
  void _onReturnDisputed(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    if (!mounted) return;
    setState(() {
      _phase = _Phase.failed;
      _errorMessage =
          'The returned item did not match on the final check. An admin has been '
          'notified and the item is being released back to the owner while this '
          'is looked into — you do not need to do anything further here.';
    });
  }

  /// A RETURN cleared outright (decision APPROVED) and the rental has already
  /// been settled server-side — `completeRental` ran before this event went
  /// out, so the deposit refund and payout are already in motion. Reuses the
  /// ordinary success screen with no awaiting-review note, exactly as if
  /// `_onItemApproved` had fired with `decision: 'APPROVED'`.
  void _onRentalCompleted(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    if (!mounted) return;
    setState(() {
      _awaitingReview = false;
      _phase = _Phase.success;
    });
  }

  void _onFaceFailed(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    _timeout?.cancel();
    if (mounted) {
      setState(() {
        _phase = _Phase.failed;
        _errorMessage = (data['message'] as String?)?.isNotEmpty == true
            ? data['message'] as String
            : 'Something went wrong completing this step. Please try again.';
        // Only overwrite the QR-derived fallback with an authoritative
        // value — this event always carries one, but guard anyway so a
        // stray null can't erase a fallback that was actually correct.
        _kioskId = (data['kioskId'] as String?) ?? _kioskId;
      });
    }
  }

  void _onScanError(Map<String, dynamic> data) {
    // Ignore errors meant for a different rental
    final id = data['rentalId'];
    if (id != null && id != widget.rentalId) return;
    _timeout?.cancel();
    if (mounted) {
      setState(() {
        _phase = _Phase.failed;
        _errorMessage = (data['message'] as String?)?.isNotEmpty == true
            ? data['message'] as String
            : 'The kiosk reported an error. Please try again.';
        _kioskId = (data['kioskId'] as String?) ?? _kioskId;
      });
    }
  }

  // ── Dispute v2: pay at the kiosk before the door unlocks (ruling 6) ─────────

  double? _owed;
  DateTime? _visitExpiresAt;
  /// null = not started; 'PAYMONGO' = checkout open; 'MANUAL' = staff confirm;
  /// 'SUBMITTED' = a payment is already waiting for confirmation.
  String? _payMode;
  Map<String, dynamic>? _manual;
  bool _paying = false;
  String? _payError;

  Future<void> _startPayment() async {
    if (_paying || widget.disputeId == null) return;
    setState(() {
      _paying = true;
      _payError = null;
    });
    try {
      final r = await _api.post('/disputes/${widget.disputeId}/pay', const {});
      final body = jsonDecode(r.body) as Map<String, dynamic>;
      if (r.statusCode != 201 && r.statusCode != 200) {
        setState(() => _payError = (body['error'] ?? body['message'] ?? 'Could not start the payment') as String);
        return;
      }
      final data = body['data'] as Map<String, dynamic>;
      final mode = data['paymentMode'] as String?;
      final url = data['paymentUrl'] as String?;
      setState(() {
        _payMode = mode;
        _manual = (data['instructions'] as Map?)?.cast<String, dynamic>();
      });
      if (mode == 'PAYMONGO' && url != null && mounted) {
        // The server confirms the payment by asking PayMongo itself; when it
        // does, the door is granted and `face:verified` moves this screen on.
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PaymentWebViewScreen(
              checkoutUrl: url,
              checkoutSessionId: data['transactionId'] as String,
              rentalId: widget.rentalId,
            ),
          ),
        );
        if (mounted && _phase == _Phase.pay) setState(() => _payMode = 'SUBMITTED');
      }
    } catch (e) {
      if (mounted) setState(() => _payError = friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  void _onVisitEnded(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId || !mounted) return;
    if (_phase == _Phase.pay || _phase == _Phase.waiting) {
      setState(() {
        _phase = _Phase.failed;
        _errorMessage = 'The kiosk session ended. Nothing was charged twice. Scan the QR code again when you are ready.';
      });
    }
  }

  void _onDisputePaymentRejected(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId || !mounted || _phase != _Phase.pay) return;
    setState(() {
      _payMode = null;
      _payError = 'The payment did not go through${data['reason'] != null ? ' (${data['reason']})' : ''}. You can try again.';
    });
  }

  Widget _buildPay() {
    final left = _visitExpiresAt?.difference(DateTime.now());
    final waiting = _payMode == 'SUBMITTED' || _payMode == 'MANUAL' || _payMode == 'PAYMONGO';
    final manualText = _manual == null
        ? ''
        : '${_manual!['channel'] ?? 'GCash'}: ${_manual!['accountName'] ?? ''} ${_manual!['accountNumber'] ?? ''}\n'
            'Amount: ₱${(_manual!['amount'] as num?)?.toStringAsFixed(2) ?? ''}\n'
            'Reference: ${_manual!['reference'] ?? ''}';
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.payments_rounded, size: 56, color: Colors.white),
            const SizedBox(height: 14),
            const Text('Pay before the locker opens',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white)),
            const SizedBox(height: 8),
            Text(
              _owed == null ? '' : 'Amount owed: ₱${_owed!.toStringAsFixed(2)}',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppColors.warning),
            ),
            const SizedBox(height: 6),
            Text(
              'The amount stops growing once you pay. When the payment is confirmed the upper door unlocks for the '
              'correct item.${left != null && !left.isNegative ? ' This kiosk session ends in ${left.inMinutes} min.' : ''}',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13.5, height: 1.45, color: Colors.white70),
            ),
            const SizedBox(height: 22),
            if (!waiting)
              FilledButton.icon(
                onPressed: _paying ? null : _startPayment,
                icon: _paying
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.lock_open_rounded),
                label: const Text('Pay now'),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54), backgroundColor: AppColors.primary),
              ),
            if (waiting) ...[
              const Center(child: CircularProgressIndicator(color: AppColors.info)),
              const SizedBox(height: 12),
              Text(
                _payMode == 'MANUAL'
                    ? 'Online payment is unavailable right now, so staff will confirm it. Send the amount as shown below; '
                        'staff have been alerted and the door unlocks as soon as they confirm.'
                    : 'Waiting for the payment to be confirmed. Stay here; the door unlocks by itself.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, height: 1.45),
              ),
              if (_payMode == 'MANUAL' && _manual != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(manualText, style: const TextStyle(color: Colors.white, height: 1.5)),
                ),
              ],
            ],
            if (_payError != null) ...[
              const SizedBox(height: 12),
              Text(_payError!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.error)),
            ],
            const SizedBox(height: 18),
            TextButton(
              onPressed: () async {
                if (widget.disputeId != null) {
                  try {
                    await _api.post('/disputes/${widget.disputeId}/cancel-visit', const {});
                  } catch (_) {}
                }
                if (mounted) Navigator.pop(context, false);
              },
              child: const Text('Cancel and leave the kiosk', style: TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      ),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  void _retry() {
    setState(() {
      _phase = _Phase.scanning;
      _errorMessage = '';
    });
    _scannerCtrl.start();
  }

  String get _modeLabel => switch (widget.mode) {
        'place' => 'Drop off at kiosk',
        'retrieve' => 'Collect your item',
        'collect' => 'Collect your own item',
        'dispute' => 'Pay and return',
        _ => 'Return to kiosk',
      };

  String get _waitingLabel => switch (widget.mode) {
        'place' => 'Opening a locker…',
        'retrieve' || 'collect' => 'Unlocking your locker…',
        'dispute' => 'Checking your case…',
        _ => 'Confirming your return…',
      };

  /// What the user physically does after the QR scan. Since 2026-09-03,
  /// identity verification happens in a page on THIS phone, not at the
  /// kiosk — the kiosk no longer has a camera to look at.
  String get _waitingDetail => switch (widget.mode) {
        'place' =>
          "We're checking with the kiosk. A verification page will open on "
              'your phone next — once confirmed, a locker door opens.',
        'retrieve' || 'collect' =>
          "We're checking with the kiosk. A verification page will open on "
              'your phone next — once confirmed, your locker opens.',
        'dispute' =>
          "We're checking with the kiosk. A verification page will open on "
              'your phone next, then you pay the amount owed and the locker opens.',
        _ =>
          "We're checking with the kiosk. A verification page will open on "
              'your phone next — once confirmed, open the locker and place '
              'the item back inside.',
      };

  String get _successLabel => switch (widget.mode) {
        'place' => 'Locker open — place your item inside',
        'retrieve' || 'collect' => 'Locker open — take your item',
        _ => 'Locker open — put the item back',
      };

  List<String> get _steps => switch (widget.mode) {
        'place' => const [
            'Scan the QR code on the kiosk screen',
            'Verify your identity on this phone',
            'Place the item in the open locker',
          ],
        'retrieve' || 'collect' => const [
            'Scan the QR code on the kiosk screen',
            'Verify your identity on this phone',
            'Take your item from the open locker',
          ],
        'dispute' => const [
            'Scan the QR code on the kiosk screen',
            'Verify your identity on this phone',
            'Pay the amount owed',
            'Put the correct item in the open locker',
          ],
        _ => const [
            'Scan the QR code on the kiosk screen',
            'Verify your identity on this phone',
            'Return the item to the open locker',
          ],
      };

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07100E),
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: Text(
          _modeLabel,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
        actions: [
          if (_phase == _Phase.scanning)
            IconButton(
              tooltip: _torchOn ? 'Torch off' : 'Torch on',
              icon: Icon(
                _torchOn ? Icons.flashlight_on_rounded : Icons.flashlight_off_rounded,
                color: _torchOn ? AppColors.warning : Colors.white,
              ),
              onPressed: () {
                _scannerCtrl.toggleTorch();
                setState(() => _torchOn = !_torchOn);
              },
            ),
        ],
      ),
      body: switch (_phase) {
        _Phase.scanning => _buildScanning(),
        _Phase.waiting => _buildWaiting(),
        _Phase.pay => _buildPay(),
        _Phase.bay => _buildBay(),
        _Phase.checking => _buildChecking(),
        _Phase.success => _buildResult(
            icon: _awaitingReview
                ? Icons.hourglass_top_rounded
                : Icons.lock_open_rounded,
            color: _awaitingReview ? AppColors.info : AppColors.success,
            title:
                _awaitingReview ? 'Item placed — awaiting review' : _successLabel,
            body: _awaitingReview
                ? 'Your item is in the locker and the door is closed.\n\n'
                    'The quick check at the kiosk was not confident enough to '
                    'confirm it on its own, so our full model is taking a closer '
                    'look and a person confirms the result.\n\n'
                    'This can take a few hours. You do not need to wait here — '
                    'we will notify you in the app as soon as it is confirmed.'
                : 'Close the door when you\'re done — the kiosk confirms automatically.',
            primaryLabel: 'Done',
            onPrimary: () => Navigator.pop(context, true),
          ),
        _Phase.failed => _buildResult(
            icon: Icons.error_outline_rounded,
            color: AppColors.error,
            title: 'Hand-off didn\'t complete',
            body: _errorMessage,
            primaryLabel: 'Scan again',
            onPrimary: _retry,
            secondaryLabel: 'Cancel',
            onSecondary: () => Navigator.pop(context, false),
            // Checklist 3.2 — a report filed from here already knows which
            // kiosk and which rental; the student shouldn't have to look
            // either up.
            tertiaryLabel: 'Report this problem',
            onTertiary: () => Navigator.pushNamed(
              context,
              '/feedback/new',
              arguments: {
                'category': 'KIOSK_PROBLEM',
                'body': _errorMessage,
                'contextNote':
                    'Filed from a kiosk hand-off that didn\'t complete — the '
                    'kiosk and rental are attached automatically.',
                'screen': 'KioskScanScreen',
                'rentalId': widget.rentalId,
                'kioskId': _kioskId,
              },
            ),
          ),
      },
    );
  }

  Widget _buildScanning() {
    return Stack(
      fit: StackFit.expand,
      children: [
        MobileScanner(controller: _scannerCtrl, onDetect: _onDetect),

        // Dim everything but the scan window so the target is unambiguous.
        AnimatedBuilder(
          animation: _sweep,
          builder: (context, _) => CustomPaint(
            painter: _ScanFramePainter(progress: _sweep.value),
          ),
        ),

        // Instructions, anchored to the bottom so they never cover the frame.
        Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            width: double.infinity,
            padding: EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg + MediaQuery.paddingOf(context).bottom,
            ),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Colors.transparent, Color(0xE607100E), Color(0xFF07100E)],
                stops: [0, 0.45, 1],
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'POINT AT THE KIOSK SCREEN',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                    color: AppColors.primaryOnDark,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                for (var i = 0; i < _steps.length; i++) ...[
                  _StepLine(
                    number: i + 1,
                    text: _steps[i],
                    active: i == 0,
                  ),
                  if (i < _steps.length - 1) const SizedBox(height: 7),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildWaiting() {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Pulsing ring: the wait is on the kiosk's face check, which can
            // take a few seconds. A bare spinner read as "the app is stuck".
            SizedBox(
              width: 110,
              height: 110,
              child: AnimatedBuilder(
                animation: _sweep,
                builder: (context, child) => CustomPaint(
                  painter: _PulsePainter(progress: _sweep.value),
                  child: child,
                ),
                child: const Center(
                  child: Icon(Icons.face_retouching_natural_rounded,
                      size: 38, color: AppColors.primaryOnDark),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              _waitingLabel,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              _waitingDetail,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.5,
                color: Color(0xFF9FBFB8),
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel',
                  style: TextStyle(color: Color(0xFF7FA39C))),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResult({
    required IconData icon,
    required Color color,
    required String title,
    required String body,
    required String primaryLabel,
    required VoidCallback onPrimary,
    String? secondaryLabel,
    VoidCallback? onSecondary,
    String? tertiaryLabel,
    VoidCallback? onTertiary,
  }) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.14),
                shape: BoxShape.circle,
                border: Border.all(color: color.withValues(alpha: 0.4), width: 1.5),
              ),
              child: Icon(icon, size: 44, color: color),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                height: 1.2,
                letterSpacing: -0.4,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.5,
                color: Color(0xFF9FBFB8),
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: onPrimary,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryOnDark,
                  foregroundColor: const Color(0xFF04211D),
                ),
                child: Text(
                  primaryLabel,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 14.5),
                ),
              ),
            ),
            if (secondaryLabel != null) ...[
              const SizedBox(height: AppSpacing.xs),
              TextButton(
                onPressed: onSecondary,
                child: Text(secondaryLabel,
                    style: const TextStyle(color: Color(0xFF7FA39C))),
              ),
            ],
            if (tertiaryLabel != null) ...[
              const SizedBox(height: AppSpacing.hair),
              TextButton.icon(
                onPressed: onTertiary,
                icon: const Icon(Icons.flag_outlined, size: 15, color: Color(0xFF7FA39C)),
                label: Text(tertiaryLabel,
                    style: const TextStyle(color: Color(0xFF7FA39C), fontSize: 12.5)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StepLine extends StatelessWidget {
  const _StepLine({
    required this.number,
    required this.text,
    required this.active,
  });

  final int number;
  final String text;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 18,
          height: 18,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active
                ? AppColors.primaryOnDark
                : Colors.white.withValues(alpha: 0.10),
            borderRadius: AppRadius.circle,
          ),
          child: Text(
            '$number',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: active ? const Color(0xFF04211D) : Colors.white70,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.xs),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 13,
              height: 1.35,
              fontWeight: active ? FontWeight.w600 : FontWeight.w400,
              color: active ? Colors.white : const Color(0xFF9FBFB8),
            ),
          ),
        ),
      ],
    );
  }
}

/// Dims the frame outside the scan window and draws corner brackets plus a
/// travelling scan line. Brackets are the near-universal QR affordance —
/// without them a full-screen camera gives no hint where to aim.
class _ScanFramePainter extends CustomPainter {
  _ScanFramePainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final side = size.width * 0.68;
    final rect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height * 0.42),
      width: side,
      height: side,
    );
    final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(6));

    // Scrim everywhere except the window.
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect(Offset.zero & size),
        Path()..addRRect(rrect),
      ),
      Paint()..color = const Color(0xFF07100E).withValues(alpha: 0.72),
    );

    final bracket = Paint()
      ..color = AppColors.primaryOnDark
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    const arm = 26.0;
    // Four corners, two strokes each.
    for (final (corner, dx, dy) in [
      (rect.topLeft, 1.0, 1.0),
      (rect.topRight, -1.0, 1.0),
      (rect.bottomLeft, 1.0, -1.0),
      (rect.bottomRight, -1.0, -1.0),
    ]) {
      canvas.drawLine(corner, corner.translate(arm * dx, 0), bracket);
      canvas.drawLine(corner, corner.translate(0, arm * dy), bracket);
    }

    // Travelling scan line. Ping-pongs so it never jumps.
    final t = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    final y = rect.top + rect.height * t;
    canvas.drawLine(
      Offset(rect.left + 6, y),
      Offset(rect.right - 6, y),
      Paint()
        ..shader = const LinearGradient(
          colors: [
            Colors.transparent,
            AppColors.primaryOnDark,
            Colors.transparent,
          ],
        ).createShader(Rect.fromLTWH(rect.left, y - 1, rect.width, 2))
        ..strokeWidth = 2,
    );
  }

  @override
  bool shouldRepaint(_ScanFramePainter old) => old.progress != progress;
}

/// Expanding rings behind the waiting state's face icon.
class _PulsePainter extends CustomPainter {
  _PulsePainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    for (var i = 0; i < 3; i++) {
      final t = (progress + i / 3) % 1.0;
      canvas.drawCircle(
        center,
        size.width * (0.32 + 0.18 * t),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..color = AppColors.primaryOnDark.withValues(alpha: (1 - t) * 0.5),
      );
    }
  }

  @override
  bool shouldRepaint(_PulsePainter old) => old.progress != progress;
}
