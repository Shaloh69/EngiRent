import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/animated_auth_background.dart';
import '../../../core/widgets/app_widgets.dart';
import '../providers/auth_provider.dart';

/// Register — the second of §2.1's named auth deliverables.
///
/// Presentation rebuilt; `_handleRegister` and the AuthProvider call are
/// unchanged. What's new: the animated background, a progress indicator that
/// makes a six-field form feel finite, grouped sections instead of one flat
/// column, real per-field validation (the previous version validated most
/// fields with a bare "Required"), and correct rendering in both themes.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _studentIdController = TextEditingController();
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _phoneController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void initState() {
    super.initState();
    // Drives the completion meter — every field feeds the same listener so
    // the count can't drift from the actual field list.
    for (final c in [
      _emailController,
      _passwordController,
      _studentIdController,
      _firstNameController,
      _lastNameController,
      _phoneController,
    ]) {
      c.addListener(_onChanged);
    }
  }

  void _onChanged() => setState(() {});

  int get _filledCount => [
        _firstNameController,
        _lastNameController,
        _studentIdController,
        _phoneController,
        _emailController,
        _passwordController,
      ].where((c) => c.text.trim().isNotEmpty).length;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _studentIdController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;
    final authProvider = context.read<AuthProvider>();
    final success = await authProvider.register(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      studentId: _studentIdController.text.trim(),
      firstName: _firstNameController.text.trim(),
      lastName: _lastNameController.text.trim(),
      phoneNumber: _phoneController.text.trim(),
    );

    if (!mounted) return;
    if (success) {
      // Profile setup (face + ID camera) is required before accessing home
      Navigator.pushReplacementNamed(context, '/profile/setup');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(authProvider.error ?? 'Registration failed')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final theme = Theme.of(context);
    const total = 6;

    return Scaffold(
      body: AnimatedAuthBackground(
        child: SafeArea(
          child: CustomScrollView(
            slivers: [
              SliverAppBar(
                pinned: true,
                backgroundColor: Colors.transparent,
                surfaceTintColor: Colors.transparent,
                title: const Text('Create account'),
                leading: IconButton(
                  icon: const Icon(Icons.arrow_back, size: 20),
                  tooltip: 'Back',
                  onPressed: () => Navigator.pop(context),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    0,
                    AppSpacing.lg,
                    AppSpacing.xl,
                  ),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 460),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Completion meter — mono counter plus a real bar,
                          // so a long form reads as finite rather than endless.
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'Join with your UCLM student account.',
                                  style: TextStyle(fontSize: 13, color: p.muted),
                                ),
                              ),
                              MonoText(
                                '$_filledCount/$total',
                                size: 12,
                                color: _filledCount == total
                                    ? p.primary
                                    : p.muted,
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          ClipRRect(
                            borderRadius: AppRadius.input,
                            child: TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0, end: _filledCount / total),
                              duration: AppMotion.base,
                              curve: AppMotion.ease,
                              builder: (context, v, _) => LinearProgressIndicator(
                                value: v,
                                minHeight: 3,
                                backgroundColor: p.border,
                                valueColor:
                                    AlwaysStoppedAnimation<Color>(p.primary),
                              ),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.lg),

                          const SectionLabel('Your details'),
                          AppCard(
                            child: Column(
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: TextFormField(
                                        controller: _firstNameController,
                                        textCapitalization:
                                            TextCapitalization.words,
                                        decoration: const InputDecoration(
                                          labelText: 'First name',
                                        ),
                                        validator: (v) =>
                                            (v == null || v.trim().isEmpty)
                                                ? 'Required'
                                                : null,
                                      ),
                                    ),
                                    const SizedBox(width: AppSpacing.sm),
                                    Expanded(
                                      child: TextFormField(
                                        controller: _lastNameController,
                                        textCapitalization:
                                            TextCapitalization.words,
                                        decoration: const InputDecoration(
                                          labelText: 'Last name',
                                        ),
                                        validator: (v) =>
                                            (v == null || v.trim().isEmpty)
                                                ? 'Required'
                                                : null,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                TextFormField(
                                  controller: _studentIdController,
                                  decoration: const InputDecoration(
                                    labelText: 'Student ID',
                                    hintText: '2021-00001',
                                    prefixIcon: Icon(Icons.badge_outlined,
                                        size: 19),
                                  ),
                                  validator: (v) =>
                                      (v == null || v.trim().isEmpty)
                                          ? 'Student ID is required'
                                          : null,
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                TextFormField(
                                  controller: _phoneController,
                                  keyboardType: TextInputType.phone,
                                  decoration: const InputDecoration(
                                    labelText: 'Phone number',
                                    hintText: '09XXXXXXXXX',
                                    prefixIcon:
                                        Icon(Icons.phone_outlined, size: 19),
                                  ),
                                  validator: (v) {
                                    final value = (v ?? '').trim();
                                    if (value.isEmpty) {
                                      return 'Phone number is required';
                                    }
                                    // Local mobile format — 11 digits starting
                                    // 09. Previously any non-empty string passed.
                                    if (!RegExp(r'^09\d{9}$').hasMatch(value)) {
                                      return 'Use an 11-digit number starting 09';
                                    }
                                    return null;
                                  },
                                ),
                              ],
                            ),
                          ),

                          const SizedBox(height: AppSpacing.lg),
                          const SectionLabel('Sign-in credentials'),
                          AppCard(
                            child: Column(
                              children: [
                                TextFormField(
                                  controller: _emailController,
                                  keyboardType: TextInputType.emailAddress,
                                  decoration: const InputDecoration(
                                    labelText: 'Email',
                                    hintText: 'you@uclm.edu.ph',
                                    prefixIcon:
                                        Icon(Icons.mail_outline, size: 19),
                                  ),
                                  validator: (v) {
                                    final value = (v ?? '').trim();
                                    if (value.isEmpty) {
                                      return 'Email is required';
                                    }
                                    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                                        .hasMatch(value)) {
                                      return 'Enter a valid email address';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                TextFormField(
                                  controller: _passwordController,
                                  obscureText: _obscurePassword,
                                  decoration: InputDecoration(
                                    labelText: 'Password',
                                    prefixIcon:
                                        const Icon(Icons.lock_outline, size: 19),
                                    suffixIcon: IconButton(
                                      icon: Icon(
                                        _obscurePassword
                                            ? Icons.visibility_outlined
                                            : Icons.visibility_off_outlined,
                                        size: 19,
                                      ),
                                      tooltip: _obscurePassword
                                          ? 'Show password'
                                          : 'Hide password',
                                      onPressed: () => setState(() =>
                                          _obscurePassword = !_obscurePassword),
                                    ),
                                  ),
                                  validator: (v) {
                                    final value = v ?? '';
                                    if (value.isEmpty) {
                                      return 'Password is required';
                                    }
                                    if (value.length < 8) {
                                      return 'Use at least 8 characters';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: AppSpacing.xs),
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Icon(Icons.info_outline,
                                        size: 13, color: p.muted),
                                    const SizedBox(width: AppSpacing.hair + 2),
                                    Expanded(
                                      child: Text(
                                        'At least 8 characters. You\'ll verify your face and ID next.',
                                        style: TextStyle(
                                            fontSize: 11.5, color: p.muted),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),

                          const SizedBox(height: AppSpacing.lg),
                          Consumer<AuthProvider>(
                            builder: (context, authProvider, _) {
                              final loading = authProvider.isLoading;
                              return ElevatedButton(
                                onPressed: loading ? null : _handleRegister,
                                child: loading
                                    ? const SizedBox(
                                        height: 20,
                                        width: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          valueColor:
                                              AlwaysStoppedAnimation<Color>(
                                                  Colors.white),
                                        ),
                                      )
                                    : const Text('Create account'),
                              );
                            },
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Center(
                            child: TextButton(
                              onPressed: () => Navigator.pop(context),
                              child: Text(
                                'Already have an account? Sign in',
                                style: theme.textTheme.bodySmall
                                    ?.copyWith(color: p.primary),
                              ),
                            ),
                          ),
                        ],
                      ),
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
}
