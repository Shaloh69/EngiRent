import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/models/rental_model.dart';

/// E6.R (user ruling 2026-09-24): an approved return stays in VERIFICATION
/// until the OWNER opens the bay and takes the item back; only then is it
/// COMPLETED. The owner's "Collect Your Item" button keys off
/// `awaitingOwnerPickup`, which needs two fields the parser never read before.
void main() {
  Map<String, dynamic> rentalJson({
    String status = 'VERIFICATION',
    String? verificationStatus,
    String? releaseRequestedAt,
    String? retrievedAt,
  }) {
    return {
      'id': 'rental-1',
      'status': status,
      'startDate': '2026-09-01T00:00:00.000Z',
      'endDate': '2026-09-05T00:00:00.000Z',
      'totalPrice': 50,
      'securityDeposit': 150,
      'createdAt': '2026-08-30T00:00:00.000Z',
      'item': {
        'id': 'item-1',
        'title': 'Little Hammer',
        'images': <String>[],
        'pricePerDay': 50,
      },
      'verificationStatus': ?verificationStatus,
      'releaseRequestedAt': ?releaseRequestedAt,
      'retrievedAt': ?retrievedAt,
    };
  }

  test('an approved return handed back in place is awaiting the owner', () {
    final r = RentalModel.fromJson(rentalJson(
      verificationStatus: 'APPROVED',
      releaseRequestedAt: '2026-09-24T14:47:35.000Z',
    ));
    expect(r.returnApproved, isTrue);
    expect(r.awaitingOwnerPickup, isTrue);
    expect(r.isCompleted, isFalse);
  });

  test('a return still under review offers the owner nothing to collect', () {
    final r = RentalModel.fromJson(rentalJson(verificationStatus: 'MANUAL_REVIEW'));
    expect(r.returnApproved, isFalse);
    expect(r.awaitingOwnerPickup, isFalse);
  });

  test('once the owner has taken it, there is nothing left to collect', () {
    final r = RentalModel.fromJson(rentalJson(
      verificationStatus: 'APPROVED',
      releaseRequestedAt: '2026-09-24T14:47:35.000Z',
      retrievedAt: '2026-09-24T15:02:00.000Z',
    ));
    expect(r.awaitingOwnerPickup, isFalse);
  });

  test('an older API shape without the release fields fails closed', () {
    final r = RentalModel.fromJson(rentalJson(verificationStatus: 'APPROVED'));
    expect(r.awaitingOwnerPickup, isFalse);
  });
}
