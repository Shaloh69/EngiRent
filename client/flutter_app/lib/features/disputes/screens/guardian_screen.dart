import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/services/api_service.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../auth/providers/auth_provider.dart';

/// Ruling 12 (2026-10-11): a parent or guardian on record, and the student's
/// acceptance that the guardian and UCLM may be contacted in a dispute.
///
/// Required for new accounts (profile setup) and asked of existing ones here.
/// The wording promises only what really happens: personnel contact the
/// guardian, and a report goes to UCLM, only after a dispute escalates.
class GuardianScreen extends StatefulWidget {
  const GuardianScreen({super.key});

  /// The Terms clause, shared with profile setup so both say the same thing.
  static const String termsClause =
      'If a rental I am part of is disputed and I do not resolve it by the deadline, EngiRent personnel may '
      'contact my parent or guardian on record, and may report the case to the UCLM Student Affairs Office, '
      'the Engineering Faculty and the Guidance Office. My details are shared only for that dispute, under '
      'the Data Privacy Act of 2012 (RA 10173).';

  @override
  State<GuardianScreen> createState() => _GuardianScreenState();
}

class _GuardianScreenState extends State<GuardianScreen> {
  final _name = TextEditingController();
  final _contact = TextEditingController();
  bool _consent = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final u = context.read<AuthProvider>().user;
    _name.text = u?.parentName ?? '';
    _contact.text = u?.parentContact ?? '';
  }

  @override
  void dispose() {
    _name.dispose();
    _contact.dispose();
    super.dispose();
  }

  bool get _valid =>
      _name.text.trim().length >= 2 && _contact.text.replaceAll(RegExp(r'\D'), '').length >= 7 && _consent;

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final r = await ApiService().put('/auth/profile', {
        'parentName': _name.text.trim(),
        'parentContact': _contact.text.trim(),
        'guardianConsent': true,
      });
      if (!mounted) return;
      if (r.statusCode == 200) {
        await context.read<AuthProvider>().loadUser();
        if (!mounted) return;
        AppToast.success(context, 'Saved', 'Your parent or guardian is on record.');
        Navigator.pop(context, true);
      } else {
        final b = jsonDecode(r.body) as Map<String, dynamic>;
        AppToast.error(context, 'Could not save', (b['error'] ?? b['message'] ?? 'Please check the details.') as String);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Could not save', friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Parent or guardian')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'EngiRent runs in partnership with the University of Cebu Lapu-Lapu and Mandaue (UCLM). Every '
            'student needs a parent or guardian on record.',
            style: TextStyle(height: 1.45),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Parent or guardian full name'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _contact,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Their contact number'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 16),
          CheckboxListTile(
            value: _consent,
            onChanged: (v) => setState(() => _consent = v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            title: const Text(GuardianScreen.termsClause, style: TextStyle(fontSize: 13, height: 1.4)),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _valid && !_saving ? _save : null,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            child: _saving
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Save'),
          ),
        ],
      ),
    );
  }
}
