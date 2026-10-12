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
  // D-87d. Whether a HUMAN or the full verification model has confirmed the
  // deposited item matches the listing: MANUAL_REVIEW while it is still being
  // checked, APPROVED once collection is allowed, REJECTED if it failed.
  //
  // This matters because a rental reaches DEPOSITED regardless of the item
  // check's verdict, and the fast check at the locker structurally cannot
  // approve anything (it skips stages to finish while someone is standing
  // there). So DEPOSITED alone does NOT mean "go and collect it" — the server
  // refuses to open the bay until this reads APPROVED.
  final String? verificationStatus;
  // E6.R. Set when an item has been handed back to its owner and is sitting
  // where they collect it (releasedAt — for an in-place release, at once; for
  // an actuator drop, only when the Pi confirms it), and once the owner has
  // opened the bay and taken it (retrievedAt). Only on GET /rentals/:id.
  final DateTime? releaseRequestedAt;
  final DateTime? releasedAt;
  final DateTime? retrievedAt;

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
    this.verificationStatus,
    this.releaseRequestedAt,
    this.releasedAt,
    this.retrievedAt,
  });

  factory RentalModel.fromJson(Map<String, dynamic> json) {
    return RentalModel(
      id: json['id'],
      status: json['status'],
      // Local too (left UTC in 1.14.3 as "calendar days"). Bookings are sent
      // as local midnight, and a concern decision sets an exact return-by
      // instant; read as UTC, "return by Oct 14, 12:53 AM" showed as Oct 13.
      // In UTC+8 this only moves a value forward, never to an earlier day.
      startDate: DateTime.parse(json['startDate']).toLocal(),
      endDate: DateTime.parse(json['endDate']).toLocal(),
      totalPrice: (json['totalPrice'] as num).toDouble(),
      securityDeposit: (json['securityDeposit'] as num).toDouble(),
      item: RentalItem.fromJson(json['item']),
      createdAt: DateTime.parse(json['createdAt']).toLocal(),
      renter: json['renter'] != null
          ? RentalParty.fromJson(json['renter'] as Map<String, dynamic>)
          : null,
      transactions: (json['transactions'] as List<dynamic>? ?? const [])
          .map((t) => RentalTransaction.fromJson(t as Map<String, dynamic>))
          .toList(),
      verificationStatus: json['verificationStatus'] as String?,
      releaseRequestedAt: json['releaseRequestedAt'] != null
          ? DateTime.parse(json['releaseRequestedAt'] as String).toLocal()
          : null,
      releasedAt: json['releasedAt'] != null
          ? DateTime.parse(json['releasedAt'] as String).toLocal()
          : null,
      retrievedAt: json['retrievedAt'] != null
          ? DateTime.parse(json['retrievedAt'] as String).toLocal()
          : null,
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

  /// D-79. The payment the renter still has to START, in the order the flow
  /// asks for them: the rental fee, then the security deposit. `null` once
  /// both exist as sent-or-confirmed.
  ///
  /// The server only moves a rental to AWAITING_DEPOSIT when BOTH types are
  /// COMPLETED (`adminDecidePayment`), but Pay Now used to hardcode
  /// RENTAL_PAYMENT — so after the fee was confirmed the renter was offered
  /// the fee again (refused) and the deposit never, and no rental made in the
  /// app could ever reach the kiosk.
  ///
  /// FAILED and REFUNDED do not count as paid: a rejected payment must be
  /// payable again. A rental with no positive deposit owes no deposit row.
  String? get nextPaymentType {
    bool started(String type) => transactions.any((t) =>
        t.type == type &&
        (t.status == 'PENDING' ||
            t.status == 'PROCESSING' ||
            t.status == 'COMPLETED'));
    if (!started('RENTAL_PAYMENT')) return 'RENTAL_PAYMENT';
    if (securityDeposit > 0 && !started('SECURITY_DEPOSIT')) {
      return 'SECURITY_DEPOSIT';
    }
    return null;
  }

  /// The type of the payment an admin is currently checking, if any — what
  /// "View payment details" must re-open, rather than a hardcoded fee.
  String? get awaitingPaymentType {
    for (final t in transactions) {
      if (t.status == 'PENDING' || t.status == 'PROCESSING') return t.type;
    }
    return null;
  }

  bool get isActive => status == 'ACTIVE';

  /// D-87d: the deposit is in the locker but nobody has confirmed it yet, so
  /// the renter cannot collect. Deliberately treats a MISSING
  /// verificationStatus as "not confirmed" — failing closed, matching the
  /// server, so an older API shape cannot silently re-open the pickup button.
  bool get depositAwaitingConfirmation =>
      status == 'DEPOSITED' && verificationStatus != 'APPROVED';
  bool get isCompleted => status == 'COMPLETED';

  /// E6.R: the return passed and the money has settled, but the rental is not
  /// complete until the owner opens the bay and takes the item back.
  bool get returnApproved =>
      status == 'VERIFICATION' && verificationStatus == 'APPROVED';

  /// E6.R: the owner can go and collect — the item has been handed back to them
  /// and they have not taken it yet. Deliberately NOT tied to a status: the
  /// same is true of an item released after a dispute or a cancellation, or one
  /// recovered from a return stranded before E6.R (already COMPLETED), and none
  /// of those owners had any way to reach the kiosk before this.
  bool get awaitingOwnerPickup => releasedAt != null && retrievedAt == null;
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
          ? DateTime.tryParse(json['createdAt'] as String)?.toLocal()
          : null,
    );
  }

  bool get isSettled => status == 'COMPLETED';
  bool get isAwaitingConfirmation =>
      status == 'PENDING' || status == 'PROCESSING';
}
