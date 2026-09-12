#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly SOURCE_PO="${PROJECT_DIR}/translations/tr/keirokit-kde.po"
readonly OUTPUT_DIR="${PROJECT_DIR}/kwin-script/contents/locale/tr/LC_MESSAGES"
readonly OUTPUT_MO="${OUTPUT_DIR}/keirokit-kde.mo"

command -v msgfmt >/dev/null 2>&1 || {
    printf 'ERROR: msgfmt is required to build translations. Install gettext.\n' >&2
    exit 1
}

mkdir -p "${OUTPUT_DIR}"
msgfmt --check --check-accelerators -o "${OUTPUT_MO}" "${SOURCE_PO}"
printf 'Built translation: %s\n' "${OUTPUT_MO}"
