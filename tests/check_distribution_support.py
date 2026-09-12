#!/usr/bin/env python3
"""Verify package-family branches and private service wiring."""

from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
TOP_LEVEL_INSTALLER = (PROJECT_DIR / "install.sh").read_text(encoding="utf-8")
HELPER_INSTALLER = (PROJECT_DIR / "cursor-helper" / "install.sh").read_text(
    encoding="utf-8"
)
HELPER_UNIT = (
    PROJECT_DIR / "cursor-helper" / "keirokit-kde-cursor-helper.service"
).read_text(encoding="utf-8")
DAEMON_UNIT = (
    PROJECT_DIR / "cursor-helper" / "keirokit-kde-ydotoold.service"
).read_text(encoding="utf-8")

for required in (
    "apt install -y ydotool python3-dbus-next",
    "dnf install -y ydotool python3-dbus-next",
    "pacman -S --needed --noconfirm ydotool python-dbus-next",
):
    assert required in HELPER_INSTALLER, required

for qdbus_candidate in (
    "qdbus6",
    "qdbus-qt6",
    "/usr/lib64/qt6/bin/qdbus",
    "/usr/lib/qt6/bin/qdbus",
):
    assert qdbus_candidate in TOP_LEVEL_INSTALLER, qdbus_candidate

assert "require_command qdbus6" not in TOP_LEVEL_INSTALLER
assert '"${QDBUS}" org.kde.KWin' in TOP_LEVEL_INSTALLER
assert "sudo dnf install qt6-qttools" in TOP_LEVEL_INSTALLER

assert "keirokit-kde-ydotoold.service" in HELPER_UNIT
assert "YDOTOOL_SOCKET=%t/keirokit-kde/ydotool.sock" in HELPER_UNIT
assert "--socket-path=%t/keirokit-kde/ydotool.sock" in DAEMON_UNIT
assert "--socket-perm=0600" in DAEMON_UNIT
assert '"1.0.4"' in HELPER_INSTALLER

print("Distribution support: Debian/Ubuntu, Fedora, and Arch branches are wired")
