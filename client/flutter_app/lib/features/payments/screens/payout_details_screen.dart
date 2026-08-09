import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/form_widgets.dart';
import '../../auth/providers/auth_provider.dart';

class _Institution {
  final String providerCode;
  final String name;
  const _Institution(this.providerCode, this.name);

  @override
  String toString() => name;
}

/// Collects where a user's rental earnings and security-deposit refunds go —
/// a real PayMongo Disbursement destination (bank account or e-wallet).
/// Reached from the Profile tab, not forced during signup: only relevant
/// once someone actually lists an item, and a rental simply can't pay them
/// out until this is set (see server's rentalSettlementService.ts).
class PayoutDetailsScreen extends StatefulWidget {
  const PayoutDetailsScreen({super.key});

  @override
  State<PayoutDetailsScreen> createState() => _PayoutDetailsScreenState();
}

class _PayoutDetailsScreenState extends State<PayoutDetailsScreen> {
  final _api = ApiService();
  final _formKey = GlobalKey<FormState>();
  final _accountNameController = TextEditingController();
  final _accountNumberController = TextEditingController();

  String _provider = 'instapay';
  List<_Institution> _institutions = [];
  _Institution? _selectedInstitution;
  bool _loadingInstitutions = false;
  bool _saving = false;
  bool _institutionError = false;

  @override
  void initState() {
    super.initState();
    _loadInstitutions();
  }

  @override
  void dispose() {
    _accountNameController.dispose();
    _accountNumberController.dispose();
    super.dispose();
  }

  Future<void> _loadInstitutions() async {
    setState(() {
      _loadingInstitutions = true;
      _selectedInstitution = null;
      _institutions = [];
    });
    try {
      final resp =
          await _api.get('/payments/receiving-institutions?provider=$_provider');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final rows = (data['data']?['institutions'] as List?) ?? [];
        _institutions = rows
            .map((r) =>
                _Institution(r['providerCode'] as String, r['name'] as String))
            .toList();
      }
    } catch (_) {
      // Leave _institutions empty — the picker shows a retry affordance
      // rather than an unexplained empty dropdown.
    } finally {
      if (mounted) setState(() => _loadingInstitutions = false);
    }
  }

  Future<void> _save() async {
    final formOk = _formKey.currentState!.validate();
    // Validate the picker alongside the fields so a user missing only the
    // institution sees it marked inline, not just as a transient toast.
    setState(() => _institutionError = _selectedInstitution == null);
    if (!formOk || _selectedInstitution == null) return;

    setState(() => _saving = true);
    try {
      final resp = await _api.put('/auth/payout-destination', {
        'provider': _provider,
        'bic': _selectedInstitution!.providerCode,
        'institutionName': _selectedInstitution!.name,
        'accountName': _accountNameController.text.trim(),
        'accountNumber': _accountNumberController.text.trim(),
      });
      final data = jsonDecode(resp.body);
      if (resp.statusCode == 200 && data['success'] == true) {
        if (!mounted) return;
        await Provider.of<AuthProvider>(context, listen: false).loadUser();
        if (!mounted) return;
        AppToast.success(context, 'Payout details saved');
        Navigator.pop(context);
      } else {
        if (!mounted) return;
        AppToast.error(
            context, 'Could not save payout details', data['message']?.toString());
      }
    } catch (e) {
      if (!mounted) return;
      AppToast.error(context, 'Could not save payout details', friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Opens the searchable institution list as a sheet. A 200-row `Autocomplete`
  /// dropdown was unusable on a phone — the overlay covered the field being
  /// typed into and clipped at the keyboard.
  Future<void> _pickInstitution() async {
    if (_institutions.isEmpty) {
      _loadInstitutions();
      return;
    }
    final picked = await showModalBottomSheet<_Institution>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _InstitutionSheet(institutions: _institutions),
    );
    if (picked != null && mounted) {
      setState(() {
        _selectedInstitution = picked;
        _institutionError = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final payoutConfigured =
        context.watch<AuthProvider>().user?.payoutConfigured ?? false;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Payout Details')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
          children: [
            if (payoutConfigured) ...[
              const NoticeBanner(
                kind: NoticeKind.success,
                title: 'Payout already set up',
                message:
                    'Saving again replaces your current destination. Rentals already in flight settle to the new details.',
              ),
              const SizedBox(height: AppSpacing.md),
            ] else ...[
              const NoticeBanner(
                title: 'Why we need this',
                message:
                    'Rental earnings and security-deposit refunds are disbursed here. '
                    'You only need it once you list an item — renting from others works without it.',
              ),
              const SizedBox(height: AppSpacing.md),
            ],

            FormSection(
              title: 'Transfer rail',
              icon: Icons.swap_horiz_rounded,
              caption:
                  'InstaPay arrives within minutes and suits everyday amounts. '
                  'PESONet is same-banking-day and has no per-transfer cap.',
              children: [
                _RailChoice(
                  value: _provider,
                  onChanged: (v) {
                    setState(() {
                      _provider = v;
                      _institutionError = false;
                    });
                    _loadInstitutions();
                  },
                ),
              ],
            ),

            FormSection(
              title: 'Destination',
              icon: Icons.account_balance_rounded,
              children: [
                if (_loadingInstitutions)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Bank or e-wallet',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: p.ink,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      const LinearProgressIndicator(minHeight: 2),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'Loading institutions that accept ${_provider.toUpperCase()}…',
                        style: TextStyle(fontSize: 11.5, color: p.muted),
                      ),
                    ],
                  )
                else
                  AppPickerField(
                    label: 'Bank or e-wallet',
                    value: _selectedInstitution?.name ?? '',
                    hasValue: _selectedInstitution != null,
                    placeholder: _institutions.isEmpty
                        ? 'Couldn\'t load the list — tap to retry'
                        : 'Search ${_institutions.length} institutions',
                    icon: _institutions.isEmpty
                        ? Icons.refresh_rounded
                        : Icons.search_rounded,
                    error: _institutionError
                        ? 'Choose where the money should go'
                        : null,
                    helper: _selectedInstitution != null
                        ? 'Code ${_selectedInstitution!.providerCode}'
                        : null,
                    onTap: _pickInstitution,
                  ),
                AppField(
                  label: 'Account holder name',
                  controller: _accountNameController,
                  hint: 'Exactly as printed on the account',
                  textCapitalization: TextCapitalization.words,
                  helper:
                      'Transfers are rejected if this doesn\'t match the account.',
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                AppField(
                  label: 'Account number',
                  controller: _accountNumberController,
                  keyboardType: TextInputType.number,
                  hint: 'Digits only',
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Required';
                    if (v.trim().length < 6) return 'That looks too short';
                    return null;
                  },
                ),
              ],
            ),

            const NoticeBanner(
              kind: NoticeKind.warning,
              title: 'Double-check before saving',
              message:
                  'We can\'t recover a transfer sent to a wrong but valid account. '
                  'Your details are stored encrypted and are never shown to renters.',
            ),
          ],
        ),
      ),
      bottomNavigationBar: StickyActionBar(
        label: payoutConfigured ? 'Replace payout details' : 'Save payout details',
        icon: Icons.lock_outline_rounded,
        busy: _saving,
        onPressed: _save,
      ),
    );
  }
}

/// Two-option rail picker. Each option carries its own trade-off line, because
/// "InstaPay vs PESONet" means nothing without it.
class _RailChoice extends StatelessWidget {
  const _RailChoice({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  static const _rails = <({String key, String name, String detail})>[
    (key: 'instapay', name: 'InstaPay', detail: 'Minutes · up to ₱50,000'),
    (key: 'pesonet', name: 'PESONet', detail: 'Same banking day · no cap'),
  ];

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Row(
      children: [
        for (final rail in _rails) ...[
          Expanded(
            child: GestureDetector(
              onTap: () => onChanged(rail.key),
              child: AnimatedContainer(
                duration: AppMotion.fast,
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  color: value == rail.key
                      ? p.primary.withValues(alpha: 0.10)
                      : Colors.transparent,
                  borderRadius: AppRadius.input,
                  border: Border.all(
                    color: value == rail.key ? p.primary : p.border,
                    width: value == rail.key ? 1.5 : 1,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          value == rail.key
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                          size: 15,
                          color: value == rail.key ? p.primary : p.muted,
                        ),
                        const SizedBox(width: AppSpacing.hair + 2),
                        Text(
                          rail.name,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: p.ink,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.hair),
                    Text(
                      rail.detail,
                      style: TextStyle(fontSize: 11, height: 1.3, color: p.muted),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (rail != _rails.last) const SizedBox(width: AppSpacing.xs),
        ],
      ],
    );
  }
}

/// Searchable institution sheet. Filters as you type and keeps the search box
/// pinned above the keyboard.
class _InstitutionSheet extends StatefulWidget {
  const _InstitutionSheet({required this.institutions});
  final List<_Institution> institutions;

  @override
  State<_InstitutionSheet> createState() => _InstitutionSheetState();
}

class _InstitutionSheetState extends State<_InstitutionSheet> {
  final _ctrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final matches = _query.isEmpty
        ? widget.institutions
        : widget.institutions
            .where((i) => i.name.toLowerCase().contains(_query.toLowerCase()))
            .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Container(
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(AppRadius.md),
          ),
          border: Border.all(color: p.border),
        ),
        child: Column(
          children: [
            const SizedBox(height: AppSpacing.xs),
            Container(
              width: 34,
              height: 3,
              decoration: BoxDecoration(
                color: p.border,
                borderRadius: AppRadius.circle,
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: TextField(
                controller: _ctrl,
                autofocus: true,
                onChanged: (v) => setState(() => _query = v),
                style: TextStyle(fontSize: 14, color: p.ink),
                decoration: InputDecoration(
                  hintText: 'Search bank or e-wallet',
                  prefixIcon: Icon(Icons.search_rounded, size: 19, color: p.muted),
                  isDense: true,
                ),
              ),
            ),
            Expanded(
              child: matches.isEmpty
                  ? AppEmptyState(
                      icon: Icons.search_off_rounded,
                      title: 'No match',
                      body: 'No institution matches "$_query".',
                    )
                  : ListView.separated(
                      controller: scrollController,
                      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
                      itemCount: matches.length,
                      separatorBuilder: (_, __) =>
                          Divider(height: 1, color: p.border),
                      itemBuilder: (context, i) {
                        final inst = matches[i];
                        return ListTile(
                          dense: true,
                          title: Text(
                            inst.name,
                            style: TextStyle(fontSize: 13.5, color: p.ink),
                          ),
                          subtitle: MonoText(
                            inst.providerCode,
                            size: 10.5,
                            weight: FontWeight.w400,
                            color: p.muted,
                          ),
                          onTap: () => Navigator.pop(context, inst),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
