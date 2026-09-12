# Keirokit KDE imleç entegrasyonu

Bu isteğe bağlı session D-Bus servisi, KWin'in istediği göreli imleç hareketini
özel bir ydotoold soketine iletir. Eklentinin döşeme özellikleri helper olmadan
da çalışır; yalnızca klavye odağını izleyen imleç hareketi devre dışı kalır.

## D-Bus sözleşmesi

- Bus: `Keirokit.KDE.CursorHelper`
- Nesne: `/Keirokit/KDE/CursorHelper`
- Arayüz: `Keirokit.KDE.CursorHelper`
- `WarpCursor(x: int32, y: int32) -> bool`
- `MoveCursorRelative(delta_x: int32, delta_y: int32) -> bool`

## Kurulum

Üst dizindeki `./install.sh` önerilir. Yalnızca helper'ı kurmak için:

```bash
cd cursor-helper
./install.sh --install-deps
```

Ubuntu/Debian ve Fedora'da Python paketi `python3-dbus-next`, Arch'ta
`python-dbus-next` adını taşır. `ydotool` paket adı üç ailede de aynıdır.

Kurulum iki systemd kullanıcı servisi ekler:

- `keirokit-kde-ydotoold.service`: `%t/keirokit-kde/ydotool.sock` üzerinde,
  izinleri `0600` olan özel daemon
- `keirokit-kde-cursor-helper.service`: KWin'in D-Bus çağrılarını işler

Dağıtımın kendi ydotool servisi kullanılmadığından servis ve soket yolu
farkları eklentiyi etkilemez.

`/dev/uinput` yazma izni yoksa:

```bash
./install.sh --with-udev-rule
```

Bu seçenek yalnızca aktif yerel oturuma erişim veren `uaccess` kuralını
`/etc/udev/rules.d/70-keirokit-kde-uinput.rules` olarak kurar; kullanıcıyı
geniş yetkili bir giriş aygıtı grubuna eklemez.

## Doğrulama

```bash
systemctl --user status keirokit-kde-ydotoold.service
systemctl --user status keirokit-kde-cursor-helper.service
qdbus6 Keirokit.KDE.CursorHelper /Keirokit/KDE/CursorHelper \
  Keirokit.KDE.CursorHelper.WarpCursor 500 500
```

Fedora'da son komutta `qdbus6` yerine `qdbus-qt6` kullanın.

Loglar:

```bash
journalctl --user -u keirokit-kde-ydotoold.service -f
journalctl --user -u keirokit-kde-cursor-helper.service -f
```

Özel bir test soketi kullanacaksanız hem daemon hem helper ortamında aynı
`YDOTOOL_SOCKET` değerini ayarlayın.
