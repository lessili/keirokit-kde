#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly VERSION="$(
    python3 -c \
        'import json,sys; print(json.load(open(sys.argv[1]))["KPlugin"]["Version"])' \
        "${PROJECT_DIR}/kwin-script/metadata.json"
)"
readonly DIST_DIR="${PROJECT_DIR}/dist"
readonly PACKAGE_BASENAME="keirokit-kde-${VERSION}"

normalize_tree_permissions() {
    local tree_root="$1"

    find "${tree_root}" -type d -exec chmod 0755 {} +
    find "${tree_root}" -type f -exec chmod 0644 {} +
}

command -v zip >/dev/null 2>&1 || {
    printf 'HATA: zip bulunamadı.\n' >&2
    exit 1
}
command -v tar >/dev/null 2>&1 || {
    printf 'HATA: tar bulunamadı.\n' >&2
    exit 1
}

cd "${PROJECT_DIR}"
"${PROJECT_DIR}/scripts/build-translations.sh"
mkdir -p "${DIST_DIR}"
rm -f \
    "${DIST_DIR}/${PACKAGE_BASENAME}.kwinscript" \
    "${DIST_DIR}/${PACKAGE_BASENAME}.tar.gz"

readonly TEMP_DIR="$(mktemp -d /tmp/keirokit-kde-package.XXXXXX)"
trap 'rm -rf -- "${TEMP_DIR}"' EXIT

install -d "${TEMP_DIR}/kwinscript" "${TEMP_DIR}/${PACKAGE_BASENAME}"
cp -R \
    kwin-script/metadata.json kwin-script/contents \
    "${TEMP_DIR}/kwinscript/"
normalize_tree_permissions "${TEMP_DIR}/kwinscript"

(
    cd "${TEMP_DIR}/kwinscript"
    zip -Xqr \
        "${DIST_DIR}/${PACKAGE_BASENAME}.kwinscript" \
        metadata.json contents
)

cp -R \
    README.md LICENSE CHANGELOG.md CONTRIBUTING.md SECURITY.md \
    install.sh uninstall.sh kwin-script cursor-helper scripts tests translations \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/"
normalize_tree_permissions "${TEMP_DIR}/${PACKAGE_BASENAME}"
chmod 0755 \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/install.sh" \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/uninstall.sh" \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/cursor-helper/install.sh" \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/cursor-helper/keirokit_cursor_helper.py" \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/scripts/build-package.sh" \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/scripts/build-translations.sh" \
    "${TEMP_DIR}/${PACKAGE_BASENAME}/tests/run.sh"

tar -C "${TEMP_DIR}" \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --exclude='*/__pycache__' \
    --exclude='*.pyc' \
    --exclude='*.pyo' \
    -czf "${DIST_DIR}/${PACKAGE_BASENAME}.tar.gz" "${PACKAGE_BASENAME}"

if tar -tzf "${DIST_DIR}/${PACKAGE_BASENAME}.tar.gz" \
    | grep -Eq '(^|/)(__pycache__/|[^/]+\.py[co]$)'; then
    printf 'HATA: Kaynak arşivinde Python cache dosyası bulundu.\n' >&2
    exit 1
fi

printf 'Oluşturuldu:\n  %s\n  %s\n' \
    "${DIST_DIR}/${PACKAGE_BASENAME}.kwinscript" \
    "${DIST_DIR}/${PACKAGE_BASENAME}.tar.gz"
