import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../constants/app_constants.dart';
import 'storage_service.dart';

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

  // Attempt token refresh — returns true if new tokens were saved
  Future<bool> _refreshTokens() async {
    final refreshToken = await _storage.getRefreshToken();
    if (refreshToken == null) return false;
    try {
      final url = Uri.parse('${AppConstants.baseUrl}/auth/refresh');
      final resp = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );
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
    final resp = await call();
    if (resp.statusCode == 401) {
      final refreshed = await _refreshTokens();
      if (refreshed) return call();
    }
    return resp;
  }

  Future<http.Response> get(String endpoint, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.get(url, headers: headers));
    }
    return http.get(url, headers: headers);
  }

  Future<http.Response> post(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.post(url, headers: headers, body: jsonEncode(body)));
    }
    return http.post(url, headers: headers, body: jsonEncode(body));
  }

  Future<http.Response> put(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.put(url, headers: headers, body: jsonEncode(body)));
    }
    return http.put(url, headers: headers, body: jsonEncode(body));
  }

  Future<http.Response> patch(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.patch(url, headers: headers, body: jsonEncode(body)));
    }
    return http.patch(url, headers: headers, body: jsonEncode(body));
  }

  Future<http.Response> delete(String endpoint, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    if (authenticated) {
      return _withRefresh(() => http.delete(url, headers: headers));
    }
    return http.delete(url, headers: headers);
  }

  // Upload a single file to the given endpoint as multipart form-data
  Future<http.Response> uploadFile(
    String endpoint,
    File file,
    String fieldName, {
    Map<String, String>? extraFields,
  }) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final token = await _storage.getAccessToken();

    final request = http.MultipartRequest('POST', url);
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    request.files.add(await http.MultipartFile.fromPath(fieldName, file.path));
    if (extraFields != null) request.fields.addAll(extraFields);

    final streamed = await request.send();
    return http.Response.fromStream(streamed);
  }
}
