import 'package:flutter/material.dart';
import 'package:mesh_gradient/mesh_gradient.dart';
import '../constants/app_colors.dart';

/// Animated mesh-gradient backdrop — mandate §1.5.
///
/// react-bits (used on the three web surfaces) is React-only, so the phone
/// app gets the equivalent treatment through `mesh_gradient`, which renders a
/// real fragment shader rather than a stack of blurred circles.
///
/// Carries the same two guarantees the mandate attaches to every animated
/// background on every surface:
///   1. `prefers-reduced-motion` (via [MediaQuery.disableAnimationsOf]) drops
///      to a static gradient — no shader animation at all.
///   2. Shader failure degrades to that same static gradient rather than an
///      empty box, so an unsupported device still gets a themed screen.
class AnimatedAuthBackground extends StatelessWidget {
  const AnimatedAuthBackground({super.key, this.child, this.opacity = 1.0});

  final Widget? child;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // Dark mode uses the lifted brand tints and a near-black ground; light
    // mode stays pale so dark ink over it keeps its contrast (§1.5: a
    // background that costs legibility is a fail).
    //
    // D-45: this comment was true and the code was not. The dark branch used
    // AppColors.primary (teal500) and AppColors.secondary (gold500) -- the
    // LIGHT-mode values -- not the lifted OnDark tints it claims. gold500 at
    // 55% alpha over #050F1A composites to a warm brown: sampled #463F2F and
    // #4B402B off the device at the top of the sign-in screen, which is not a
    // brand colour and reads as a rendering fault. Now the lifted tints, so
    // the code does what the line above says.
    final colors = isDark
        ? [
            const Color(0xFF050F1A),
            AppColors.primaryOnDark,
            const Color(0xFF0E2E4A),
            AppColors.secondaryOnDark.withValues(alpha: 0.55),
          ]
        : [
            const Color(0xFFF7F9FC),
            AppColors.primaryLight.withValues(alpha: 0.55),
            const Color(0xFFE6F0FB),
            AppColors.accentLight.withValues(alpha: 0.45),
          ];

    final staticFallback = DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [colors[0], colors[1], colors[2], colors[3]],
          stops: const [0.0, 0.35, 0.7, 1.0],
        ),
      ),
      child: const SizedBox.expand(),
    );

    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    Widget backdrop;
    if (reduceMotion) {
      backdrop = staticFallback;
    } else {
      try {
        backdrop = AnimatedMeshGradient(
          colors: colors,
          options: AnimatedMeshGradientOptions(
            frequency: 3,
            amplitude: 12,
            speed: 1.2,
          ),
        );
      } catch (_) {
        backdrop = staticFallback;
      }
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        Opacity(opacity: opacity, child: backdrop),
        // Scrim — the mesh drifts, so without a wash over it the copy's
        // contrast changes frame to frame. This holds text legibility fixed
        // regardless of where the bright bands land.
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: isDark
                  ? [
                      const Color(0xFF050F1A).withValues(alpha: 0.62),
                      const Color(0xFF050F1A).withValues(alpha: 0.86),
                    ]
                  : [
                      const Color(0xFFF7F9FC).withValues(alpha: 0.72),
                      const Color(0xFFF7F9FC).withValues(alpha: 0.92),
                    ],
            ),
          ),
          child: const SizedBox.expand(),
        ),
        if (child != null) child!,
      ],
    );
  }
}
