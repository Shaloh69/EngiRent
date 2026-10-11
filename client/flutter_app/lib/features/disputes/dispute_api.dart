import 'dart:convert';

import '../../core/services/api_service.dart';

/// Dispute System v2 (user rulings 2026-10-11): the phone's calls. The server
/// computes every amount, deadline and sentence; the app only shows them.
class DisputeApi {
  DisputeApi._();
  static final _api = ApiService();

  static Map<String, dynamic>? _data(String body) {
    final j = jsonDecode(body);
    return j is Map<String, dynamic> ? j['data'] as Map<String, dynamic>? : null;
  }

  static String _error(String body, String fallback) {
    try {
      final j = jsonDecode(body) as Map<String, dynamic>;
      return (j['error'] ?? j['message'] ?? fallback) as String;
    } catch (_) {
      return fallback;
    }
  }

  /// {restricted, reason, disputeId, suspendedUntilReview}
  static Future<Map<String, dynamic>?> restriction() async {
    final r = await _api.get('/disputes/restriction');
    return r.statusCode == 200 ? _data(r.body) : null;
  }

  static Future<List<Map<String, dynamic>>> mine() async {
    final r = await _api.get('/disputes/mine');
    if (r.statusCode != 200) throw Exception(_error(r.body, 'Could not load your disputes'));
    return ((_data(r.body)?['disputes'] as List?) ?? const []).cast<Map<String, dynamic>>();
  }

  static Future<Map<String, dynamic>> get(String id) async {
    final r = await _api.get('/disputes/$id');
    if (r.statusCode != 200) throw Exception(_error(r.body, 'Could not load the case'));
    return _data(r.body)!;
  }

  static Future<Map<String, dynamic>> pay(String id) async {
    final r = await _api.post('/disputes/$id/pay', const {});
    if (r.statusCode != 201 && r.statusCode != 200) throw Exception(_error(r.body, 'Could not start the payment'));
    return _data(r.body)!;
  }

  static Future<void> cancelVisit(String id) async {
    await _api.post('/disputes/$id/cancel-visit', const {});
  }

  static Future<void> requestReview(String id, String reason) async {
    final r = await _api.post('/disputes/$id/review-request', {'reason': reason});
    if (r.statusCode != 200) throw Exception(_error(r.body, 'Could not send the request'));
  }
}
