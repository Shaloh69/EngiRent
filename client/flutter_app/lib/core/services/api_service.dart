import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:mime/mime.dart';
import '../constants/app_constants.dart';
import 'api_exceptions.dart';
import 'connectivity_controller.dart';
import 'storage_service.dart';

/// Mandate §2.10.1 / checklist Stage 4 — a request now always terminates
/// (never hangs forever waiting on a dead connection) and always leaves a
/// trace in [ConnectivityController], which is what lets the offline banner
/// reflect real API reachability rather than just "a radio is connected".
const _requestTimeout = Duration(seconds: 15);
const _uploadTimeout = Duration(seconds: 45); // photos/screenshots are bigger

class ApiService {
  final StorageService _storage = StorageService();

  Future<Map<String, String>> _getHeaders({bool authenticated = false}) async {
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (authenticated) {
      final token = await _storage.getAccessToken();
      if (token != null) headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  /// Every real HTTP call funnels through here. A response — any response,
  /// including a 4xx/5xx — proves the server was reached, which is what
  /// clears a false "offline" banner left over from a previous failure. A
  /// timeout or socket error proves the opposite and is reported as such,
  /// then re-thrown as [ApiUnreachableException] so calling code can tell
  /// "you're offline" apart from "the server said no".
  Future<http.Response> _execute(
    Future<http.Response> Function() call, {
    Duration timeout = _requestTimeout,
  }) async {
    try {
      final resp = await call().timeout(timeout);
      ConnectivityController.instance.reportRequestOutcome(reachedServer: true);
      return resp;
    } on TimeoutException {
      ConnectivityController.instance.reportRequestOutcome(reachedServer: false);
      throw const ApiUnreachableException('The request took too long to respond.');
    } on SocketException {
      ConnectivityController.instance.reportRequestOutcome(reachedServer: false);
      throw const ApiUnreachableException('Could not reach the server.');
    } on http.ClientException catch (e) {
      ConnectivityController.instance.reportRequestOutcome(reachedServer: false);
      throw ApiUnreachableException(e.message);
    }
  }

  // Attempt token refresh — returns true if new tokens were saved
  Future<bool> _refreshTokens() async {
    final refreshToken = await _storage.getRefreshToken();
    if (refreshToken == null) return false;
    try {
      final url = Uri.parse('${AppConstants.baseUrl}/auth/refresh');
      final resp = await http
          .post(
            url,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'refreshToken': refreshToken}),
          )
          .timeout(_requestTimeout);
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        if (data['success'] == true) {
          await _storage.saveTokens(
            data['data']['accessToken'] as String,
            data['data']['refreshToken'] as String,
          );
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  Future<http.Response> _withRefresh(Future<http.Response> Function() call) async {
    final resp = await _execute(call);
    if (resp.statusCode == 401) {
      final refreshed = await _refreshTokens();
      if (refreshed) return _execute(call);
    }
    return resp;
  }

  Future<http.Response> get(String endpoint, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.get(url, headers: headers));
    }
    return _execute(() => http.get(url, headers: headers));
  }

  Future<http.Response> post(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.post(url, headers: headers, body: jsonEncode(body)));
    }
    return _execute(() => http.post(url, headers: headers, body: jsonEncode(body)));
  }

  Future<http.Response> put(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.put(url, headers: headers, body: jsonEncode(body)));
    }
    return _execute(() => http.put(url, headers: headers, body: jsonEncode(body)));
  }

  Future<http.Response> patch(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.patch(url, headers: headers, body: jsonEncode(body)));
    }
    return _execute(() => http.patch(url, headers: headers, body: jsonEncode(body)));
  }

  Future<http.Response> delete(String endpoint, {dynamic body, bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    final encodedBody = body != null ? jsonEncode(body) : null;
    if (authenticated) {
      return _withRefresh(() => http.delete(url, headers: headers, body: encodedBody));
    }
    return _execute(() => http.delete(url, headers: headers, body: encodedBody));
  }

  // Upload a single file to the given endpoint as multipart form-data.
  // `file` is nullable so a form that has an optional attachment (feedback's
  // screenshot) can reuse this instead of a second near-identical method —
  // the server side already treats the file field as optional (multer's
  // `.single()` leaves `req.file` undefined when the field is absent), so
  // this only had to catch up to match.
  Future<http.Response> uploadFile(
    String endpoint,
    File? file,
    String fieldName, {
    Map<String, String>? extraFields,
  }) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final token = await _storage.getAccessToken();

    return _execute(() async {
      final request = http.MultipartRequest('POST', url);
      if (token != null) request.headers['Authorization'] = 'Bearer $token';
      if (file != null) {
        final mimeType = lookupMimeType(file.path) ?? 'image/jpeg';
        final parts = mimeType.split('/');
        request.files.add(await http.MultipartFile.fromPath(
          fieldName,
          file.path,
          contentType: MediaType(parts[0], parts[1]),
        ));
      }
      if (extraFields != null) request.fields.addAll(extraFields);

      final streamed = await request.send();
      return http.Response.fromStream(streamed);
    }, timeout: _uploadTimeout);
  }
}
