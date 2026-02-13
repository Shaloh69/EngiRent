class RentalModel {
  final String id;
  final String status;
  final DateTime startDate;
  final DateTime endDate;
  final double totalPrice;
  final double securityDeposit;
  final RentalItem item;
  final DateTime createdAt;

  RentalModel({
    required this.id,
    required this.status,
    required this.startDate,
    required this.endDate,
    required this.totalPrice,
    required this.securityDeposit,
    required this.item,
    required this.createdAt,
  });

  factory RentalModel.fromJson(Map<String, dynamic> json) {
    return RentalModel(
      id: json['id'],
      status: json['status'],
      startDate: DateTime.parse(json['startDate']),
      endDate: DateTime.parse(json['endDate']),
      totalPrice: (json['totalPrice'] as num).toDouble(),
      securityDeposit: (json['securityDeposit'] as num).toDouble(),
      item: RentalItem.fromJson(json['item']),
      createdAt: DateTime.parse(json['createdAt']),
    );
  }

  int get daysRemaining {
    final now = DateTime.now();
    if (now.isAfter(endDate)) return 0;
    return endDate.difference(now).inDays;
  }

  bool get isActive => status == 'ACTIVE';
  bool get isCompleted => status == 'COMPLETED';
  bool get isPending => status == 'PENDING';
}

class RentalItem {
  final String id;
  final String title;
  final List<String> images;

  RentalItem({
    required this.id,
    required this.title,
    required this.images,
  });

  factory RentalItem.fromJson(Map<String, dynamic> json) {
    return RentalItem(
      id: json['id'],
      title: json['title'],
      images: List<String>.from(json['images'] ?? []),
    );
  }

  String get firstImage => images.isNotEmpty ? images.first : '';
}
