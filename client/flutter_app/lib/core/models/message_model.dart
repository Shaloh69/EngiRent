/// Checklist Stage 5 — one conversation per rental.
class MessageModel {
  final String id;
  final String body;
  final DateTime createdAt;
  final DateTime? readAt;
  final MessageSender sender;

  MessageModel({
    required this.id,
    required this.body,
    required this.createdAt,
    this.readAt,
    required this.sender,
  });

  factory MessageModel.fromJson(Map<String, dynamic> json) {
    return MessageModel(
      id: json['id'],
      body: json['body'],
      createdAt: DateTime.parse(json['createdAt']),
      readAt: json['readAt'] != null ? DateTime.parse(json['readAt']) : null,
      sender: MessageSender.fromJson(json['sender'] as Map<String, dynamic>),
    );
  }
}

class MessageSender {
  final String id;
  final String firstName;
  final String lastName;
  final String? profileImage;

  MessageSender({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.profileImage,
  });

  factory MessageSender.fromJson(Map<String, dynamic> json) {
    return MessageSender(
      id: json['id'],
      firstName: json['firstName'] ?? '',
      lastName: json['lastName'] ?? '',
      profileImage: json['profileImage'],
    );
  }

  String get fullName => '$firstName $lastName'.trim();
}
