#!/usr/bin/env python3
"""Parse the cursor helper without creating __pycache__ artifacts."""

import ast
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
HELPER_PATH = PROJECT_DIR / "cursor-helper" / "keirokit_cursor_helper.py"

ast.parse(HELPER_PATH.read_text(encoding="utf-8"), filename=str(HELPER_PATH))
