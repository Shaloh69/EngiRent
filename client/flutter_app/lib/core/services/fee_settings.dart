/// Renter fees (user ruling 2026-10-21; server: services/pricing.ts).
///
/// The renter pays the owner's price (rent) + a platform fee (a % of the rent,
/// shown INSIDE the daily price: ₱100 -> "₱102/day") + a service fee once per
/// rental ("+ ₱10 service fee"). 1 day at ₱100 = ₱112.
///
/// These numbers are for SHOWING prices only. The server computes every
/// charge itself and stores it on the booking; it never trusts the app's sum.
/// Loaded from GET /app-config at launch (force_update_gate.dart); until then,
/// or if that call fails, the defaults below apply.
class FeeSettings {
  FeeSettings._();
  static final FeeSettings instance = FeeSettings._();

  double platformFeePct = 2;
  double serviceFee = 10;

  /// From the `fees` object of /app-config; ignores anything malformed.
  void apply(Object? json) {
    if (json is! Map) return;
    final pct = json['platformFeePct'];
    final fee = json['serviceFee'];
    if (pct is num && pct >= 0) platformFeePct = pct.toDouble();
    if (fee is num && fee >= 0) serviceFee = fee.toDouble();
  }

  static double _r2(double n) => (n * 100).roundToDouble() / 100;

  /// The per-day price students see (the owner's price + the platform fee).
  double shownPerDay(double ownerPricePerDay) => _r2(ownerPricePerDay * (1 + platformFeePct / 100));

  /// The full price of a booking.
  FeeQuote quote(double ownerPricePerDay, int days) {
    final rent = _r2(ownerPricePerDay * days);
    final platform = _r2(rent * platformFeePct / 100);
    final service = _r2(serviceFee);
    return FeeQuote(rent: rent, platformFee: platform, serviceFee: service, total: _r2(rent + platform + service));
  }
}

class FeeQuote {
  final double rent;
  final double platformFee;
  final double serviceFee;
  final double total;
  const FeeQuote({required this.rent, required this.platformFee, required this.serviceFee, required this.total});

  /// Rent + platform fee: what "₱102 × 3 days" adds up to.
  double get rentWithPlatformFee => rent + platformFee;
}

/// "₱102" or "₱102.50": whole pesos without decimals, otherwise two.
String peso(double v) => v == v.roundToDouble() ? '₱${v.toStringAsFixed(0)}' : '₱${v.toStringAsFixed(2)}';
