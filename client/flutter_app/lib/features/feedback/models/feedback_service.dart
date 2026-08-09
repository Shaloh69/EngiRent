import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../../core/models/feedback_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/utils/error_utils.dart';

class FeedbackService {
  final ApiService _api = ApiService();

  /// POST /feedback — checklist 3.1. appVersion is attached automatically
  /// (mandate §2.9.3: a report is close to useless without knowing what
  /// build it came from); category/body/screenshot are the only things the
  /// caller has to supply directly. `screen`, `rentalId`, `kioskId` are the
  /// contextual pre-fill checklist 3.2 asks for from a failed kiosk scan, a
  /// payment error, or a disputed rental.
  Future<Map<String, dynamic>> submit({
    required String category,
    required String body,
    String? screen,
    String? rentalId,
    String? kioskId,
    String? itemId,
    File? screenshot,
  }) async {
    try {
      String appVersion = 'unknown';
      try {
        final info = await PackageInfo.fromPlatform();
        appVersion = '${info.version}+${info.buildNumber}';
      } catch (_) {
        // Version reporting failing must never block the report itself.
      }

      final response = await _api.uploadFile(
        '/feedback',
        screenshot,
        'file',
        extraFields: {
          'category': category,
          'body': body,
          'appVersion': appVersion,
          'device': defaultTargetPlatform.name,
          if (screen != null) 'screen': screen,
          if (rentalId != null) 'rentalId': rentalId,
          if (kioskId != null) 'kioskId': kioskId,
          if (itemId != null) 'itemId': itemId,
        },
      );
      final data = jsonDecode(response.body);
      if (response.statusCode == 201 && data['success'] == true) {
        return {'success': true};
      }
      return {
        'success': false,
        'error': (data['error'] ?? data['message']) ?? 'Could not send your report',
      };
    } catch (e) {
      return {'success': false, 'error': friendlyErrorMessage(e)};
    }
  }

  /// GET /feedback/mine — so filing a report isn't a one-way write; the
  /// student can see it was received and check back on it.
  Future<Map<String, dynamic>> getMine() async {
    try {
      final response = await _api.get('/feedback/mine');
      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        final items = (data['data']['feedback'] as List<dynamic>)
            .map((j) => FeedbackReport.fromJson(j as Map<String, dynamic>))
            .toList();
        return {'success': true, 'items': items};
      }
      return {'success': false, 'error': data['error'] ?? 'Could not load your reports'};
    } catch (e) {
      return {'success': false, 'error': friendlyErrorMessage(e)};
    }
  }
}
