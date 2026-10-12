import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engirent/features/kiosk/widgets/retry_feedback_card.dart';

/// The retry screen tells the person at the open locker WHY the AI asked for a
/// retry and shows what the locker camera saw (user request 2026-10-12).
/// Network images cannot load under `flutter test`, so every photo falls back
/// to its placeholder: that also pins that a broken photo never breaks the card.
void main() {
  const reason = 'More than one object is in the locker. Leave only the rented item inside.';
  final urls = [
    'https://api.example/media/secure/a',
    'https://api.example/media/secure/b',
    'https://api.example/media/secure/c',
  ];

  Widget host(Widget child) => MaterialApp(
        home: Scaffold(
          backgroundColor: const Color(0xFF0B1A33),
          body: SingleChildScrollView(child: Padding(padding: const EdgeInsets.all(16), child: child)),
        ),
      );

  testWidgets('shows the AI sentence, a move-it heading and one photo per URL', (tester) async {
    await tester.pumpWidget(host(RetryFeedbackCard(reason: reason, reposition: true, imageUrls: urls)));
    await tester.pump();

    expect(find.byKey(const ValueKey('retry-feedback-reason')), findsOneWidget);
    expect(find.text(reason), findsOneWidget);
    expect(find.text('Why the AI asked you to move it'), findsOneWidget);
    for (final u in urls) {
      expect(find.byKey(ValueKey('retry-photo-$u')), findsOneWidget);
    }
  });

  testWidgets('a weak match (not a placement problem) gets the neutral heading', (tester) async {
    await tester.pumpWidget(host(RetryFeedbackCard(reason: 'Item did not match the listing.', reposition: false, imageUrls: const [])));
    expect(find.text('What the AI said'), findsOneWidget);
    expect(find.text('Why the AI asked you to move it'), findsNothing);
  });

  testWidgets('photos only, no sentence: still renders, with no reason line', (tester) async {
    await tester.pumpWidget(host(RetryFeedbackCard(reason: null, reposition: false, imageUrls: [urls.first])));
    await tester.pump();
    expect(find.byKey(const ValueKey('retry-feedback-reason')), findsNothing);
    expect(find.byKey(ValueKey('retry-photo-${urls.first}')), findsOneWidget);
  });

  testWidgets('tapping a photo opens it full size, and Close dismisses it', (tester) async {
    await tester.pumpWidget(host(RetryFeedbackCard(reason: reason, reposition: true, imageUrls: [urls.first])));
    await tester.pump();
    await tester.tap(find.byKey(ValueKey('retry-photo-${urls.first}')));
    await tester.pumpAndSettle();
    expect(find.byType(InteractiveViewer), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.byType(InteractiveViewer), findsNothing);
  });

  test('hasContent: the card is skipped when the server sent nothing', () {
    expect(RetryFeedbackCard.hasContent(null, const []), isFalse);
    expect(RetryFeedbackCard.hasContent('   ', const []), isFalse);
    expect(RetryFeedbackCard.hasContent(reason, const []), isTrue);
    expect(RetryFeedbackCard.hasContent(null, urls), isTrue);
  });

  // D-118: the server's attemptNumber is the check that just ran
  // (returnAttemptCount + 1), so a first retry sends 1. The screen only shows
  // the AI card from attempt 2, so the next attempt must be 2, not 1.
  test('attemptAfterRetry: the first retry puts the person on attempt 2', () {
    expect(RetryFeedbackCard.attemptAfterRetry(1, 0), 2); // the real first-retry payload
    expect(RetryFeedbackCard.attemptAfterRetry(2, 2), 3);
    expect(RetryFeedbackCard.attemptAfterRetry(null, 0), 2); // an older server sent no number
    expect(RetryFeedbackCard.attemptAfterRetry(null, 2), 3);
  });
}
