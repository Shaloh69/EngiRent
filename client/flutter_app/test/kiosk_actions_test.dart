import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:engirent/core/services/api_service.dart';
import 'package:engirent/features/kiosk/kiosk_actions.dart';
import 'package:engirent/features/kiosk/screens/kiosk_scan_screen.dart';

// 2026-10-21 (user report: "when I scan the QR in the kiosk I get the missing
// fields"): the Home "Scan kiosk" button opened the scanner with no rental.
// These pin the rules it now uses (the same as the rental page's kiosk
// buttons) and what the button does with them. Each rule was removed once and
// a test here failed (PROGRESS.md, APP FIX A1-A3).

const me = 'u-me';
Map<String, dynamic> rental(String status, {String owner = 'u-other', String renter = 'u-other', Map<String, dynamic> extra = const {}}) => {
      'id': 'r-$status-$owner-$renter',
      'status': status,
      'ownerId': owner,
      'renterId': renter,
      'item': {'id': 'i1', 'title': 'Calculator', 'ownerId': owner},
      ...extra,
    };

class FakeApi extends ApiService {
  FakeApi(this.rentals, {this.status = 200});
  final List<Map<String, dynamic>> rentals;
  final int status;
  String? asked;
  @override
  Future<http.Response> get(String endpoint, {bool authenticated = true}) async {
    asked = endpoint;
    return http.Response(jsonEncode({'success': status == 200, 'data': {'rentals': rentals}}), status);
  }
}

void main() {
  group('kioskActionsFor: the rental page rules', () {
    test('owner + AWAITING_DEPOSIT -> place', () {
      final a = kioskActionsFor([rental('AWAITING_DEPOSIT', owner: me)], me);
      expect(a.single.mode, 'place');
    });
    test('the renter of an AWAITING_DEPOSIT rental has nothing to do at the kiosk', () {
      expect(kioskActionsFor([rental('AWAITING_DEPOSIT', renter: me)], me), isEmpty);
    });
    test('renter + DEPOSITED + item confirmed -> retrieve', () {
      final a = kioskActionsFor([rental('DEPOSITED', renter: me, extra: {'verificationStatus': 'APPROVED'})], me);
      expect(a.single.mode, 'retrieve');
    });
    test('renter + DEPOSITED but item not confirmed yet -> nothing (the server would refuse the bay)', () {
      expect(kioskActionsFor([rental('DEPOSITED', renter: me, extra: {'verificationStatus': 'MANUAL_REVIEW'})], me), isEmpty);
      expect(kioskActionsFor([rental('DEPOSITED', renter: me)], me), isEmpty);
    });
    test('renter + ACTIVE -> return; the owner of an ACTIVE rental -> nothing', () {
      expect(kioskActionsFor([rental('ACTIVE', renter: me)], me).single.mode, 'return');
      expect(kioskActionsFor([rental('ACTIVE', owner: me)], me), isEmpty);
    });
    test('owner + released, not yet retrieved -> collect (retrieve), whatever the status', () {
      final a = kioskActionsFor([rental('COMPLETED', owner: me, extra: {'releasedAt': '2026-10-20T10:00:00Z', 'retrievedAt': null})], me);
      expect(a.single.mode, 'retrieve');
      expect(a.single.label, contains('Collect'));
      expect(kioskActionsFor([rental('COMPLETED', owner: me, extra: {'releasedAt': '2026-10-20T10:00:00Z', 'retrievedAt': '2026-10-20T11:00:00Z'})], me), isEmpty);
    });
    test('the renter never gets the owner collect step', () {
      expect(kioskActionsFor([rental('COMPLETED', renter: me, extra: {'releasedAt': '2026-10-20T10:00:00Z'})], me), isEmpty);
    });
    test('other people\'s rentals and finished rentals give nothing; no user id gives nothing', () {
      expect(kioskActionsFor([rental('AWAITING_DEPOSIT'), rental('PENDING', renter: me), rental('COMPLETED', renter: me)], me), isEmpty);
      expect(kioskActionsFor([rental('AWAITING_DEPOSIT', owner: me)], ''), isEmpty);
      // Signed-out / unknown user: a row with an empty owner id must not read as "yours".
      expect(kioskActionsFor([rental('AWAITING_DEPOSIT', owner: '')], ''), isEmpty);
    });
    test('roles also read from the owner/renter objects when the ids are missing', () {
      final r = {'id': 'r1', 'status': 'ACTIVE', 'renter': {'id': me}, 'item': {'title': 'Pico'}};
      expect(kioskActionsFor([r], me).single.mode, 'return');
    });
    test('the rental id and item title are carried to the scanner', () {
      final a = kioskActionsFor([rental('ACTIVE', renter: me)], me).single;
      expect(a.rentalId, isNotEmpty);
      expect(a.itemTitle, 'Calculator');
    });
  });

  group('openKioskFromHome', () {
    KioskAction? opened;
    Future<void> tapWith(WidgetTester t, FakeApi api) async {
      opened = null;
      await t.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (c) => TextButton(
                onPressed: () => openKioskFromHome(c, api: api, userId: me, open: (_, a) async => opened = a),
                child: const Text('Scan kiosk')),
          ),
        ),
      ));
      await t.tap(find.text('Scan kiosk'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 500));
    }

    testWidgets('asks for up to 50 rentals, and with nothing to do says so instead of opening the scanner', (t) async {
      final api = FakeApi([rental('COMPLETED', renter: me)]);
      await tapWith(t, api);
      expect(api.asked, '/rentals?limit=50');
      expect(find.textContaining('Nothing to do at the kiosk right now'), findsOneWidget);
    });

    testWidgets('exactly one visit: straight to the scanner for THAT rental and step, no question', (t) async {
      final api = FakeApi([rental('ACTIVE', renter: me), rental('COMPLETED', renter: me)]);
      await tapWith(t, api);
      expect(find.text('Which rental is this kiosk visit for?'), findsNothing);
      expect(opened?.mode, 'return');
      expect(opened?.rentalId, 'r-ACTIVE-u-other-u-me');
    });

    testWidgets('choosing in the list opens the chosen rental', (t) async {
      final api = FakeApi([
        rental('ACTIVE', renter: me),
        {...rental('AWAITING_DEPOSIT', owner: me), 'item': {'title': 'Oscilloscope'}},
      ]);
      await tapWith(t, api);
      await t.tap(find.text('Oscilloscope'));
      await t.pumpAndSettle();
      expect(opened?.mode, 'place');
    });

    testWidgets('two possible visits: asks which rental, listing both', (t) async {
      final api = FakeApi([
        rental('ACTIVE', renter: me),
        {...rental('AWAITING_DEPOSIT', owner: me), 'item': {'title': 'Oscilloscope'}},
      ]);
      await tapWith(t, api);
      expect(find.text('Which rental is this kiosk visit for?'), findsOneWidget);
      expect(find.text('Calculator'), findsOneWidget);
      expect(find.text('Oscilloscope'), findsOneWidget);
      expect(find.text('Return the item'), findsOneWidget);
      expect(find.text('Place the item in the kiosk'), findsOneWidget);
    });

    testWidgets('a failed request says it could not load, and opens nothing', (t) async {
      final api = FakeApi(const [], status: 500);
      await tapWith(t, api);
      expect(find.textContaining("Can't load your rentals right now"), findsOneWidget);
      expect(find.text('Which rental is this kiosk visit for?'), findsNothing);
      expect(opened, isNull);
    });
  });

  testWidgets('the scanner opened WITHOUT a rental says what to do instead of scanning', (t) async {
    await t.pumpWidget(const MaterialApp(home: KioskScanScreen(rentalId: '', mode: 'place')));
    await t.pump();
    expect(find.text(KioskScanScreen.noRentalMessage), findsOneWidget);
    // Scanning again cannot help without a rental: the only way out is back.
    expect(find.text('Scan again'), findsNothing);
    expect(find.text('Go back'), findsOneWidget);
    expect(find.text("Hand-off didn't complete"), findsNothing);
  });
}
