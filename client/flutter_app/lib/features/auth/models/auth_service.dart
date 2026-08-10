import 'dart:convert';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/api_service.dart';
import '../../../core/services/storage_service.dart';
import '../../../core/models/user_model.dart';
import '../../../core/utils/error_utils.dart';

class AuthService {
  final ApiService _api = ApiService();
  final StorageService _storage = StorageService();

  Future<Map<String, dynamic>> _demoAuthSuccess({
    required String email,
    required String firstName,
    required String lastName,
    required String studentId,
  }) async {
    final user = UserModel(
      id: 'demo-user-001',
      email: email,
      studentId: studentId,
      firstName: firstName,
      lastName: lastName,
      phoneNumber: '09171234567',
      isVerified: true,
    );
    await _storage.saveTokens('demo-access-token', 'demo-refresh-token');
    await _storage.saveUserId(user.id);
    return {'success': true, 'user': user, 'isDemo': true};
  }

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
      if (AppConstants.demoMode) {
        return _demoAuthSuccess(
          email: email,
          firstName: firstName,
          lastName: lastName,
          studentId: studentId,
        );
      }
      return {'success': false, 'error': friendlyErrorMessage(e)};
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
      if (AppConstants.demoMode && email.trim().isNotEmpty && password.isNotEmpty) {
        return _demoAuthSuccess(
          email: email,
          firstName: 'Demo',
          lastName: 'User',
          studentId: 'DEMO-2026-001',
        );
      }
      return {'success': false, 'error': friendlyErrorMessage(e)};
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
      if (AppConstants.demoMode) {
        return {
          'success': true,
          'user': UserModel(
            id: 'demo-user-001',
            email: 'demo@uclm.edu.ph',
            studentId: 'DEMO-2026-001',
            firstName: 'Demo',
            lastName: 'User',
            phoneNumber: '09171234567',
            isVerified: true,
          ),
          'isDemo': true,
        };
      }
      return {'success': false, 'error': friendlyErrorMessage(e)};
    }
  }

  /// PUT /auth/profile — checklist Stage 9. Existed, called by nothing; the
  /// only "profile editing" in the app was Payout Details. Only changed
  /// fields need to be sent — the server merges (see authController.ts's
  /// updateProfile), so a caller can send just what actually changed.
  Future<Map<String, dynamic>> updateProfile({
    String? firstName,
    String? lastName,
    String? phoneNumber,
    String? parentName,
    String? parentContact,
  }) async {
    try {
      final response = await _api.put('/auth/profile', {
        if (firstName != null) 'firstName': firstName,
        if (lastName != null) 'lastName': lastName,
        if (phoneNumber != null) 'phoneNumber': phoneNumber,
        if (parentName != null) 'parentName': parentName,
        if (parentContact != null) 'parentContact': parentContact,
      });
      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        return {'success': true, 'user': UserModel.fromJson(data['data']['user'])};
      }
      return {'success': false, 'error': (data['error'] ?? data['message']) ?? 'Could not update your profile'};
    } catch (e) {
      return {'success': false, 'error': friendlyErrorMessage(e)};
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
