import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/design_tokens.g.dart';
import '../theme/tokens.dart';

/// E3.2 — the phone's half of `ANIMATION-AND-LOADING-SPEC.md` §1.
///
/// The kiosk got all three primitives (determinate / staged / indeterminate)
/// because all three of its waits are real. **The phone gets two, and the
/// omission is deliberate:**
///
/// * **Indeterminate** — the face round-trip (§1.3). Genuinely unknown
///   duration, so no percentage is shown, because there is none.
/// * **Determinate** — the 120-second session countdown that §1.3 requires
///   *alongside* it. This one **is** determinate: the server tells us exactly
///   when the session dies, so a bar and a number are honest here.
/// * **Staged** — **not built.** §1.2's ML pipeline runs on the kiosk, and no
///   phone screen waits on it. Adding it would be a widget nothing renders,
///   which is D-43's failure mode ("emitted but consumed by nothing") in
///   widget form. It belongs here the day a phone screen actually waits on a
///   staged operation.
///
/// Everything below reads generated tokens (`DesignTokens.of(brightness)`),
/// never raw colours, so a token change restyles them — `ENGIRENT-CLAUDE.md`
/// §7.

/// An honest indeterminate indicator: motion, no percentage.
///
/// Reduced motion deliberately does **not** freeze this. The spec's rule —
/// "freeze to the end state, don't slow down" — is correct for a transition
/// and wrong here, because an indeterminate indicator has no end state to
/// freeze to and a motionless one is indistinguishable from a crashed screen,
/// which is the single thing it exists to prevent. Same call as the kiosk's.
class AppIndeterminateProgress extends StatelessWidget {
  const AppIndeterminateProgress({
    super.key,
    required this.label,
    this.sub,
    this.attemptLabel,
  });

  final String label;
  final String? sub;

  /// e.g. "Attempt 2 of 4" — rendered verbatim. The attempt budget is real
  /// (`kioskSessionStore.MAX_ATTEMPTS`) and the server returns what is left,
  /// so this is reported, never guessed.
  final String? attemptLabel;

  @override
  Widget build(BuildContext context) {
    final t = DesignTokens.of(Theme.of(context).brightness);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(color: t.textPrimary, fontWeight: FontWeight.w700),
        ),
        if (sub != null) ...[
          const SizedBox(height: AppSpacing.hair),
          Text(
            sub!,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: t.textSecondary),
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        ClipRRect(
          borderRadius: BorderRadius.circular(DesignRadius.input),
          child: LinearProgressIndicator(
            // value: null is what makes this indeterminate. Never pass a
            // number here to make it "look more informative" — that is a
            // determinate claim over an unknown wait.
            value: null,
            minHeight: 6,
            backgroundColor: t.surfaceAlt,
            valueColor: AlwaysStoppedAnimation<Color>(t.brand),
          ),
        ),
        if (attemptLabel != null) ...[
          const SizedBox(height: AppSpacing.xs),
          Text(
            attemptLabel!,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: t.textSecondary,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
          ),
        ],
      ],
    );
  }
}

/// The 120-second kiosk-session countdown (`ANIMATION-AND-LOADING-SPEC.md`
/// §2.3): *"visible, calm, non-red until genuinely low."*
///
/// **Counts down to an ABSOLUTE deadline supplied by the server**, never from
/// a local `120`. The server opens the session and sends `expiresAt`; a phone
/// starting its own clock when the event *arrives* would drift by the network
/// and render latency and consistently overstate the time left — telling a
/// student "40s remaining" on a session the server has already expired.
///
/// **A null `deadline` renders nothing at all.** That is the same rule the
/// kiosk's determinate bar follows: absent is not a licence to invent. An
/// older server that does not send `expiresAt` gets no countdown rather than
/// a fictional one.
class AppSessionCountdown extends StatefulWidget {
  const AppSessionCountdown({
    super.key,
    required this.deadline,
    this.onExpired,
  });

  final DateTime? deadline;
  final VoidCallback? onExpired;

  @override
  State<AppSessionCountdown> createState() => _AppSessionCountdownState();
}

class _AppSessionCountdownState extends State<AppSessionCountdown> {
  Timer? _ticker;
  bool _firedExpired = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(AppSessionCountdown old) {
    super.didUpdateWidget(old);
    if (old.deadline != widget.deadline) {
      _firedExpired = false;
      _start();
    }
  }

  void _start() {
    _ticker?.cancel();
    if (widget.deadline == null) return;
    // Recomputed from the wall clock each tick rather than decremented, so a
    // dropped frame or a backgrounded app cannot make the number drift away
    // from the deadline the server is actually enforcing.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
      if (_remaining() <= Duration.zero && !_firedExpired) {
        _firedExpired = true;
        widget.onExpired?.call();
      }
    });
  }

  Duration _remaining() {
    final d = widget.deadline;
    if (d == null) return Duration.zero;
    final left = d.difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.deadline == null) return const SizedBox.shrink();

    final t = DesignTokens.of(Theme.of(context).brightness);
    final left = _remaining();
    final seconds = left.inSeconds;

    // Calm until genuinely low, then the warning role — never `critical`.
    // A session running low is a deadline, not a failure, which is the same
    // principle that keeps PENDING off warning-yellow across this project.
    final low = seconds <= 20;
    final colour = low ? t.warning : t.textSecondary;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          seconds > 0
              ? '${seconds}s left in this session'
              : 'Session expired — scan again at the kiosk',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colour,
                fontWeight: low ? FontWeight.w700 : FontWeight.w400,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
        ),
      ],
    );
  }
}
