#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_ID="keirokit-kde"
readonly HELPER_UNIT="keirokit-kde-cursor-helper.service"
readonly DAEMON_UNIT="keirokit-kde-ydotoold.service"
readonly USER_DATA_DIR="${HOME}/.local/share/keirokit-kde"
readonly USER_UNIT_DIR="${HOME}/.config/systemd/user"
REMOVE_UDEV_RULE=false

resolve_qdbus() {
    local candidate=""
    for candidate in \
        "$(command -v qdbus6 2>/dev/null || true)" \
        "$(command -v qdbus-qt6 2>/dev/null || true)" \
        /usr/lib64/qt6/bin/qdbus \
        /usr/lib/qt6/bin/qdbus; do
        if [[ -n "${candidate}" && -x "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done
    return 1
}

if [[ "${1:-}" == "--remove-udev-rule" ]]; then
    REMOVE_UDEV_RULE=true
elif [[ $# -gt 0 ]]; then
    printf 'Kullanım: %s [--remove-udev-rule]\n' "$0" >&2
    exit 2
fi

if (( EUID == 0 )); then
    printf 'HATA: Bu betiği normal Plasma kullanıcısıyla çalıştırın.\n' >&2
    exit 1
fi

if QDBUS="$(resolve_qdbus)"; then
    "${QDBUS}" org.kde.KWin /Scripting \
        org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" \
        >/dev/null 2>&1 || true
fi

if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kwinrc --group Plugins \
        --key "${SCRIPT_ID}Enabled" false
fi

if command -v kpackagetool6 >/dev/null 2>&1 \
    && kpackagetool6 -t KWin/Script -l | grep -Fq "${SCRIPT_ID}"; then
    kpackagetool6 -t KWin/Script -r "${SCRIPT_ID}"
fi

if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now "${HELPER_UNIT}" >/dev/null 2>&1 || true
    systemctl --user disable --now "${DAEMON_UNIT}" >/dev/null 2>&1 || true
fi

rm -f \
    "${USER_UNIT_DIR}/${HELPER_UNIT}" \
    "${USER_UNIT_DIR}/${DAEMON_UNIT}"
rm -rf -- "${USER_DATA_DIR}"

if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
fi

if [[ "${REMOVE_UDEV_RULE}" == true ]]; then
    command -v sudo >/dev/null 2>&1 || {
        printf 'HATA: udev kuralını kaldırmak için sudo bulunamadı.\n' >&2
        exit 1
    }
    sudo rm -f /etc/udev/rules.d/70-keirokit-kde-uinput.rules
    sudo udevadm control --reload-rules
fi

printf 'Keirokit KDE kullanıcı kurulumu kaldırıldı.\n'
