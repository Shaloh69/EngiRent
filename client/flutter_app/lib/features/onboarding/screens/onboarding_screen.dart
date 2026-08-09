import 'package:flutter/material.dart';
import 'package:introduction_screen/introduction_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/animated_auth_background.dart';
import '../../../core/widgets/app_widgets.dart';

/// First-open walkthrough — mandate §2.3 (1 of 2).
///
/// Shown once, before sign-in, then never again. This is the "what is this
/// app" pass; the in-context "?" tour (§2.3 part 2, see HomeScreen) is the
/// separate "what does this button do" pass. Conflating the two is why
/// onboarding usually gets skipped and then nothing explains the UI.
class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key});

  static const _seenKey = 'engirent_onboarding_seen';

  /// Whether the walkthrough still needs showing. Read at startup to pick the
  /// initial route.
  static Future<bool> shouldShow() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return !(prefs.getBool(_seenKey) ?? false);
    } catch (_) {
      // A failed read must not block launch — showing onboarding one extra
      // time is a far better failure than crashing on start.
      return false;
    }
  }

  static Future<void> _markSeen() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_seenKey, true);
    } catch (_) {/* non-fatal */}
  }

  Future<void> _finish(BuildContext context) async {
    await _markSeen();
    if (context.mounted) {
      Navigator.pushReplacementNamed(context, '/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final theme = Theme.of(context);

    PageViewModel page({
      required IconData icon,
      required Color accent,
      required String eyebrow,
      required String title,
      required String body,
    }) {
      return PageViewModel(
        // Both slots share one centred, max-width box.
        // IntroductionScreen lays title and body out independently with no
        // shared width constraint, so on anything wider than a phone the
        // copy ran past the viewport and clipped mid-word.
        titleWidget: _Constrain(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
            Container(
              height: 64,
              width: 64,
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.14),
                borderRadius: AppRadius.card,
                border: Border.all(color: accent.withValues(alpha: 0.32)),
              ),
              child: Icon(icon, color: accent, size: 30),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              eyebrow.toUpperCase(),
              style: AppTheme.mono(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: accent,
                letterSpacing: 1.8,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
              Text(
                title,
                style: theme.textTheme.headlineMedium
                    ?.copyWith(fontSize: 30, letterSpacing: -0.6, height: 1.1),
              ),
            ],
          ),
        ),
        bodyWidget: _Constrain(
          child: Text(
            body,
            style: TextStyle(fontSize: 15, height: 1.5, color: p.muted),
          ),
        ),
        decoration: PageDecoration(
          titlePadding: EdgeInsets.zero,
          bodyPadding: const EdgeInsets.only(top: AppSpacing.sm),
          pageColor: Colors.transparent,
          // Top inset clears the status bar — without it the icon tile was
          // clipped by the notch/status area. bodyFlex/imageFlex pull the
          // content off the top edge so it sits in the upper third rather
          // than hard against it.
          contentMargin: EdgeInsets.fromLTRB(
            AppSpacing.lg,
            MediaQuery.of(context).padding.top + AppSpacing.huge,
            AppSpacing.lg,
            AppSpacing.lg,
          ),
          bodyAlignment: Alignment.topLeft,
          titleTextStyle: const TextStyle(),
        ),
      );
    }

    return Scaffold(
      body: AnimatedAuthBackground(
        child: IntroductionScreen(
          globalBackgroundColor: Colors.transparent,
          pages: [
            page(
              icon: Icons.inventory_2_outlined,
              accent: AppColors.primary,
              eyebrow: 'Step 01',
              title: 'Rent gear from\nother students',
              body:
                  'Calculators, Arduino kits, lab gowns, measuring tools — borrow what you need for a few days instead of buying it for one subject.',
            ),
            page(
              icon: Icons.lock_outline,
              accent: AppColors.secondary,
              eyebrow: 'Step 02',
              title: 'A smart locker\nholds the handover',
              body:
                  'No meeting up or coordinating schedules. The owner drops the item into a locker on campus, and you collect it with a QR code and a face check.',
            ),
            page(
              icon: Icons.verified_user_outlined,
              accent: AppColors.accent,
              eyebrow: 'Step 03',
              title: 'Your money is held\nuntil it\'s verified',
              body:
                  'Payment and your deposit stay in escrow until the item is verifiably deposited. Cameras record its condition going in and out, so damage disputes start from photos, not memory.',
            ),
          ],
          showSkipButton: true,
          skip: Text('Skip', style: TextStyle(color: p.muted)),
          next: Icon(Icons.arrow_forward_rounded, color: p.primary),
          done: Text(
            'Get started',
            style: TextStyle(fontWeight: FontWeight.w700, color: p.primary),
          ),
          onDone: () => _finish(context),
          onSkip: () => _finish(context),
          curve: AppMotion.ease,
          dotsDecorator: DotsDecorator(
            size: const Size(6, 6),
            activeSize: const Size(20, 6),
            color: p.border,
            activeColor: p.primary,
            // Mandate §1.4 — the indicator is a bar, not a row of pills.
            shape: const RoundedRectangleBorder(borderRadius: AppRadius.input),
            activeShape:
                const RoundedRectangleBorder(borderRadius: AppRadius.input),
          ),
          controlsPadding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.xs, AppSpacing.md, AppSpacing.md),
        ),
      ),
    );
  }
}

/// Centres page content and caps its width. Without this the onboarding copy
/// stretched edge-to-edge and overflowed on tablets and desktop-sized
/// windows, clipping the last word of each line.
class _Constrain extends StatelessWidget {
  const _Constrain({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Align(alignment: Alignment.centerLeft, child: child),
      ),
    );
  }
}
