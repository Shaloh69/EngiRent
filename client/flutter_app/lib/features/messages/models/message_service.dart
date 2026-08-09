import 'dart:convert';
import '../../../core/models/message_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/utils/error_utils.dart';

class MessageService {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> getConversation(String rentalId) async {
    try {
      final resp = await _api.get('/rentals/$rentalId/conversation');
      final data = jsonDecode(resp.body);
      if (resp.statusCode == 200 && data['success'] == true) {
        final messages = (data['data']['messages'] as List<dynamic>)
            .map((j) => MessageModel.fromJson(j as Map<String, dynamic>))
            .toList();
        return {
          'success': true,
          'messages': messages,
          'otherParticipantId': data['data']['otherParticipantId'] as String?,
        };
      }
      return {'success': false, 'error': data['error'] ?? 'Could not load messages'};
    } catch (e) {
      return {'success': false, 'error': friendlyErrorMessage(e)};
    }
  }

  Future<Map<String, dynamic>> sendMessage(String rentalId, String body) async {
    try {
      final resp = await _api.post('/rentals/$rentalId/conversation/messages', {'body': body});
      final data = jsonDecode(resp.body);
      if (resp.statusCode == 201 && data['success'] == true) {
        return {'success': true, 'message': MessageModel.fromJson(data['data']['message'])};
      }
      return {'success': false, 'error': data['error'] ?? 'Could not send message'};
    } catch (e) {
      return {'success': false, 'error': friendlyErrorMessage(e)};
    }
  }
}
