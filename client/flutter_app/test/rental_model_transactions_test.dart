import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/models/rental_model.dart';

/// PAYMENTS RULING, 2026-09-06 — D-23's client half.
///
/// `GET /rentals/:id` has always returned `transactions` (rentalController.ts,
/// `include: { transactions: true }`), and `RentalModel.fromJson` has always
/// thrown them away. That was survivable while a checkout URL carried the
/// whole payment flow. Under manual payments the transaction *is* the flow:
/// the rental sits in PENDING while a human verifies receipt, and the only way
/// the phone can tell "not paid yet" from "paid, waiting on an admin" is this
/// array.
///
/// This is the same defect shape as D-1 — a field the server sends, a parser
/// that does not read it, and a screen that then renders a confident lie.
void main() {
  Map<String, dynamic> rentalJson({List<Map<String, dynamic>>? transactions}) {
    return {
      'id': 'rental-1',
      'status': 'PENDING',
      'startDate': '2026-09-01T00:00:00.000Z',
      'endDate': '2026-09-05T00:00:00.000Z',
      'totalPrice': 1600,
      'securityDeposit': 500,
      'createdAt': '2026-08-30T00:00:00.000Z',
      'item': {
        'id': 'item-1',
        'title': 'Oscilloscope',
        'images': <String>[],
        'pricePerDay': 400,
        'owner': {
          'id': 'owner-1',
          'firstName': 'Ana',
          'lastName': 'Cruz',
          'email': 'ana@uclm.edu.ph',
        },
      },
      if (transactions != null) 'transactions': transactions,
    };
  }

  Map<String, dynamic> txn({
    String id = 'txn-1',
    String type = 'RENTAL_PAYMENT',
    String status = 'PENDING',
    double amount = 1600,
    String method = 'Manual',
    String? reference,
  }) {
    return {
      'id': id,
      'type': type,
      'status': status,
      'amount': amount,
      'paymentMethod': method,
      'paymentReferenceNo': reference,
      'createdAt': '2026-08-30T01:00:00.000Z',
    };
  }

  group('RentalModel.fromJson — transactions', () {
    test('parses the transactions the API already sends', () {
      final rental = RentalModel.fromJson(
        rentalJson(transactions: [txn(), txn(id: 'txn-2', type: 'SECURITY_DEPOSIT', amount: 500)]),
      );

      expect(rental.transactions, hasLength(2));
      expect(rental.transactions.first.id, 'txn-1');
      expect(rental.transactions.first.type, 'RENTAL_PAYMENT');
      expect(rental.transactions.first.status, 'PENDING');
      expect(rental.transactions.first.amount, 1600);
      expect(rental.transactions.first.paymentMethod, 'Manual');
    });

    test('still parses a rental whose payload omits transactions', () {
      // GET /rentals (the list view) does not include them. A model that
      // required the key would break every rentals list.
      final rental = RentalModel.fromJson(rentalJson());
      expect(rental.transactions, isEmpty);
    });

    test('carries the out-of-band payment reference when one is recorded', () {
      final rental = RentalModel.fromJson(
        rentalJson(transactions: [txn(reference: 'GC-77812')]),
      );
      expect(rental.transactions.first.paymentReferenceNo, 'GC-77812');
    });
  });

  group('RentalModel — awaiting-confirmation state', () {
    test('a PENDING rental with no transaction is simply unpaid', () {
      final rental = RentalModel.fromJson(rentalJson(transactions: []));
      expect(rental.awaitingPaymentConfirmation, isFalse);
      expect(rental.pendingPaymentOfType('RENTAL_PAYMENT'), isNull);
    });

    test('a PENDING transaction means an admin has yet to confirm receipt', () {
      final rental = RentalModel.fromJson(rentalJson(transactions: [txn()]));
      expect(rental.awaitingPaymentConfirmation, isTrue);
      expect(rental.pendingPaymentOfType('RENTAL_PAYMENT')!.id, 'txn-1');
    });

    test('a PROCESSING transaction is still awaiting confirmation', () {
      // adminDecidePayment claims PENDING -> PROCESSING before completing, so
      // a renter refreshing mid-approval must not be told they are unpaid.
      final rental = RentalModel.fromJson(
        rentalJson(transactions: [txn(status: 'PROCESSING')]),
      );
      expect(rental.awaitingPaymentConfirmation, isTrue);
    });

    test('a COMPLETED transaction is not awaiting anything', () {
      final rental = RentalModel.fromJson(
        rentalJson(transactions: [txn(status: 'COMPLETED')]),
      );
      expect(rental.awaitingPaymentConfirmation, isFalse);
    });

    test('a FAILED transaction is not awaiting confirmation — it needs paying again', () {
      // An admin rejecting a payment must put the renter back in front of the
      // Pay button, not leave them staring at "awaiting confirmation" forever.
      final rental = RentalModel.fromJson(
        rentalJson(transactions: [txn(status: 'FAILED')]),
      );
      expect(rental.awaitingPaymentConfirmation, isFalse);
      expect(rental.pendingPaymentOfType('RENTAL_PAYMENT'), isNull);
    });
  });
}
