/// Where an owner's earnings are sent: one entry of PayMongo's receiving-
/// institution list (GET /payments/receiving-institutions, via the gateway).
class PayoutInstitution {
  final String providerCode;
  final String name;
  const PayoutInstitution(this.providerCode, this.name);

  @override
  String toString() => name;
}

/// The handful most students use, by PayMongo provider code (stable, unlike the
/// names), with the name people actually call them. 2026-10-21: the live list
/// has 94 InstaPay / 124 PESONet entries, and GCash is listed as
/// "G-Xchange, Inc.", so a student searching "gcash" found nothing.
/// Order here is the order shown.
const Map<String, String> popularPayoutLabels = {
  'GXCHPHM2XXX': 'GCash',
  'PAPHPHM1XXX': 'Maya',
  'BNORPHMMXXX': 'BDO',
  'BOPIPHMMXXX': 'BPI',
  'TLBPPHMMXXX': 'Landbank',
  'MBTCPHMMXXX': 'Metrobank',
  'UBPHPHMMXXX': 'UnionBank',
  'SETCPHMMXXX': 'Security Bank',
  'RCBCPHMMXXX': 'RCBC',
  'PNBMPHMMTOD': 'PNB',
  'PNBMPHMMXXX': 'PNB',
  'GOTYPHM2XXX': 'GoTyme',
  'MYDBPHM2XXX': 'Maya Bank',
  'MYYAPHM2XXX': 'Maya Bank',
};

/// Other words people type for an institution.
const Map<String, List<String>> _aliases = {
  'GXCHPHM2XXX': ['gcash', 'g-cash', 'globe'],
  'PAPHPHM1XXX': ['paymaya', 'maya'],
  'TLBPPHMMXXX': ['landbank', 'lbp'],
  'BNORPHMMXXX': ['bdo', 'banco de oro'],
};

/// E-wallets: their "account number" is the owner's mobile number.
const Set<String> eWalletCodes = {'GXCHPHM2XXX', 'PAPHPHM1XXX', 'SHPHPHM2XXX', 'GPNEPHM2XXX', 'DCPHPHM1XXX'};

/// "GCash (G-Xchange, Inc.)" for a popular one; the PayMongo name otherwise.
String payoutLabel(PayoutInstitution i) {
  final friendly = popularPayoutLabels[i.providerCode];
  return friendly == null ? i.name : '$friendly (${i.name})';
}

bool _matches(PayoutInstitution i, String q) {
  if (q.isEmpty) return true;
  final words = [i.name, popularPayoutLabels[i.providerCode] ?? '', ...?_aliases[i.providerCode]];
  return words.any((w) => w.toLowerCase().contains(q));
}

/// The sheet's two sections for a search query: the popular ones first (in
/// [popularPayoutLabels] order), then everything else in PayMongo's order.
({List<PayoutInstitution> popular, List<PayoutInstitution> rest}) arrangePayoutInstitutions(
  List<PayoutInstitution> all,
  String query,
) {
  final q = query.trim().toLowerCase();
  final hits = all.where((i) => _matches(i, q)).toList();
  final order = popularPayoutLabels.keys.toList();
  final popular = hits.where((i) => popularPayoutLabels.containsKey(i.providerCode)).toList()
    ..sort((a, b) => order.indexOf(a.providerCode).compareTo(order.indexOf(b.providerCode)));
  final rest = hits.where((i) => !popularPayoutLabels.containsKey(i.providerCode)).toList();
  return (popular: popular, rest: rest);
}
