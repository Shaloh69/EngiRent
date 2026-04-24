import 'dart:convert';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/notification_model.dart';
import '../../../core/services/api_service.dart';

class NotificationService {
  final ApiService _api = ApiService();

  List<NotificationModel> _demoNotifications() {
    final now = DateTime.now();
    final data = [
      {
        'id': 'notif-demo-001',
        'title': 'Item Ready for Pickup',
        'message': 'Arduino Starter Kit is now in locker L-07.',
        'type': 'ITEM_READY_FOR_CLAIM',
        'isRead': false,
        'createdAt': now.subtract(const Duration(minutes: 18)).toIso8601String(),
      },
      {
        'id': 'notif-demo-002',
        'title': 'Return Reminder',
        'message': 'Your calculator rental is due tomorrow at 5:00 PM.',
        'type': 'RETURN_REMINDER',
        'isRead': true,
        'createdAt': now.subtract(const Duration(hours: 5)).toIso8601String(),
      },
      {
        'id': 'notif-demo-003',
        'title': 'Verification In Progress',
        'message': 'Returned item is being verified by the kiosk AI service.',
        'type': 'SYSTEM_ANNOUNCEMENT',
        'isRead': false,
        'createdAt': now.subtract(const Duration(days: 1)).toIso8601String(),
      },
    ];
    return data.map((json) => NotificationModel.fromJson(json)).toList();
  }

  Future<bool> markAllRead() async {
    try {
      final response = await _api.patch('/notifications/read-all', {});
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<bool> markRead(String notificationId) async {
    try {
      final response = await _api.patch('/notifications/$notificationId/read', {});
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> getNotifications() async {
    try {
      final response = await _api.get('/notifications');
      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success']) {
        final notifications = (data['data']['notifications'] as List<dynamic>)
            .map((json) => NotificationModel.fromJson(json as Map<String, dynamic>))
            .toList();
        return {'success': true, 'notifications': notifications};
      }
      return {'success': false, 'error': data['error'] ?? 'Failed to load notifications'};
    } catch (e) {
      if (AppConstants.demoMode) {
        return {'success': true, 'notifications': _demoNotifications(), 'isDemo': true};
      }
      return {'success': false, 'error': e.toString()};
    }
  }
}
