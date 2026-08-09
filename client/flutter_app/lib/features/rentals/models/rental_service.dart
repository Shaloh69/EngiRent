import 'dart:convert';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/rental_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/services/local_cache.dart';
import '../../../core/utils/error_utils.dart';

const _cacheKey = 'rentals';

class RentalService {
  final ApiService _api = ApiService();

  List<RentalModel> _demoRentals() {
    final now = DateTime.now();
    final data = [
      {
        'id': 'rent-demo-001',
        'status': 'ACTIVE',
        'startDate': now.subtract(const Duration(days: 1)).toIso8601String(),
        'endDate': now.add(const Duration(days: 2)).toIso8601String(),
        'totalPrice': 180,
        'securityDeposit': 500,
        'item': {
          'id': 'item-demo-002',
          'title': 'Arduino Starter Kit',
          'images': ['https://example.com/arduino.jpg']
        },
        'createdAt': now.subtract(const Duration(days: 2)).toIso8601String(),
      },
      {
        'id': 'rent-demo-002',
        'status': 'VERIFICATION',
        'startDate': now.subtract(const Duration(days: 4)).toIso8601String(),
        'endDate': now.subtract(const Duration(days: 1)).toIso8601String(),
        'totalPrice': 220,
        'securityDeposit': 350,
        'item': {
          'id': 'item-demo-001',
          'title': 'Scientific Calculator FX-991ES',
          'images': ['https://example.com/calc.jpg']
        },
        'createdAt': now.subtract(const Duration(days: 5)).toIso8601String(),
      },
    ];
    return data.map((json) => RentalModel.fromJson(json)).toList();
  }

  /// Checklist Stage 4.2 — falls back to the last successful response when
  /// the request fails, rather than an empty state, marked with when that
  /// snapshot was actually taken so it never gets mistaken for live data.
  Future<Map<String, dynamic>> getRentals() async {
    try {
      final response = await _api.get('/rentals');
      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success']) {
        final rentalsJson = data['data']['rentals'] as List<dynamic>;
        await LocalCache.save(_cacheKey, rentalsJson);
        final rentals = rentalsJson
            .map((json) => RentalModel.fromJson(json as Map<String, dynamic>))
            .toList();
        return {'success': true, 'rentals': rentals, 'stale': false};
      }
      return {'success': false, 'error': data['error'] ?? 'Failed to load rentals'};
    } catch (e) {
      final cached = await LocalCache.load(_cacheKey);
      if (cached != null) {
        final rentals = (cached.data as List<dynamic>)
            .map((json) => RentalModel.fromJson(json as Map<String, dynamic>))
            .toList();
        return {
          'success': true,
          'rentals': rentals,
          'stale': true,
          'cachedAt': cached.cachedAt,
        };
      }
      if (AppConstants.demoMode) {
        return {'success': true, 'rentals': _demoRentals(), 'isDemo': true, 'stale': false};
      }
      return {'success': false, 'error': friendlyErrorMessage(e)};
    }
  }
}
