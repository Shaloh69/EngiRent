import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/services/api_service.dart';
import '../auth/providers/auth_provider.dart';
import 'screens/kiosk_scan_screen.dart';

/// One thing this student can do at the kiosk right now.
class KioskAction {
  final String rentalId;
  final String mode; // place | retrieve | return (KioskScanScreen modes)
  final String itemTitle;
  final String label;

  const KioskAction({
    required this.rentalId,
    required this.mode,
    required this.itemTitle,
    required this.label,
  });
}

/// What the Home "Scan kiosk" button can start, from the raw `GET /rentals`
/// list. Before 2026-10-21 that button opened the scanner with NO rental, so
/// every scan from it came back "Missing required fields" (the API needs to
/// know which rental the visit is for).
///
/// The rules are the ones the rental page already uses to show its kiosk
/// buttons (rental_detail_screen.dart, "Place Item at Kiosk" / "Pick Up Item
/// from Kiosk" / "Return Item to Kiosk" / "Collect Your Item from the Kiosk").
/// Roles come from the list's own `ownerId` / `renterId`: the list does not
/// include the item's owner object the model reads elsewhere.
List<KioskAction> kioskActionsFor(List<dynamic> rentals, String myId) {
  final out = <KioskAction>[];
  if (myId.isEmpty) return out;
  for (final raw in rentals) {
    if (raw is! Map) continue;
    final r = raw.cast<String, dynamic>();
    final id = r['id'] as String?;
    if (id == null || id.isEmpty) continue;
    final item = r['item'];
    final ownerId = (r['ownerId'] ??
        (r['owner'] is Map ? r['owner']['id'] : null) ??
        (item is Map ? item['ownerId'] : null)) as String?;
    final renterId = (r['renterId'] ??
        (r['renter'] is Map ? r['renter']['id'] : null)) as String?;
    final isOwner = ownerId == myId;
    final isRenter = renterId == myId;
    final status = r['status'] as String? ?? '';
    final title = (item is Map ? item['title'] as String? : null) ?? 'Your rental';

    KioskAction a(String mode, String label) =>
        KioskAction(rentalId: id, mode: mode, itemTitle: title, label: label);

    if (isOwner && status == 'AWAITING_DEPOSIT') {
      out.add(a('place', 'Place the item in the kiosk'));
    } else if (isRenter && status == 'DEPOSITED' && r['verificationStatus'] == 'APPROVED') {
      out.add(a('retrieve', 'Pick up the item'));
    } else if (isRenter && status == 'ACTIVE') {
      out.add(a('return', 'Return the item'));
    }
    if (isOwner && r['releasedAt'] != null && r['retrievedAt'] == null) {
      out.add(a('retrieve', 'Collect your item back'));
    }
  }
  return out;
}

/// The Home "Scan kiosk" button: work out which rental the visit is for, then
/// open the scanner for it. Nothing to do -> say so; one -> straight in;
/// several -> let the student pick.
Future<void> openKioskFromHome(
  BuildContext context, {
  ApiService? api,
  String? userId,
  Future<void> Function(BuildContext, KioskAction)? open,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final myId = userId ?? context.read<AuthProvider>().user?.id ?? '';
  List<dynamic> rentals;
  try {
    final resp = await (api ?? ApiService()).get('/rentals?limit=50');
    final body = jsonDecode(resp.body);
    if (resp.statusCode != 200 || body['success'] != true) throw Exception('status ${resp.statusCode}');
    rentals = (body['data']?['rentals'] as List<dynamic>?) ?? const [];
  } catch (_) {
    messenger.showSnackBar(const SnackBar(
      content: Text("Can't load your rentals right now. Check your internet and try again."),
    ));
    return;
  }
  if (!context.mounted) return;

  final actions = kioskActionsFor(rentals, myId);
  if (actions.isEmpty) {
    messenger.showSnackBar(const SnackBar(
      content: Text('Nothing to do at the kiosk right now. A rental shows its kiosk step '
          'when it is time to drop off, pick up or return an item.'),
    ));
    return;
  }

  KioskAction? chosen = actions.length == 1 ? actions.first : null;
  chosen ??= await showModalBottomSheet<KioskAction>(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text('Which rental is this kiosk visit for?',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          ),
          for (final a in actions)
            ListTile(
              leading: const Icon(Icons.qr_code_scanner_rounded),
              title: Text(a.itemTitle, maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: Text(a.label),
              onTap: () => Navigator.pop(sheet, a),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
  if (chosen == null || !context.mounted) return;
  if (open != null) return open(context, chosen);
  await Navigator.push(
    context,
    MaterialPageRoute(builder: (_) => KioskScanScreen(rentalId: chosen!.rentalId, mode: chosen.mode)),
  );
}
