import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/core/models/rental_model.dart';
import 'package:engirent/core/services/fee_settings.dart';

// Renter fees (2026-10-21). The app only SHOWS prices, but they must match
// what the server charges (server/services/pricing.ts tests the same numbers).
// Each rule was removed once and a test here failed.

void main() {
  final f = FeeSettings.instance;
  setUp(() {
    f.platformFeePct = 2;
    f.serviceFee = 10;
  });

  test('the user\'s examples: ₱102/day; 1 day ₱112; 3 days ₱316; ₱1 -> ₱11.02', () {
    expect(f.shownPerDay(100), 102);
    final one = f.quote(100, 1);
    expect([one.rent, one.platformFee, one.serviceFee, one.total], [100, 2, 10, 112]);
    final three = f.quote(100, 3);
    expect([three.rent, three.platformFee, three.serviceFee, three.total], [300, 6, 10, 316]);
    expect(three.rentWithPlatformFee, 306);
    expect(f.quote(1, 1).total, 11.02);
  });

  test('rounds to whole centavos, like the server', () {
    f.platformFeePct = 2.5;
    final q = f.quote(33.33, 3);
    expect([q.rent, q.platformFee, q.total], [99.99, 2.5, 112.49]);
    expect(f.shownPerDay(33.33), 34.16);
  });

  test('settings from /app-config are applied; malformed ones ignored', () {
    f.apply({'platformFeePct': 5, 'serviceFee': 15});
    expect(f.quote(100, 1).total, 120);
    f.apply({'platformFeePct': -3, 'serviceFee': 'x'});
    expect([f.platformFeePct, f.serviceFee], [5, 15]);
    f.apply(null);
    expect([f.platformFeePct, f.serviceFee], [5, 15]);
  });

  test('peso(): whole pesos without decimals, otherwise two', () {
    expect(peso(102), '₱102');
    expect(peso(102.5), '₱102.50');
  });

  test('a rental\'s renter total = rent + fees; older rentals (no fee fields) = rent', () {
    Map<String, dynamic> j(Map<String, dynamic> extra) => {
          'id': 'r1', 'status': 'PENDING', 'startDate': '2026-10-21T00:00:00Z', 'endDate': '2026-10-22T00:00:00Z',
          'totalPrice': 100, 'securityDeposit': 50, 'item': {'id': 'i1', 'title': 'Glue Gun', 'images': []},
          'createdAt': '2026-10-21T00:00:00Z', ...extra,
        };
    final withFees = RentalModel.fromJson(j({'platformFee': 2, 'serviceFee': 10, 'ownerId': 'o1'}));
    expect(withFees.renterTotal, 112);
    expect(withFees.ownerId, 'o1');
    expect(RentalModel.fromJson(j({})).renterTotal, 100);
  });
}
