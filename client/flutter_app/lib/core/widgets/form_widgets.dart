import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../constants/app_colors.dart';
import '../theme/tokens.dart';
import 'app_widgets.dart';

/// Shared form kit — mandate §2.2.
///
/// Every form screen in the app previously repeated the same pattern by hand:
/// a bare label `Text`, a `TextFormField` with `OutlineInputBorder()`, and a
/// `SizedBox(height: 20)`. That produced inconsistent spacing, no grouping,
/// and a submit button that scrolled off the bottom of long forms so users
/// couldn't tell the screen was actionable.
///
/// These primitives replace that: fields are grouped into titled sections so
/// a long form reads as a few short ones, and the primary action is pinned to
/// the bottom where it's always reachable.

/// A titled group of fields. Grouping is what makes a 9-field form feel like
/// three small decisions instead of one long interrogation.
class FormSection extends StatelessWidget {
  const FormSection({
    super.key,
    required this.title,
    required this.children,
    this.caption,
    this.icon,
  });

  final String title;
  final String? caption;
  final IconData? icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 14, color: p.primary),
              const SizedBox(width: AppSpacing.hair + 2),
            ],
            Expanded(child: SectionLabel(title)),
          ],
        ),
        if (caption != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.xs),
            child: Text(
              caption!,
              style: TextStyle(fontSize: 12, height: 1.4, color: p.muted),
            ),
          ),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) const SizedBox(height: AppSpacing.md),
                children[i],
              ],
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
      ],
    );
  }
}

/// A labelled text field. The label sits above the field rather than floating
/// inside it — floating labels disappear once a field has content, which is
/// exactly when someone reviewing a filled-in form needs to read them.
class AppField extends StatelessWidget {
  const AppField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.helper,
    this.prefix,
    this.suffix,
    this.keyboardType,
    this.maxLines = 1,
    this.maxLength,
    this.validator,
    this.inputFormatters,
    this.enabled = true,
    this.textCapitalization = TextCapitalization.none,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? helper;
  final String? prefix;
  final Widget? suffix;
  final TextInputType? keyboardType;
  final int maxLines;
  final int? maxLength;
  final String? Function(String?)? validator;
  final List<TextInputFormatter>? inputFormatters;
  final bool enabled;
  final TextCapitalization textCapitalization;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: p.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.hair + 2),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          maxLines: maxLines,
          maxLength: maxLength,
          validator: validator,
          enabled: enabled,
          inputFormatters: inputFormatters,
          textCapitalization: textCapitalization,
          onChanged: onChanged,
          style: TextStyle(fontSize: 14, color: p.ink),
          decoration: InputDecoration(
            hintText: hint,
            prefixText: prefix,
            suffixIcon: suffix,
            counterText: '',
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: AppSpacing.sm,
            ),
          ),
        ),
        if (helper != null)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(
              helper!,
              style: TextStyle(fontSize: 11.5, height: 1.35, color: p.muted),
            ),
          ),
      ],
    );
  }
}

/// A labelled tappable row that opens a picker (date range, category sheet,
/// locker list). Looks like a field so a form doesn't visually break where a
/// value happens to come from a sheet rather than the keyboard.
class AppPickerField extends StatelessWidget {
  const AppPickerField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.placeholder = 'Select',
    this.icon = Icons.expand_more_rounded,
    this.helper,
    this.hasValue = true,
    this.error,
  });

  final String label;
  final String value;
  final String placeholder;
  final IconData icon;
  final String? helper;
  final bool hasValue;
  final String? error;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: p.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.hair + 2),
        InkWell(
          onTap: onTap,
          borderRadius: AppRadius.input,
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: AppSpacing.sm + 2,
            ),
            decoration: BoxDecoration(
              color: p.isDark ? p.surfaceAlt : Colors.white,
              borderRadius: AppRadius.input,
              border: Border.all(
                color: error != null ? AppColors.error : p.border,
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    hasValue ? value : placeholder,
                    style: TextStyle(
                      fontSize: 14,
                      color: hasValue ? p.ink : p.muted,
                    ),
                  ),
                ),
                Icon(icon, size: 18, color: p.muted),
              ],
            ),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(
              error!,
              style: const TextStyle(fontSize: 11.5, color: AppColors.error),
            ),
          )
        else if (helper != null)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(
              helper!,
              style: TextStyle(fontSize: 11.5, height: 1.35, color: p.muted),
            ),
          ),
      ],
    );
  }
}

/// Inline notice. Four intents, one shape — so "your deposit is refundable"
/// and "this rental is overdue" don't need two different-looking boxes.
enum NoticeKind { info, success, warning, danger }

class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.message,
    this.kind = NoticeKind.info,
    this.title,
    this.icon,
  });

  final String message;
  final String? title;
  final NoticeKind kind;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final (color, fallbackIcon) = switch (kind) {
      NoticeKind.info => (p.primary, Icons.info_outline_rounded),
      NoticeKind.success => (AppColors.success, Icons.check_circle_outline),
      NoticeKind.warning => (AppColors.warning, Icons.warning_amber_rounded),
      NoticeKind.danger => (AppColors.error, Icons.error_outline_rounded),
    };

    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: color.withValues(alpha: p.isDark ? 0.12 : 0.08),
        borderRadius: AppRadius.input,
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon ?? fallbackIcon, size: 17, color: color),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null) ...[
                  Text(
                    title!,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: p.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                ],
                Text(
                  message,
                  style: TextStyle(fontSize: 12, height: 1.45, color: p.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Bottom action bar pinned above the safe area. On long forms the submit
/// button used to scroll away entirely; here it stays put, and can carry a
/// summary line (a running total, a validation hint) beside it.
class StickyActionBar extends StatelessWidget {
  const StickyActionBar({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.summaryLabel,
    this.summaryValue,
    this.secondary,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final String? summaryLabel;
  final String? summaryValue;
  final Widget? secondary;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Container(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.sm + MediaQuery.paddingOf(context).bottom,
      ),
      decoration: BoxDecoration(
        color: p.surface,
        border: Border(top: BorderSide(color: p.border)),
      ),
      child: Row(
        children: [
          if (summaryValue != null) ...[
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  summaryLabel ?? 'Total',
                  style: TextStyle(fontSize: 11, color: p.muted),
                ),
                MonoText(summaryValue!, size: 17, color: p.ink),
              ],
            ),
            const SizedBox(width: AppSpacing.md),
          ],
          if (secondary != null) ...[
            secondary!,
            const SizedBox(width: AppSpacing.xs),
          ],
          Expanded(
            child: SizedBox(
              height: 46,
              child: ElevatedButton(
                onPressed: busy ? null : onPressed,
                child: busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          if (icon != null) ...[
                            Icon(icon, size: 17),
                            const SizedBox(width: AppSpacing.xs),
                          ],
                          Text(
                            label,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 14.5,
                            ),
                          ),
                        ],
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A single line in a cost breakdown. Amounts are mono and tabular so the
/// decimal points line up down the column — the whole point of a receipt.
class CostRow extends StatelessWidget {
  const CostRow({
    super.key,
    required this.label,
    required this.amount,
    this.note,
    this.emphasis = false,
    this.color,
  });

  final String label;
  final String amount;
  final String? note;
  final bool emphasis;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: emphasis ? 14 : 13,
                    fontWeight: emphasis ? FontWeight.w700 : FontWeight.w500,
                    color: emphasis ? p.ink : p.muted,
                  ),
                ),
                if (note != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Text(
                      note!,
                      style: TextStyle(fontSize: 11, color: p.muted),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          MonoText(
            amount,
            size: emphasis ? 16 : 13.5,
            color: color ?? (emphasis ? p.primary : p.ink),
          ),
        ],
      ),
    );
  }
}

/// Hairline divider used inside cost breakdowns and grouped rows.
class ThinDivider extends StatelessWidget {
  const ThinDivider({super.key, this.vertical = AppSpacing.xs});
  final double vertical;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: vertical),
      child: Divider(height: 1, thickness: 1, color: AppPalette.of(context).border),
    );
  }
}

/// Numbered step header for multi-stage flows (profile setup, kiosk scan).
/// Shows position in the flow so a camera screen doesn't feel like a dead end.
class StepHeader extends StatelessWidget {
  const StepHeader({
    super.key,
    required this.step,
    required this.total,
    required this.title,
    this.subtitle,
  });

  final int step;
  final int total;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            for (var i = 1; i <= total; i++) ...[
              Expanded(
                child: AnimatedContainer(
                  duration: AppMotion.base,
                  curve: AppMotion.ease,
                  height: 3,
                  decoration: BoxDecoration(
                    color: i <= step ? p.primary : p.border,
                    borderRadius: AppRadius.circle,
                  ),
                ),
              ),
              if (i < total) const SizedBox(width: AppSpacing.hair),
            ],
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        MonoText('STEP $step OF $total', size: 10.5, color: p.primary),
        const SizedBox(height: 3),
        Text(
          title,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            height: 1.15,
            letterSpacing: -0.4,
            color: p.ink,
          ),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: AppSpacing.hair),
          Text(
            subtitle!,
            style: TextStyle(fontSize: 13, height: 1.45, color: p.muted),
          ),
        ],
      ],
    );
  }
}
