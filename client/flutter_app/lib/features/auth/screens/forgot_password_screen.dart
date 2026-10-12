import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_exceptions.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/animated_auth_background.dart';

/// Forgot password (2026-10-12, once the server could send email). Two steps
/// on one screen: the student's email, then the 6-digit code from that email
/// with a new password. The server decides everything (code life, tries,
/// resend gap) and its sentences are shown as they come. Pops with the email
/// so the login screen can fill it in.
class ForgotPasswordScreen extends StatefulWidget {
  final String? initialEmail;
  const ForgotPasswordScreen({super.key, this.initialEmail});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  static const _resendSeconds = 60;

  final _api = ApiService();
  final _emailForm = GlobalKey<FormState>();
  final _resetForm = GlobalKey<FormState>();
  late final TextEditingController _email =
      TextEditingController(text: widget.initialEmail ?? '');
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  bool _codeSent = false;
  bool _busy = false;
  bool _obscure = true;
  int _resendIn = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _email.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  /// The server's own sentence. Field validation arrives as a JSON list in
  /// `error`; the first message is the one worth showing.
  String _message(String body, String fallback) {
    try {
      final j = jsonDecode(body) as Map<String, dynamic>;
      final e = (j['error'] ?? j['message'] ?? fallback) as String;
      if (e.startsWith('[')) {
        final list = jsonDecode(e) as List;
        if (list.isNotEmpty) return (list.first as Map)['message'] as String;
      }
      return e;
    } catch (_) {
      return fallback;
    }
  }

  void _startCountdown() {
    _timer?.cancel();
    setState(() => _resendIn = _resendSeconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn--);
      if (_resendIn <= 0) t.cancel();
    });
  }

  Future<void> _sendCode() async {
    if (!_codeSent && !_emailForm.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final r = await _api.post(
        '/auth/forgot-password',
        {'email': _email.text.trim()},
        authenticated: false,
      );
      if (!mounted) return;
      if (r.statusCode == 200) {
        setState(() => _codeSent = true);
        _startCountdown();
        AppToast.info(context, 'Check your email', _message(r.body, 'A code is on its way.'));
      } else {
        AppToast.error(context, _message(r.body, 'Could not send the code'));
      }
    } on ApiUnreachableException catch (e) {
      if (mounted) AppToast.error(context, 'No connection', e.cause);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    if (!_resetForm.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final r = await _api.post(
        '/auth/reset-password',
        {
          'email': _email.text.trim(),
          'code': _code.text.trim(),
          'newPassword': _password.text,
        },
        authenticated: false,
      );
      if (!mounted) return;
      if (r.statusCode == 200) {
        AppToast.success(context, 'Password changed', 'Sign in with your new password.');
        Navigator.pop(context, _email.text.trim());
      } else {
        AppToast.error(context, _message(r.body, 'Could not change the password'));
      }
    } on ApiUnreachableException catch (e) {
      if (mounted) AppToast.error(context, 'No connection', e.cause);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _spinner() => const SizedBox(
        height: 20,
        width: 20,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final muted = isDark ? AppColors.textSecondaryDark : AppColors.textSecondary;

    return Scaffold(
      body: AnimatedAuthBackground(
        child: SafeArea(
          child: Stack(
            children: [
              Positioned(
                top: AppSpacing.xs,
                left: AppSpacing.xs,
                child: IconButton(
                  icon: const Icon(Icons.arrow_back_rounded),
                  tooltip: 'Back to sign in',
                  onPressed: () => Navigator.pop(context),
                ),
              ),
              Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                    vertical: AppSpacing.xl,
                  ),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 250),
                      child: _codeSent ? _resetStep(theme, muted) : _emailStep(theme, muted),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _emailStep(ThemeData theme, Color muted) {
    return Form(
      key: _emailForm,
      child: Column(
        key: const ValueKey('email-step'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Forgot password',
              style: theme.textTheme.headlineMedium?.copyWith(fontSize: 30, letterSpacing: -0.6)),
          const SizedBox(height: AppSpacing.hair),
          Text(
            'Enter the email you signed up with. We will send a 6-digit code to it.',
            style: theme.textTheme.bodyMedium?.copyWith(color: muted),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            onFieldSubmitted: (_) => _busy ? null : _sendCode(),
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'you@uclm.edu.ph',
              prefixIcon: Icon(Icons.mail_outline, size: 19),
            ),
            validator: (v) {
              final value = (v ?? '').trim();
              if (value.isEmpty) return 'Email is required';
              if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value)) {
                return 'Enter a valid email address';
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          ElevatedButton(
            onPressed: _busy ? null : _sendCode,
            child: _busy ? _spinner() : const Text('Send code'),
          ),
        ],
      ),
    );
  }

  Widget _resetStep(ThemeData theme, Color muted) {
    return Form(
      key: _resetForm,
      child: Column(
        key: const ValueKey('reset-step'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Enter the code',
              style: theme.textTheme.headlineMedium?.copyWith(fontSize: 30, letterSpacing: -0.6)),
          const SizedBox(height: AppSpacing.hair),
          Text(
            'We sent a 6-digit code to ${_email.text.trim()}. It works for 15 minutes. '
            'Not there? Check Spam.',
            style: theme.textTheme.bodyMedium?.copyWith(color: muted),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _code,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(
              labelText: '6-digit code',
              prefixIcon: Icon(Icons.pin_outlined, size: 19),
            ),
            validator: (v) =>
                (v ?? '').trim().length == 6 ? null : 'Enter the 6-digit code from the email',
          ),
          const SizedBox(height: AppSpacing.sm),
          TextFormField(
            controller: _password,
            obscureText: _obscure,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.newPassword],
            decoration: InputDecoration(
              labelText: 'New password',
              prefixIcon: const Icon(Icons.lock_outline, size: 19),
              suffixIcon: IconButton(
                icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 19),
                tooltip: _obscure ? 'Show password' : 'Hide password',
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ),
            validator: (v) =>
                (v ?? '').length >= 8 ? null : 'Use at least 8 characters',
          ),
          const SizedBox(height: AppSpacing.sm),
          TextFormField(
            controller: _confirm,
            obscureText: _obscure,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _busy ? null : _reset(),
            decoration: const InputDecoration(
              labelText: 'Confirm new password',
              prefixIcon: Icon(Icons.lock_outline, size: 19),
            ),
            validator: (v) => v == _password.text ? null : 'The passwords do not match',
          ),
          const SizedBox(height: AppSpacing.lg),
          ElevatedButton(
            onPressed: _busy ? null : _reset,
            child: _busy ? _spinner() : const Text('Change password'),
          ),
          const SizedBox(height: AppSpacing.sm),
          TextButton(
            onPressed: (_busy || _resendIn > 0) ? null : _sendCode,
            child: Text(_resendIn > 0 ? 'Send a new code in ${_resendIn}s' : 'Send a new code'),
          ),
          TextButton(
            onPressed: _busy
                ? null
                : () {
                    _timer?.cancel();
                    setState(() {
                      _codeSent = false;
                      _resendIn = 0;
                      _code.clear();
                    });
                  },
            child: const Text('Use a different email'),
          ),
        ],
      ),
    );
  }
}
