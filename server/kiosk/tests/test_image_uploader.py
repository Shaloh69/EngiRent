"""The kiosk's image upload retries transport failures (2026-10-12).

Found live: one upload timed out on a lossy Wi-Fi link, nothing repeated it, the
server got zero kiosk images and the AI check could not run for an item that
was in the locker. These pin: a timeout is retried and can still succeed, a
server refusal is NOT retried, every attempt sends a fresh form, and giving up
returns an empty list (the caller's existing "no images" path).
"""

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import image_uploader  # noqa: E402


class _Resp:
    def __init__(self, status=200, payload=None, text=""):
        self.status = status
        self._payload = payload or {"urls": ["u1", "u2", "u3"]}
        self._text = text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def json(self):
        return self._payload

    async def text(self):
        return self._text


class _Session:
    """Plays a script of outcomes, one per POST; an Exception is raised."""

    script: list = []
    forms: list = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def post(self, url, data=None, headers=None, timeout=None):
        _Session.forms.append(data)
        outcome = _Session.script.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture(autouse=True)
def _fake(monkeypatch):
    _Session.script = []
    _Session.forms = []
    monkeypatch.setattr(image_uploader.aiohttp, "ClientSession", _Session)

    async def _no_wait(_):
        return None

    monkeypatch.setattr(image_uploader.asyncio, "sleep", _no_wait)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_timeout_is_retried_and_the_second_attempt_succeeds():
    _Session.script = [asyncio.TimeoutError(), _Resp()]
    urls = run(image_uploader.upload_locker_images(1, [b"a", b"b", b"c"], "rental-1"))
    assert urls == ["u1", "u2", "u3"]
    assert len(_Session.forms) == 2


def test_each_attempt_sends_a_fresh_form():
    _Session.script = [asyncio.TimeoutError(), _Resp()]
    run(image_uploader.upload_locker_images(1, [b"a"], None))
    assert _Session.forms[0] is not _Session.forms[1]


def test_gives_up_after_three_attempts_with_an_empty_list():
    _Session.script = [asyncio.TimeoutError(), OSError("down"), asyncio.TimeoutError()]
    assert run(image_uploader.upload_locker_images(1, [b"a"], "r")) == []
    assert len(_Session.forms) == 3


def test_a_server_refusal_is_not_retried():
    _Session.script = [_Resp(status=403, text="forbidden")]
    assert run(image_uploader.upload_locker_images(1, [b"a"], "r")) == []
    assert len(_Session.forms) == 1


def test_no_frames_means_no_request():
    assert run(image_uploader.upload_locker_images(1, [], "r")) == []
    assert _Session.forms == []
