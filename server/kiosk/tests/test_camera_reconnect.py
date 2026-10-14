"""
D-119 — a locker camera whose stream breaks is reopened by the kiosk itself.

Found live 2026-10-14: locker 3 captured at 19:37, then every read failed
("Camera read failed") until the service restarted, because the camera was
opened once at boot and never again. These tests drive the real
`CameraManager.capture_locker` with fake captures in place of the GStreamer
pipeline; no hardware, no real waits.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hardware import camera_manager  # noqa: E402

FRAME = np.zeros((4, 4, 3), dtype=np.uint8)


class FakeCap:
    def __init__(self, reads):
        self._reads = list(reads)  # True = a frame, False = a failed read
        self.released = False

    def read(self):
        ok = self._reads.pop(0) if self._reads else False
        return (True, FRAME) if ok else (False, None)

    def release(self):
        self.released = True


@pytest.fixture
def opens(monkeypatch):
    """Queue of captures `_open_usb` hands out, in order; records each open."""
    queue, calls = [], []

    def fake_open(device, w, h):
        calls.append(device)
        return queue.pop(0) if queue else None

    monkeypatch.setattr(camera_manager, "_open_usb", fake_open)
    monkeypatch.setattr(camera_manager, "MOCK_CAMERA", False)
    monkeypatch.setattr(camera_manager.time, "sleep", lambda s: None)
    return queue, calls


def manager_with(queue, boot_caps):
    """A CameraManager whose boot-time opens return `boot_caps` (locker 1..4)."""
    queue.extend(boot_caps)
    return camera_manager.CameraManager()


def test_a_broken_stream_is_reopened_and_the_capture_still_returns_every_frame(opens):
    queue, calls = opens
    dead = FakeCap([False, False, False])
    m = manager_with(queue, [FakeCap([True] * 3), FakeCap([True] * 3), dead, FakeCap([True] * 3)])
    queue.append(FakeCap([True] * 3))  # what the reopen gets
    frames = m.capture_locker(3)
    assert len(frames) == 3
    assert dead.released
    assert len(calls) == 5  # 4 at boot + 1 reopen


def test_a_camera_missing_at_boot_is_opened_when_it_is_next_used(opens):
    queue, calls = opens
    m = manager_with(queue, [FakeCap([True] * 3), FakeCap([True] * 3), None, FakeCap([True] * 3)])
    queue.append(FakeCap([True] * 3))
    assert len(m.capture_locker(3)) == 3


def test_a_camera_that_stays_dead_is_reopened_once_not_in_a_loop(opens):
    queue, calls = opens
    m = manager_with(queue, [FakeCap([True] * 3), FakeCap([True] * 3), FakeCap([False] * 3), FakeCap([True] * 3)])
    queue.append(FakeCap([False] * 9))  # the reopened camera fails too
    assert m.capture_locker(3) == []
    assert len(calls) == 5  # exactly one reopen


def test_a_camera_that_cannot_be_reopened_stops_without_more_attempts(opens):
    queue, calls = opens
    m = manager_with(queue, [FakeCap([True] * 3), FakeCap([True] * 3), FakeCap([False] * 3), FakeCap([True] * 3)])
    # queue now empty: the reopen gets None
    assert m.capture_locker(3) == []
    assert len(calls) == 5


def test_a_healthy_camera_is_never_reopened(opens):
    queue, calls = opens
    m = manager_with(queue, [FakeCap([True] * 3) for _ in range(4)])
    assert len(m.capture_locker(2)) == 3
    assert len(calls) == 4
