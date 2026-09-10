import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/theme_controller.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/animated_auth_background.dart';
import '../../../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../../../core/utils/toast_utils.dart';

/// Login — mandate §2.1 names the auth screens as a deliverable in their own
/// right, since this is the first thing any user sees. Rebuilt presentation
/// only: `_handleLogin` and the AuthProvider wiring are unchanged from the
/// previous version, per §2.1's "services and API wiring stay as they are".
///
/// What it now has that the previous scaffold-looking version didn't: the
/// animated mesh background (§1.5), a real branded lockup, staggered entrance
/// animation on the fields, inline per-field validation, a loading state on
/// submit, and correct rendering in both themes (§1.6).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  late final AnimationController _entrance;

  @override
  void initState() {
    super.initState();
    _entrance = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..forward();
  }

  @override
  void dispose() {
    _entrance.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;
    final authProvider = context.read<AuthProvider>();
    final success = await authProvider.login(
      _emailController.text.trim(),
      _passwordController.text,
    );

    if (!mounted) return;
    if (success) {
      Navigator.pushReplacementNamed(context, '/home');
    } else {
      // E3.2: was a raw SnackBar. This screen and register_screen were the
      // ONLY two of 64 error paths in the app still bypassing the shared
      // toast -- 62 call sites already used AppToast. So a failed sign-in,
      // one of the few errors every single user will eventually see, was the
      // one styled by Flutter's defaults instead of by our tokens.
      AppToast.error(context, authProvider.error ?? 'Login failed');
    }
  }

  /// Staggered entrance — each element enters slightly after the one above,
  /// so the form assembles rather than popping in as one block.
  Widget _stagger({required int index, required Widget child}) {
    final start = (index * 0.09).clamp(0.0, 0.6);
    final anim = CurvedAnimation(
      parent: _entrance,
      curve: Interval(start, (start + 0.4).clamp(0.0, 1.0),
          curve: AppMotion.ease),
    );
    return AnimatedBuilder(
      animation: anim,
      builder: (context, c) => Opacity(
        opacity: anim.value,
        child: Transform.translate(
          offset: Offset(0, 18 * (1 - anim.value)),
          child: c,
        ),
      ),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final muted =
        isDark ? AppColors.textSecondaryDark : AppColors.textSecondary;
    final borderCol = isDark ? AppColors.borderDarkMode : AppColors.border;
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      body: AnimatedAuthBackground(
        child: SafeArea(
          child: Stack(
            children: [
              // Theme toggle is reachable before sign-in — a user who can't
              // read the form in their current scheme shouldn't have to log
              // in first to fix it.
              Positioned(
                top: AppSpacing.xs,
                right: AppSpacing.md,
                child: Consumer<ThemeController>(
                  builder: (context, controller, _) => IconButton(
                    onPressed: () => controller.toggle(context),
                    icon: Icon(
                      controller.isDark(context)
                          ? Icons.light_mode_outlined
                          : Icons.dark_mode_outlined,
                      size: 20,
                    ),
                    tooltip: controller.isDark(context)
                        ? 'Switch to light'
                        : 'Switch to dark',
                  ),
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
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _stagger(index: 0, child: const _BrandLockup()),
                          const SizedBox(height: AppSpacing.xl),

                          _stagger(
                            index: 1,
                            child: Text(
                              l10n.signIn,
                              style: theme.textTheme.headlineMedium?.copyWith(
                                fontSize: 30,
                                letterSpacing: -0.6,
                              ),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.hair),
                          _stagger(
                            index: 2,
                            child: Text(
                              'Use your UCLM student account to continue.',
                              style: theme.textTheme.bodyMedium
                                  ?.copyWith(color: muted),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.lg),

                          _stagger(
                            index: 3,
                            child: TextFormField(
                              controller: _emailController,
                              keyboardType: TextInputType.emailAddress,
                              textInputAction: TextInputAction.next,
                              autofillHints: const [AutofillHints.email],
                              decoration: InputDecoration(
                                labelText: l10n.email,
                                hintText: 'you@uclm.edu.ph',
                                prefixIcon: const Icon(Icons.mail_outline, size: 19),
                              ),
                              validator: (v) {
                                final value = (v ?? '').trim();
                                if (value.isEmpty) return 'Email is required';
                                if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                                    .hasMatch(value)) {
                                  return 'Enter a valid email address';
                                }
                                return null;
                              },
                            ),
                          ),
                          const SizedBox(height: AppSpacing.sm),

                          _stagger(
                            index: 4,
                            child: TextFormField(
                              controller: _passwordController,
                              obscureText: _obscurePassword,
                              textInputAction: TextInputAction.done,
                              autofillHints: const [AutofillHints.password],
                              onFieldSubmitted: (_) => _handleLogin(),
                              decoration: InputDecoration(
                                labelText: l10n.password,
                                hintText: 'Enter your password',
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
                                  onPressed: () => setState(
                                      () => _obscurePassword = !_obscurePassword),
                                ),
                              ),
                              validator: (v) => (v == null || v.isEmpty)
                                  ? 'Password is required'
                                  : null,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.lg),

                          _stagger(
                            index: 5,
                            child: Consumer<AuthProvider>(
                              builder: (context, authProvider, child) {
                                final loading = authProvider.isLoading;
                                return ElevatedButton(
                                  onPressed: loading ? null : _handleLogin,
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
                                      : Text(l10n.signIn),
                                );
                              },
                            ),
                          ),
                          const SizedBox(height: AppSpacing.md),

                          _stagger(
                            index: 6,
                            child: Row(
                              children: [
                                Expanded(child: Divider(color: borderCol)),
                                Padding(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: AppSpacing.sm),
                                  child: Text(
                                    l10n.newHere,
                                    style: theme.textTheme.bodySmall
                                        ?.copyWith(color: muted),
                                  ),
                                ),
                                Expanded(child: Divider(color: borderCol)),
                              ],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.sm),

                          _stagger(
                            index: 7,
                            child: OutlinedButton(
                              onPressed: () =>
                                  Navigator.pushNamed(context, '/register'),
                              child: Text(l10n.createAccount),
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

/// Branded lockup — mandate §1.1 bans the centred-hero-card pattern, so this
/// is a left-aligned mark with the wordmark and a mono system label rather
/// than a centred logo-over-title stack.
class _BrandLockup extends StatelessWidget {
  const _BrandLockup();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final muted =
        isDark ? AppColors.textSecondaryDark : AppColors.textSecondary;

    return Row(
      children: [
        Container(
          height: 46,
          width: 46,
          decoration: BoxDecoration(
            gradient: AppColors.primaryGradient,
            borderRadius: AppRadius.card,
          ),
          child: const Icon(Icons.lock_outline, color: Colors.white, size: 23),
        ),
        const SizedBox(width: AppSpacing.sm),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'EngiRent Hub',
              style: theme.textTheme.titleLarge?.copyWith(fontSize: 20),
            ),
            // Mandate §1.2 — system/identifier strings are mono.
            Text(
              'UCLM · SMART LOCKER',
              style: AppTheme.mono(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: muted,
                letterSpacing: 1.4,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
