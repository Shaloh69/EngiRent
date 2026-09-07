import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'design_tokens.g.dart';

/// E3 design reference — Flutter surface.
///
/// The phase's definition of done asks for "a reference screen per surface that
/// renders every token and every status state". This is that screen for the
/// app, and like the admin console's it exists for a practical reason as much
/// as a checklist one: it is the only place the whole system is visible at
/// once, and it renders with **no network and no login**, which is what makes
/// the app's palette checkable at all. Reaching a rental status chip the normal
/// way needs a live tunnel, a verified account and a rental in the right state.
///
/// Reachable only in a debug build, via
/// `--dart-define=DESIGN_REFERENCE=1`. It is not routed from any screen and
/// ships to nobody.
class DesignReferenceScreen extends StatelessWidget {
  const DesignReferenceScreen({super.key});

  static const _roles = <String>[
    'brand', 'onBrand', 'success', 'warning', 'critical', 'review',
    'accent', 'cta', 'brandInk', 'successInk', 'warningInk', 'criticalInk',
    'reviewInk', 'accentInk', 'ctaInk', 'appBg', 'surface', 'surfaceAlt',
    'border', 'borderStrong', 'textPrimary', 'textSecondary', 'textDisabled',
  ];

  static Color _role(DesignTokens t, String name) => switch (name) {
        'brand' => t.brand,
        'onBrand' => t.onBrand,
        'success' => t.success,
        'warning' => t.warning,
        'critical' => t.critical,
        'review' => t.review,
        'accent' => t.accent,
        'cta' => t.cta,
        'brandInk' => t.brandInk,
        'successInk' => t.successInk,
        'warningInk' => t.warningInk,
        'criticalInk' => t.criticalInk,
        'reviewInk' => t.reviewInk,
        'accentInk' => t.accentInk,
        'ctaInk' => t.ctaInk,
        'appBg' => t.appBg,
        'surface' => t.surface,
        'surfaceAlt' => t.surfaceAlt,
        'border' => t.border,
        'borderStrong' => t.borderStrong,
        'textPrimary' => t.textPrimary,
        'textSecondary' => t.textSecondary,
        _ => t.textDisabled,
      };

  /// WCAG 2.1 relative luminance. Deliberately duplicated from the Node token
  /// toolchain — that runs at build time; this has to run on the device so the
  /// numbers shown are the ones actually rendering.
  static double _lum(Color c) {
    double ch(double s) =>
        s <= 0.03928 ? s / 12.92 : math.pow((s + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  static String _ratio(Color a, Color b) {
    final la = _lum(a), lb = _lum(b);
    final hi = la > lb ? la : lb;
    final lo = la > lb ? lb : la;
    return '${((hi + 0.05) / (lo + 0.05)).toStringAsFixed(2)}:1';
  }

  static String _hex(Color c) =>
      '#${((c.r * 255).round() << 16 | (c.g * 255).round() << 8 | (c.b * 255).round()).toRadixString(16).padLeft(6, '0').toUpperCase()}';

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final t = DesignTokens.of(brightness);
    final isDark = brightness == Brightness.dark;

    final byRole = <String, List<String>>{};
    kStatusRole.forEach((status, role) {
      byRole.putIfAbsent(role, () => []).add(status);
    });

    return Scaffold(
      backgroundColor: t.appBg,
      appBar: AppBar(
        backgroundColor: t.appBg,
        foregroundColor: t.textPrimary,
        title: Text('Token reference — ${isDark ? "dark" : "light"}'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Section(
            t: t,
            title: 'Semantic roles (${_roles.length})',
            subtitle: 'Contrast shown against this theme’s page ground.',
            child: Wrap(
              spacing: 12,
              runSpacing: 12,
              children: _roles.map((name) {
                final c = _role(t, name);
                return SizedBox(
                  width: 160,
                  child: Row(
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: c,
                          border: Border.all(color: t.border),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(name,
                                style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: t.textPrimary)),
                            Text(_hex(c),
                                style: TextStyle(
                                    fontSize: 10, color: t.textSecondary)),
                            Text(_ratio(c, t.appBg),
                                style: TextStyle(
                                    fontSize: 10, color: t.textSecondary)),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
          _Section(
            t: t,
            title: 'Status states (${kStatusRole.length})',
            subtitle:
                'One meaning across all four surfaces. The pending family is '
                'cyan-teal — never warning-yellow, never red.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: byRole.entries.map((e) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(e.key.toUpperCase(),
                          style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1,
                              color: t.textSecondary)),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: e.value
                            .map((s) => _Chip(status: s, t: t))
                            .toList(),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
          _Section(
            t: t,
            title: 'Unmapped status',
            subtitle:
                'Must not assert a meaning the system does not have, and must '
                'not fall through to a brand colour.',
            child: Align(
              alignment: Alignment.centerLeft,
              child: _Chip(status: 'SOME_FUTURE_STATE', t: t),
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.t,
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final DesignTokens t;
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: t.surface,
        border: Border.all(color: t.border),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: t.textPrimary)),
          const SizedBox(height: 2),
          Text(subtitle,
              style: TextStyle(fontSize: 12, color: t.textSecondary)),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

/// The status chip, rendered the way the design system says: a tinted fill with
/// the family's ink, never the fill hue as text.
class _Chip extends StatelessWidget {
  const _Chip({required this.status, required this.t});

  final String status;
  final DesignTokens t;

  @override
  Widget build(BuildContext context) {
    final ink = statusInk(status, t);
    final fill = statusColor(status, t);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: fill.withValues(alpha: 0.14),
        border: Border.all(color: fill.withValues(alpha: 0.34)),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Text(
        status.replaceAll('_', ' ').toLowerCase(),
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: ink),
      ),
    );
  }
}
