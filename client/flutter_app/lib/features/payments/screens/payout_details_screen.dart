import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';
import '../../../core/utils/toast_utils.dart';
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
      final resp = await _api.get('/payments/receiving-institutions?provider=$_provider');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final rows = (data['data']?['institutions'] as List?) ?? [];
        _institutions = rows
            .map((r) => _Institution(r['providerCode'] as String, r['name'] as String))
            .toList();
      }
    } catch (_) {
      // Leave _institutions empty — the picker will show "no options" and
      // the user can retry by switching rails and back.
    } finally {
      if (mounted) setState(() => _loadingInstitutions = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedInstitution == null) {
      AppToast.error(context, 'Select a bank or e-wallet', 'Choose your payout destination from the list');
      return;
    }

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
        AppToast.error(context, 'Could not save payout details', data['message']?.toString());
      }
    } catch (e) {
      if (!mounted) return;
      AppToast.error(context, 'Could not save payout details', e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final payoutConfigured = context.watch<AuthProvider>().user?.payoutConfigured ?? false;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Payout Details')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (payoutConfigured)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.check_circle_rounded, color: AppColors.success, size: 20),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text('Payout is already set up. Saving again replaces it.'),
                      ),
                    ],
                  ),
                ),
              const Text(
                'This is where your rental earnings and security-deposit refunds are sent. '
                'You only need this once you list an item for rent.',
                style: TextStyle(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 20),
              const Text('Transfer rail', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'instapay', label: Text('InstaPay')),
                  ButtonSegment(value: 'pesonet', label: Text('PESONet')),
                ],
                selected: {_provider},
                onSelectionChanged: (s) {
                  setState(() => _provider = s.first);
                  _loadInstitutions();
                },
              ),
              const SizedBox(height: 20),
              const Text('Bank or e-wallet', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              _loadingInstitutions
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: LinearProgressIndicator(),
                    )
                  : Autocomplete<_Institution>(
                      optionsBuilder: (value) {
                        if (value.text.isEmpty) return _institutions;
                        return _institutions.where(
                          (i) => i.name.toLowerCase().contains(value.text.toLowerCase()),
                        );
                      },
                      displayStringForOption: (i) => i.name,
                      onSelected: (i) => setState(() => _selectedInstitution = i),
                      fieldViewBuilder: (context, controller, focusNode, onSubmit) {
                        return TextFormField(
                          controller: controller,
                          focusNode: focusNode,
                          decoration: InputDecoration(
                            hintText: _institutions.isEmpty
                                ? 'No options available — check your connection'
                                : 'Search for your bank or e-wallet (e.g. GCash)',
                            border: const OutlineInputBorder(),
                          ),
                        );
                      },
                    ),
              const SizedBox(height: 20),
              const Text('Account holder name', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              TextFormField(
                controller: _accountNameController,
                decoration: const InputDecoration(border: OutlineInputBorder()),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 20),
              const Text('Account number', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              TextFormField(
                controller: _accountNumberController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder()),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _saving ? null : _save,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: _saving
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.white),
                        )
                      : const Text('Save Payout Details', style: TextStyle(color: AppColors.white)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
