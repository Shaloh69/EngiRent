/// Checklist Stage 3 — before this there was no feedback, support or
/// bug-report path anywhere in the app.
class FeedbackReport {
  final String id;
  final String category;
  final String body;
  final String status; // NEW | ACKNOWLEDGED | RESOLVED
  final String? adminNote;
  final DateTime createdAt;
  final DateTime? resolvedAt;

  FeedbackReport({
    required this.id,
    required this.category,
    required this.body,
    required this.status,
    this.adminNote,
    required this.createdAt,
    this.resolvedAt,
  });

  factory FeedbackReport.fromJson(Map<String, dynamic> json) {
    return FeedbackReport(
      id: json['id'],
      category: json['category'],
      body: json['body'],
      status: json['status'] ?? 'NEW',
      adminNote: json['adminNote'],
      createdAt: DateTime.parse(json['createdAt']),
      resolvedAt: json['resolvedAt'] != null ? DateTime.parse(json['resolvedAt']) : null,
    );
  }
}

/// category -> human label. Kept in one place so the compose form and any
/// list/history view agree on wording without hardcoding it twice.
const Map<String, String> kFeedbackCategories = {
  'BUG': 'Something broke',
  'SUGGESTION': 'Suggestion',
  'KIOSK_PROBLEM': 'Kiosk / locker problem',
  'PAYMENT_PROBLEM': 'Payment problem',
  'OTHER': 'Other',
};
