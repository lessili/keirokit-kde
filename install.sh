#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_ID="keirokit-kde"
readonly SHORTCUT_SCHEMA_VERSION="1"

INSTALL_CURSOR_HELPER=true
INSTALL_DEPENDENCIES=false
INSTALL_UINPUT_RULE=false

usage() {
    cat <<EOF
Kullanım: $0 [seçenekler]

  --skip-cursor-helper  İsteğe bağlı imleç entegrasyonunu kurma
  --install-deps        Eksik helper paketlerini dağıtım paket yöneticisiyle kur
  --with-udev-rule      /dev/uinput için aktif oturum udev kuralını kur
  -h, --help            Bu yardımı göster
EOF
}

while (( $# > 0 )); do
    case "$1" in
        --skip-cursor-helper) INSTALL_CURSOR_HELPER=false ;;
        --install-deps) INSTALL_DEPENDENCIES=true ;;
        --with-udev-rule) INSTALL_UINPUT_RULE=true ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'HATA: Bilinmeyen seçenek: %s\n\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

if (( EUID == 0 )); then
    printf 'HATA: Bu betiği root olarak değil, normal Plasma kullanıcısıyla çalıştırın.\n' >&2
    exit 1
fi

require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        printf 'HATA: Gerekli Plasma 6 komutu bulunamadı: %s\n' "$1" >&2
        exit 1
    }
}

resolve_qdbus() {
    local candidate=""
    local qt_bin_dir=""

    for candidate in qdbus6 qdbus-qt6; do
        if command -v "${candidate}" >/dev/null 2>&1; then
            command -v "${candidate}"
            return 0
        fi
    done

    for candidate in qtpaths6 qtpaths-qt6; do
        if command -v "${candidate}" >/dev/null 2>&1; then
            qt_bin_dir="$("${candidate}" --query QT_INSTALL_BINS 2>/dev/null || true)"
            if [[ -n "${qt_bin_dir}" && -x "${qt_bin_dir}/qdbus" ]]; then
                printf '%s\n' "${qt_bin_dir}/qdbus"
                return 0
            fi
        fi
    done

    for candidate in \
        /usr/lib64/qt6/bin/qdbus \
        /usr/lib64/qt6/bin/qdbus-qt6 \
        /usr/lib/qt6/bin/qdbus \
        /usr/lib/qt6/bin/qdbus-qt6; do
        if [[ -x "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done

    return 1
}

qdbus_install_hint() {
    local distro_id=""
    local distro_like=""

    if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        source /etc/os-release
        distro_id="${ID:-}"
        distro_like="${ID_LIKE:-}"
    fi

    case " ${distro_id} ${distro_like} " in
        *" fedora "*|*" rhel "*) printf 'sudo dnf install qt6-qttools\n' ;;
        *" debian "*|*" ubuntu "*) printf 'sudo apt install qdbus-qt6\n' ;;
        *" arch "*) printf 'sudo pacman -S --needed qt6-tools\n' ;;
        *) printf 'Dağıtımınızın Qt 6 D-Bus araçları paketini kurun.\n' ;;
    esac
}

install_qdbus_dependency() {
    local install_hint="$(qdbus_install_hint)"
    command -v sudo >/dev/null 2>&1 || return 1

    case "${install_hint}" in
        "sudo dnf install qt6-qttools") sudo dnf install -y qt6-qttools ;;
        "sudo apt install qdbus-qt6") sudo apt install -y qdbus-qt6 ;;
        "sudo pacman -S --needed qt6-tools")
            sudo pacman -S --needed --noconfirm qt6-tools
            ;;
        *) return 1 ;;
    esac
}

require_command kpackagetool6
require_command kwriteconfig6
require_command kreadconfig6

if ! QDBUS="$(resolve_qdbus)" \
    && [[ "${INSTALL_DEPENDENCIES}" == true ]]; then
    install_qdbus_dependency || true
    QDBUS="$(resolve_qdbus || true)"
fi

if [[ -z "${QDBUS:-}" ]]; then
    printf 'HATA: Qt 6 qdbus komutu bulunamadı.\n' >&2
    printf 'Kurulum önerisi: %s\n' "$(qdbus_install_hint)" >&2
    exit 1
fi
readonly QDBUS

cd "${PROJECT_DIR}"

kwriteconfig6 --file kwinrc --group Windows \
    --key PerOutputVirtualDesktops true
kwriteconfig6 --file kwinrc --group Windows \
    --key SeparateScreenFocus true

if ! kpackagetool6 -t KWin/Script -i kwin-script/; then
    printf 'Paket zaten kurulu olabilir; güncelleme deneniyor.\n'
    kpackagetool6 -t KWin/Script -u kwin-script/
fi

kwriteconfig6 --file kwinrc --group Plugins \
    --key "${SCRIPT_ID}Enabled" true

"${QDBUS}" org.kde.KWin /KWin reconfigure
"${QDBUS}" org.kde.KWin /Scripting \
    org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" \
    >/dev/null 2>&1 || true

installed_shortcut_schema="$(
    kreadconfig6 --file kwinrc \
        --group "Script-${SCRIPT_ID}" \
        --key ShortcutSchemaVersion \
        --default 0
)"

if [[ "${installed_shortcut_schema}" != "${SHORTCUT_SCHEMA_VERSION}" ]]; then
    shortcut_ids=(
        "Keirokit KDE Toggle Layout"
        "Keirokit KDE Toggle Floating"
        "Keirokit KDE Focus Left"
        "Keirokit KDE Focus Down"
        "Keirokit KDE Focus Up"
        "Keirokit KDE Focus Right"
    )
    for desktop_number in {1..9}; do
        shortcut_ids+=(
            "Keirokit KDE Switch to Desktop ${desktop_number}"
            "Keirokit KDE Move Window to Desktop ${desktop_number}"
        )
    done
    for shortcut_id in "${shortcut_ids[@]}"; do
        "${QDBUS}" org.kde.kglobalaccel /kglobalaccel \
            org.kde.KGlobalAccel.unregister kwin "${shortcut_id}" \
            >/dev/null 2>&1 || true
    done

    kwriteconfig6 --file kwinrc \
        --group "Script-${SCRIPT_ID}" \
        --key ShortcutSchemaVersion "${SHORTCUT_SCHEMA_VERSION}"
fi

sleep 1
"${QDBUS}" org.kde.KWin /Scripting org.kde.kwin.Scripting.start

if [[ "${INSTALL_CURSOR_HELPER}" == true ]]; then
    helper_args=()
    [[ "${INSTALL_DEPENDENCIES}" == true ]] && helper_args+=(--install-deps)
    [[ "${INSTALL_UINPUT_RULE}" == true ]] && helper_args+=(--with-udev-rule)
    printf 'İsteğe bağlı imleç entegrasyonu kuruluyor.\n'
    "${PROJECT_DIR}/cursor-helper/install.sh" "${helper_args[@]}"
fi

cat <<'EOF'
Keirokit KDE kuruldu ve KWin yeniden yapılandırıldı.

Varsayılan yerleşim: binary-split
Yerleşimi değiştir: Meta+Alt+Space
Odaklı pencereyi float/tiled yap: Meta+Alt+F
Yönlü odak: Meta+Ctrl+Alt+H/J/K/L
Masaüstüne geç: Meta+Shift+F1…F9
Pencereyle birlikte masaüstüne git: Meta+Ctrl+Shift+F1…F9

Log:
  journalctl --user -f -o cat | grep --line-buffered '\[Keirokit KDE\]'
Paket:
  kpackagetool6 -t KWin/Script -l | grep keirokit-kde
EOF
