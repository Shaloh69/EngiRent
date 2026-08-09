import 'package:flutter/material.dart';
import '../constants/app_colors.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';

/// Shared primitives — mandate §2.1.
///
/// Screens compose from these rather than each hand-rolling a Container with
/// its own padding and radius. That's the whole point: spacing and radius
/// can't drift per screen if no screen defines them.

/// Resolves the palette-tinted neutrals for the active brightness. Every
/// widget below reads from this instead of branching on `isDark` inline, so
/// there's one place where "what is a border in dark mode" is answered.
class AppPalette {
  final bool isDark;
  const AppPalette(this.isDark);

  factory AppPalette.of(BuildContext context) =>
      AppPalette(Theme.of(context).brightness == Brightness.dark);

  Color get surface =>
      isDark ? AppColors.surfaceDarkMode : AppColors.surface;
  Color get surfaceAlt =>
      isDark ? AppColors.surfaceAltDarkMode : const Color(0xFFEEF4FB);
  Color get border => isDark ? AppColors.borderDarkMode : AppColors.border;
  Color get ink => isDark ? AppColors.textPrimaryDark : AppColors.textPrimary;
  Color get muted =>
      isDark ? AppColors.textSecondaryDark : AppColors.textSecondary;
  Color get primary => isDark ? AppColors.primaryOnDark : AppColors.primary;
  Color get secondary =>
      isDark ? AppColors.secondaryOnDark : AppColors.secondary;
  Color get accent => isDark ? AppColors.accentOnDark : AppColors.accent;
}

/// A bordered panel. Mandate §1.4 — borders do the work shadows used to, so
/// this has a 1px palette-tinted edge and no elevation.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md),
    this.onTap,
    this.color,
    this.borderColor,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? p.surface,
        borderRadius: AppRadius.card,
        border: Border.all(color: borderColor ?? p.border),
      ),
      child: child,
    );

    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.card,
        child: content,
      ),
    );
  }
}

/// Small state label. Deliberately not a pill (§1.4) — 2px corners, uppercase
/// mono, tinted background derived from a single semantic colour.
class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    required this.color,
    this.dense = false,
  });

  final String label;
  final Color color;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? AppSpacing.hair + 2 : AppSpacing.xs,
        vertical: dense ? 2 : AppSpacing.hair,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: AppRadius.input,
        border: Border.all(color: color.withValues(alpha: 0.34)),
      ),
      child: Text(
        label.toUpperCase(),
        style: AppTheme.mono(
          fontSize: dense ? 9 : 10,
          fontWeight: FontWeight.w600,
          color: color,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}

/// Numerals, IDs, currency, countdowns — mandate §1.2 requires all of these
/// in IBM Plex Mono with tabular figures. Having a widget for it makes the
/// rule cheap to follow, which is the only way a rule like this survives.
class MonoText extends StatelessWidget {
  const MonoText(
    this.text, {
    super.key,
    this.size = 14,
    this.weight = FontWeight.w600,
    this.color,
    this.letterSpacing,
  });

  final String text;
  final double size;
  final FontWeight weight;
  final Color? color;
  final double? letterSpacing;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppTheme.mono(
        fontSize: size,
        fontWeight: weight,
        color: color ?? AppPalette.of(context).ink,
        letterSpacing: letterSpacing,
      ),
    );
  }
}

/// Section label above a group of content. Mono + wide tracking, so sections
/// read as instrument panel headings rather than generic bold text.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.xs),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text.toUpperCase(),
              style: AppTheme.mono(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: p.muted,
                letterSpacing: 1.6,
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Labelled key/value row — used anywhere a screen lists facts about a
/// rental, item or payout. Values default to mono since they're almost
/// always amounts, dates or identifiers.
class InfoRow extends StatelessWidget {
  const InfoRow({
    super.key,
    required this.label,
    required this.value,
    this.mono = true,
    this.valueColor,
  });

  final String label;
  final String value;
  final bool mono;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 13, color: p.muted),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          mono
              ? MonoText(value, size: 13, color: valueColor ?? p.ink)
              : Text(
                  value,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: valueColor ?? p.ink,
                  ),
                ),
        ],
      ),
    );
  }
}

/// Consistent empty state. Mandate §3 makes the equivalent point for charts:
/// an empty result must still render a real component, not collapse to bare
/// text — the same reasoning applies to lists.
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.body,
    this.action,
  });

  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: 52,
              width: 52,
              decoration: BoxDecoration(
                color: p.surfaceAlt,
                borderRadius: AppRadius.card,
                border: Border.all(color: p.border),
              ),
              child: Icon(icon, color: p.muted, size: 24),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            if (body != null) ...[
              const SizedBox(height: AppSpacing.hair),
              Text(
                body!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: p.muted),
              ),
            ],
            if (action != null) ...[
              const SizedBox(height: AppSpacing.lg),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// Staggered entrance for lists and grids, so content assembles instead of
/// appearing as one block. Matches the timing used on the web surfaces.
class Stagger extends StatelessWidget {
  const Stagger({super.key, required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: AppMotion.slow,
      curve: Interval(
        (index * 0.06).clamp(0.0, 0.5),
        1.0,
        curve: AppMotion.ease,
      ),
      builder: (context, t, c) => Opacity(
        opacity: t,
        child: Transform.translate(offset: Offset(0, 14 * (1 - t)), child: c),
      ),
      child: child,
    );
  }
}
