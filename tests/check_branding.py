#!/usr/bin/env python3
"""Reject retired branding and unrelated-project comparisons."""

from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
FORBIDDEN = (
    "komo" + "rebi",
    "hypr" + "land",
    "com." + "tiling",
    "tiling" + "wm",
    "plasma_" + "komo" + "rebi",
)
TEXT_SUFFIXES = {
    "",
    ".js",
    ".json",
    ".md",
    ".po",
    ".py",
    ".rules",
    ".service",
    ".sh",
    ".ui",
    ".xml",
    ".yml",
    ".yaml",
}

assert PROJECT_DIR.name == "keirokit-kde" or PROJECT_DIR.name.startswith(
    "keirokit-kde-"
), PROJECT_DIR

violations: list[str] = []
for path in PROJECT_DIR.rglob("*"):
    if not path.is_file() or ".git" in path.parts or "dist" in path.parts:
        continue
    if path.suffix not in TEXT_SUFFIXES and path.name not in {"LICENSE"}:
        continue
    source = path.read_text(encoding="utf-8", errors="replace").lower()
    for forbidden in FORBIDDEN:
        if forbidden in source or forbidden in path.name.lower():
            violations.append(f"{path.relative_to(PROJECT_DIR)}: {forbidden}")

assert not violations, "Retired names found:\n" + "\n".join(violations)
print("Keirokit KDE branding: clean")
