# Keirokit KDE

Keirokit KDE, KDE Plasma 6.7 ve üzerindeki Wayland oturumları için dinamik
pencere döşeme ve ekran başına sanal masaüstü grupları sağlayan bir KWin
betiğidir.

## Özellikler

- `binary-split`, `master-stack`, `columns`, `rows` ve `monocle` yerleşimleri
- Ekran/masaüstü bazında yerleşim seçimi
- Ayrı iç ve dört kenarlı dış boşluk ayarları
- Yapılandırılabilir smart gaps
- Ekranlar arasında uzamsal klavye odağı
- Pencereyle birlikte hedef masaüstüne ve ekrana geçiş
- Yeni pencereyi imlecin bulunduğu tile'a ekleme
- Sürükleyip bırakarak tile yer değiştirme
- Regex tabanlı pencere istisnaları
- İsteğe bağlı, Wayland uyumlu imleç takibi

## Gereksinimler

- KDE Plasma/KWin 6.7 veya üzeri
- Wayland oturumu
- Bash, Python 3 ve systemd kullanıcı oturumu
- Tam kurulum için `ydotool` 1.0.4+ ve Python `dbus-next`

Plasma 6.7 şartı dağıtımdan bağımsızdır. Dağıtımınızın deposundaki Plasma daha
eskiyse eklenti desteklenmez.

### İmleç entegrasyonu bağımlılıkları

| Dağıtım | Komut |
|---|---|
| Ubuntu / Debian | `sudo apt update && sudo apt install ydotool python3-dbus-next` |
| Fedora | `sudo dnf install ydotool python3-dbus-next` |
| Arch | `sudo pacman -S --needed ydotool python-dbus-next` |

Eski Ubuntu/Debian sürümlerinde daemon ayrı `ydotoold` paketinde olabilir;
kurulum betiği binary eksikse bu paketi ayrıca kurar. 1.0.4 sağlamayan eski
paketler desteklenmez.

Kurulum betiği dağıtım ailesini `/etc/os-release` üzerinden tanır. Eksik
paketleri yalnızca açıkça `--install-deps` verildiğinde kurar.

Fedora, Qt 6 D-Bus aracını `qdbus6` yerine `qdbus-qt6` adıyla sağlar. Kurulum
betiği iki adı ve dağıtıma özgü Qt 6 binary dizinlerini otomatik algılar. Araç
ayrıca eksikse Fedora'da `sudo dnf install qt6-qttools` ile kurulabilir.

## Kaynaktan kurulum

Normal Plasma kullanıcısıyla:

Sürüm kaynak arşivini açın veya depoyu `keirokit-kde` dizinine klonladıktan
sonra:

```bash
cd keirokit-kde
./install.sh --install-deps
```

`/dev/uinput` erişimi yoksa güvenli aktif-oturum udev kuralını da kurun:

```bash
./install.sh --with-udev-rule
```

İmleç entegrasyonunu istemiyorsanız:

```bash
./install.sh --skip-cursor-helper
```

Kurulum, `keirokit-kde` KWin paketini kullanıcı hesabına kurar,
gerekli ekran başına masaüstü ayarlarını açar ve betiği aynı oturumda başlatır.
İmleç entegrasyonu dağıtımın sağladığı servis dosyasına bağlı değildir; kendi
özel ydotoold servisini ve yalnızca kullanıcıya açık soketini kullanır.

## Sürüm paketini kurma

GitHub Releases sayfasındaki `.kwinscript` dosyası yalnızca KWin eklentisidir:

```bash
kpackagetool6 -t KWin/Script -i keirokit-kde-1.0.1.kwinscript
```

Tam kurulum için sürümdeki `keirokit-kde-1.0.1.tar.gz` arşivini açıp
`./install.sh` çalıştırın.

## Varsayılan kısayollar

| Eylem | Kısayol |
|---|---|
| Sola/aşağı/yukarı/sağa odak | `Meta+Ctrl+Alt+H/J/K/L` |
| Etkin ekran/masaüstü yerleşimini değiştir | `Meta+Alt+Space` |
| Odaklı pencereyi float/tiled yap | `Meta+Alt+F` |
| Masaüstü 1…9'u atandığı ekranda göster | `Meta+Shift+F1…F9` |
| Aktif pencereyle masaüstü 1…9'a git | `Meta+Ctrl+Shift+F1…F9` |

Kısayollar Sistem Ayarları → Kısayollar → KWin bölümünde “Keirokit KDE”
aranarak değiştirilebilir.

## Yapılandırma

Sistem Ayarları → Pencere Yönetimi → KWin Betikleri bölümündeki Keirokit KDE
ayar düğmesi 16 ayarı canlı olarak uygular.

Ayar arayüzünün kaynak dili İngilizcedir. Plasma sistem dili Türkçe olduğunda
birlikte gelen Türkçe çeviri otomatik kullanılır; dil, Sistem Ayarları → Bölge
ve Dil bölümünden seçilir. Değişiklikten sonra Sistem Ayarları'nı yeniden açın.

Ekran/masaüstü eşlemeleri `ekran-adı=masaüstleri` biçimindedir:

```text
DP-2=1-4
HDMI-A-1=5-8
```

Yerleşim override'ları `ekran-adı:masaüstü=layout` biçimindedir:

```text
DP-2:1=master-stack
DP-2:4=monocle
HDMI-A-1:7=columns
```

Ekran adlarını görmek için:

```bash
# Arch/Ubuntu/Debian
qdbus6 org.kde.KWin /KWin org.kde.KWin.supportInformation

# Fedora
qdbus-qt6 org.kde.KWin /KWin org.kde.KWin.supportInformation
```

## Doğrulama ve paketleme

```bash
bash tests/run.sh
bash scripts/build-package.sh
```

CI; Ubuntu, Debian, Fedora ve Arch container'larında sözdizimi, XML/KConfig
bağlantıları, Türkçe çeviri kataloğu, Python birim testleri, KWin davranış
harness'ı, marka temizliği ve sürüm paketini doğrular. Gerçek çoklu ekranlı KWin
davranışı ayrıca canlı Plasma oturumunda sınanmalıdır.

## Sorun giderme

```bash
journalctl --user -f -o cat | grep --line-buffered '\[Keirokit KDE\]'
kpackagetool6 -t KWin/Script -l | grep keirokit-kde
systemctl --user status keirokit-kde-ydotoold.service
systemctl --user status keirokit-kde-cursor-helper.service
```

İmleç servisi ayrıntıları için [cursor-helper/README.md](cursor-helper/README.md)
dosyasına bakın. Kaldırmak için `./uninstall.sh`; sistem udev kuralını da
kaldırmak için `./uninstall.sh --remove-udev-rule` kullanın.

## Lisans

MIT. Ayrıntılar [LICENSE](LICENSE) dosyasındadır.
