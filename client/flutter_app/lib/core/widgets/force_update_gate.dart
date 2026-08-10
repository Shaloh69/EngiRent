import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../theme/tokens.dart';

/// Checklist Stage 9 — force-update gate, "for an app that moves money and
/// opens doors". `GET /app-config` (public, no auth) returns the server's
/// current `minVersion`/`latestVersion`/`forceUpdateMessage`; if the
/// installed build is below `minVersion`, this blocks the whole app behind
/// a non-dismissible screen rather than letting an unsupported build keep
/// making requests a since-changed API contract might not handle safely.
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

class _ForceUpdateGateState extends State<ForceUpdateGate> {
  String? _blockMessage;

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
      final minVersion = data['data']?['minVersion'] as String?;
      final message = data['data']?['forceUpdateMessage'] as String?;
      if (minVersion == null) return;

      final info = await PackageInfo.fromPlatform();
      if (_isBelow(info.version, minVersion) && mounted) {
        setState(() => _blockMessage =
            message ?? 'Please update EngiRent to continue — this version is no longer supported.');
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
    return _ForceUpdateScreen(message: _blockMessage!);
  }
}

class _ForceUpdateScreen extends StatelessWidget {
  const _ForceUpdateScreen({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.system_update_rounded, size: 64),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    'Update required',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(message, textAlign: TextAlign.center),
                  const SizedBox(height: AppSpacing.lg),
                  FilledButton.icon(
                    onPressed: () => launchUrl(
                      // Placeholder store URL — EngiRent has no published
                      // store listing yet; this becomes the real one once
                      // it does.
                      Uri.parse('https://play.google.com/store/apps/details?id=com.engirent.app'),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.open_in_new_rounded),
                    label: const Text('Update now'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
