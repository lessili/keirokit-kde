#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PROJECT_DIR="$(cd -- "${TEST_DIR}/.." && pwd -P)"

node --check "${PROJECT_DIR}/kwin-script/contents/code/main.js"
xmllint --noout \
    "${PROJECT_DIR}/kwin-script/contents/config/main.xml" \
    "${PROJECT_DIR}/kwin-script/contents/ui/config.ui"
python3 "${TEST_DIR}/check_python_syntax.py"
python3 "${TEST_DIR}/check_config_schema.py"
python3 "${TEST_DIR}/check_branding.py"
python3 "${TEST_DIR}/check_distribution_support.py"
"${PROJECT_DIR}/scripts/build-translations.sh"
python3 "${TEST_DIR}/check_translations.py"
PYTHONDONTWRITEBYTECODE=1 python3 "${TEST_DIR}/test_cursor_helper.py"
bash -n \
    "${PROJECT_DIR}/install.sh" \
    "${PROJECT_DIR}/uninstall.sh" \
    "${PROJECT_DIR}/cursor-helper/install.sh" \
    "${PROJECT_DIR}/scripts/build-translations.sh" \
    "${PROJECT_DIR}/scripts/build-package.sh"
node "${TEST_DIR}/kwin_harness.js"
