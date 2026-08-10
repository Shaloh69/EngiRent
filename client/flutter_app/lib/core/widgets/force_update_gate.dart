import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../constants/app_colors.dart';
import '../services/api_service.dart';
import '../theme/tokens.dart';
import 'app_widgets.dart';

/// Checklist Stage 9 — force-update gate, "for an app that moves money and
/// opens doors". Originally blocked only below `minVersion`; a follow-up
/// request asked for a hard block on *any* version behind `latestVersion`,
/// so every user is always running the current build — not just clear of
/// some older, separately-tracked floor. `minVersion` still exists
/// server-side (as a documented floor, and for anyone reading `/app-config`
/// directly), but this gate now compares against `latestVersion`, which is
/// strictly the stronger condition.
///
/// `GET /app-config` (public, no auth) also returns real content for this
/// screen — `highlights` (what's actually in the new build, sourced from
/// `AppRelease`) and `creditedFixes` (real, resolved bug reports whose
/// `fixedInVersion` matches, crediting the reporter by name) — not just a
/// bare version number. `downloadUrl` points at the real distribution path
/// (the web download flow's `/downloading` page) rather than a Play Store
/// listing EngiRent doesn't have.
///
/// The check itself is best-effort and never blocks startup — a failed
/// fetch (offline, server unreachable) just lets the app through normally,
/// same as any other "can't reach the server yet" moment this app already
/// tolerates.
class ForceUpdateGate extends StatefulWidget {
  const ForceUpdateGate({super.key, required this.child});
  final Widget child;

  @override
  State<ForceUpdateGate> createState() => _ForceUpdateGateState();
}

class CreditedFix {
  final String reporterName;
  final String summary;
  const CreditedFix({required this.reporterName, required this.summary});
}

class _ForceUpdateGateState extends State<ForceUpdateGate> {
  String? _latestVersion;
  String? _blockMessage;
  String? _downloadUrl;
  List<String> _highlights = const [];
  List<CreditedFix> _creditedFixes = const [];

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final resp = await ApiService().get('/app-config', authenticated: false);
      if (resp.statusCode != 200) return;
      final data = jsonDecode(resp.body);
      final config = data['data'] as Map<String, dynamic>?;
      final latestVersion = config?['latestVersion'] as String?;
      if (latestVersion == null) return;

      final info = await PackageInfo.fromPlatform();
      if (_isBelow(info.version, latestVersion) && mounted) {
        setState(() {
          _latestVersion = latestVersion;
          _blockMessage = config?['forceUpdateMessage'] as String? ??
              'A new version of EngiRent is available.';
          _downloadUrl = config?['downloadUrl'] as String?;
          _highlights = (config?['highlights'] as List<dynamic>? ?? [])
              .map((e) => e.toString())
              .toList();
          _creditedFixes = (config?['creditedFixes'] as List<dynamic>? ?? [])
              .map((e) => CreditedFix(
                    reporterName: (e as Map<String, dynamic>)['reporterName'] as String? ?? 'A student',
                    summary: e['summary'] as String? ?? '',
                  ))
              .toList();
        });
      }
    } catch (_) {
      // Never block startup on a failed/offline check.
    }
  }

  /// Simple numeric component-by-component comparison — "1.4.9" < "1.5.0",
  /// "1.5.2" is not < "1.5.2", missing trailing components treated as 0
  /// ("1.5" == "1.5.0"). Not full semver (no pre-release/build-metadata
  /// handling), which this app's plain `MAJOR.MINOR.PATCH` versions don't
  /// need.
  static bool _isBelow(String installed, String minimum) {
    final a = installed.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    final b = minimum.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    for (var i = 0; i < (a.length > b.length ? a.length : b.length); i++) {
      final av = i < a.length ? a[i] : 0;
      final bv = i < b.length ? b[i] : 0;
      if (av != bv) return av < bv;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    if (_blockMessage == null) return widget.child;
    return _UpdateRequiredScreen(
      version: _latestVersion!,
      message: _blockMessage!,
      downloadUrl: _downloadUrl,
      highlights: _highlights,
      creditedFixes: _creditedFixes,
    );
  }
}

class _UpdateRequiredScreen extends StatelessWidget {
  const _UpdateRequiredScreen({
    required this.version,
    required this.message,
    required this.downloadUrl,
    required this.highlights,
    required this.creditedFixes,
  });

  final String version;
  final String message;
  final String? downloadUrl;
  final List<String> highlights;
  final List<CreditedFix> creditedFixes;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  children: [
                    const SizedBox(height: AppSpacing.lg),
                    Icon(Icons.system_update_rounded, size: 64, color: AppColors.primary),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      'New version released',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Please update through this page to download the new version.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: p.muted),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(message, textAlign: TextAlign.center, style: TextStyle(color: p.muted, fontSize: 13)),
                    const SizedBox(height: AppSpacing.lg),

                    if (highlights.isNotEmpty) ...[
                      Row(
                        children: [
                          const SectionLabel('WHAT\'S NEW'),
                          const SizedBox(width: AppSpacing.xs),
                          StatusPill(label: 'v$version', color: AppColors.primary, dense: true),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (final h in highlights) ...[
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.only(top: 6),
                                    child: Container(
                                      width: 6, height: 6,
                                      decoration: BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                                    ),
                                  ),
                                  const SizedBox(width: AppSpacing.sm),
                                  Expanded(child: Text(h, style: TextStyle(color: p.ink, fontSize: 14))),
                                ],
                              ),
                              if (h != highlights.last) const SizedBox(height: AppSpacing.xs),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                    ],

                    // Special mention — the explicitly-requested part: real
                    // students, credited by name, for a real bug they
                    // reported that's actually fixed in this build.
                    if (creditedFixes.isNotEmpty) ...[
                      const SectionLabel('SPECIAL MENTION'),
                      const SizedBox(height: AppSpacing.sm),
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (final f in creditedFixes) ...[
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(Icons.bug_report_outlined, size: 16, color: AppColors.success),
                                  const SizedBox(width: AppSpacing.sm),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text.rich(
                                          TextSpan(
                                            children: [
                                              TextSpan(
                                                text: f.reporterName,
                                                style: TextStyle(fontWeight: FontWeight.w700, color: p.ink, fontSize: 13.5),
                                              ),
                                              TextSpan(
                                                text: ' noticed this — ',
                                                style: TextStyle(color: p.muted, fontSize: 13.5),
                                              ),
                                              const TextSpan(
                                                text: 'Resolved',
                                                style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.success, fontSize: 13.5),
                                              ),
                                            ],
                                          ),
                                        ),
                                        if (f.summary.isNotEmpty) ...[
                                          const SizedBox(height: 2),
                                          Text(f.summary, style: TextStyle(color: p.muted, fontSize: 12.5)),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              if (f != creditedFixes.last) const SizedBox(height: AppSpacing.sm),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: downloadUrl == null
                        ? null
                        : () => launchUrl(Uri.parse(downloadUrl!), mode: LaunchMode.externalApplication),
                    icon: const Icon(Icons.open_in_new_rounded),
                    label: const Text('Download the new version'),
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
