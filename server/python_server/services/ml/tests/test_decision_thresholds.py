"""
E1 — the 85 / 60 / retry-10 decision boundaries, asserted rather than assumed.

`ENGIRENT-CLAUDE.md` §1 puts these thresholds explicitly OUT of scope for the
redesign track: "the 85 / 60 / retry-10 thresholds stay put unless A-3's
measured confidence distribution says otherwise." That makes them a contract,
and a contract with no test is a comment.

Two different things are checked, and the distinction matters:

  1. **The values themselves** (85.0 / 60.0 / 10). If someone moves a threshold
     to paper over a bad signal — the exact failure mode §1 warns about — these
     tests fail and say so.
  2. **The mapping at the boundary.** `>= 85` and `>= 60` are inclusive, so a
     score of exactly 85.0 must APPROVE and exactly 60.0 must go to manual
     review. Off-by-one at a boundary is the classic way a threshold silently
     shifts without anyone editing a number.

`_make_decision` is pure — it reads only its arguments and `settings` — so it
is called unbound with `self=None` rather than constructing a HybridVerifier,
which would load ResNet50 and every CV model for a function that touches none
of them.
"""

import pytest

from app.config import settings
from app.comparison.hybrid import HybridVerifier

# Unbound: `self` is unused by the method under test.
decide = lambda confidence, attempt: HybridVerifier._make_decision(  # noqa: E731
    None, confidence, attempt
)


class TestThresholdValues:
    """The numbers themselves are the contract."""

    def test_verified_threshold_is_85(self):
        assert settings.threshold_verified == 85.0

    def test_manual_review_threshold_is_60(self):
        assert settings.threshold_manual_review == 60.0

    def test_max_retry_attempts_is_10(self):
        assert settings.max_retry_attempts == 10


class TestApprovalBoundary:
    """>= 85 approves; anything below it must not."""

    def test_exactly_85_approves(self):
        decision, _ = decide(85.0, 1)
        assert decision == "APPROVED"

    def test_just_below_85_does_not_approve(self):
        decision, _ = decide(84.999, 1)
        assert decision == "PENDING"

    def test_perfect_score_approves(self):
        decision, _ = decide(100.0, 1)
        assert decision == "APPROVED"

    @pytest.mark.parametrize("attempt", [1, 5, 10, 11])
    def test_approval_does_not_depend_on_attempt_number(self, attempt):
        # A tenth attempt that finally scores 90 is still a match. The retry
        # budget governs failure, not success.
        decision, _ = decide(90.0, attempt)
        assert decision == "APPROVED"


class TestManualReviewBand:
    """60-84 is a human's decision, never the machine's."""

    def test_exactly_60_goes_to_manual_review(self):
        decision, _ = decide(60.0, 1)
        assert decision == "PENDING"

    def test_top_of_the_band_goes_to_manual_review(self):
        decision, _ = decide(84.9, 1)
        assert decision == "PENDING"

    def test_just_below_60_leaves_the_band(self):
        decision, _ = decide(59.999, 1)
        assert decision != "PENDING"

    @pytest.mark.parametrize("attempt", [1, 10, 99])
    def test_manual_review_does_not_depend_on_attempt_number(self, attempt):
        # PENDING must not degrade into REJECTED just because the user retried;
        # a 70% match is a human's call on the first try and on the last.
        decision, _ = decide(70.0, attempt)
        assert decision == "PENDING"


class TestRetryAndRejection:
    """< 60 retries until the budget is gone, then rejects."""

    def test_low_score_retries_while_budget_remains(self):
        decision, message = decide(30.0, 1)
        assert decision == "RETRY"
        assert "1/10" in message

    def test_last_allowed_attempt_still_retries(self):
        decision, _ = decide(30.0, settings.max_retry_attempts - 1)
        assert decision == "RETRY"

    def test_attempt_at_the_cap_rejects(self):
        decision, _ = decide(30.0, settings.max_retry_attempts)
        assert decision == "REJECTED"

    def test_beyond_the_cap_rejects(self):
        decision, _ = decide(0.0, settings.max_retry_attempts + 5)
        assert decision == "REJECTED"

    def test_zero_confidence_is_never_approved_or_pending(self):
        decision, _ = decide(0.0, 1)
        assert decision in {"RETRY", "REJECTED"}


class TestNoSilentApproval:
    """The property that actually matters: nothing below 85 ever auto-approves,
    at any attempt number. Swept rather than spot-checked, because this is the
    one failure that releases a renter's money on a bad match."""

    @pytest.mark.parametrize(
        "confidence", [0.0, 1.0, 25.0, 59.9, 60.0, 70.0, 84.0, 84.99]
    )
    @pytest.mark.parametrize("attempt", [1, 3, 10, 50])
    def test_below_threshold_never_approves(self, confidence, attempt):
        decision, _ = decide(confidence, attempt)
        assert decision != "APPROVED"
