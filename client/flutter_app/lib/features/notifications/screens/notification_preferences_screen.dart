import 'dart:convert';
import 'package:flutter/material.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/form_widgets.dart';

/// Checklist Stage 9 — `GET/PUT /notifications/preferences`. Mutable types
/// only (SYSTEM_ANNOUNCEMENT and the verification-outcome types are never
/// offered — those matter too much to bury), labelled in plain language.
/// Saves immediately per toggle (optimistic UI) rather than a separate
/// save step — this is a set of switches, not a form.
const _typeLabels = <String, String>{
  'BOOKING_CONFIRMED': 'Booking confirmations',
  'ITEM_READY_FOR_CLAIM': 'Item ready for pickup',
  'RENTAL_STARTED': 'Rental started',
  'RETURN_REMINDER': 'Return reminders',
  'RETURN_OVERDUE': 'Overdue return alerts',
  'PAYMENT_RECEIVED': 'Payment confirmations',
  'FEEDBACK_UPDATE': 'Feedback report updates',
};

class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() => _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState extends State<NotificationPreferencesScreen> {
  final _api = ApiService();
  bool _loading = true;
  String? _error;
  List<String> _mutableTypes = [];
  Set<String> _muted = {};
  final Set<String> _pending = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get('/notifications/preferences');
      final data = jsonDecode(resp.body);
      if (resp.statusCode == 200 && data['success'] == true) {
        setState(() {
          _mutableTypes = List<String>.from(data['data']['mutableTypes'] as List<dynamic>);
          _muted = Set<String>.from(data['data']['mutedTypes'] as List<dynamic>);
          _loading = false;
        });
      } else {
        setState(() {
          _loading = false;
          _error = data['error'] as String? ?? 'Could not load your preferences';
        });
      }
    } catch (e) {
      setState(() { _loading = false; _error = friendlyErrorMessage(e); });
    }
  }

  Future<void> _toggle(String type, bool enabled) async {
    final previous = Set<String>.from(_muted);
    setState(() {
      if (enabled) {
        _muted.remove(type);
      } else {
        _muted.add(type);
      }
      _pending.add(type);
    });
    try {
      final resp = await _api.put('/notifications/preferences', {'mutedTypes': _muted.toList()});
      final data = jsonDecode(resp.body);
      if (resp.statusCode != 200 || data['success'] != true) {
        throw Exception(data['error'] ?? 'Failed to save');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _muted = previous);
      AppToast.error(context, 'Could not save', friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _pending.remove(type));
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Notification Preferences')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: p.muted)),
                        const SizedBox(height: AppSpacing.sm),
                        OutlinedButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  children: [
                    NoticeBanner(
                      kind: NoticeKind.info,
                      message:
                          'These control what shows up in your Alerts tab. Account-security and '
                          'verification notices always come through.',
                      icon: Icons.info_outline_rounded,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Container(
                      decoration: BoxDecoration(
                        color: p.surface,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: p.border),
                      ),
                      child: Column(
                        children: [
                          for (final type in _mutableTypes) ...[
                            if (type != _mutableTypes.first)
                              Divider(height: 1, indent: AppSpacing.md, color: p.border),
                            SwitchListTile(
                              title: Text(
                                _typeLabels[type] ?? type,
                                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: p.ink),
                              ),
                              value: !_muted.contains(type),
                              onChanged: _pending.contains(type)
                                  ? null
                                  : (enabled) => _toggle(type, enabled),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}
