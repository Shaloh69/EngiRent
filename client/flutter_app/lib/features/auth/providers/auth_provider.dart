import 'dart:async';
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
  StreamSubscription<Map<String, dynamic>>? _verifyApprovedSub;
  StreamSubscription<Map<String, dynamic>>? _verifyRejectedSub;

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
    _verifyApprovedSub?.cancel();
    _verifyRejectedSub?.cancel();
    _verifyApprovedSub = null;
    _verifyRejectedSub = null;
    SocketService.instance.disconnect();
    await _authService.logout();
    _user = null;
    notifyListeners();
  }

  Future<void> _connectSocket() async {
    if (_user == null) return;
    final token = await _storage.getAccessToken();
    SocketService.instance.connect(userId: _user!.id, accessToken: token);
    _listenForVerificationDecisions();
  }

  /// E2.4 / D-1's last open bullet.
  ///
  /// An admin approving or rejecting an ID now emits to this user's room, and
  /// the state it changes lives here — `_user.verificationStatus`, which the
  /// Profile tab's Identity tile renders and the whole re-prompt loop keys
  /// off. Without this the decision reaches the phone and changes nothing
  /// visible until the user happens to trigger a profile fetch.
  ///
  /// It refetches rather than patching `_user` from the payload: D-1's real
  /// cause was two code paths building a user object with different fields
  /// (`login` omitted the three verification fields that `getProfile`
  /// returned), and hand-assembling a third one here would be the same
  /// mistake a third time. `getProfile` uses PROFILE_SELECT and is the one
  /// definition of a complete user.
  void _listenForVerificationDecisions() {
    _verifyApprovedSub?.cancel();
    _verifyRejectedSub?.cancel();
    _verifyApprovedSub =
        SocketService.instance.onVerificationApproved.listen((_) => loadUser());
    _verifyRejectedSub =
        SocketService.instance.onVerificationRejected.listen((_) => loadUser());
  }

  @override
  void dispose() {
    _verifyApprovedSub?.cancel();
    _verifyRejectedSub?.cancel();
    super.dispose();
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
