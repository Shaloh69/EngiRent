import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../core/services/api_service.dart';
import '../../../core/services/storage_service.dart';
import '../../../core/models/user_model.dart';

class AuthService {
  final ApiService _api = ApiService();
  final StorageService _storage = StorageService();

  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    required String studentId,
    required String firstName,
    required String lastName,
    required String phoneNumber,
    String? parentName,
    String? parentContact,
  }) async {
    try {
      final response = await _api.post('/auth/register', {
        'email': email,
        'password': password,
        'studentId': studentId,
        'firstName': firstName,
        'lastName': lastName,
        'phoneNumber': phoneNumber,
        'parentName': parentName,
        'parentContact': parentContact,
      }, authenticated: false);

      final data = jsonDecode(response.body);

      if (response.statusCode == 201 && data['success']) {
        // Save tokens
        await _storage.saveTokens(
          data['data']['tokens']['accessToken'],
          data['data']['tokens']['refreshToken'],
        );
        await _storage.saveUserId(data['data']['user']['id']);
        return {'success': true, 'user': UserModel.fromJson(data['data']['user'])};
      } else {
        return {'success': false, 'error': data['error'] ?? 'Registration failed'};
      }
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _api.post('/auth/login', {
        'email': email,
        'password': password,
      }, authenticated: false);

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success']) {
        await _storage.saveTokens(
          data['data']['tokens']['accessToken'],
          data['data']['tokens']['refreshToken'],
        );
        await _storage.saveUserId(data['data']['user']['id']);
        return {'success': true, 'user': UserModel.fromJson(data['data']['user'])};
      } else {
        return {'success': false, 'error': data['error'] ?? 'Login failed'};
      }
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getProfile() async {
    try {
      final response = await _api.get('/auth/profile');
      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success']) {
        return {'success': true, 'user': UserModel.fromJson(data['data']['user'])};
      } else {
        return {'success': false, 'error': data['error'] ?? 'Failed to get profile'};
      }
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  Future<void> logout() async {
    try {
      await _api.post('/auth/logout', {});
    } catch (e) {
      // Ignore errors
    } finally {
      await _storage.clearAll();
    }
  }
}
