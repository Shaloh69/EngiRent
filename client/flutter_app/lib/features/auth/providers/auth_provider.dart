import 'package:flutter/material.dart';
import '../../../core/models/user_model.dart';
import '../models/auth_service.dart';

class AuthProvider with ChangeNotifier {
  final AuthService _authService = AuthService();
  
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
      _user = result['user'];
      _error = null;
      notifyListeners();
      return true;
    } else {
      _error = result['error'];
      notifyListeners();
      return false;
    }
  }

  Future<bool> login(String email, String password) async {
    _setLoading(true);
    
    final result = await _authService.login(email: email, password: password);
    
    _setLoading(false);

    if (result['success']) {
      _user = result['user'];
      _error = null;
      notifyListeners();
      return true;
    } else {
      _error = result['error'];
      notifyListeners();
      return false;
    }
  }

  Future<void> loadUser() async {
    final result = await _authService.getProfile();
    
    if (result['success']) {
      _user = result['user'];
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await _authService.logout();
    _user = null;
    notifyListeners();
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
