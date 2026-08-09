class RentalModel {
  final String id;
  final String status;
  final DateTime startDate;
  final DateTime endDate;
  final double totalPrice;
  final double securityDeposit;
  final RentalItem item;
  final DateTime createdAt;
  // Only present when the API includes them (GET /rentals/:id does;
  // GET /rentals' list view may not) — nullable rather than required so
  // this model still parses either shape.
  final RentalParty? renter;

  RentalModel({
    required this.id,
    required this.status,
    required this.startDate,
    required this.endDate,
    required this.totalPrice,
    required this.securityDeposit,
    required this.item,
    required this.createdAt,
    this.renter,
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
      renter: json['renter'] != null
          ? RentalParty.fromJson(json['renter'] as Map<String, dynamic>)
          : null,
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

  /// Checklist Stage 5 — who the "Message" button on this rental should
  /// reach. `null` until the caller is known, since that depends on which
  /// side of the rental the signed-in user is on, not just the rental data.
  RentalParty? otherParty(String currentUserId) {
    if (renter == null) return null;
    if (renter!.id == currentUserId) return item.owner;
    return renter;
  }
}

class RentalParty {
  final String id;
  final String firstName;
  final String lastName;
  final String? profileImage;

  RentalParty({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.profileImage,
  });

  factory RentalParty.fromJson(Map<String, dynamic> json) => RentalParty(
        id: json['id'],
        firstName: json['firstName'] ?? '',
        lastName: json['lastName'] ?? '',
        profileImage: json['profileImage'],
      );

  String get fullName => '$firstName $lastName'.trim();
}

class RentalItem {
  final String id;
  final String title;
  final List<String> images;
  final RentalParty? owner;

  RentalItem({
    required this.id,
    required this.title,
    required this.images,
    this.owner,
  });

  factory RentalItem.fromJson(Map<String, dynamic> json) {
    return RentalItem(
      id: json['id'],
      title: json['title'],
      images: List<String>.from(json['images'] ?? []),
      owner: json['owner'] != null
          ? RentalParty.fromJson(json['owner'] as Map<String, dynamic>)
          : null,
    );
  }

  String get firstImage => images.isNotEmpty ? images.first : '';
}
