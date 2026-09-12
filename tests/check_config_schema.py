#!/usr/bin/env python3
"""Verify that every Keirokit KDE KCM control is wired to KConfig and main.js."""

from __future__ import annotations

import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET


PROJECT_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PATH = PROJECT_DIR / "kwin-script/contents/config/main.xml"
UI_PATH = PROJECT_DIR / "kwin-script/contents/ui/config.ui"
SCRIPT_PATH = PROJECT_DIR / "kwin-script/contents/code/main.js"
METADATA_PATH = PROJECT_DIR / "kwin-script/metadata.json"

EXPECTED_WIDGETS = {
    "LayoutAlgorithm": "QComboBox",
    "InnerGap": "QSpinBox",
    "OuterGapTop": "QSpinBox",
    "OuterGapRight": "QSpinBox",
    "OuterGapBottom": "QSpinBox",
    "OuterGapLeft": "QSpinBox",
    "SmartGaps": "QCheckBox",
    "SmartGapsThreshold": "QSpinBox",
    "MasterRatio": "QSpinBox",
    "MasterCount": "QSpinBox",
    "EnforceOutputDesktopAssignments": "QCheckBox",
    "OutputDesktopAssignments": "KEditListWidget",
    "LayoutOverrides": "KEditListWidget",
    "WindowDenylist": "KEditListWidget",
    "MouseFollowsFocus": "QCheckBox",
    "OpenAtCursor": "QCheckBox",
}

EXPECTED_TYPES = {
    "LayoutAlgorithm": "Enum",
    "InnerGap": "Int",
    "OuterGapTop": "Int",
    "OuterGapRight": "Int",
    "OuterGapBottom": "Int",
    "OuterGapLeft": "Int",
    "SmartGaps": "Bool",
    "SmartGapsThreshold": "Int",
    "MasterRatio": "Int",
    "MasterCount": "Int",
    "EnforceOutputDesktopAssignments": "Bool",
    "OutputDesktopAssignments": "StringList",
    "LayoutOverrides": "StringList",
    "WindowDenylist": "StringList",
    "MouseFollowsFocus": "Bool",
    "OpenAtCursor": "Bool",
}


schema_root = ET.parse(SCHEMA_PATH).getroot()
namespace = {"kcfg": "http://www.kde.org/standards/kcfg/1.0"}
schema_entries = {
    entry.attrib["name"]: entry.attrib["type"]
    for entry in schema_root.findall(".//kcfg:entry", namespace)
}

ui_root = ET.parse(UI_PATH).getroot()
ui_widgets = {
    widget.attrib["name"][len("kcfg_") :]: widget.attrib["class"]
    for widget in ui_root.findall(".//widget")
    if widget.attrib.get("name", "").startswith("kcfg_")
}

assert schema_entries == EXPECTED_TYPES, (
    f"main.xml settings mismatch: {schema_entries!r}"
)
assert ui_widgets == EXPECTED_WIDGETS, f"config.ui widgets mismatch: {ui_widgets!r}"

script_source = SCRIPT_PATH.read_text(encoding="utf-8")
read_keys = set(
    re.findall(
        r'read(?:BoundedInteger|Boolean)?Config\(\s*"([A-Za-z0-9]+)"',
        script_source,
    )
)
missing_runtime_reads = set(EXPECTED_WIDGETS) - read_keys
assert not missing_runtime_reads, (
    f"settings not consumed by main.js: {sorted(missing_runtime_reads)!r}"
)

metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
assert metadata["KPackageStructure"] == "KWin/Script"
assert metadata["KPlugin"]["Id"] == "keirokit-kde"
assert metadata["KPlugin"]["Name"] == "Keirokit KDE"
assert metadata["KPlugin"]["License"] == "MIT"
assert metadata["X-Plasma-API-Minimum-Version"] == "6.7"
assert metadata["X-KDE-ConfigModule"] == (
    "kwin/effects/configs/kcm_kwin4_genericscripted"
)

print("Keirokit KDE config schema: all 16 settings are wired")
