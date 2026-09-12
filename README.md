# Keirokit KDE

Keirokit KDE is a KWin script for KDE Plasma 6.7+ Wayland sessions that provides dynamic window tiling and per-monitor virtual desktop groups.

> [!WARNING]
> Keirokit KDE is currently experimental. Bugs and unexpected layout behavior may occur.

## Features

- `binary-split`, `master-stack`, `columns`, `rows`, and `monocle` layouts
- Per-monitor and per-desktop layout selection
- Separate inner gaps and four-sided outer gap settings
- Configurable smart gaps
- Spatial keyboard focus across monitors
- Follow the target desktop and monitor when moving a window
- Insert new windows into the tile under the cursor
- Swap tiles using drag and drop
- Regex-based window exceptions
- Optional Wayland-compatible cursor tracking

## Requirements

- KDE Plasma/KWin 6.7 or later
- A Wayland session
- Bash, Python 3, and a systemd user session
- For the full installation: `ydotool` 1.0.4+ and Python `dbus-next`

The Plasma 6.7 requirement is distribution-independent. If the Plasma version in your distribution's repositories is older, the plugin is not supported.

### Cursor integration dependencies

| Distribution | Command |
|---|---|
| Ubuntu / Debian | `sudo apt update && sudo apt install ydotool python3-dbus-next` |
| Fedora | `sudo dnf install ydotool python3-dbus-next` |
| Arch | `sudo pacman -S --needed ydotool python-dbus-next` |

On older Ubuntu/Debian releases, the daemon may be provided by a separate `ydotoold` package; if the binary is missing, the installer will install that package as well. Older packages that do not provide version 1.0.4 are not supported.

The installer detects the distribution family through `/etc/os-release`. Missing packages are installed only when `--install-deps` is explicitly provided.

Fedora provides the Qt 6 D-Bus tool as `qdbus-qt6` instead of `qdbus6`. The installer automatically detects both names and distribution-specific Qt 6 binary directories. If the tool is missing on Fedora, it can also be installed with `sudo dnf install qt6-qttools`.

## Installing from source

As a regular Plasma user:

Extract the release source archive or clone the repository into a `keirokit-kde` directory, then run:

```bash
cd keirokit-kde
./install.sh --install-deps
```

If you do not have access to `/dev/uinput`, install the secure active-session udev rule as well:

```bash
./install.sh --with-udev-rule
```

If you do not want cursor integration:

```bash
./install.sh --skip-cursor-helper
```

The installer installs the `keirokit-kde` KWin package for the current user, enables the required per-monitor desktop settings, and starts the script in the same session. Cursor integration does not depend on the distribution-provided service file; it uses its own dedicated ydotoold service and a socket accessible only to the user.

## Installing a release package

The `.kwinscript` file on the GitHub Releases page contains only the KWin plugin:

```bash
kpackagetool6 -t KWin/Script -i keirokit-kde-1.0.1.kwinscript
```

For a full installation, extract the `keirokit-kde-1.0.1.tar.gz` archive from the release and run `./install.sh`.

## Default shortcuts

| Action | Shortcut |
|---|---|
| Focus left/down/up/right | `Meta+Ctrl+Alt+H/J/K/L` |
| Change the layout for the active monitor/desktop | `Meta+Alt+Space` |
| Toggle the focused window between floating/tiled | `Meta+Alt+F` |
| Show desktop 1…9 on its assigned monitor | `Meta+Shift+F1…F9` |
| Move the active window to desktop 1…9 and follow it | `Meta+Ctrl+Shift+F1…F9` |

Shortcuts can be changed by searching for “Keirokit KDE” under System Settings → Shortcuts → KWin.

## Configuration

The Keirokit KDE settings button under System Settings → Window Management → KWin Scripts applies 16 settings live.

The source language of the settings interface is English. When Plasma's system language is Turkish, the bundled Turkish translation is used automatically. The language can be selected under System Settings → Region & Language. Reopen System Settings after changing the language.

Monitor/desktop mappings use the `monitor-name=desktops` format:

```text
DP-2=1-4
HDMI-A-1=5-8
```

Layout overrides use the `monitor-name:desktop=layout` format:

```text
DP-2:1=master-stack
DP-2:4=monocle
HDMI-A-1:7=columns
```

To view monitor names:

```bash
# Arch/Ubuntu/Debian
qdbus6 org.kde.KWin /KWin org.kde.KWin.supportInformation

# Fedora
qdbus-qt6 org.kde.KWin /KWin org.kde.KWin.supportInformation
```

## Validation and packaging

```bash
bash tests/run.sh
bash scripts/build-package.sh
```

CI validates syntax, XML/KConfig connections, the Turkish translation catalog, Python unit tests, the KWin behavior harness, branding checks, and the release package in Ubuntu, Debian, Fedora, and Arch containers. Real multi-monitor KWin behavior should also be tested in a live Plasma session.

## Compatibility

Keirokit KDE has currently only been tested on Kubuntu, Fedora, and Arch Linux.

It works as expected on Kubuntu and Arch Linux. Unfortunately, on Fedora, windows may not always be arranged correctly.

Other distributions have not been tested yet.

## Known Issues

Keirokit KDE is still experimental, and there are some known issues:

- Some layouts may not work correctly in all situations.
- Closing windows can sometimes break the current layout.
- Not every setting or configuration has been tested extensively. I have tested as much as I reasonably could, but some issues may still exist.

If you encounter a problem, feel free to open an issue.

## Project Status

I'm not currently sure whether I will continue updating this project.

However, if I see that there are enough people who genuinely want auto-tiling and scrolling window management on KDE Plasma, there is a good chance that I will continue working on it.

## Troubleshooting
```bash
journalctl --user -f -o cat | grep --line-buffered '\[Keirokit KDE\]'
kpackagetool6 -t KWin/Script -l | grep keirokit-kde
systemctl --user status keirokit-kde-ydotoold.service
systemctl --user status keirokit-kde-cursor-helper.service
```

For details about the cursor service, see [cursor-helper/README.md](cursor-helper/README.md). To uninstall Keirokit KDE, run `./uninstall.sh`; to also remove the system udev rule, run `./uninstall.sh --remove-udev-rule`.

## License

MIT. See the [LICENSE](LICENSE) file for details.