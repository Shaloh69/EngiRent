import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/features/payments/payout_institutions.dart';

// 2026-10-21 (user: "it outputs so much banks"): PayMongo's live list has 94
// InstaPay institutions, and GCash is called "G-Xchange, Inc.", so searching
// "gcash" found nothing. Each rule was removed once and a test here failed.

const list = [
  PayoutInstitution('ONNRPHM1XXX', 'BDO Network Bank'),
  PayoutInstitution('BOPIPHMMXXX', 'Bank of the Philippine Islands / BPI Family'),
  PayoutInstitution('CIPHPHMMXXX', 'CIMB Philippines, Inc.'),
  PayoutInstitution('GXCHPHM2XXX', 'G-Xchange, Inc.'),
  PayoutInstitution('TLBPPHMMXXX', 'Land Bank of The Philippines'),
  PayoutInstitution('PAPHPHM1XXX', 'Maya Philippines, Inc.'),
  PayoutInstitution('SHPHPHM2XXX', 'ShopeePay Philippines, Inc.'),
];

List<String> codes(List<PayoutInstitution> l) => l.map((i) => i.providerCode).toList();

void main() {
  test('no search: GCash, Maya, BPI, Landbank first (in that order), the rest after in PayMongo order', () {
    final a = arrangePayoutInstitutions(list, '');
    expect(codes(a.popular), ['GXCHPHM2XXX', 'PAPHPHM1XXX', 'BOPIPHMMXXX', 'TLBPPHMMXXX']);
    expect(codes(a.rest), ['ONNRPHM1XXX', 'CIPHPHMMXXX', 'SHPHPHM2XXX']);
  });
  test('"gcash" finds G-Xchange (the bug), in any case', () {
    expect(codes(arrangePayoutInstitutions(list, 'gcash').popular), ['GXCHPHM2XXX']);
    expect(codes(arrangePayoutInstitutions(list, '  GCash ').popular), ['GXCHPHM2XXX']);
  });
  test('"paymaya" finds Maya; "landbank" (one word) finds Land Bank', () {
    expect(codes(arrangePayoutInstitutions(list, 'paymaya').popular), ['PAPHPHM1XXX']);
    expect(codes(arrangePayoutInstitutions(list, 'landbank').popular), ['TLBPPHMMXXX']);
  });
  test('the PayMongo name still matches, and non-popular hits land in the rest', () {
    final a = arrangePayoutInstitutions(list, 'shopee');
    expect(a.popular, isEmpty);
    expect(codes(a.rest), ['SHPHPHM2XXX']);
    expect(codes(arrangePayoutInstitutions(list, 'xchange').popular), ['GXCHPHM2XXX']);
  });
  test('no match: both empty', () {
    final a = arrangePayoutInstitutions(list, 'zzz');
    expect(a.popular, isEmpty);
    expect(a.rest, isEmpty);
  });
  test('labels: friendly name with the PayMongo name for popular ones; the plain name otherwise', () {
    expect(payoutLabel(list[3]), 'GCash (G-Xchange, Inc.)');
    expect(payoutLabel(list[2]), 'CIMB Philippines, Inc.');
  });
  test('GCash and Maya are e-wallets (account number = mobile number); a bank is not', () {
    expect(eWalletCodes.contains('GXCHPHM2XXX'), isTrue);
    expect(eWalletCodes.contains('PAPHPHM1XXX'), isTrue);
    expect(eWalletCodes.contains('BOPIPHMMXXX'), isFalse);
  });
}
