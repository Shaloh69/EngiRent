"""
D-111: the server had pytesseract but no Tesseract binary on PATH, so OCR
failed silently on every live check. `ocr._locate_tesseract` falls back to the
standard Windows install path when `tesseract` is not on PATH.
"""

from unittest import mock

import pytesseract
import pytest

from app.utils import ocr


@pytest.fixture(autouse=True)
def restore():
    cmd = pytesseract.pytesseract.tesseract_cmd
    yield
    pytesseract.pytesseract.tesseract_cmd = cmd
    ocr._located = False


def test_default_path_is_the_installers_real_path():
    # Written once with an escape bug that turned "\t" into a TAB: pin it.
    assert ocr._WINDOWS_DEFAULT == "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
    assert "\t" not in ocr._WINDOWS_DEFAULT


def test_uses_default_install_when_not_on_path():
    ocr._located = False
    with mock.patch("shutil.which", return_value=None), mock.patch("os.path.exists", return_value=True):
        ocr._locate_tesseract(pytesseract)
    assert pytesseract.pytesseract.tesseract_cmd == ocr._WINDOWS_DEFAULT


def test_leaves_path_alone_when_tesseract_is_on_path():
    before = pytesseract.pytesseract.tesseract_cmd
    ocr._located = False
    with mock.patch("shutil.which", return_value="C:\\tools\\tesseract.exe"):
        ocr._locate_tesseract(pytesseract)
    assert pytesseract.pytesseract.tesseract_cmd == before


def test_no_binary_still_returns_empty_text_not_an_error():
    import numpy as np

    ocr._located = False
    with mock.patch("shutil.which", return_value=None), mock.patch("os.path.exists", return_value=False):
        assert ocr.extract_text(np.zeros((40, 40, 3), "uint8")) == ""
