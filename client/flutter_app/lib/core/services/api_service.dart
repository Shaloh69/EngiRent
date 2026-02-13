import 'dart:convert';
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
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
      }
    }

    return headers;
  }

  Future<http.Response> get(String endpoint, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    return await http.get(url, headers: headers);
  }

  Future<http.Response> post(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    return await http.post(url, headers: headers, body: jsonEncode(body));
  }

  Future<http.Response> put(String endpoint, dynamic body, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    return await http.put(url, headers: headers, body: jsonEncode(body));
  }

  Future<http.Response> delete(String endpoint, {bool authenticated = true}) async {
    final url = Uri.parse('${AppConstants.baseUrl}$endpoint');
    final headers = await _getHeaders(authenticated: authenticated);
    return await http.delete(url, headers: headers);
  }
}
