import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/models/item_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/utils/toast_utils.dart';

class CreateRentalScreen extends StatefulWidget {
  final ItemModel item;
  const CreateRentalScreen({super.key, required this.item});

  @override
  State<CreateRentalScreen> createState() => _CreateRentalScreenState();
}

class _CreateRentalScreenState extends State<CreateRentalScreen> {
  final _api = ApiService();
  final _dateFmt = DateFormat('MMM d, yyyy');

  DateTime? _startDate;
  DateTime? _endDate;
  bool _submitting = false;
  bool _lockersLoading = false;
  List<Map<String, dynamic>> _lockers = [];

  @override
  void initState() {
    super.initState();
    _fetchLockers();
  }

  Future<void> _fetchLockers() async {
    setState(() => _lockersLoading = true);
    try {
      final resp = await _api.get('/kiosk/lockers');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        if (data['success'] == true) {
          setState(() {
            _lockers = List<Map<String, dynamic>>.from(data['data']['lockers'] ?? []);
          });
        }
      }
    } catch (_) {
      // Non-critical — locker grid is informational only
    } finally {
      setState(() => _lockersLoading = false);
    }
  }

  Future<void> _pickDates() async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
      initialDateRange: _startDate != null && _endDate != null
          ? DateTimeRange(start: _startDate!, end: _endDate!)
          : null,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(
            primary: AppColors.primary,
            onPrimary: AppColors.white,
            secondary: AppColors.accent,
            onSecondary: AppColors.white,
            surface: AppColors.surface,
          ),
        ),
        child: child!,
      ),
    );
    if (range != null) {
      setState(() {
        _startDate = range.start;
        _endDate = range.end;
      });
    }
  }

  int get _days {
    if (_startDate == null || _endDate == null) return 0;
    return _endDate!.difference(_startDate!).inDays.clamp(1, 999);
  }

  double get _rentalTotal => _days * widget.item.pricePerDay;
  double get _grandTotal => _rentalTotal + widget.item.securityDeposit;

  Future<void> _confirm() async {
    if (_startDate == null || _endDate == null) {
      AppToast.warning(context, 'Select Dates', 'Please choose your rental start and end dates.');
      return;
    }
    if (_lockers.isEmpty) {
      AppToast.warning(context, 'No Lockers Available', 'All kiosk lockers are currently occupied. Try again later.');
      return;
    }
    setState(() => _submitting = true);
    try {
      final resp = await _api.post('/rentals', {
        'itemId': widget.item.id,
        'startDate': _startDate!.toIso8601String(),
        'endDate': _endDate!.toIso8601String(),
      });
      if (!mounted) return;

      if (resp.statusCode == 201 || resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final rentalId = data['data']['rental']['id'] as String;
        AppToast.success(
          context,
          'Rental Requested!',
          'Pay now to confirm your booking for ${widget.item.title}.',
        );
        // Replace create screen with rental detail
        Navigator.pushReplacementNamed(context, '/rentals/$rentalId');
      } else {
        final data = jsonDecode(resp.body);
        final msg = data['message'] ?? data['error'] ?? 'Could not create rental. Please try again.';
        AppToast.error(context, 'Request Failed', msg);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network Error', e.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Book Item'),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: AppColors.border),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
        children: [
          // ── Item summary ─────────────────────────────────────────────────
          _SectionCard(
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: item.images.isNotEmpty
                      ? CachedNetworkImage(
                          imageUrl: item.images.first,
                          width: 72,
                          height: 72,
                          fit: BoxFit.cover,
                          errorWidget: (_, __, ___) => _imgFallback(),
                        )
                      : _imgFallback(),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'PHP ${item.pricePerDay.toStringAsFixed(0)}/day  ·  Deposit PHP ${item.securityDeposit.toStringAsFixed(0)}',
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'by ${item.owner.fullName}',
                        style: const TextStyle(
                          color: AppColors.primary,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ── Date selection ───────────────────────────────────────────────
          _SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SectionHeader(icon: Icons.calendar_month_rounded, label: 'Rental Dates'),
                const SizedBox(height: 14),
                if (_startDate == null)
                  GestureDetector(
                    onTap: _pickDates,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 18),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.primary.withValues(alpha: 0.3), width: 1.5),
                      ),
                      child: const Column(
                        children: [
                          Icon(Icons.date_range_rounded, color: AppColors.primary, size: 32),
                          SizedBox(height: 8),
                          Text(
                            'Tap to select rental dates',
                            style: TextStyle(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                else
                  Row(
                    children: [
                      Expanded(
                        child: _DateCell(
                          label: 'Start',
                          date: _dateFmt.format(_startDate!),
                          icon: Icons.flight_takeoff_rounded,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _DateCell(
                          label: 'End',
                          date: _dateFmt.format(_endDate!),
                          icon: Icons.flight_land_rounded,
                        ),
                      ),
                      const SizedBox(width: 10),
                      GestureDetector(
                        onTap: _pickDates,
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(Icons.edit_calendar_rounded, color: AppColors.primary, size: 20),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ── Price breakdown ──────────────────────────────────────────────
          AnimatedOpacity(
            opacity: _startDate != null ? 1.0 : 0.35,
            duration: const Duration(milliseconds: 250),
            child: _SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionHeader(icon: Icons.receipt_long_rounded, label: 'Price Breakdown'),
                  const SizedBox(height: 14),
                  _PriceRow(
                    label: 'PHP ${item.pricePerDay.toStringAsFixed(0)} × $_days day${_days == 1 ? '' : 's'}',
                    value: 'PHP ${_rentalTotal.toStringAsFixed(2)}',
                  ),
                  const SizedBox(height: 8),
                  _PriceRow(
                    label: 'Security deposit (refundable)',
                    value: 'PHP ${item.securityDeposit.toStringAsFixed(2)}',
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 10),
                    child: Divider(),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total Due Now',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.textPrimary),
                      ),
                      Text(
                        'PHP ${_grandTotal.toStringAsFixed(2)}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 18,
                          color: AppColors.accent,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),

          // ── Locker availability ──────────────────────────────────────────
          _SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SectionHeader(icon: Icons.lock_outline_rounded, label: 'Kiosk Locker Status'),
                const SizedBox(height: 4),
                const Text(
                  'A locker will be auto-assigned when you place the item.',
                  style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
                const SizedBox(height: 14),
                _lockersLoading
                    ? const Center(child: Padding(
                        padding: EdgeInsets.all(16),
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ))
                    : _lockers.isEmpty
                        ? Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: AppColors.error.withValues(alpha: 0.07),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Row(
                              children: [
                                Icon(Icons.warning_amber_rounded, color: AppColors.error, size: 18),
                                SizedBox(width: 8),
                                Text(
                                  'No lockers available right now',
                                  style: TextStyle(color: AppColors.error, fontWeight: FontWeight.w600, fontSize: 13),
                                ),
                              ],
                            ),
                          )
                        : _LockerGrid(lockers: _lockers),
              ],
            ),
          ),
        ],
      ),

      // ── Confirm button ───────────────────────────────────────────────────
      bottomNavigationBar: Container(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
        decoration: BoxDecoration(
          color: AppColors.surface,
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: 0.1),
              blurRadius: 16,
              offset: const Offset(0, -4),
            ),
          ],
        ),
        child: _submitting
            ? Container(
                height: 54,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: AppColors.accentGradient,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                ),
              )
            : GestureDetector(
                onTap: _confirm,
                child: Container(
                  height: 54,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: _lockers.isEmpty || _startDate == null
                        ? const LinearGradient(colors: [Color(0xFFCBD5E1), Color(0xFFCBD5E1)])
                        : AppColors.accentGradient,
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: _lockers.isNotEmpty && _startDate != null
                        ? [BoxShadow(
                            color: AppColors.accent.withValues(alpha: 0.35),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          )]
                        : null,
                  ),
                  child: const Text(
                    'Confirm Rental',
                    style: TextStyle(
                      color: AppColors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                      letterSpacing: 0.3,
                    ),
                  ),
                ),
              ),
      ),
    );
  }

  Widget _imgFallback() => Container(
    width: 72,
    height: 72,
    color: AppColors.greyLight,
    child: const Icon(Icons.inventory_2_rounded, color: AppColors.grey),
  );
}

// ── Sub-widgets ──────────────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final Widget child;
  const _SectionCard({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final IconData icon;
  final String label;
  const _SectionHeader({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.primary),
        const SizedBox(width: 8),
        Text(
          label,
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 15,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}

class _DateCell extends StatelessWidget {
  final String label;
  final String date;
  final IconData icon;
  const _DateCell({required this.label, required this.date, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 13, color: AppColors.primaryLight),
            const SizedBox(width: 4),
            Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          ]),
          const SizedBox(height: 4),
          Text(date, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}

class _PriceRow extends StatelessWidget {
  final String label;
  final String value;
  const _PriceRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
      ],
    );
  }
}

class _LockerGrid extends StatelessWidget {
  final List<Map<String, dynamic>> lockers;
  const _LockerGrid({required this.lockers});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 1,
      ),
      itemCount: lockers.length,
      itemBuilder: (_, i) {
        final locker = lockers[i];
        final status = locker['status'] as String? ?? 'AVAILABLE';
        final number = locker['lockerNumber'] as String? ?? '?';
        final isAvailable = status == 'AVAILABLE';

        Color bg;
        Color fg;
        if (isAvailable) {
          bg = AppColors.secondary.withValues(alpha: 0.12);
          fg = AppColors.secondaryDark;
        } else if (status == 'RESERVED') {
          bg = AppColors.warning.withValues(alpha: 0.12);
          fg = AppColors.warning;
        } else {
          bg = AppColors.grey.withValues(alpha: 0.1);
          fg = AppColors.grey;
        }

        return Container(
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isAvailable ? AppColors.secondary.withValues(alpha: 0.3) : Colors.transparent,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                isAvailable ? Icons.lock_open_rounded : Icons.lock_rounded,
                color: fg,
                size: 20,
              ),
              const SizedBox(height: 4),
              Text(
                number.padLeft(2, '0'),
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: fg,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
