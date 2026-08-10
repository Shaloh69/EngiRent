import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/form_widgets.dart';
import '../models/auth_service.dart';
import '../providers/auth_provider.dart';

/// Checklist Stage 9 — `PUT /auth/profile` existed and was called by
/// nothing; the only "profile editing" anywhere in the app was Payout
/// Details. This is the rest of it: name and phone number (the fields
/// that actually change after signup — email/studentId are the identity
/// keys and deliberately not editable here, matching what the endpoint
/// itself accepts).
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstNameCtrl = TextEditingController();
  final _lastNameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _service = AuthService();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final user = context.read<AuthProvider>().user;
    _firstNameCtrl.text = user?.firstName ?? '';
    _lastNameCtrl.text = user?.lastName ?? '';
    _phoneCtrl.text = user?.phoneNumber ?? '';
  }

  @override
  void dispose() {
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final result = await _service.updateProfile(
      firstName: _firstNameCtrl.text.trim(),
      lastName: _lastNameCtrl.text.trim(),
      phoneNumber: _phoneCtrl.text.trim(),
    );

    if (!mounted) return;
    setState(() => _saving = false);

    if (result['success'] == true) {
      await context.read<AuthProvider>().loadUser();
      if (!mounted) return;
      AppToast.success(context, 'Profile updated', 'Your changes have been saved.');
      Navigator.pop(context);
    } else {
      AppToast.error(context, 'Could not save changes',
          (result['error'] as String?) ?? 'Please try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Edit Profile')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
          children: [
            FormSection(
              title: 'Your details',
              icon: Icons.person_outline_rounded,
              children: [
                AppField(
                  label: 'First name',
                  controller: _firstNameCtrl,
                  textCapitalization: TextCapitalization.words,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                AppField(
                  label: 'Last name',
                  controller: _lastNameCtrl,
                  textCapitalization: TextCapitalization.words,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                AppField(
                  label: 'Phone number',
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
              ],
            ),
            const NoticeBanner(
              kind: NoticeKind.info,
              message:
                  'Email and Student ID can\'t be changed here — contact support if either '
                  'is wrong.',
              icon: Icons.info_outline_rounded,
            ),
          ],
        ),
      ),
      bottomNavigationBar: StickyActionBar(
        label: 'Save changes',
        icon: Icons.check_rounded,
        busy: _saving,
        onPressed: _save,
      ),
    );
  }
}
