import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/models/item_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/error_utils.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/form_widgets.dart';

/// Checkout — mandate §2.2, modelled on the FlutterShop checkout screen.
///
/// The previous version asked for a date range and then showed a bare total,
/// with the security deposit folded in silently. The single most common
/// question about this product is "why is it charging me more than the rental
/// price" — so the breakdown is now itemised, the deposit is labelled
/// refundable, and escrow is explained on the screen where the money is
/// committed rather than three screens later.
class CreateRentalScreen extends StatefulWidget {
  final ItemModel item;
  const CreateRentalScreen({super.key, required this.item});

  @override
  State<CreateRentalScreen> createState() => _CreateRentalScreenState();
}

class _CreateRentalScreenState extends State<CreateRentalScreen> {
  final _api = ApiService();
  final _dateFmt = DateFormat('EEE, MMM d');
  final _shortFmt = DateFormat('MMM d');

  DateTime? _startDate;
  DateTime? _endDate;
  bool _submitting = false;
  bool _lockersLoading = false;
  bool _dateError = false;
  List<Map<String, dynamic>> _lockers = [];

  // Checklist Stage 6 — "checkout calendar disables taken dates". Flutter's
  // stock showDateRangePicker has no per-day predicate (only the single-date
  // showDatePicker does), so true greyed-out days aren't achievable without
  // hand-building a calendar widget. Instead: booked ranges are shown up
  // front so a student can see them before opening the picker, and any
  // selection that overlaps one is caught and rejected immediately rather
  // than only failing at submit — same real protection, different affordance.
  bool _bookedDatesLoading = true;
  List<DateTimeRange> _bookedRanges = [];

  @override
  void initState() {
    super.initState();
    _fetchLockers();
    _fetchBookedDates();
  }

  Future<void> _fetchBookedDates() async {
    try {
      final resp = await _api.get('/items/${widget.item.id}/booked-dates', authenticated: false);
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        if (data['success'] == true) {
          final ranges = (data['data']['bookedRanges'] as List<dynamic>)
              .map((r) => DateTimeRange(
                    start: DateTime.parse(r['startDate']),
                    end: DateTime.parse(r['endDate']),
                  ))
              .toList();
          if (mounted) setState(() => _bookedRanges = ranges);
        }
      }
    } catch (_) {
      // Non-critical, same tolerance as _fetchLockers — the server still
      // enforces the real check at submit time regardless of whether this
      // informational fetch succeeded.
    } finally {
      if (mounted) setState(() => _bookedDatesLoading = false);
    }
  }

  bool _overlapsBooked(DateTime start, DateTime end) =>
      _bookedRanges.any((r) => start.isBefore(r.end) && r.start.isBefore(end));

  Future<void> _fetchLockers() async {
    setState(() => _lockersLoading = true);
    try {
      final resp = await _api.get('/kiosk/lockers');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        if (data['success'] == true) {
          setState(() {
            _lockers =
                List<Map<String, dynamic>>.from(data['data']['lockers'] ?? []);
          });
        }
      }
    } catch (_) {
      // Non-critical — the locker line degrades to "checking availability".
    } finally {
      if (mounted) setState(() => _lockersLoading = false);
    }
  }

  Future<void> _pickDates() async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 90)),
      initialDateRange: _startDate != null && _endDate != null
          ? DateTimeRange(start: _startDate!, end: _endDate!)
          : null,
      helpText: 'Rental period',
      saveText: 'Set dates',
      // Inherit the app theme. This previously hardcoded ColorScheme.light,
      // which rendered a white-on-white picker in dark mode.
      builder: (context, child) => child!,
    );
    if (range != null) {
      if (_overlapsBooked(range.start, range.end)) {
        _showOverlapError();
        return;
      }
      setState(() {
        _startDate = range.start;
        _endDate = range.end;
        _dateError = false;
      });
    }
  }

  void _showOverlapError() {
    AppToast.error(
      context,
      'Those dates aren\'t free',
      'This item is already booked for part of that period — see the taken '
          'dates below and pick a range that doesn\'t overlap them.',
    );
  }

  /// One-tap common durations. Most rentals here are "a few days" or "a week";
  /// making that a preset removes a two-step calendar interaction.
  void _applyPreset(int days) {
    final start = DateTime.now();
    final startDate = DateTime(start.year, start.month, start.day);
    final endDate = startDate.add(Duration(days: days));
    if (_overlapsBooked(startDate, endDate)) {
      _showOverlapError();
      return;
    }
    setState(() {
      _startDate = startDate;
      _endDate = endDate;
      _dateError = false;
    });
  }

  int get _days {
    if (_startDate == null || _endDate == null) return 0;
    return _endDate!.difference(_startDate!).inDays.clamp(1, 999);
  }

  double get _rentalTotal => _days * widget.item.pricePerDay;
  double get _grandTotal => _rentalTotal + widget.item.securityDeposit;

  int get _availableLockers =>
      _lockers.where((l) => (l['status'] ?? l['state']) == 'AVAILABLE').length;

  Future<void> _confirm() async {
    if (_startDate == null || _endDate == null) {
      setState(() => _dateError = true);
      AppToast.warning(context, 'Choose your dates',
          'Pick when you need the item and when you\'ll return it.');
      return;
    }
    if (_lockers.isEmpty) {
      AppToast.warning(context, 'No lockers available',
          'All kiosk lockers are currently occupied. Try again later.');
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
        AppToast.success(context, 'Rental requested',
            'Pay now to confirm your booking for ${widget.item.title}.');
        Navigator.pushReplacementNamed(context, '/rentals/$rentalId');
      } else {
        final data = jsonDecode(resp.body);
        final msg = data['message'] ??
            data['error'] ??
            'Could not create rental. Please try again.';
        AppToast.error(context, 'Request failed', msg);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Network error', friendlyErrorMessage(e));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final hasDates = _startDate != null && _endDate != null;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
        children: [
          _ItemSummary(item: widget.item),
          const SizedBox(height: AppSpacing.lg),

          FormSection(
            title: 'Rental period',
            icon: Icons.event_outlined,
            caption: 'Day 1 starts when you collect from the kiosk.',
            children: [
              _PresetRow(
                selectedDays: hasDates ? _days : null,
                onSelect: _applyPreset,
              ),
              AppPickerField(
                label: 'Dates',
                icon: Icons.calendar_month_outlined,
                hasValue: hasDates,
                placeholder: 'Choose start and return dates',
                value: hasDates
                    ? '${_dateFmt.format(_startDate!)}  →  ${_dateFmt.format(_endDate!)}'
                    : '',
                helper: hasDates
                    ? '$_days ${_days == 1 ? 'day' : 'days'} · return by ${_shortFmt.format(_endDate!)}'
                    : null,
                error: _dateError ? 'Pick a rental period to continue' : null,
                onTap: _pickDates,
              ),
              if (!_bookedDatesLoading && _bookedRanges.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: _BookedRangesNotice(ranges: _bookedRanges, formatter: _shortFmt),
                ),
            ],
          ),

          FormSection(
            title: 'Collection',
            icon: Icons.storefront_outlined,
            children: [
              _LockerStatus(
                loading: _lockersLoading,
                total: _lockers.length,
                available: _availableLockers,
                onRetry: _fetchLockers,
              ),
            ],
          ),

          const SectionLabel('Cost breakdown'),
          AppCard(
            child: Column(
              children: [
                CostRow(
                  label: 'Rental',
                  note: hasDates
                      ? '₱${widget.item.pricePerDay.toStringAsFixed(0)} × $_days ${_days == 1 ? 'day' : 'days'}'
                      : '₱${widget.item.pricePerDay.toStringAsFixed(0)} per day',
                  amount: hasDates ? '₱${_rentalTotal.toStringAsFixed(2)}' : '—',
                ),
                CostRow(
                  label: 'Security deposit',
                  note: 'Refunded after the return check',
                  amount: '₱${widget.item.securityDeposit.toStringAsFixed(2)}',
                  color: p.muted,
                ),
                const ThinDivider(),
                CostRow(
                  label: 'Pay now',
                  amount: hasDates ? '₱${_grandTotal.toStringAsFixed(2)}' : '—',
                  emphasis: true,
                ),
                if (hasDates) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Row(
                    children: [
                      Icon(Icons.south_west_rounded,
                          size: 13, color: AppColors.success),
                      const SizedBox(width: AppSpacing.hair),
                      Expanded(
                        child: Text(
                          'You get ₱${widget.item.securityDeposit.toStringAsFixed(2)} back — '
                          'the true cost of this rental is ₱${_rentalTotal.toStringAsFixed(2)}.',
                          style: TextStyle(
                              fontSize: 11.5, height: 1.35, color: p.muted),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          const NoticeBanner(
            title: 'Your deposit is held, not spent',
            message:
                'Both amounts are held in escrow. When you return the item, an AI '
                'condition check compares before and after photos — if nothing has '
                'changed, your deposit is released automatically and the owner is paid.',
            icon: Icons.shield_outlined,
          ),
          const SizedBox(height: AppSpacing.xs),
          const NoticeBanner(
            kind: NoticeKind.warning,
            title: 'Returning late',
            message:
                'Late returns accrue the daily rate against your deposit. Return '
                'through any kiosk locker before the due date to avoid this.',
          ),
        ],
      ),
      bottomNavigationBar: StickyActionBar(
        label: 'Request rental',
        icon: Icons.arrow_forward_rounded,
        busy: _submitting,
        summaryLabel: hasDates ? 'Pay now' : 'Select dates',
        summaryValue: hasDates ? '₱${_grandTotal.toStringAsFixed(0)}' : '—',
        onPressed: _confirm,
      ),
    );
  }
}

/// The item being rented, restated at checkout. Standard e-commerce practice —
/// nobody should have to hit back to check they picked the right thing.
class _ItemSummary extends StatelessWidget {
  const _ItemSummary({required this.item});
  final ItemModel item;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: AppRadius.input,
            child: SizedBox(
              width: 62,
              height: 62,
              child: item.images.isEmpty
                  ? Container(
                      color: p.surfaceAlt,
                      child: Icon(Icons.inventory_2_outlined,
                          color: p.muted, size: 22),
                    )
                  : CachedNetworkImage(
                      imageUrl: item.images.first,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(color: p.surfaceAlt),
                      errorWidget: (_, __, ___) => Container(
                        color: p.surfaceAlt,
                        child: Icon(Icons.broken_image_outlined,
                            color: p.muted, size: 20),
                      ),
                    ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                    color: p.ink,
                  ),
                ),
                const SizedBox(height: AppSpacing.hair),
                Row(
                  children: [
                    MonoText(
                      '₱${item.pricePerDay.toStringAsFixed(0)}',
                      size: 13,
                      color: p.primary,
                    ),
                    Text(' / day',
                        style: TextStyle(fontSize: 11.5, color: p.muted)),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Quick-duration chips. Highlights whichever matches the current selection so
/// a preset and a hand-picked range aren't visually indistinguishable.
class _PresetRow extends StatelessWidget {
  const _PresetRow({required this.selectedDays, required this.onSelect});

  final int? selectedDays;
  final ValueChanged<int> onSelect;

  static const _presets = <({int days, String label})>[
    (days: 1, label: '1 day'),
    (days: 3, label: '3 days'),
    (days: 7, label: '1 week'),
    (days: 14, label: '2 weeks'),
  ];

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Quick pick',
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: p.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Wrap(
          spacing: AppSpacing.xs,
          runSpacing: AppSpacing.xs,
          children: [
            for (final preset in _presets)
              GestureDetector(
                onTap: () => onSelect(preset.days),
                child: AnimatedContainer(
                  duration: AppMotion.fast,
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm, vertical: 7),
                  decoration: BoxDecoration(
                    color: selectedDays == preset.days
                        ? p.primary.withValues(alpha: 0.10)
                        : Colors.transparent,
                    borderRadius: AppRadius.input,
                    border: Border.all(
                      color: selectedDays == preset.days ? p.primary : p.border,
                      width: selectedDays == preset.days ? 1.5 : 1,
                    ),
                  ),
                  child: Text(
                    preset.label,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: selectedDays == preset.days
                          ? FontWeight.w700
                          : FontWeight.w500,
                      color:
                          selectedDays == preset.days ? p.primary : p.muted,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// Checklist Stage 6 — informational stand-in for greying out taken days.
/// `showDateRangePicker` has no `selectableDayPredicate` (unlike the
/// single-date picker), so the taken ranges are surfaced here instead and
/// enforced by `_overlapsBooked` when a selection is made.
class _BookedRangesNotice extends StatelessWidget {
  const _BookedRangesNotice({required this.ranges, required this.formatter});

  final List<DateTimeRange> ranges;
  final DateFormat formatter;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final sorted = [...ranges]..sort((a, b) => a.start.compareTo(b.start));
    final label = sorted
        .map((r) => '${formatter.format(r.start)}–${formatter.format(r.end)}')
        .join(', ');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.10),
        borderRadius: AppRadius.input,
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.event_busy_rounded, size: 15, color: AppColors.warning),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Text(
              'Already booked: $label',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: p.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Locker availability. The old grid rendered every locker as a coloured
/// square, which looked informative but told the renter nothing actionable —
/// they can't choose a locker. What matters is simply whether one is free.
class _LockerStatus extends StatelessWidget {
  const _LockerStatus({
    required this.loading,
    required this.total,
    required this.available,
    required this.onRetry,
  });

  final bool loading;
  final int total;
  final int available;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);

    if (loading) {
      return Row(
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: p.muted),
          ),
          const SizedBox(width: AppSpacing.xs),
          Text('Checking locker availability…',
              style: TextStyle(fontSize: 12.5, color: p.muted)),
        ],
      );
    }

    if (total == 0) {
      return Row(
        children: [
          Icon(Icons.wifi_off_rounded, size: 17, color: p.muted),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Text(
              'Couldn\'t reach the kiosk.',
              style: TextStyle(fontSize: 12.5, color: p.muted),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      );
    }

    final ok = available > 0;
    final color = ok ? AppColors.success : AppColors.warning;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              ok ? Icons.check_circle_outline : Icons.hourglass_empty_rounded,
              size: 17,
              color: color,
            ),
            const SizedBox(width: AppSpacing.xs),
            Expanded(
              child: Text(
                ok
                    ? '$available of $total lockers free'
                    : 'All $total lockers are occupied',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: p.ink,
                ),
              ),
            ),
            StatusPill(
              label: ok ? 'Ready' : 'Full',
              color: color,
              dense: true,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.hair + 2),
        Text(
          ok
              ? 'The owner drops the item into a locker and you collect it with a code — you never need to meet.'
              : 'A locker frees up as soon as someone collects or returns. You can still request; collection waits for a free locker.',
          style: TextStyle(fontSize: 11.5, height: 1.4, color: p.muted),
        ),
      ],
    );
  }
}
