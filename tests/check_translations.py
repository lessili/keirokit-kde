#!/usr/bin/env python3
"""Verify English source text and the bundled Turkish KDE catalog."""

import gettext
import json
from pathlib import Path
import xml.etree.ElementTree as ET


PROJECT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_DIR = PROJECT_DIR / "kwin-script"
UI_PATH = SCRIPT_DIR / "contents" / "ui" / "config.ui"
CATALOG_DIR = SCRIPT_DIR / "contents" / "locale"

metadata = json.loads((SCRIPT_DIR / "metadata.json").read_text(encoding="utf-8"))
assert metadata["X-KWin-Config-TranslationDomain"] == "keirokit-kde"
assert metadata["KPlugin"]["Description"].startswith("Dynamic tiling")
assert metadata["KPlugin"]["Description[tr]"].startswith("KWin 6.7+")

translation = gettext.translation(
    "keirokit-kde",
    localedir=CATALOG_DIR,
    languages=["tr"],
)

nonlinguistic = {
    "%",
    "px",
    "binary-split",
    "master-stack",
    "columns",
    "rows",
    "monocle",
}
source_strings = {
    element.text.strip()
    for element in ET.parse(UI_PATH).iter("string")
    if element.text and element.text.strip() not in nonlinguistic
}

missing = sorted(
    source for source in source_strings if translation.gettext(source) == source
)
assert not missing, "Missing Turkish UI translations:\n" + "\n".join(missing)
assert translation.gettext("Layouts") == "Yerleşimler"
assert translation.gettext("Exceptions") == "İstisnalar"

print("English UI and Turkish translation catalog: valid")
