#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Keirokit KDE contributors
# SPDX-License-Identifier: MIT

"""Keirokit KDE session D-Bus service for pointer movement through ydotool."""

import asyncio
import logging
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import time

from dbus_next.aio import MessageBus
from dbus_next.constants import BusType, NameFlag, RequestNameReply
from dbus_next.service import ServiceInterface, method


BUS_NAME = "Keirokit.KDE.CursorHelper"
OBJECT_PATH = "/Keirokit/KDE/CursorHelper"
INTERFACE_NAME = "Keirokit.KDE.CursorHelper"
COMMAND_TIMEOUT_SECONDS = 5
ABSOLUTE_MOVE_SETTLE_SECONDS = 0.05

LOGGER = logging.getLogger("keirokit-kde-cursor-helper")


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    LOGGER.addHandler(handler)
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False


def ydotool_socket_path() -> Path:
    """Return the configured ydotoold socket path."""
    configured_path = os.environ.get("YDOTOOL_SOCKET")
    if configured_path:
        return Path(configured_path)

    runtime_directory = os.environ.get("XDG_RUNTIME_DIR")
    if runtime_directory:
        return Path(runtime_directory) / ".ydotool_socket"

    return Path("/tmp/.ydotool_socket")


def daemon_socket_is_available() -> bool:
    socket_path = ydotool_socket_path()

    try:
        socket_stat = socket_path.stat()
    except FileNotFoundError:
        LOGGER.error(
            "ydotoold socket'i bulunamadı: %s. "
            "'systemctl --user status ydotool.service' ile daemon durumunu kontrol edin.",
            socket_path,
        )
        return False
    except PermissionError as error:
        LOGGER.error(
            "ydotoold socket'ine erişilemiyor (%s): %s. "
            "Socket izinlerini ve kullanıcının input grubu üyeliğini kontrol edin.",
            socket_path,
            error,
        )
        return False
    except OSError as error:
        LOGGER.error("ydotoold socket'i denetlenemedi (%s): %s", socket_path, error)
        return False

    if not stat.S_ISSOCK(socket_stat.st_mode):
        LOGGER.error(
            "Beklenen ydotoold yolu bir Unix socket değil: %s", socket_path
        )
        return False

    return True


def format_process_output(completed: subprocess.CompletedProcess[str]) -> str:
    output_parts = []
    if completed.stdout.strip():
        output_parts.append(f"stdout={completed.stdout.strip()!r}")
    if completed.stderr.strip():
        output_parts.append(f"stderr={completed.stderr.strip()!r}")
    return ", ".join(output_parts) or "çıktı yok"


class KeirokitCursorHelperInterface(ServiceInterface):
    def __init__(self) -> None:
        super().__init__(INTERFACE_NAME)

    @method()
    def WarpCursor(self, x: "i", y: "i") -> "b":  # noqa: N802 - D-Bus API adı
        """Move the cursor to the requested absolute coordinate."""
        try:
            return self._warp_cursor(x, y)
        except Exception:
            # D-Bus istemcisine hata fırlatmak yerine False dönmek bu servisin
            # sözleşmesidir; ayrıntı journal'da kalır.
            LOGGER.exception(
                "WarpCursor(%d, %d) beklenmeyen bir hatayla başarısız oldu.", x, y
            )
            return False

    @method()
    def MoveCursorRelative(  # noqa: N802 - D-Bus API adı
        self, delta_x: "i", delta_y: "i"
    ) -> "b":
        """Move the cursor by raw relative uinput deltas."""
        try:
            succeeded = self._move_cursor_relative(delta_x, delta_y)
            if succeeded:
                LOGGER.info(
                    "İmleç göreli hareket ettirildi: delta=(%d, %d).",
                    delta_x,
                    delta_y,
                )
            return succeeded
        except Exception:
            LOGGER.exception(
                "MoveCursorRelative(%d, %d) beklenmeyen bir hatayla "
                "başarısız oldu.",
                delta_x,
                delta_y,
            )
            return False

    @staticmethod
    def _move_cursor_relative(delta_x: int, delta_y: int) -> bool:
        ydotool_path = shutil.which("ydotool")
        if ydotool_path is None:
            LOGGER.error(
                "ydotool bulunamadı. Dağıtımınızın paket yöneticisiyle "
                "ydotool paketini kurun."
            )
            return False

        if not daemon_socket_is_available():
            return False

        return KeirokitCursorHelperInterface._run_ydotool_commands(
            [
                [
                    ydotool_path,
                    "mousemove",
                    "-x",
                    str(delta_x),
                    "-y",
                    str(delta_y),
                ]
            ]
        )

    @staticmethod
    def _warp_cursor(x: int, y: int) -> bool:
        ydotool_path = shutil.which("ydotool")
        if ydotool_path is None:
            LOGGER.error(
                "ydotool bulunamadı. Dağıtımınızın paket yöneticisiyle "
                "ydotool paketini kurun."
            )
            return False

        if not daemon_socket_is_available():
            return False

        # ydotool 1.0.4 mutlak hareketi iki ardışık event frame'i olarak
        # uygular: önce INT32_MIN ile sol üste sıfırlar, hemen ardından hedef
        # kadar göreli hareket yollar. Plasma/Wayland ikinci frame'i bazen
        # işlemediği için imleç (0, 0)'da kalır. Sıfırlama ile hedef hareketini
        # ayrı süreçlere bölüp arada kısa süre beklemek iki frame'in de
        # compositor tarafından işlenmesini sağlar.
        commands = [
            [
                ydotool_path,
                "mousemove",
                "--absolute",
                "-x",
                "0",
                "-y",
                "0",
            ],
            [
                ydotool_path,
                "mousemove",
                "-x",
                str(x),
                "-y",
                str(y),
            ],
        ]

        succeeded = KeirokitCursorHelperInterface._run_ydotool_commands(
            commands,
            settle_after_first=True,
        )
        if succeeded:
            LOGGER.info("İmleç (%d, %d) koordinatına taşındı.", x, y)
        return succeeded

    @staticmethod
    def _run_ydotool_commands(
        commands: list[list[str]], *, settle_after_first: bool = False
    ) -> bool:
        for command_index, command in enumerate(commands):
            try:
                completed = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=COMMAND_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired:
                LOGGER.error(
                    "ydotool %d saniye içinde tamamlanmadı; "
                    "ydotoold yanıt vermiyor olabilir.",
                    COMMAND_TIMEOUT_SECONDS,
                )
                return False
            except PermissionError as error:
                LOGGER.error(
                    "ydotool çalıştırılamadı veya ydotoold/uinput erişimi "
                    "reddedildi: %s. input grubu üyeliğini, /dev/uinput "
                    "izinlerini ve yeniden giriş yapıldığını kontrol edin.",
                    error,
                )
                return False
            except OSError as error:
                LOGGER.error("ydotool başlatılamadı: %s", error)
                return False

            combined_output = f"{completed.stdout}\n{completed.stderr}".lower()
            daemon_error_markers = (
                "backend unavailable",
                "failed to connect socket",
                "connection refused",
                "please check if ydotoold is running",
            )
            permission_error_markers = (
                "permission denied",
                "operation not permitted",
                "failed to open uinput",
            )

            if any(marker in combined_output for marker in daemon_error_markers):
                LOGGER.error(
                    "ydotoold çalışmıyor veya socket üzerinden erişilemiyor: %s",
                    format_process_output(completed),
                )
                return False

            if any(
                marker in combined_output for marker in permission_error_markers
            ):
                LOGGER.error(
                    "ydotool/ydotoold erişim hatası: %s. input grubu ve "
                    "/dev/uinput izinlerini kontrol edin.",
                    format_process_output(completed),
                )
                return False

            if completed.returncode != 0:
                LOGGER.error(
                    "ydotool başarısız oldu (exit=%d): %s",
                    completed.returncode,
                    format_process_output(completed),
                )
                return False

            if settle_after_first and command_index == 0:
                time.sleep(ABSOLUTE_MOVE_SETTLE_SECONDS)

        return True


async def run_service() -> int:
    try:
        bus = await MessageBus(bus_type=BusType.SESSION).connect()
    except Exception:
        LOGGER.exception("Session D-Bus'a bağlanılamadı.")
        return 1

    interface = KeirokitCursorHelperInterface()
    bus.export(OBJECT_PATH, interface)

    try:
        name_reply = await bus.request_name(BUS_NAME, NameFlag.DO_NOT_QUEUE)
    except Exception:
        LOGGER.exception("D-Bus adı alınamadı: %s", BUS_NAME)
        bus.disconnect()
        return 1

    if name_reply != RequestNameReply.PRIMARY_OWNER:
        LOGGER.error(
            "%s D-Bus adı zaten başka bir süreç tarafından kullanılıyor (yanıt=%s).",
            BUS_NAME,
            name_reply,
        )
        bus.disconnect()
        return 1

    LOGGER.info(
        "Servis hazır: bus=%s path=%s interface=%s",
        BUS_NAME,
        OBJECT_PATH,
        INTERFACE_NAME,
    )

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_number in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signal_number, stop_event.set)
        except NotImplementedError:
            # Unix dışı asyncio loop'larında signal handler bulunmayabilir.
            pass

    await stop_event.wait()
    LOGGER.info("Servis durduruluyor.")
    bus.disconnect()
    return 0


def main() -> int:
    configure_logging()
    try:
        return asyncio.run(run_service())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
