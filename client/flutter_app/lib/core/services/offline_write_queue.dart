import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'api_exceptions.dart';
import 'api_service.dart';

/// A single pending write, persisted to disk so it survives the app being
/// closed while offline — "queued in memory only" would lose everything the
/// moment a student switches apps on a weak connection.
class QueuedWrite {
  QueuedWrite({
    required this.id,
    required this.method,
    required this.endpoint,
    required this.body,
    required this.queuedAt,
    required this.label,
  });

  final String id;
  final String method; // POST | PUT | PATCH | DELETE
  final String endpoint;
  final dynamic body;
  final DateTime queuedAt;

  /// Human-readable description shown in any future "pending changes" UI —
  /// "the request body" isn't something to show a student.
  final String label;

  Map<String, dynamic> toJson() => {
        'id': id,
        'method': method,
        'endpoint': endpoint,
        'body': body,
        'queuedAt': queuedAt.toIso8601String(),
        'label': label,
      };

  factory QueuedWrite.fromJson(Map<String, dynamic> json) => QueuedWrite(
        id: json['id'] as String,
        method: json['method'] as String,
        endpoint: json['endpoint'] as String,
        body: json['body'],
        queuedAt: DateTime.parse(json['queuedAt'] as String),
        label: json['label'] as String,
      );
}

/// Checklist Stage 4.3 — queue and replay non-payment writes made while
/// offline, so a review (or similar) written with no connection isn't just
/// lost, and posts automatically once the connection comes back.
///
/// The hard rule this stage names — "payments and locker actions must never
/// be queued, replaying either is dangerous" — is enforced structurally
/// here, not just by convention at each call site: [enqueue] refuses any
/// endpoint under `/payments` or `/kiosk` outright. A payment retried blind
/// after the fact could double-charge; a locker command replayed later could
/// open a door nobody is standing in front of anymore. Those must fail
/// loudly and immediately instead (which ApiService already does — see
/// ApiUnreachableException).
class OfflineWriteQueue {
  OfflineWriteQueue._();
  static final OfflineWriteQueue instance = OfflineWriteQueue._();

  static const _storageKey = 'engirent_offline_write_queue';
  static const _forbiddenPrefixes = ['/payments', '/kiosk'];

  final ApiService _api = ApiService();
  bool _flushing = false;

  Future<List<QueuedWrite>> _readAll() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getStringList(_storageKey) ?? [];
    return raw
        .map((s) {
          try {
            return QueuedWrite.fromJson(jsonDecode(s) as Map<String, dynamic>);
          } catch (_) {
            return null; // drop anything that doesn't parse rather than crash
          }
        })
        .whereType<QueuedWrite>()
        .toList();
  }

  Future<void> _writeAll(List<QueuedWrite> items) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _storageKey,
      items.map((w) => jsonEncode(w.toJson())).toList(),
    );
  }

  Future<int> pendingCount() async => (await _readAll()).length;

  Future<void> enqueue({
    required String method,
    required String endpoint,
    required dynamic body,
    required String label,
  }) async {
    for (final prefix in _forbiddenPrefixes) {
      if (endpoint.startsWith(prefix)) {
        // A logic error in the calling code, not a runtime condition a user
        // can hit — fail hard in development rather than silently queuing
        // something this stage explicitly forbids queuing.
        throw StateError(
          'Refusing to queue $method $endpoint — payments/kiosk actions must '
          'never be queued (checklist Stage 4.3). Fail loudly instead.',
        );
      }
    }
    final items = await _readAll();
    items.add(QueuedWrite(
      id: '${DateTime.now().microsecondsSinceEpoch}',
      method: method,
      endpoint: endpoint,
      body: body,
      queuedAt: DateTime.now(),
      label: label,
    ));
    await _writeAll(items);
  }

  /// Replays every queued write in the order it was made. Stops at the
  /// first failure and leaves the remainder queued — if the connection
  /// dropped again mid-flush, later items shouldn't be attempted (and
  /// possibly reordered ahead of the one that just failed) out of sequence.
  ///
  /// Returns how many writes were successfully replayed, so a caller can
  /// show "2 pending changes were sent" rather than a silent background sync.
  Future<int> flush() async {
    if (_flushing) return 0;
    _flushing = true;
    var sent = 0;
    try {
      var items = await _readAll();
      while (items.isNotEmpty) {
        final next = items.first;
        try {
          final resp = await switch (next.method) {
            'POST' => _api.post(next.endpoint, next.body),
            'PUT' => _api.put(next.endpoint, next.body),
            'PATCH' => _api.patch(next.endpoint, next.body),
            'DELETE' => _api.delete(next.endpoint, body: next.body),
            _ => throw StateError('Unsupported queued method ${next.method}'),
          };
          // A 4xx here means the server genuinely rejected it (e.g. the
          // rental was cancelled in the meantime) — that's a resolved
          // outcome, not a connectivity failure, so drop it rather than
          // retrying it forever.
          if (resp.statusCode >= 500) {
            break; // a real server-side failure — stop and try later
          }
        } on ApiUnreachableException {
          break; // still offline (or offline again) — stop, keep the rest queued
        }
        items.removeAt(0);
        await _writeAll(items);
        sent++;
      }
    } finally {
      _flushing = false;
    }
    return sent;
  }
}
