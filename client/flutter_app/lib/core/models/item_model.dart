class ItemModel {
  final String id;
  final String title;
  final String description;
  final String category;
  final String condition;
  final double pricePerDay;
  final double? pricePerWeek;
  final double? pricePerMonth;
  final double securityDeposit;
  final List<String> images;
  // Checklist Stage 7 — one optional clip. Null (not empty-string) means "no
  // video", which is also what a listing created before this stage returns.
  final String? videoUrl;
  final bool isAvailable;
  // Owner intent ("show this in browse"), distinct from isAvailable (rental
  // state) — see the schema comment in itemController for why. Defaults true
  // so older responses that predate this field, and the hand-built demo
  // fixtures below, don't read every item as hidden.
  final bool isListed;
  final double averageRating;
  final int totalRentals;
  final ItemOwner owner;
  final DateTime createdAt;
  final String? serialNumber;

  ItemModel({
    required this.id,
    required this.title,
    required this.description,
    required this.category,
    required this.condition,
    required this.pricePerDay,
    this.pricePerWeek,
    this.pricePerMonth,
    required this.securityDeposit,
    required this.images,
    this.videoUrl,
    required this.isAvailable,
    this.isListed = true,
    this.averageRating = 0.0,
    this.totalRentals = 0,
    required this.owner,
    required this.createdAt,
    this.serialNumber,
  });

  factory ItemModel.fromJson(Map<String, dynamic> json) {
    return ItemModel(
      id: json['id'],
      title: json['title'],
      description: json['description'],
      category: json['category'],
      condition: json['condition'],
      pricePerDay: (json['pricePerDay'] as num).toDouble(),
      pricePerWeek: json['pricePerWeek'] != null ? (json['pricePerWeek'] as num).toDouble() : null,
      pricePerMonth: json['pricePerMonth'] != null ? (json['pricePerMonth'] as num).toDouble() : null,
      securityDeposit: (json['securityDeposit'] as num).toDouble(),
      images: List<String>.from(json['images']),
      videoUrl: json['videoUrl'] as String?,
      isAvailable: json['isAvailable'] ?? true,
      isListed: json['isListed'] ?? true,
      averageRating: (json['averageRating'] as num?)?.toDouble() ?? 0.0,
      totalRentals: json['totalRentals'] ?? 0,
      owner: ItemOwner.fromJson(json['owner']),
      createdAt: DateTime.parse(json['createdAt']),
      serialNumber: json['serialNumber'] as String?,
    );
  }

  String get firstImage => images.isNotEmpty ? images.first : '';
}

/// One row of `GET /items/my-items` — an `ItemModel` plus the extra state
/// only the owner's own view needs: whether a rental is currently attached,
/// and a server-resolved status rather than three raw booleans the client
/// would otherwise have to interpret itself (mandate §2.9.1).
class MyListingModel {
  final ItemModel item;

  /// AVAILABLE | RENTED | UNLISTED | UNAVAILABLE — resolved server-side from
  /// isListed/isAvailable/activeRental so the app and the admin console can't
  /// disagree about what the combination means.
  final String listingState;
  final bool canDelete;
  final ActiveRentalSummary? activeRental;
  final int reviewCount;
  final int rentalCount;

  MyListingModel({
    required this.item,
    required this.listingState,
    required this.canDelete,
    this.activeRental,
    this.reviewCount = 0,
    this.rentalCount = 0,
  });

  factory MyListingModel.fromJson(Map<String, dynamic> json) {
    return MyListingModel(
      item: ItemModel.fromJson(json),
      listingState: json['listingState'] as String? ?? 'AVAILABLE',
      canDelete: json['canDelete'] as bool? ?? true,
      activeRental: json['activeRental'] != null
          ? ActiveRentalSummary.fromJson(
              json['activeRental'] as Map<String, dynamic>)
          : null,
      reviewCount: json['reviewCount'] as int? ?? 0,
      rentalCount: json['rentalCount'] as int? ?? 0,
    );
  }
}

class ActiveRentalSummary {
  final String id;
  final String status;
  final DateTime startDate;
  final DateTime endDate;
  final String renterName;

  ActiveRentalSummary({
    required this.id,
    required this.status,
    required this.startDate,
    required this.endDate,
    required this.renterName,
  });

  factory ActiveRentalSummary.fromJson(Map<String, dynamic> json) {
    final renter = json['renter'] as Map<String, dynamic>?;
    return ActiveRentalSummary(
      id: json['id'],
      status: json['status'],
      startDate: DateTime.parse(json['startDate']),
      endDate: DateTime.parse(json['endDate']),
      renterName: renter != null
          ? '${renter['firstName']} ${renter['lastName']}'
          : 'a renter',
    );
  }
}

class ItemOwner {
  final String id;
  final String firstName;
  final String lastName;
  final String? profileImage;

  ItemOwner({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.profileImage,
  });

  factory ItemOwner.fromJson(Map<String, dynamic> json) {
    return ItemOwner(
      id: json['id'],
      firstName: json['firstName'],
      lastName: json['lastName'],
      profileImage: json['profileImage'],
    );
  }

  String get fullName => '$firstName $lastName';
}
