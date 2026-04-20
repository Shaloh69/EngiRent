"""
WiFi manager – uses NetworkManager (nmcli) available on Raspberry Pi OS Bookworm.

Responsibilities:
  - Check if any WiFi connection is active
  - Save new credentials via nmcli
  - Reboot after provisioning
"""

import logging
import subprocess
import time

log = logging.getLogger("kiosk.wifi")


def is_wifi_connected() -> bool:
    """Return True if the Pi has an active WiFi connection."""
    try:
        result = subprocess.run(
            ["nmcli", "-t", "-f", "TYPE,STATE", "con", "show", "--active"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.splitlines():
            if line.startswith("wifi:") and "activated" in line:
                return True
        return False
    except Exception as e:
        log.error("nmcli check failed: %s", e)
        return False


def get_available_networks() -> list[dict]:
    """Scan and return visible SSIDs with signal strength."""
    try:
        result = subprocess.run(
            ["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes"],
            capture_output=True, text=True, timeout=15,
        )
        networks = []
        seen = set()
        for line in result.stdout.splitlines():
            parts = line.split(":")
            if len(parts) >= 3:
                ssid = parts[0].strip()
                if ssid and ssid not in seen:
                    seen.add(ssid)
                    networks.append({
                        "ssid": ssid,
                        "signal": int(parts[1]) if parts[1].isdigit() else 0,
                        "security": parts[2].strip() or "Open",
                    })
        return sorted(networks, key=lambda x: -x["signal"])
    except Exception as e:
        log.error("WiFi scan failed: %s", e)
        return []


def connect_wifi(ssid: str, password: str) -> tuple[bool, str]:
    """
    Add and activate a WiFi connection via nmcli.
    Returns (success, message).
    """
    try:
        # Remove existing connection with same SSID if present
        subprocess.run(
            ["nmcli", "con", "delete", ssid],
            capture_output=True, timeout=5,
        )
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["nmcli", "dev", "wifi", "connect", ssid, "password", password],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            log.info("WiFi connected to %s", ssid)
            return True, f"Connected to {ssid}"
        else:
            msg = result.stderr.strip() or result.stdout.strip()
            log.warning("WiFi connect failed: %s", msg)
            return False, msg
    except subprocess.TimeoutExpired:
        return False, "Connection timed out"
    except Exception as e:
        return False, str(e)


def reboot(delay_seconds: int = 3):
    log.info("Rebooting in %s seconds…", delay_seconds)
    time.sleep(delay_seconds)
    subprocess.run(["sudo", "reboot"])
