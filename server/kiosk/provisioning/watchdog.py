"""
Uplink watchdog (D-74) — the runtime half of the fix.

Provisioning used to be a single check at startup: `main()` asked "is there
Wi-Fi", and never asked again. The failure that actually happens is the one the
kiosk cannot notice that way — it boots fine, runs for hours, and the router
loses its uplink underneath it. On 2026-09-13 the kiosk sat retrying
`desktop-gklhcri:5000` every 5 seconds for hours with nothing on screen saying
why, because as far as the old check was concerned nothing had changed.

This runs the diagnosis on a timer, announces transitions, and does nothing
else unless explicitly configured to. **It never touches GPIO**, and it holds
no hardware references, so it cannot open a door by any path.

Started from `main()` as a daemon thread; the process exits normally without
waiting for it.
"""

from __future__ import annotations

import logging
import threading
import time

from .uplink import Action, PolicyConfig, Uplink, UplinkPolicy, classify, describe, record, run_probe

log = logging.getLogger("kiosk.uplink")


class UplinkWatchdog:
    def __init__(
        self,
        server_url: str,
        interval: int = 60,
        policy: UplinkPolicy | None = None,
        server_ok_fn=None,
        on_state=None,
        safe_to_disrupt=None,
        start_ap=None,
    ):
        """
        `server_ok_fn`  - returns the live client's own view (`sio.connected`).
                          Preferred over probing: an open socket is proof.
        `on_state`      - called on every CHANGE with (Uplink, message).
        `safe_to_disrupt` - see UplinkPolicy.update. Absent means "not safe".
        `start_ap`      - only ever called if auto-AP is switched on AND the
                          policy's gates pass.
        """
        self.server_url = server_url
        self.interval = max(10, int(interval))
        self.policy = policy or UplinkPolicy()
        self.server_ok_fn = server_ok_fn
        self.on_state = on_state
        self.safe_to_disrupt = safe_to_disrupt
        self.start_ap = start_ap
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_state: Uplink | None = None

    # ── one cycle, separated so it can be driven directly in a test ──────────
    def tick(self, now: float | None = None) -> Uplink:
        now = time.monotonic() if now is None else now
        server_ok = None
        if self.server_ok_fn is not None:
            try:
                server_ok = bool(self.server_ok_fn())
            except Exception:                                  # pragma: no cover
                server_ok = None

        state = classify(run_probe(self.server_url, server_ok=server_ok))
        action = self.policy.update(state, now, safe_to_disrupt=self.safe_to_disrupt)
        self.last_state = state
        # Every tick, not just on change: the socket client reads this on each
        # retry, so it must always reflect the latest measurement.
        record(state)

        if action is Action.ANNOUNCE:
            msg = describe(state)
            if state is Uplink.OK:
                log.info("Uplink recovered: %s", msg)
            else:
                # WARNING, not ERROR: the kiosk is degraded, not broken, and
                # this repeats only on change -- see UplinkPolicy.
                log.warning("Uplink %s — %s", state.value, msg)
            if self.on_state:
                try:
                    self.on_state(state, msg)
                except Exception as e:                          # pragma: no cover
                    log.error("uplink on_state callback failed: %s", e)

        elif action is Action.START_AP:
            log.warning("Uplink %s for %.0fs — starting provisioning hotspot",
                        state.value, self.policy.seconds_in_state(now))
            if self.start_ap:
                try:
                    self.start_ap()
                except Exception as e:                          # pragma: no cover
                    log.error("start_ap failed: %s", e)

        return state

    # ── thread plumbing ──────────────────────────────────────────────────────
    def _loop(self):
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception as e:                              # pragma: no cover
                log.error("uplink watchdog cycle failed: %s", e)
            self._stop.wait(self.interval)

    def start(self) -> "UplinkWatchdog":
        self._thread = threading.Thread(target=self._loop, name="uplink-watchdog", daemon=True)
        self._thread.start()
        log.info("Uplink watchdog started (every %ss, auto-AP %s)",
                 self.interval, "ON" if self.policy.config.auto_ap_enabled else "off")
        return self

    def stop(self):
        self._stop.set()
