import 'dart:convert';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/item_model.dart';
import '../../../core/services/api_service.dart';

class ItemService {
  final ApiService _api = ApiService();

  List<ItemModel> _demoItems() {
    final now = DateTime.now().toIso8601String();
    final data = [
      {
        'id': 'item-demo-001',
        'title': 'Scientific Calculator FX-991ES',
        'description': 'Reliable calculator for engineering math subjects.',
        'category': 'ACADEMIC_TOOLS',
        'condition': 'GOOD',
        'pricePerDay': 45,
        'securityDeposit': 300,
        'images': ['https://example.com/calc.jpg'],
        'isAvailable': true,
        'averageRating': 4.6,
        'totalRentals': 19,
        'owner': {'id': 'owner-01', 'firstName': 'Ian', 'lastName': 'Luna'},
        'createdAt': now,
      },
      {
        'id': 'item-demo-002',
        'title': 'Arduino Starter Kit',
        'description': 'Breadboard, jumper wires, sensors, and Uno board.',
        'category': 'DEVELOPMENT_KITS',
        'condition': 'LIKE_NEW',
        'pricePerDay': 90,
        'securityDeposit': 600,
        'images': ['https://example.com/arduino.jpg'],
        'isAvailable': true,
        'averageRating': 4.8,
        'totalRentals': 24,
        'owner': {'id': 'owner-02', 'firstName': 'Allan', 'lastName': 'Mondejar'},
        'createdAt': now,
      },
      {
        'id': 'item-demo-003',
        'title': 'Engineering Drawing Set',
        'description': 'Complete drafting kit for plate activities.',
        'category': 'ACADEMIC_TOOLS',
        'condition': 'FAIR',
        'pricePerDay': 55,
        'securityDeposit': 350,
        'images': ['https://example.com/drawing.jpg'],
        'isAvailable': false,
        'averageRating': 4.2,
        'totalRentals': 11,
        'owner': {'id': 'owner-03', 'firstName': 'Jerrel', 'lastName': 'Abala'},
        'createdAt': now,
      },
    ];
    return data.map((json) => ItemModel.fromJson(json)).toList();
  }

  Future<Map<String, dynamic>> getItems({String? query}) async {
    try {
      final endpoint = query != null && query.isNotEmpty ? '/items?search=$query' : '/items';
      final response = await _api.get(endpoint, authenticated: false);
      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success']) {
        final items = (data['data']['items'] as List<dynamic>)
            .map((json) => ItemModel.fromJson(json as Map<String, dynamic>))
            .toList();
        return {'success': true, 'items': items};
      }
      return {'success': false, 'error': data['error'] ?? 'Failed to fetch items'};
    } catch (e) {
      if (AppConstants.demoMode) {
        return {'success': true, 'items': _demoItems(), 'isDemo': true};
      }
      return {'success': false, 'error': e.toString()};
    }
  }

  Future<Map<String, dynamic>> createItem({
    required String title,
    required String description,
    required String category,
    required String condition,
    required String pricePerDay,
    required String securityDeposit,
    required List<String> images,
    String? serialNumber,
  }) async {
    try {
      final response = await _api.post('/items', {
        'title': title,
        'description': description,
        'category': category,
        'condition': condition,
        'pricePerDay': pricePerDay,
        'securityDeposit': securityDeposit,
        'images': images,
        if (serialNumber != null && serialNumber.isNotEmpty) 'serialNumber': serialNumber,
      });
      final data = jsonDecode(response.body);
      if ((response.statusCode == 200 || response.statusCode == 201) && data['success']) {
        return {'success': true};
      }
      return {'success': false, 'error': data['error'] ?? 'Failed to create item'};
    } catch (e) {
      if (AppConstants.demoMode) {
        return {'success': true, 'isDemo': true};
      }
      return {'success': false, 'error': e.toString()};
    }
  }
}
