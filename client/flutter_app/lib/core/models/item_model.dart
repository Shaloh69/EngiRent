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
  final bool isAvailable;
  final double averageRating;
  final int totalRentals;
  final ItemOwner owner;
  final DateTime createdAt;

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
    required this.isAvailable,
    this.averageRating = 0.0,
    this.totalRentals = 0,
    required this.owner,
    required this.createdAt,
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
      isAvailable: json['isAvailable'] ?? true,
      averageRating: (json['averageRating'] as num?)?.toDouble() ?? 0.0,
      totalRentals: json['totalRentals'] ?? 0,
      owner: ItemOwner.fromJson(json['owner']),
      createdAt: DateTime.parse(json['createdAt']),
    );
  }

  String get firstImage => images.isNotEmpty ? images.first : '';
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
