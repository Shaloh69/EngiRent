class NotificationModel {
  final String id;
  final String title;
  final String message;
  final String type;
  final bool isRead;
  final DateTime createdAt;
  // What the notification is about, so tapping it can open that thing.
  final String? relatedEntityType; // 'rental', 'transaction', ...
  final String? relatedEntityId;

  NotificationModel({
    required this.id,
    required this.title,
    required this.message,
    required this.type,
    required this.isRead,
    required this.createdAt,
    this.relatedEntityType,
    this.relatedEntityId,
  });

  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    return NotificationModel(
      id: json['id'] as String,
      title: (json['title'] ?? '') as String,
      message: (json['message'] ?? '') as String,
      type: (json['type'] ?? 'SYSTEM_ANNOUNCEMENT') as String,
      isRead: (json['isRead'] ?? false) as bool,
      createdAt: DateTime.tryParse((json['createdAt'] ?? '').toString())?.toLocal() ?? DateTime.now(),
      relatedEntityType: json['relatedEntityType'] as String?,
      relatedEntityId: json['relatedEntityId'] as String?,
    );
  }
}
