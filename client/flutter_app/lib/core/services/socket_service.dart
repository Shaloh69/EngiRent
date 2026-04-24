import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../constants/app_constants.dart';

/// Socket.io service — connects the Flutter app to the Node.js backend and
/// delivers real-time rental status events to listeners.
///
/// Usage:
///   SocketService.instance.connect(userId: currentUserId);
///   SocketService.instance.onRentalUpdate.listen((event) { ... });
///   SocketService.instance.disconnect();
class SocketService {
  SocketService._();
  static final SocketService instance = SocketService._();

  io.Socket? _socket;
  String? _userId;

  // Stream controllers for each event the server can emit to this user
  final _rentalCompleted = StreamController<Map<String, dynamic>>.broadcast();
  final _depositApproved = StreamController<Map<String, dynamic>>.broadcast();
  final _depositRejected = StreamController<Map<String, dynamic>>.broadcast();
  final _depositRetry = StreamController<Map<String, dynamic>>.broadcast();
  final _faceVerified = StreamController<Map<String, dynamic>>.broadcast();
  final _faceFailed = StreamController<Map<String, dynamic>>.broadcast();
  final _rentalActive = StreamController<Map<String, dynamic>>.broadcast();
  final _returnUnderReview = StreamController<Map<String, dynamic>>.broadcast();
  final _returnDisputed = StreamController<Map<String, dynamic>>.broadcast();
  final _returnRetry = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onRentalCompleted => _rentalCompleted.stream;
  Stream<Map<String, dynamic>> get onDepositApproved => _depositApproved.stream;
  Stream<Map<String, dynamic>> get onDepositRejected => _depositRejected.stream;
  Stream<Map<String, dynamic>> get onDepositRetry => _depositRetry.stream;
  Stream<Map<String, dynamic>> get onFaceVerified => _faceVerified.stream;
  Stream<Map<String, dynamic>> get onFaceFailed => _faceFailed.stream;
  Stream<Map<String, dynamic>> get onRentalActive => _rentalActive.stream;
  Stream<Map<String, dynamic>> get onReturnUnderReview => _returnUnderReview.stream;
  Stream<Map<String, dynamic>> get onReturnDisputed => _returnDisputed.stream;
  Stream<Map<String, dynamic>> get onReturnRetry => _returnRetry.stream;

  /// Convenience broadcast that fires on ANY rental status change.
  /// Widgets that only need to know "something changed" can listen here.
  final _anyRentalChange = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onAnyRentalChange => _anyRentalChange.stream;

  bool get isConnected => _socket?.connected ?? false;

  void connect({required String userId, String? accessToken}) {
    if (_socket != null && _socket!.connected && _userId == userId) return;
    disconnect();

    _userId = userId;

    final baseUrl = AppConstants.baseUrl.replaceFirst('/api/v1', '');

    _socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setExtraHeaders(accessToken != null ? {'Authorization': 'Bearer $accessToken'} : {})
          .enableReconnection()
          .setReconnectionDelay(3000)
          .setReconnectionAttempts(double.infinity.toInt())
          .build(),
    );

    _socket!
      ..onConnect((_) {
        debugPrint('[Socket] Connected — joining user room: $userId');
        _socket!.emit('join', userId);
      })
      ..onDisconnect((_) => debugPrint('[Socket] Disconnected'))
      ..onConnectError((err) => debugPrint('[Socket] Connect error: $err'))
      ..on('rental:completed', _handle(_rentalCompleted))
      ..on('deposit:approved', _handle(_depositApproved))
      ..on('deposit:rejected', _handle(_depositRejected))
      ..on('deposit:retry', _handle(_depositRetry))
      ..on('face:verified', _handle(_faceVerified))
      ..on('face:failed', _handle(_faceFailed))
      ..on('rental:active', _handle(_rentalActive))
      ..on('return:under_review', _handle(_returnUnderReview))
      ..on('return:disputed', _handle(_returnDisputed))
      ..on('return:retry', _handle(_returnRetry));
  }

  Function(dynamic) _handle(StreamController<Map<String, dynamic>> ctrl) {
    return (data) {
      final event = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
      ctrl.add(event);
      _anyRentalChange.add(event);
    };
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _userId = null;
  }

  void dispose() {
    disconnect();
    _rentalCompleted.close();
    _depositApproved.close();
    _depositRejected.close();
    _depositRetry.close();
    _faceVerified.close();
    _faceFailed.close();
    _rentalActive.close();
    _returnUnderReview.close();
    _returnDisputed.close();
    _returnRetry.close();
    _anyRentalChange.close();
  }
}
