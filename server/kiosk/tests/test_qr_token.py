"""
E1 — the kiosk QR session token, tested against what the code actually does.

`API-TEST-PLAN.md` lists "QR token TTL (90 s) and signature — expired and
forged tokens rejected" as specifically risky. Writing these tests turned up a
mismatch between the documentation and the code, and the repo wins:

    CLAUDE.md and Implemented.md §6 say the kiosk "validates its own QR
    signature/TTL". `validate_qr_token_internal` never recomputes the
    signature. It accepts a token only if it is byte-identical to the ONE
    token currently live in this process, and only inside the TTL, and it
    invalidates it on use.

That is a stricter check than signature verification, not a weaker one — a
correctly-signed token that was not the live one is still refused, and every
token is single-use — but the docs describe a mechanism that isn't there, so
they are corrected rather than the code. The tests below pin the real
behaviour, including the "correctly signed but never issued" case, so that if
anyone later "restores" signature checking they have to confront what it would
actually loosen.

Stdlib unittest on purpose: the kiosk venv has no pytest, on the Pi or here,
and a test that needs a pip install before it runs is a test nobody runs.

    cd server/kiosk && venv/Scripts/python.exe -m unittest discover -s tests -t .
    (on the Pi:      python3 -m unittest discover -s tests -t .)
"""

import hashlib
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kiosk_ui import server  # noqa: E402


class QrTokenTestCase(unittest.TestCase):
    def setUp(self):
        # Every test starts from "no token has been issued".
        server._active_qr_token = None
        server._qr_token_expiry = 0.0

    def tearDown(self):
        server._active_qr_token = None
        server._qr_token_expiry = 0.0

    def _issue(self):
        """Mint a token the way GET /api/qr-token does."""
        server._active_qr_token = server._make_session_token()
        server._qr_token_expiry = time.monotonic() + server._QR_TTL
        return server._active_qr_token


class TestTokenShape(QrTokenTestCase):
    def test_ttl_is_90_seconds(self):
        # D-9 regression: the kiosk screen told users 30 s while the real TTL
        # was 90 s, because the caption reported the poll interval instead.
        # The UI now renders whatever this value is, so the value is the
        # contract.
        self.assertEqual(server._QR_TTL, 90.0)

    def test_token_carries_the_kiosk_id_first(self):
        # Node parses the kiosk id out of the first colon-delimited segment
        # (index.ts, app:kiosk_scan), so the ordering is load-bearing.
        token = self._issue()
        parts = token.split(":")
        self.assertEqual(len(parts), 4)
        self.assertEqual(parts[0], os.getenv("KIOSK_ID", "kiosk-1"))

    def test_each_mint_is_unique(self):
        first = server._make_session_token()
        second = server._make_session_token()
        self.assertNotEqual(first, second)

    def test_api_reports_the_real_ttl(self):
        client = server.app.test_client()
        body = client.get("/api/qr-token").get_json()
        self.assertEqual(body["ttl"], 90)
        self.assertLessEqual(body["expires_in"], 90)
        self.assertGreater(body["expires_in"], 0)


class TestValidAcceptance(QrTokenTestCase):
    def test_the_live_token_is_accepted(self):
        token = self._issue()
        self.assertTrue(server.validate_qr_token_internal(token))

    def test_acceptance_is_single_use(self):
        token = self._issue()
        self.assertTrue(server.validate_qr_token_internal(token))
        # A captured token replayed a second later must not open anything —
        # this is the property that makes a photographed QR worthless.
        self.assertFalse(server.validate_qr_token_internal(token))

    def test_a_new_mint_invalidates_the_previous_token(self):
        first = self._issue()
        second = self._issue()
        self.assertFalse(server.validate_qr_token_internal(first))
        self.assertTrue(server.validate_qr_token_internal(second))


class TestExpiry(QrTokenTestCase):
    def test_token_one_second_from_expiry_is_still_accepted(self):
        token = self._issue()
        server._qr_token_expiry = time.monotonic() + 1.0
        self.assertTrue(server.validate_qr_token_internal(token))

    def test_expired_token_is_refused(self):
        token = self._issue()
        # Wind the clock past the TTL rather than sleeping 90 seconds.
        server._qr_token_expiry = time.monotonic() - 0.001
        self.assertFalse(server.validate_qr_token_internal(token))

    def test_expiry_is_checked_even_for_the_exact_live_token(self):
        token = self._issue()
        server._qr_token_expiry = time.monotonic() - 100
        self.assertFalse(server.validate_qr_token_internal(token))
        self.assertIsNotNone(server._active_qr_token)  # not consumed, just refused


class TestForgeryAndJunk(QrTokenTestCase):
    def test_empty_and_missing_tokens_are_refused(self):
        self._issue()
        for junk in ["", None, "   ", "not-a-token", "a:b:c:d"]:
            with self.subTest(token=junk):
                self.assertFalse(server.validate_qr_token_internal(junk))

    def test_nothing_is_accepted_when_no_token_is_live(self):
        # Kiosk just booted, or the last token was already used.
        self.assertFalse(server.validate_qr_token_internal("anything"))

    def test_a_tampered_live_token_is_refused(self):
        token = self._issue()
        tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
        self.assertFalse(server.validate_qr_token_internal(tampered))

    def test_a_correctly_signed_token_that_was_never_issued_is_refused(self):
        """The documentation's version of this check would ACCEPT this token.

        Built exactly the way `_make_session_token` builds one — same secret,
        same digest, current timestamp — but never issued by this kiosk. A
        signature-only check passes it; the real check refuses it, because it
        is not the live token. This is why the docs are being corrected to
        match the code rather than the other way round.
        """
        self._issue()
        kiosk_id = os.getenv("KIOSK_ID", "kiosk-1")
        payload = f"{kiosk_id}:{'f' * 32}:{int(time.time())}"
        sig = hashlib.sha256(
            f"{payload}:{server._KIOSK_SECRET}".encode()
        ).hexdigest()[:16]
        forged = f"{payload}:{sig}"

        self.assertFalse(server.validate_qr_token_internal(forged))

    def test_a_refused_token_does_not_consume_the_live_one(self):
        token = self._issue()
        server.validate_qr_token_internal("wrong")
        # An attacker spraying junk must not be able to invalidate the token
        # the real user in front of the kiosk is about to scan.
        self.assertTrue(server.validate_qr_token_internal(token))


if __name__ == "__main__":
    unittest.main()
