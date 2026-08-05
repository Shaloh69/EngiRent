"""
Phase 0 fix under test: /verify, /extract-features, /register-face, and
/verify-face are wired with `dependencies=[Depends(require_api_key)]` so an
unauthenticated caller (e.g. anything other than the Node backend) can't
invoke the ML service directly. Previously there was no such gate at all.

require_api_key() has two modes:
  - settings.api_key == ""   -> local dev, no key required, always passes.
  - settings.api_key == "x"  -> production, the X-API-Key header must match
                                 exactly, or the request is rejected (401).
"""

import pytest
from fastapi import HTTPException

from app.config import settings
from app.security import require_api_key


@pytest.fixture(autouse=True)
def restore_api_key():
    original = settings.api_key
    yield
    settings.api_key = original


async def test_no_key_configured_allows_any_request():
    settings.api_key = ""
    await require_api_key(x_api_key=None)  # must not raise


async def test_missing_header_rejected_when_key_configured():
    settings.api_key = "secret-key"
    with pytest.raises(HTTPException) as exc_info:
        await require_api_key(x_api_key=None)
    assert exc_info.value.status_code == 401


async def test_wrong_key_rejected():
    settings.api_key = "secret-key"
    with pytest.raises(HTTPException) as exc_info:
        await require_api_key(x_api_key="wrong-key")
    assert exc_info.value.status_code == 401


async def test_correct_key_allows_request():
    settings.api_key = "secret-key"
    await require_api_key(x_api_key="secret-key")  # must not raise


async def test_empty_string_header_rejected_when_key_configured():
    settings.api_key = "secret-key"
    with pytest.raises(HTTPException) as exc_info:
        await require_api_key(x_api_key="")
    assert exc_info.value.status_code == 401
