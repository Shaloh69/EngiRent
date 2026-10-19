import 'dart:convert';

import 'package:flutter/material.dart';

import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';

/// Concerns v2 (user rulings 2026-10-13): reporting a problem the locker
/// camera cannot see. The server decides every window, requirement and peso;
/// the app only shows them and sends the evidence.
class ConcernApi {
  ConcernApi._();
  static final _api = ApiService();

  static Map<String, dynamic>? _data(String body) {
    final j = jsonDecode(body);
    return j is Map<String, dynamic> ? j['data'] as Map<String, dynamic>? : null;
  }

  /// The server's own sentence (`error` on a refusal, `message` on success).
  static String message(String body, String fallback) {
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

  /// {viewer, windows:[{kind,canReport,reason,closesAt,title,requirement}], depositHoldUntil, cases:[...]}
  static Future<Map<String, dynamic>?> options(String rentalId) async {
    final r = await _api.get('/concerns/options/$rentalId');
    return r.statusCode == 200 ? _data(r.body) : null;
  }

  /// Tests render the real case screen from a recorded case through this.
  @visibleForTesting
  static Future<Map<String, dynamic>> Function(String id)? getOverride;

  static Future<Map<String, dynamic>> get(String id) async {
    if (getOverride != null) return getOverride!(id);
    final r = await _api.get('/concerns/$id');
    if (r.statusCode != 200) throw Exception(message(r.body, 'Could not load the case'));
    return _data(r.body)!;
  }

  static List<MapEntry<String, String>> _files(List<String> photos, String? video) => [
        for (final p in photos) MapEntry('photos', p),
        if (video != null) MapEntry('video', video),
      ];

  /// Returns the new case {id, referenceNo}. Throws with the server's reason.
  static Future<Map<String, dynamic>> report({
    required String rentalId,
    required String kind,
    required String statement,
    required List<String> photos,
    String? video,
  }) async {
    final r = await _api.uploadParts('/concerns',
        fields: {'rentalId': rentalId, 'kind': kind, 'statement': statement}, files: _files(photos, video));
    if (r.statusCode != 201) throw Exception(message(r.body, 'Could not send your report'));
    return _data(r.body)!;
  }

  static Future<void> respond(String id, {required String statement, required List<String> photos, String? video}) async {
    final r = await _api.uploadParts('/concerns/$id/respond', fields: {'statement': statement}, files: _files(photos, video));
    if (r.statusCode != 200) throw Exception(message(r.body, 'Could not send your answer'));
  }

  static Future<void> pay(String id, String reference) async {
    final r = await _api.post('/concerns/$id/pay', {'reference': reference});
    if (r.statusCode != 200) throw Exception(message(r.body, 'Could not send your payment'));
  }
}

/// The words the app uses for each kind of case.
class ConcernText {
  ConcernText._();

  static String title(String kind) => switch (kind) {
        'DEFECT_ON_RECEIPT' => 'Problem with the item I received',
        'DAMAGE_ON_RETURN' => 'Damage found after the return',
        'RETURN_CHECK' => 'Concern about this return',
        _ => 'Report',
      };

  static String button(String kind) => switch (kind) {
        'DEFECT_ON_RECEIPT' => 'Report a problem with the item',
        'DAMAGE_ON_RETURN' => 'Report damage on the returned item',
        'RETURN_CHECK' => 'Add a concern about this return',
        _ => 'Report a problem',
      };

  static String explain(String kind) => switch (kind) {
        'DEFECT_ON_RECEIPT' =>
          'Use this if the item was broken, incomplete or not as described when you picked it up, in a way the locker camera could not see.',
        'DAMAGE_ON_RETURN' =>
          'Use this if the item came back damaged in a way the locker camera could not see (it does not work, a part is broken inside, something is missing).',
        'RETURN_CHECK' => 'Tell the admin checking this return something they should know before they decide.',
        _ => '',
      };

  /// An example statement for the kind being reported.
  static String hint(String kind) => switch (kind) {
        'DAMAGE_ON_RETURN' =>
          'Say what is damaged and how you found out. e.g. "The drill no longer spins. It worked when I deposited it; my listing photos show it running."',
        'RETURN_CHECK' =>
          'Say what the admin should know. e.g. "The case was already scratched when I rented it; see the listing photo with the scratch on the lid."',
        _ =>
          'Say what is wrong, when you noticed it, and what you tried. e.g. "The screen stays black when I press ON, even with new batteries."',
      };

  /// When a report with no fixed deadline (closesAt null) stops being possible.
  /// The return check has none: it lasts exactly as long as the admin's check.
  static String openUntil(String kind) => kind == 'RETURN_CHECK'
      ? 'You can add this while an admin is checking the return. It closes once they decide.'
      : 'You can report this now.';

  /// What happens after the report is sent, step by step.
  static List<String> steps(String kind) => switch (kind) {
        'DEFECT_ON_RECEIPT' => [
            'The owner is told and can give their side within 24 hours.',
            'An admin compares your photos and video with the listing photos and the locker camera photos.',
            'If the owner is found responsible, you get rent back (all of it if you reported within 3 hours of pickup, otherwise for the days you could not use) and you return the item early with no late fee.',
          ],
        'DAMAGE_ON_RETURN' => [
            "The renter is told and can give their side within 24 hours. Their deposit stays held until an admin decides.",
            'An admin compares your photos and video with the photos taken at the deposit and at the return.',
            "If the renter is found responsible, the cost (up to the item's replacement value) comes from their deposit first; anything more they pay you.",
          ],
        'RETURN_CHECK' => [
            'The other student is told and can answer.',
            'The admin checking this return sees your report before deciding it.',
          ],
        _ => const [],
      };

  /// [mine]: the viewer reported this case. The one being reported is the
  /// "other student", so they must not be told they are waiting for themselves.
  ///
  /// [settled]: the server's `settled` (a decided damage case with nothing left
  /// to pay). The ruling stays "upheld", but the pill leads with "Settled" so a
  /// renter who has paid is not left wondering why it is still upheld.
  static String status(String s, {bool mine = true, bool settled = false}) => switch (s) {
        'UPHELD' when settled => 'Settled · upheld',
        'PARTLY_UPHELD' when settled => 'Settled · partly upheld',
        'AWAITING_RESPONSE' => mine ? 'Waiting for the other student' : 'Waiting for your answer',
        'UNDER_REVIEW' => 'With an admin',
        'UPHELD' => 'Decided: upheld',
        'PARTLY_UPHELD' => 'Decided: partly upheld',
        'NOT_UPHELD' => 'Decided: not upheld',
        'CLOSED' => 'Closed',
        _ => s,
      };

  static Color statusColor(String s, {bool settled = false}) => switch (s) {
        'UPHELD' || 'PARTLY_UPHELD' when settled => AppColors.success,
        'AWAITING_RESPONSE' => AppColors.info,
        'UNDER_REVIEW' => AppColors.warning,
        'UPHELD' => AppColors.error,
        'PARTLY_UPHELD' => AppColors.warning,
        'NOT_UPHELD' => AppColors.success,
        _ => AppColors.textSecondary,
      };

  static String party(String? p) => p == 'RENTER' ? 'Renter' : p == 'OWNER' ? 'Owner' : 'Admin';

  static String when(String? iso) {
    if (iso == null) return '—';
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return '—';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final m = d.minute.toString().padLeft(2, '0');
    return '${months[d.month - 1]} ${d.day}, $h:$m ${d.hour < 12 ? 'AM' : 'PM'}';
  }

  static String peso(num? n) => '₱${(n ?? 0).toStringAsFixed(2)}';
}
