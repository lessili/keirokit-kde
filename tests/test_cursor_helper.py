#!/usr/bin/env python3
"""Cursor helper davranış testleri."""

import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest import mock


PROJECT_DIR = Path(__file__).resolve().parent.parent
HELPER_PATH = PROJECT_DIR / "cursor-helper" / "keirokit_cursor_helper.py"
SPEC = importlib.util.spec_from_file_location("keirokit_cursor_helper", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Helper yüklenemedi: {HELPER_PATH}")

cursor_helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cursor_helper)


class WarpCursorTests(unittest.TestCase):
    def test_absolute_warp_waits_between_origin_reset_and_target_move(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="",
            stderr="",
        )

        with (
            mock.patch.object(cursor_helper.shutil, "which", return_value="/usr/bin/ydotool"),
            mock.patch.object(
                cursor_helper,
                "daemon_socket_is_available",
                return_value=True,
            ),
            mock.patch.object(
                cursor_helper.subprocess,
                "run",
                return_value=completed,
            ) as run,
            mock.patch.object(cursor_helper.time, "sleep") as sleep,
        ):
            succeeded = cursor_helper.KeirokitCursorHelperInterface._warp_cursor(482, 558)

        self.assertTrue(succeeded)
        self.assertEqual(
            [call.args[0] for call in run.call_args_list],
            [
                [
                    "/usr/bin/ydotool",
                    "mousemove",
                    "--absolute",
                    "-x",
                    "0",
                    "-y",
                    "0",
                ],
                [
                    "/usr/bin/ydotool",
                    "mousemove",
                    "-x",
                    "482",
                    "-y",
                    "558",
                ],
            ],
        )
        sleep.assert_called_once_with(
            cursor_helper.ABSOLUTE_MOVE_SETTLE_SECONDS
        )

    def test_relative_move_uses_documented_axis_arguments(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        with (
            mock.patch.object(
                cursor_helper.shutil, "which", return_value="/usr/bin/ydotool"
            ),
            mock.patch.object(
                cursor_helper,
                "daemon_socket_is_available",
                return_value=True,
            ),
            mock.patch.object(
                cursor_helper.subprocess,
                "run",
                return_value=completed,
            ) as run,
        ):
            succeeded = (
                cursor_helper.KeirokitCursorHelperInterface._move_cursor_relative(-21, 34)
            )

        self.assertTrue(succeeded)
        self.assertEqual(
            run.call_args.args[0],
            [
                "/usr/bin/ydotool",
                "mousemove",
                "-x",
                "-21",
                "-y",
                "34",
            ],
        )


if __name__ == "__main__":
    unittest.main()
