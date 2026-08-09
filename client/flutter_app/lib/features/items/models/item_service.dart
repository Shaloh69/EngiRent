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

  List<MyListingModel> _demoMyListings() {
    return _demoItems()
        .map((item) => MyListingModel(
              item: item,
              listingState: item.isAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
              canDelete: true,
            ))
        .toList();
  }

  /// GET /items/my-items — existed on the server, called by nothing. An
  /// owner could publish a listing and then never see it again (mandate
  /// §2.9.1).
  Future<Map<String, dynamic>> getMyItems() async {
    try {
      final response = await _api.get('/items/my-items?limit=50');
      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success']) {
        final items = (data['data']['items'] as List<dynamic>)
            .map((json) => MyListingModel.fromJson(json as Map<String, dynamic>))
            .toList();
        return {'success': true, 'items': items};
      }
      return {'success': false, 'error': data['error'] ?? 'Failed to load your listings'};
    } catch (e) {
      if (AppConstants.demoMode) {
        return {'success': true, 'items': _demoMyListings(), 'isDemo': true};
      }
      return {'success': false, 'error': e.toString()};
    }
  }

  /// PUT /items/:id — existed, called by nothing. Fields are sent only when
  /// present, matching the server's partial-update semantics: omit a key to
  /// leave it unchanged rather than sending nulls that would clear it.
  Future<Map<String, dynamic>> updateItem(
    String id, {
    String? title,
    String? description,
    String? category,
    String? condition,
    String? pricePerDay,
    String? securityDeposit,
    List<String>? images,
    String? serialNumber,
    bool? isListed,
    bool? isAvailable,
  }) async {
    try {
      final body = <String, dynamic>{
        if (title != null) 'title': title,
        if (description != null) 'description': description,
        if (category != null) 'category': category,
        if (condition != null) 'condition': condition,
        if (pricePerDay != null) 'pricePerDay': pricePerDay,
        if (securityDeposit != null) 'securityDeposit': securityDeposit,
        if (images != null) 'images': images,
        if (serialNumber != null) 'serialNumber': serialNumber,
        if (isListed != null) 'isListed': isListed,
        if (isAvailable != null) 'isAvailable': isAvailable,
      };
      final response = await _api.put('/items/$id', body);
      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success']) {
        return {'success': true};
      }
      return {
        'success': false,
        'error': (data['error'] ?? data['message']) ?? 'Failed to update listing',
      };
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  /// DELETE /items/:id — existed, called by nothing. The server refuses this
  /// while a rental is in flight; the app is expected to check
  /// `MyListingModel.canDelete` first so that refusal reads as a disabled
  /// button with a reason, not a 400 toast (checklist 2.4's stated bar).
  Future<Map<String, dynamic>> deleteItem(String id) async {
    try {
      final response = await _api.delete('/items/$id');
      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success']) {
        return {'success': true};
      }
      return {
        'success': false,
        'error': (data['error'] ?? data['message']) ?? 'Failed to delete listing',
      };
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }
}
