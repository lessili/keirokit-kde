#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SOURCE_HELPER="${SCRIPT_DIR}/keirokit_cursor_helper.py"
readonly SOURCE_HELPER_UNIT="${SCRIPT_DIR}/keirokit-kde-cursor-helper.service"
readonly SOURCE_DAEMON_UNIT="${SCRIPT_DIR}/keirokit-kde-ydotoold.service"
readonly SOURCE_UDEV_RULE="${SCRIPT_DIR}/70-keirokit-kde-uinput.rules"
readonly HELPER_UNIT_NAME="keirokit-kde-cursor-helper.service"
readonly DAEMON_UNIT_NAME="keirokit-kde-ydotoold.service"
readonly USER_DATA_DIR="${HOME}/.local/share/keirokit-kde"
readonly USER_UNIT_DIR="${HOME}/.config/systemd/user"

INSTALL_DEPENDENCIES=false
INSTALL_UINPUT_RULE=false

usage() {
    cat <<EOF
Kullanım: $0 [seçenekler]

  --install-deps    Eksik paketleri apt, dnf veya pacman ile kur
  --with-udev-rule  Aktif oturuma /dev/uinput erişimi veren kuralı kur
  -h, --help        Bu yardımı göster
EOF
}

while (( $# > 0 )); do
    case "$1" in
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

log() { printf '[keirokit-kde] %s\n' "$*"; }
warn() { printf '[keirokit-kde] UYARI: %s\n' "$*" >&2; }
die() { printf '[keirokit-kde] HATA: %s\n' "$*" >&2; exit 1; }

if (( EUID == 0 )); then
    die "Bu betiği root olarak değil, normal Plasma kullanıcısıyla çalıştırın."
fi

for required_file in \
    "${SOURCE_HELPER}" \
    "${SOURCE_HELPER_UNIT}" \
    "${SOURCE_DAEMON_UNIT}" \
    "${SOURCE_UDEV_RULE}"; do
    [[ -f "${required_file}" ]] || die "Kaynak dosya bulunamadı: ${required_file}"
done

detect_package_family() {
    local distro_id=""
    local distro_like=""

    if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        source /etc/os-release
        distro_id="${ID:-}"
        distro_like="${ID_LIKE:-}"
    fi

    case " ${distro_id} ${distro_like} " in
        *" debian "*|*" ubuntu "*) printf 'debian\n' ;;
        *" fedora "*|*" rhel "*) printf 'fedora\n' ;;
        *" arch "*) printf 'arch\n' ;;
        *) printf 'unknown\n' ;;
    esac
}

print_dependency_command() {
    case "$1" in
        debian) printf 'sudo apt update && sudo apt install ydotool python3-dbus-next\n' ;;
        fedora) printf 'sudo dnf install ydotool python3-dbus-next\n' ;;
        arch) printf 'sudo pacman -S --needed ydotool python-dbus-next\n' ;;
        *) printf 'ydotool, Python 3 ve dbus-next paketlerini kurun.\n' ;;
    esac
}

install_dependencies() {
    command -v sudo >/dev/null 2>&1 || die "Bağımlılık kurulumu için sudo bulunamadı."
    case "$1" in
        debian)
            sudo apt update
            sudo apt install -y ydotool python3-dbus-next
            if ! command -v ydotoold >/dev/null 2>&1; then
                sudo apt install -y ydotoold
            fi
            ;;
        fedora)
            sudo dnf install -y ydotool python3-dbus-next
            ;;
        arch)
            sudo pacman -S --needed --noconfirm ydotool python-dbus-next
            ;;
        *) die "Dağıtım otomatik tanınamadı; bağımlılıkları elle kurun." ;;
    esac
}

readonly PACKAGE_FAMILY="$(detect_package_family)"

dependencies_available() {
    command -v python3 >/dev/null 2>&1 \
        && command -v ydotool >/dev/null 2>&1 \
        && command -v ydotoold >/dev/null 2>&1 \
        && python3 -c 'import dbus_next' >/dev/null 2>&1
}

if ! dependencies_available; then
    if [[ "${INSTALL_DEPENDENCIES}" == true ]]; then
        install_dependencies "${PACKAGE_FAMILY}"
    else
        warn "Gerekli çalışma zamanı bağımlılıkları eksik."
        printf '\n  %s\n\n' "$(print_dependency_command "${PACKAGE_FAMILY}")" >&2
        printf "Ardından yeniden çalıştırın veya otomatik kurulum için '--install-deps' kullanın.\n" >&2
        exit 2
    fi
fi

dependencies_available || die "Bağımlılıklar kurulumdan sonra da doğrulanamadı."
command -v systemctl >/dev/null 2>&1 || die "systemctl bulunamadı."

ydotoold_version="$(ydotoold --version 2>&1 | sed -nE 's/.*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -n1)"
if [[ -n "${ydotoold_version}" ]] \
    && [[ "$(printf '%s\n' "1.0.4" "${ydotoold_version}" | sort -V | head -n1)" != "1.0.4" ]]; then
    die "ydotool 1.0.4 veya üzeri gerekli; bulunan sürüm: ${ydotoold_version}"
fi

if [[ "${INSTALL_UINPUT_RULE}" == true ]]; then
    command -v sudo >/dev/null 2>&1 || die "udev kuralı için sudo bulunamadı."
    command -v udevadm >/dev/null 2>&1 || die "udevadm bulunamadı."

    log "Aktif yerel oturuma uinput erişimi veren udev kuralı kuruluyor."
    sudo install -Dm0644 "${SOURCE_UDEV_RULE}" \
        "/etc/udev/rules.d/70-keirokit-kde-uinput.rules"
    sudo udevadm control --reload-rules
    sudo udevadm trigger --subsystem-match=misc --action=change
fi

if [[ ! -w /dev/uinput ]]; then
    warn "/dev/uinput bu kullanıcı tarafından yazılabilir değil."
    warn "Kurulumu './install.sh --with-udev-rule' ile yineleyin ve gerekirse oturumu yenileyin."
fi

log "Helper ve systemd kullanıcı servisleri kuruluyor."
install -d -m0755 "${USER_DATA_DIR}" "${USER_UNIT_DIR}"
install -m0755 "${SOURCE_HELPER}" "${USER_DATA_DIR}/keirokit_cursor_helper.py"
install -m0644 "${SOURCE_HELPER_UNIT}" "${USER_UNIT_DIR}/${HELPER_UNIT_NAME}"
install -m0644 "${SOURCE_DAEMON_UNIT}" "${USER_UNIT_DIR}/${DAEMON_UNIT_NAME}"

systemctl --user daemon-reload
systemctl --user enable --now "${DAEMON_UNIT_NAME}"
systemctl --user enable "${HELPER_UNIT_NAME}"
systemctl --user restart "${HELPER_UNIT_NAME}"

if ! systemctl --user is-active --quiet "${DAEMON_UNIT_NAME}"; then
    systemctl --user --no-pager --full status "${DAEMON_UNIT_NAME}" || true
    die "Özel ydotoold servisi başlatılamadı. uinput iznini kontrol edin."
fi

if ! systemctl --user is-active --quiet "${HELPER_UNIT_NAME}"; then
    systemctl --user --no-pager --full status "${HELPER_UNIT_NAME}" || true
    die "İmleç helper servisi başlatılamadı."
fi

qdbus_command="qdbus6"
if command -v qdbus-qt6 >/dev/null 2>&1; then
    qdbus_command="qdbus-qt6"
fi

cat <<EOF

[keirokit-kde] İmleç entegrasyonu kuruldu.

Durum:
  systemctl --user status keirokit-kde-ydotoold.service
  systemctl --user status keirokit-kde-cursor-helper.service

Test:
  ${qdbus_command} Keirokit.KDE.CursorHelper /Keirokit/KDE/CursorHelper \
    Keirokit.KDE.CursorHelper.WarpCursor 500 500
EOF
