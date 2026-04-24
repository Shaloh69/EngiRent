import 'package:flutter/material.dart';
import '../../../core/models/user_model.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/services/storage_service.dart';
import '../models/auth_service.dart';

class AuthProvider with ChangeNotifier {
  final AuthService _authService = AuthService();
  final StorageService _storage = StorageService();

  UserModel? _user;
  bool _isLoading = false;
  String? _error;

  UserModel? get user => _user;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _user != null;

  Future<bool> register({
    required String email,
    required String password,
    required String studentId,
    required String firstName,
    required String lastName,
    required String phoneNumber,
    String? parentName,
    String? parentContact,
  }) async {
    _setLoading(true);
    
    final result = await _authService.register(
      email: email,
      password: password,
      studentId: studentId,
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      parentName: parentName,
      parentContact: parentContact,
    );

    _setLoading(false);

    if (result['success']) {
      _user = result['user'] as UserModel;
      _error = null;
      notifyListeners();
      return true;
    } else {
      _error = result['error'] as String?;
      notifyListeners();
      return false;
    }
  }

  Future<bool> login(String email, String password) async {
    _setLoading(true);

    final result = await _authService.login(email: email, password: password);

    _setLoading(false);

    if (result['success']) {
      _user = result['user'] as UserModel;
      _error = null;
      notifyListeners();
      _connectSocket();
      return true;
    } else {
      _error = result['error'] as String?;
      notifyListeners();
      return false;
    }
  }

  Future<void> loadUser() async {
    final result = await _authService.getProfile();

    if (result['success']) {
      _user = result['user'] as UserModel;
      notifyListeners();
      _connectSocket();
    }
  }

  Future<void> logout() async {
    SocketService.instance.disconnect();
    await _authService.logout();
    _user = null;
    notifyListeners();
  }

  Future<void> _connectSocket() async {
    if (_user == null) return;
    final token = await _storage.getAccessToken();
    SocketService.instance.connect(userId: _user!.id, accessToken: token);
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
