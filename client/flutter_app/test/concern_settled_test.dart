import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:engirent/core/constants/app_colors.dart';
import 'package:engirent/features/concerns/concern_api.dart';
import 'package:engirent/features/concerns/screens/concern_case_screen.dart';

/// 2026-10-15, ER-CON-2026-0002: the renter paid the ₱200 they owed, staff
/// confirmed it, and the case still read as a red "Decided: upheld" with
/// "Still owed by the renter ₱200.00 (paid)". The ruling stays upheld; the case
/// must read as settled. Case data below is the live case's, renter's view.
Map<String, dynamic> caseJson({required bool paid}) => {
  'id': 'fef067a7',
  'referenceNo': 'ER-CON-2026-0002',
  'kind': 'DAMAGE_ON_RETURN',
  'title': 'Damage found after the return',
  'status': 'UPHELD',
  'viewerRole': 'RESPONDENT',
  'viewerParty': 'RENTER',
  'itemTitle': 'Calculator',
  'rentalId': 'r1',
  'reporterParty': 'OWNER',
  'responseDueAt': '2026-10-16T15:05:57.000Z',
  'respondedAt': '2026-10-15T15:10:19.000Z',
  'canRespond': false,
  'settled': paid,
  'nextStep': paid
      ? 'Settled. Your ₱200.00 payment was confirmed on Oct 15, 2026, 11:18 PM and the limit on your account is lifted. Nothing more to do. The decision stays on record as upheld: it says who was responsible for the damage, not that anything is still owed.'
      : 'Pay the ₱200.00 you owe to lift the limit on your account.',
  'decision': {
    'decidedAt': '2026-10-15T15:12:16.000Z',
    'responsibilityPct': 100,
    'assessedAmount': 300,
    'fromDeposit': 100,
    'amountOwed': 200,
    'owedPaidAt': paid ? '2026-10-15T15:18:43.000Z' : null,
  },
  'payment': null,
  'evidence': <Map<String, dynamic>>[],
  'events': [
    {
      'type': 'REPORTED',
      'actor': 'OWNER',
      'message': 'The owner reported: Damage found after the return.',
      'at': '2026-10-15T15:05:57.000Z',
    },
    {'type': 'ANSWERED', 'actor': 'RENTER', 'message': 'The renter answered.', 'at': '2026-10-15T15:10:19.000Z'},
    {
      'type': 'DECIDED',
      'actor': 'ADMIN',
      'message':
          'The admin assessed the damage at ₱300.00 and found the renter 100% responsible: ₱300.00. ₱100.00 is taken from the held deposit and paid to the owner; ₱0.00 of the deposit is refunded to the renter.',
      'at': '2026-10-15T15:12:16.000Z',
    },
    if (paid) ...[
      {
        'type': 'PAYMENT_SUBMITTED',
        'actor': 'RENTER',
        'message': 'The renter sent ₱200.00 (reference 878136405); waiting for staff to confirm.',
        'at': '2026-10-15T15:18:09.000Z',
      },
      {
        'type': 'PAYMENT_CONFIRMED',
        'actor': 'ADMIN',
        'message': 'Staff confirmed the ₱200.00 payment.',
        'at': '2026-10-15T15:18:43.000Z',
      },
    ],
  ],
};

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    GoogleFonts.config.allowRuntimeFetching = false;
  });
  tearDown(() => ConcernApi.getOverride = null);

  test('the pill leads with Settled only for a settled upheld case', () {
    expect(ConcernText.status('UPHELD', settled: true), 'Settled · upheld');
    expect(ConcernText.status('PARTLY_UPHELD', settled: true), 'Settled · partly upheld');
    expect(ConcernText.status('UPHELD'), 'Decided: upheld');
    expect(ConcernText.status('NOT_UPHELD', settled: true), 'Decided: not upheld');
    expect(ConcernText.statusColor('UPHELD', settled: true), AppColors.success);
    expect(ConcernText.statusColor('UPHELD'), AppColors.error);
  });

  for (final paid in [true, false]) {
    testWidgets('the case screen, ${paid ? 'paid' : 'still owed'}', (tester) async {
      ConcernApi.getOverride = (_) async => caseJson(paid: paid);
      await tester.binding.setSurfaceSize(const Size(420, 1100));
      final key = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          home: RepaintBoundary(
            key: key,
            child: const ConcernCaseScreen(concernId: 'fef067a7'),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.takeException(), isNull);
      if (paid) {
        expect(find.text('SETTLED · UPHELD'), findsOneWidget);
        expect(find.text('DECIDED: UPHELD'), findsNothing);
        expect(find.text('Paid by the renter'), findsOneWidget);
        expect(find.text('Payment confirmed'), findsOneWidget);
        expect(find.text('Still owed by the renter'), findsNothing);
        expect(find.textContaining('Settled. Your ₱200.00 payment was confirmed'), findsOneWidget);
      } else {
        expect(find.text('DECIDED: UPHELD'), findsOneWidget);
        expect(find.text('Still owed by the renter'), findsOneWidget);
        expect(find.text('Paid by the renter'), findsNothing);
      }
      // Optional PNG for a person to look at. With CONCERN_OUT set, the real-time
      // capture also lets google_fonts try (and fail) to load its fonts, which
      // the runner reports as an error; the image is written regardless.
      final out = Platform.environment['CONCERN_OUT'];
      if (out != null) {
        await tester.runAsync(() async {
          final b = key.currentContext!.findRenderObject() as RenderRepaintBoundary;
          final img = await b.toImage(pixelRatio: 1.0);
          final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
          await File(
            out.replaceFirst('.png', paid ? '_paid.png' : '_owed.png'),
          ).writeAsBytes(bytes!.buffer.asUint8List());
        });
      }
    });
  }
}
