# Değişiklik günlüğü

Bu proje [Semantic Versioning](https://semver.org/) kullanır.

## 1.0.1 - 2026-08-25

- Fedora/KWin'de uygulamadan önce eklenebilen odaksız iç/protokol yüzeyinin
  bir BSP yaprağı tüketip ilk uygulamayı yarım açması engellendi
- Yinelenen `windowAdded` sinyalleri zararsız hâle getirildi; BSP ağaçlarına
  yinelenen pencere yapraklarını temizleyen ve tek pencere durumunu
  kendiliğinden onaran güvenlik denetimleri eklendi
- `managed` ve `normalWindow` görünen KWin iç pencereleri gerçek API'deki
  `wantsInput` niteliğiyle ayıklandı
- Gizli pencerelerin ve etkin olmayan Plasma etkinliklerindeki pencerelerin
  görünür BSP alanını bölmesi engellendi
- Aşırı boşluk değerlerinin çok küçük kullanılabilir alanlarda pencereyi ekran
  dışına taşıması engellendi
- Kesirli ölçeklemede dikdörtgen kenarları birlikte yuvarlanarak bir piksellik
  ekran taşmaları giderildi
- Output/masaüstü geçişlerindeki geçici API ve `clientArea` hataları artık bir
  betik callback'ini veya diğer ekranların yerleşimini kesmiyor
- Aynı output için birden çok eşleme satırı önceki masaüstlerini kaybetmeden
  birleştiriliyor
- Bilerek boşaltılan liste ayarlarının kendiliğinden varsayılana dönmesi
  engellendi
- Masaüstü 1–9 kısayolları, ilgili masaüstü sonradan oluşturulsa bile script
  yeniden yüklenmeden kullanılabilmesi için baştan kaydediliyor
- Yanlışlıkla girilen aşırı büyük masaüstü aralıklarının KWin'i uzun süre
  meşgul etmesi önlendi
- Sürüm arşivlerinden Python cache dosyaları ve yerel kullanıcı kimliği
  temizlendi; dosya izinleri yayın için normalleştirildi
- Ayar arayüzünün varsayılan dili İngilizce yapıldı ve Türkçe çeviri eklendi
- Türkçe katalog KWin'in beklediği `contents/locale` yolunda `.kwinscript`
  paketine ve dağıtım CI denetimlerine eklendi

## 1.0.0 - 2026-08-25

- İlk Keirokit KDE sürümü
- Plasma/KWin 6.7+ dinamik döşeme ve ekran başına masaüstü desteği
- Ubuntu/Debian, Fedora ve Arch bağımlılık algılama desteği
- Dağıtımdan bağımsız özel ydotoold kullanıcı servisi
- GitHub CI, etiket tabanlı sürüm ve `.kwinscript` paketleme akışı
