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
  // `GET /rentals/:id` includes these (`rentalController.ts`, `include:
  // { transactions: true }`); the list view does not, so this defaults to
  // empty rather than being required. Under the manual-payments ruling this
  // array is how the phone tells "not paid yet" apart from "paid, waiting on
  // an admin to confirm receipt" — the rental sits in PENDING for both.
  final List<RentalTransaction> transactions;

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
    this.transactions = const [],
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
      transactions: (json['transactions'] as List<dynamic>? ?? const [])
          .map((t) => RentalTransaction.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }

  int get daysRemaining {
    final now = DateTime.now();
    if (now.isAfter(endDate)) return 0;
    return endDate.difference(now).inDays;
  }

  /// The live (not yet settled, not yet rejected) payment of a given type, if
  /// there is one. PROCESSING counts: `adminDecidePayment` claims
  /// PENDING -> PROCESSING before completing, so a renter refreshing during an
  /// approval must not be told they are unpaid.
  RentalTransaction? pendingPaymentOfType(String type) {
    for (final t in transactions) {
      if (t.type == type && (t.status == 'PENDING' || t.status == 'PROCESSING')) {
        return t;
      }
    }
    return null;
  }

  /// True when money has been requested and a human has yet to confirm it
  /// arrived. Deliberately false for FAILED: a rejected payment must put the
  /// renter back in front of the Pay button, not leave them waiting forever.
  bool get awaitingPaymentConfirmation =>
      transactions.any((t) => t.status == 'PENDING' || t.status == 'PROCESSING');

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

/// One row of the rental's payment ledger. A summary, not the full
/// `Transaction` record — the phone only needs enough to say what is owed,
/// what has been sent, and whether anyone has confirmed it.
class RentalTransaction {
  final String id;
  final String type; // RENTAL_PAYMENT | SECURITY_DEPOSIT | LATE_FEE | ...
  final String status; // PENDING | PROCESSING | COMPLETED | FAILED | REFUNDED
  final double amount;
  final String paymentMethod; // "Manual" under the payments ruling
  /// The out-of-band reference the renter quotes (e.g. a GCash reference
  /// number) and the admin reconciles against. Null until one is recorded.
  final String? paymentReferenceNo;
  final DateTime? createdAt;

  RentalTransaction({
    required this.id,
    required this.type,
    required this.status,
    required this.amount,
    required this.paymentMethod,
    this.paymentReferenceNo,
    this.createdAt,
  });

  factory RentalTransaction.fromJson(Map<String, dynamic> json) {
    return RentalTransaction(
      id: json['id'] as String,
      type: json['type'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      amount: (json['amount'] as num?)?.toDouble() ?? 0,
      paymentMethod: json['paymentMethod'] as String? ?? '',
      paymentReferenceNo: json['paymentReferenceNo'] as String?,
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'] as String)
          : null,
    );
  }

  bool get isSettled => status == 'COMPLETED';
  bool get isAwaitingConfirmation =>
      status == 'PENDING' || status == 'PROCESSING';
}
