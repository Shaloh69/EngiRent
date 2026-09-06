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

  // E2.2's other half. socket.io reconnects on its own, but the events that
  // fired while it was down are gone — they are emitted, not queued. So a
  // reconnect is not a return to a known-good state: it is the moment at
  // which this client is *most* likely to be showing something stale, with
  // no indication that it is.
  //
  // `ConnectivityController` and `OfflineBanner` already cover HTTP
  // reachability, and `offline_write_queue` replays writes made while
  // offline. Neither re-syncs *reads*, which is the gap E0's stale-state
  // sweep named as "the one genuine remainder".
  //
  // Tracked so the first connect of a session does NOT fire a resync: every
  // screen already fetches on mount, and firing here would double every
  // initial load.
  bool _hasConnectedOnce = false;

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
  final _kioskScanError = StreamController<Map<String, dynamic>>.broadcast();
  // The kiosk validated the scanned QR and now needs this user to prove who
  // they are. Since 2026-09-03 that happens here on the phone, not at the
  // kiosk — the kiosk's face camera was removed (design mandate 2.13).
  final _kioskFaceRequired = StreamController<Map<String, dynamic>>.broadcast();
  // Checklist Stage 5 — real-time message delivery.
  final _newMessage = StreamController<Map<String, dynamic>>.broadcast();
  // PAYMENTS RULING 2026-09-06 — under manual payments an admin approving
  // receipt IS the payment confirmation. There is no webhook and no checkout
  // redirect to tell the renter anything, so without these two events the
  // rental sits on "awaiting confirmation" until the user thinks to refresh.
  final _paymentApproved = StreamController<Map<String, dynamic>>.broadcast();
  final _paymentRejected = StreamController<Map<String, dynamic>>.broadcast();
  // E2.4 / D-1's last open bullet. An admin deciding an ID verification used
  // to reach the database and stop there, so the Profile tab's Identity tile
  // kept rendering the pre-decision state — an approved student was still
  // told "Under review" and offered the submit button they had already used.
  final _verificationApproved = StreamController<Map<String, dynamic>>.broadcast();
  final _verificationRejected = StreamController<Map<String, dynamic>>.broadcast();

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
  Stream<Map<String, dynamic>> get onKioskScanError => _kioskScanError.stream;
  Stream<Map<String, dynamic>> get onKioskFaceRequired => _kioskFaceRequired.stream;
  Stream<Map<String, dynamic>> get onNewMessage => _newMessage.stream;
  Stream<Map<String, dynamic>> get onPaymentApproved => _paymentApproved.stream;
  Stream<Map<String, dynamic>> get onPaymentRejected => _paymentRejected.stream;
  Stream<Map<String, dynamic>> get onVerificationApproved => _verificationApproved.stream;
  Stream<Map<String, dynamic>> get onVerificationRejected => _verificationRejected.stream;

  String? get currentUserId => _userId;

  /// Convenience broadcast that fires on ANY rental status change.
  /// Widgets that only need to know "something changed" can listen here.
  final _anyRentalChange = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onAnyRentalChange => _anyRentalChange.stream;

  /// Fires when the socket comes back after having been connected before.
  ///
  /// Deliberately also pushed onto [onAnyRentalChange], so the screens that
  /// already refetch on "something changed" get reconnect-resync for free
  /// rather than each growing its own reconnect handler — the duplicated-
  /// implementation shape `ENGIRENT-CLAUDE.md` §7 says to avoid. Screens
  /// whose data is not rental-shaped (chat, profile) listen here instead.
  final _reconnected = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onReconnected => _reconnected.stream;

  bool get isConnected => _socket?.connected ?? false;

  void connect({required String userId, String? accessToken}) {
    if (_socket != null && _socket!.connected && _userId == userId) return;
    disconnect();

    _userId = userId;

    final baseUrl = AppConstants.baseUrl.replaceFirst('/api/v1', '');

    final builder = io.OptionBuilder()
        .setTransports(['websocket'])
        .setExtraHeaders(accessToken != null ? {'Authorization': 'Bearer $accessToken'} : {})
        .enableReconnection()
        .setReconnectionDelay(3000)
        .setReconnectionAttempts(double.infinity.toInt());

    // The backend authenticates the socket from this auth payload (preferred
    // over extraHeaders, which some websocket transports drop). Without a valid
    // token the socket cannot join its notification room.
    if (accessToken != null) {
      builder.setAuth({'token': accessToken});
    }

    _socket = io.io(baseUrl, builder.build());

    _socket!
      ..onConnect((_) {
        debugPrint('[Socket] Connected — joining user room: $userId');
        _socket!.emit('join', userId);

        // Rejoining is not enough. Anything emitted to this room while the
        // socket was down was delivered to nobody, so every screen driven by
        // those events is now silently out of date. Tell them to refetch.
        noteConnected();
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
      ..on('return:retry', _handle(_returnRetry))
      ..on('kiosk:scan_error', _handle(_kioskScanError))
      ..on('kiosk:face_required', _handle(_kioskFaceRequired))
      // Routed through _handle() deliberately: an approved payment advances
      // the rental (PENDING -> AWAITING_DEPOSIT once both sides are paid), so
      // every rentals list showing a status is now stale.
      ..on('payment:approved', _handle(_paymentApproved))
      ..on('payment:rejected', _handle(_paymentRejected))
      // Deliberately NOT routed through _handle()/_anyRentalChange, for the
      // same reason message:new is not: an ID decision is a change to the
      // *user*, not to any rental, and pushing it onto the rental-change
      // stream would make every rentals list refetch for an event that
      // cannot alter a single row it displays. AuthProvider listens instead
      // and refreshes the profile, which is the state that actually moved.
      ..on('verification:approved', (data) {
        _verificationApproved.add(
            data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{});
      })
      ..on('verification:rejected', (data) {
        _verificationRejected.add(
            data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{});
      })
      // Not routed through _handle()/_anyRentalChange — a new message isn't
      // a rental status change, and piggybacking it there would make every
      // rentals-list screen refetch on every incoming chat message.
      ..on('message:new', (data) {
        _newMessage.add(data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{});
      });
  }

  /// Records that the socket is connected, and signals a resync if this is a
  /// *re*connect rather than the first connect of the session.
  ///
  /// Extracted from the `onConnect` callback so the rule can be tested
  /// without a live socket. The rule has two edges that are easy to get
  /// wrong and both are load-bearing: the first connect must NOT fire
  /// (every screen already fetches on mount, so firing would double every
  /// initial load), and an explicit [disconnect] must reset it (a logout
  /// starts a fresh session, and the next login's first connect is not a
  /// reconnect).
  @visibleForTesting
  void noteConnected() {
    if (_hasConnectedOnce) {
      debugPrint('[Socket] Reconnected — signalling resync');
      final event = <String, dynamic>{
        'reason': 'reconnected',
        'at': DateTime.now().toIso8601String(),
      };
      _reconnected.add(event);
      _anyRentalChange.add(event);
    }
    _hasConnectedOnce = true;
  }

  void emit(String event, Map<String, dynamic> data) {
    _socket?.emit(event, data);
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
    // An explicit disconnect is a logout or a teardown, not a dropped
    // connection. The next connect is a genuinely fresh session and must not
    // be treated as a reconnect, or the first load of the next login fires
    // twice.
    _hasConnectedOnce = false;
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
    _kioskScanError.close();
    _kioskFaceRequired.close();
    _newMessage.close();
    _paymentApproved.close();
    _paymentRejected.close();
    _verificationApproved.close();
    _verificationRejected.close();
    _anyRentalChange.close();
    _reconnected.close();
  }
}
