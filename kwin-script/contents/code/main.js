// SPDX-FileCopyrightText: 2026 Keirokit KDE contributors
// SPDX-License-Identifier: MIT

"use strict";

const LOG_PREFIX = "[Keirokit KDE]";
const LAYOUT_BINARY_SPLIT = "binary-split";
const LAYOUT_MASTER_STACK = "master-stack";
const LAYOUT_COLUMNS = "columns";
const LAYOUT_ROWS = "rows";
const LAYOUT_MONOCLE = "monocle";
const ALL_LAYOUTS = [
    LAYOUT_BINARY_SPLIT,
    LAYOUT_MASTER_STACK,
    LAYOUT_COLUMNS,
    LAYOUT_ROWS,
    LAYOUT_MONOCLE
];
const DEFAULT_GAP = 8;
const MAX_GAP = 200;
const DEFAULT_MASTER_RATIO = 60;
const MAX_SHORTCUT_DESKTOP = 9;
const FOCUS_LEFT = "left";
const FOCUS_RIGHT = "right";
const FOCUS_UP = "up";
const FOCUS_DOWN = "down";
const CURSOR_WARP_TIMEOUT_MS = 1500;
const CURSOR_MOVE_SETTLE_MS = 50;
const CURSOR_WARP_TOLERANCE_PX = 4;
const CURSOR_WARP_MAX_ATTEMPTS = 6;
const CURSOR_INITIAL_INPUT_GAIN = 1.85;
const CURSOR_MIN_INPUT_GAIN = 0.25;
const CURSOR_MAX_INPUT_GAIN = 4;
const WINDOW_STATE_SETTLE_MS = 50;
const WINDOW_OPEN_SETTLE_DELAYS_MS = [40, 120, 300, 1000];
const WINDOW_GEOMETRY_TOLERANCE_PX = 2;
const EXTERNAL_FOCUS_WARP_SETTLE_MS = 50;
const WINDOW_CLOSE_FOCUS_SUPPRESS_MS = 150;
const DEFAULT_OUTPUT_ASSIGNMENT_LINES = [
    "// Biçim: ekran-adı=masaüstleri (tek sayılar ve aralıklar kabul edilir)",
    "DP-2=1-4",
    "HDMI-A-1=5-8"
];
const DEFAULT_LAYOUT_OVERRIDE_LINES = [
    "// Biçim: ekran-adı:masaüstü=layout",
    "// Örnek: HDMI-A-1:7=monocle"
];
const DEFAULT_DENYLIST_LINES = [
    "krunner",
    "plasmashell"
];

let activeLayout = LAYOUT_BINARY_SPLIT;
let denylistRules = [];
let mouseFollowsFocus = true;
let openAtCursor = false;
let enforceOutputDesktopAssignments = true;
let outputDesktopAssignments = {};
let desktopOutputAssignments = {};
let configuredLayoutOverrides = {};
let runtimeLayoutOverrides = {};
let gapSettings = null;
let masterRatio = DEFAULT_MASTER_RATIO;
let masterCount = 1;
let retileInProgress = false;
let desktopMapChangeInProgress = false;
let managedWindowMutationInProgress = false;
let keirokitFocusChangeInProgress = false;
let closeFocusWarpSuppressed = false;
let pendingExternalFocusWarp = null;
let closeFocusSuppressionTimer = null;
let lastTileableOrder = [];
const observedWindows = [];
const windowOrder = [];
const explicitlyFloatingWindows = [];
const interactiveMoveResizeStates = [];
const pendingWarpRequests = [];
const pendingWindowStateTimers = [];
const pendingWindowOpenTimers = [];
const expectedWindowGeometries = [];
const binarySplitTrees = {};
const lastValidDesktopByOutput = {};
const lastFocusedWindowByWorkspace = {};

// Tüm motor mesajlarını journal'da kolayca bulunabilecek ortak önekle yazar.
function log(message) {
    console.log(`${LOG_PREFIX} ${message}`);
}

// KConfig enum değerini desteklenen dahili layout adına dönüştürür.
function normalizeLayoutName(configValue) {
    const normalizedValue = String(configValue).toLowerCase();
    const numericValue = Number(configValue);

    if (numericValue === 1 || normalizedValue.indexOf("master") !== -1) {
        return LAYOUT_MASTER_STACK;
    }

    if (numericValue === 2 || normalizedValue.indexOf("column") !== -1) {
        return LAYOUT_COLUMNS;
    }

    if (numericValue === 3 || normalizedValue.indexOf("row") !== -1) {
        return LAYOUT_ROWS;
    }

    if (numericValue === 4 || normalizedValue.indexOf("monocle") !== -1) {
        return LAYOUT_MONOCLE;
    }

    return LAYOUT_BINARY_SPLIT;
}

// Script config'inden başlangıç layout'unu okur.
function readConfiguredLayout() {
    return normalizeLayoutName(readConfig("LayoutAlgorithm", 0));
}

// Bir tamsayı ayarını istenen aralığa güvenle sınırlar.
function readBoundedIntegerConfig(key, defaultValue, minimum, maximum) {
    const configuredValue = Number(readConfig(key, defaultValue));

    if (!isFinite(configuredValue)) {
        log(
            `Geçersiz ${key} değeri; varsayılan ${defaultValue} kullanılacak.`
        );
        return defaultValue;
    }

    return Math.max(
        minimum,
        Math.min(maximum, Math.round(configuredValue))
    );
}

// İç/dış boşluklar ile smart-gaps davranışını tek bir ayar nesnesine okur.
function readGapSettings() {
    return {
        inner: readBoundedIntegerConfig(
            "InnerGap",
            readBoundedIntegerConfig("Gap", DEFAULT_GAP, 0, MAX_GAP),
            0,
            MAX_GAP
        ),
        top: readBoundedIntegerConfig(
            "OuterGapTop",
            DEFAULT_GAP,
            0,
            MAX_GAP
        ),
        right: readBoundedIntegerConfig(
            "OuterGapRight",
            DEFAULT_GAP,
            0,
            MAX_GAP
        ),
        bottom: readBoundedIntegerConfig(
            "OuterGapBottom",
            DEFAULT_GAP,
            0,
            MAX_GAP
        ),
        left: readBoundedIntegerConfig(
            "OuterGapLeft",
            DEFAULT_GAP,
            0,
            MAX_GAP
        ),
        smart: readBooleanConfig("SmartGaps", false),
        smartThreshold: readBoundedIntegerConfig(
            "SmartGapsThreshold",
            1,
            1,
            20
        )
    };
}

// KConfig bool değerlerini gerçek boolean, sayı veya metin biçiminden güvenli
// biçimde okuyup belirtilen varsayılana düşürür.
function readBooleanConfig(key, defaultValue) {
    const configuredValue = readConfig(key, defaultValue);

    if (typeof configuredValue === "boolean") {
        return configuredValue;
    }

    if (typeof configuredValue === "number") {
        return configuredValue !== 0;
    }

    const normalizedValue = String(configuredValue).trim().toLowerCase();

    if (normalizedValue === "true" || normalizedValue === "1") {
        return true;
    }

    if (normalizedValue === "false" || normalizedValue === "0") {
        return false;
    }

    log(
        `Geçersiz ${key} değeri; varsayılan `
        + `${defaultValue ? "açık" : "kapalı"} kullanılacak.`
    );
    return defaultValue;
}

// İmlecin odağı izlemesi seçeneğini script config'inden okur.
function readMouseFollowsFocus() {
    return readBooleanConfig("MouseFollowsFocus", true);
}

// Yeni pencerelerin imleç altındaki layout bölgesine eklenmesi seçeneğini okur.
function readOpenAtCursor() {
    return readBooleanConfig("OpenAtCursor", true);
}

// KConfig'ten gelen QStringList/JavaScript dizisi değerini satır dizisine
// dönüştürür; eski veya elle yazılmış metin değerlerini de güvenle kabul eder.
function configValueToLines(configValue) {
    if (configValue === undefined || configValue === null) {
        return [];
    }

    if (
        typeof configValue !== "string"
        && typeof configValue.length === "number"
    ) {
        const lines = [];

        for (let index = 0; index < configValue.length; index += 1) {
            lines.push(String(configValue[index]));
        }

        return lines;
    }

    const text = String(configValue);

    if (text.indexOf("\n") !== -1) {
        return text.split(/\r?\n/);
    }

    // StringList normalde JavaScript dizisi olarak gelir. Bu virgül ayrımı,
    // yalnızca elle yazılmış eski tek-string config değerleri için geri uyumdur.
    return text.split(",");
}

// Denylist satırlarını case-insensitive RegExp nesnelerine derler; boş satırlar
// ile "#" veya "//" başlayan açıklama satırlarını filtre kuralı saymaz.
function compileDenylistRules(lines) {
    const rules = [];

    for (let index = 0; index < lines.length; index += 1) {
        const pattern = String(lines[index]).trim();

        if (
            pattern.length === 0
            || pattern.indexOf("#") === 0
            || pattern.indexOf("//") === 0
        ) {
            continue;
        }

        try {
            rules.push({
                pattern,
                regex: new RegExp(pattern, "i")
            });
        } catch (error) {
            log(`Geçersiz denylist regex'i atlandı: ${pattern}; hata=${error}`);
        }
    }

    return rules;
}

// Derlenmiş denylist kurallarının pattern alanlarını başlangıç logu için tek
// satırda birleştirir.
function denylistRuleSummary(rules) {
    const patterns = [];

    for (let index = 0; index < rules.length; index += 1) {
        patterns.push(rules[index].pattern);
    }

    return patterns.join(", ");
}

// Script config'indeki StringList denylist'ini okur ve çalıştırılabilir regex
// kurallarına dönüştürür.
function readConfiguredDenylist() {
    const configuredLines = configValueToLines(
        readConfig("WindowDenylist", DEFAULT_DENYLIST_LINES)
    );
    const rules = compileDenylistRules(configuredLines);

    log(
        `Denylist yüklendi: ${rules.length} regex`
        + (rules.length > 0
            ? ` (${denylistRuleSummary(rules)})`
            : "")
    );

    return rules;
}

// Yorum ve boş satırları yapılandırma listelerinden ayıklar.
function activeConfigLines(configValue, defaultValue) {
    const sourceValue = configValue === undefined || configValue === null
        ? defaultValue
        : configValue;
    const sourceLines = configValueToLines(sourceValue);
    const lines = [];

    for (let index = 0; index < sourceLines.length; index += 1) {
        const line = String(sourceLines[index]).trim();

        if (
            line.length === 0
            || line.indexOf("#") === 0
            || line.indexOf("//") === 0
        ) {
            continue;
        }

        lines.push(line);
    }

    return lines;
}

// Kullanıcıya gösterilen 1 tabanlı masaüstü numarasını döndürür.
function desktopNumber(desktop) {
    if (!desktop) {
        return 0;
    }

    return Number(desktop.x11DesktopNumber || 0);
}

// 1 tabanlı masaüstü numarasını KWin VirtualDesktop nesnesine dönüştürür.
function desktopByNumber(number) {
    const desktops = workspace.desktops;

    for (let index = 0; index < desktops.length; index += 1) {
        if (desktopNumber(desktops[index]) === Number(number)) {
            return desktops[index];
        }
    }

    return null;
}

// "1,2,4-7" biçimini artan, benzersiz masaüstü numaralarına açar.
function parseDesktopNumberSpec(specification) {
    const values = [];
    const seen = {};
    const parts = String(specification).split(",");
    let maximumDesktopNumber = 0;

    for (let index = 0; index < workspace.desktops.length; index += 1) {
        maximumDesktopNumber = Math.max(
            maximumDesktopNumber,
            desktopNumber(workspace.desktops[index])
        );
    }

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex].trim();
        const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
        let first = 0;
        let last = 0;

        if (rangeMatch) {
            first = Number(rangeMatch[1]);
            last = Number(rangeMatch[2]);
        } else if (/^\d+$/.test(part)) {
            first = Number(part);
            last = first;
        } else {
            log(`Geçersiz masaüstü aralığı atlandı: ${part}`);
            continue;
        }

        const ascending = first <= last;
        const boundedFirst = ascending
            ? Math.max(1, first)
            : Math.min(maximumDesktopNumber, first);
        const boundedLast = ascending
            ? Math.min(maximumDesktopNumber, last)
            : Math.max(1, last);

        if (
            maximumDesktopNumber < 1
            || (ascending && boundedFirst > boundedLast)
            || (!ascending && boundedFirst < boundedLast)
        ) {
            log(`Mevcut masaüstü aralığı dışında değer atlandı: ${part}`);
            continue;
        }

        if (boundedFirst !== first || boundedLast !== last) {
            log(
                `Masaüstü aralığı mevcut sınırlara daraltıldı: ${part} -> `
                + `${boundedFirst}-${boundedLast}`
            );
        }

        const step = ascending ? 1 : -1;

        for (
            let value = boundedFirst;
            value !== boundedLast + step;
            value += step
        ) {
            if (seen[value]) {
                continue;
            }

            seen[value] = true;
            values.push(value);
        }
    }

    return values;
}

// Ekran adını canlı KWin output nesnesine dönüştürür.
function outputByName(outputName) {
    const screens = workspace.screens;

    for (let index = 0; index < screens.length; index += 1) {
        if (screens[index].name === outputName) {
            return screens[index];
        }
    }

    return null;
}

// KConfig'teki "DP-2=1-4" satırlarını çift yönlü ekran/masaüstü haritasına
// dönüştürür. Aynı masaüstünün birden çok ekrana atanmasına izin vermez.
function readOutputDesktopAssignments() {
    const lines = activeConfigLines(
        readConfig(
            "OutputDesktopAssignments",
            DEFAULT_OUTPUT_ASSIGNMENT_LINES
        ),
        DEFAULT_OUTPUT_ASSIGNMENT_LINES
    );
    const byOutput = {};
    const byDesktop = {};

    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(/^(.+?)\s*=\s*(.+)$/);

        if (!match) {
            log(`Geçersiz ekran/masaüstü eşlemesi atlandı: ${lines[index]}`);
            continue;
        }

        const outputName = match[1].trim();
        const output = outputByName(outputName);

        if (!output) {
            log(`Eşlemedeki ekran şu anda bağlı değil: ${outputName}`);
            continue;
        }

        const numbers = parseDesktopNumberSpec(match[2]);
        const assigned = byOutput[outputName] || [];

        for (
            let numberIndex = 0;
            numberIndex < numbers.length;
            numberIndex += 1
        ) {
            const desktop = desktopByNumber(numbers[numberIndex]);

            if (!desktop) {
                log(
                    `Eşlemedeki masaüstü mevcut değil: ${outputName}=`
                    + `${numbers[numberIndex]}`
                );
                continue;
            }

            if (byDesktop[desktop.id]) {
                if (byDesktop[desktop.id] === outputName) {
                    log(
                        `Yinelenen masaüstü eşlemesi atlandı: `
                        + `${outputName}=${desktopNumber(desktop)}`
                    );
                    continue;
                }

                log(
                    `Masaüstü ${desktopNumber(desktop)} zaten `
                    + `${byDesktop[desktop.id]} ekranına atanmış; `
                    + `${outputName} satırında atlandı.`
                );
                continue;
            }

            assigned.push(desktop);
            byDesktop[desktop.id] = outputName;
        }

        if (assigned.length > 0) {
            byOutput[outputName] = assigned;
        }
    }

    return {
        byOutput,
        byDesktop
    };
}

// Ekran/masaüstü çifti için nesne anahtarı üretir.
function workspaceKey(output, desktop) {
    if (!output || !desktop) {
        return "";
    }

    return `${output.name}::${desktop.id}`;
}

// Layout override metninin desteklenen tam layout adını döndürür.
function configuredLayoutName(value) {
    const name = String(value).trim().toLowerCase();

    for (let index = 0; index < ALL_LAYOUTS.length; index += 1) {
        if (name === ALL_LAYOUTS[index]) {
            return name;
        }
    }

    return "";
}

// "DP-2:1=master-stack" satırlarını ekran/masaüstü layout override haritasına
// dönüştürür.
function readLayoutOverrides() {
    const lines = activeConfigLines(
        readConfig("LayoutOverrides", DEFAULT_LAYOUT_OVERRIDE_LINES),
        DEFAULT_LAYOUT_OVERRIDE_LINES
    );
    const overrides = {};

    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(/^(.+?):(\d+)\s*=\s*(.+)$/);

        if (!match) {
            log(`Geçersiz layout override atlandı: ${lines[index]}`);
            continue;
        }

        const output = outputByName(match[1].trim());
        const desktop = desktopByNumber(Number(match[2]));
        const layout = configuredLayoutName(match[3]);

        if (!output || !desktop || !layout) {
            log(`Kullanılamayan layout override atlandı: ${lines[index]}`);
            continue;
        }

        overrides[workspaceKey(output, desktop)] = layout;
    }

    return overrides;
}

// Runtime kısayol seçimini, ardından yapılandırılmış override'ı, son olarak
// genel layout ayarını kullanır.
function layoutForOutputDesktop(output, desktop) {
    const key = workspaceKey(output, desktop);

    return runtimeLayoutOverrides[key]
        || configuredLayoutOverrides[key]
        || activeLayout;
}

// Bir masaüstünün yapılandırmada atandığı canlı output'u döndürür.
function mappedOutputForDesktop(desktop) {
    if (!desktop) {
        return null;
    }

    const outputName = desktopOutputAssignments[desktop.id];
    return outputName ? outputByName(outputName) : null;
}

// Output'un izin verilen masaüstü listesinde hedefin bulunup bulunmadığını
// denetler; eşlemesi olmayan output'larda tüm masaüstlerine izin verir.
function desktopIsAllowedOnOutput(desktop, output) {
    if (!desktop || !output) {
        return false;
    }

    const assigned = outputDesktopAssignments[output.name];

    if (!assigned || assigned.length === 0) {
        return true;
    }

    return windowIsInList(assigned, desktop);
}

// Plasma 6.7'nin ekran başına güncel sanal masaüstünü döndürür.
function currentDesktopForOutput(output) {
    if (!output) {
        return null;
    }

    try {
        return workspace.currentDesktopForScreen(output) || null;
    } catch (error) {
        log(
            `Output masaüstü okunamadı: output=${output.name}, hata=${error}`
        );
        return null;
    }
}

// Bir pencerenin verilen sanal masaüstünde görünür olup olmadığını belirler.
function windowBelongsToDesktop(window, desktop) {
    if (!window || !desktop) {
        return false;
    }

    const desktops = window.desktops;

    // Boş masaüstü listesi KWin'de "tüm masaüstlerinde" anlamına gelir.
    if (!desktops || desktops.length === 0) {
        return true;
    }

    for (let index = 0; index < desktops.length; index += 1) {
        if (desktops[index].id === desktop.id) {
            return true;
        }
    }

    return false;
}

// Boş activities listesi KWin'de "tüm etkinliklerde" anlamına gelir. Diğer
// etkinliklerdeki pencereler aynı output/desktop üzerinde görünür olmadığından
// mevcut layout'ta yer tüketmemelidir.
function windowBelongsToCurrentActivity(window) {
    if (!window) {
        return false;
    }

    const activities = window.activities;
    const currentActivity = typeof workspace.currentActivity === "string"
        ? workspace.currentActivity
        : "";

    if (!activities || activities.length === 0 || !currentActivity) {
        return true;
    }

    for (let index = 0; index < activities.length; index += 1) {
        if (String(activities[index]) === currentActivity) {
            return true;
        }
    }

    return false;
}

// Loglarda boş başlıkları açıkça göstermek için güvenli pencere başlığı üretir.
function windowCaption(window) {
    return window && window.caption
        ? String(window.caption)
        : "<başlıksız>";
}

// KWin JS Window API'de D-Bus queryWindowInfo çıktısındaki
// "hasTransientParent" adlı alan yoktur. Aynı yapısal anlamı doğrulanmış
// transient/transientFor özelliklerinden hesaplar.
function hasTransientParent(window) {
    return Boolean(window && (window.transient === true || window.transientFor));
}

// KWin tam ekran sırasında normal bir pencerenin moveable/resizeable
// özelliklerini geçici olarak false yapar. Bu state'ler float/yapısal istisna
// değildir; Keirokit KDE pencereyi listeye alıp state'i kaldırmalıdır.
function windowHasTilingPlacementState(window) {
    return Boolean(
        window
        && (window.fullScreen === true || window.maximizeMode)
    );
}

// Resource bilgilerine hiç dokunmadan zorunlu yapısal istisnaları tam istenen
// sırada denetler; ilk eşleşen neden sonraki denylist adımını kesin olarak keser.
function structuralExclusionReason(window) {
    if (!window || !window.managed) {
        return "!managed";
    }

    if (window.deleted === true) {
        return "deleted";
    }

    // KWin, iç kabuk ve protokol yardımcı yüzeylerini windowList() üzerinden
    // gösterebilir. Geçici olarak taşınabilir geometri bildirseler bile bunlar
    // uygulama penceresi değildir ve BSP yaprağı tüketmemelidir.
    if (window.normalWindow === false) {
        return "!normalWindow";
    }

    // KWin InternalWindow nesneleri gerçek uygulama penceresi olmadıkları
    // halde managed=true, normalWindow=true, moveable=true ve resizeable=true
    // bildirebilir. Script API doğrudan isInternal özelliğini sunmadığı için
    // odak kabul etmeyen bu yüzeyleri belgelenmiş wantsInput alanıyla ayıkla.
    if (window.wantsInput === false) {
        return "!wantsInput";
    }

    const nonApplicationWindowTypes = [
        "desktopWindow",
        "dock",
        "toolbar",
        "menu",
        "splash",
        "utility",
        "dropdownMenu",
        "popupMenu",
        "tooltip",
        "notification",
        "criticalNotification",
        "appletPopup",
        "onScreenDisplay",
        "comboBox",
        "dndIcon",
        "inputMethod",
        "outline"
    ];

    for (let index = 0; index < nonApplicationWindowTypes.length; index += 1) {
        const typeName = nonApplicationWindowTypes[index];
        if (window[typeName] === true) {
            return typeName;
        }
    }

    if (window.specialWindow) {
        return "specialWindow";
    }

    if (window.popupWindow) {
        return "popupWindow";
    }

    if (window.dialog) {
        return "dialog";
    }

    if (window.modal) {
        return "modal";
    }

    if (hasTransientParent(window)) {
        return "hasTransientParent";
    }

    if (!window.moveable && !windowHasTilingPlacementState(window)) {
        return "!moveable";
    }

    if (!window.resizeable && !windowHasTilingPlacementState(window)) {
        return "!resizeable";
    }

    if (window.minimized) {
        return "minimized";
    }

    if (window.hidden === true) {
        return "hidden";
    }

    return "";
}

// Kullanıcının yalnızca Keirokit KDE float kısayoluyla tiling dışına çıkardığı
// normal pencereleri nesne kimliğiyle izler. Tam ekran/maximize bir float nedeni
// değildir; bu durumlar applyWindowGeometry tarafından kaldırılıp yeniden tile
// edilir.
function windowIsExplicitlyFloating(window) {
    return windowIsInList(explicitlyFloatingWindows, window);
}

// Yapısal filtreden geçmiş pencerenin denylist'te karşılaştırılacak üç kimlik
// alanını küçük/büyük harf duyarsız regex testine hazır stringler olarak okur.
function windowIdentity(window) {
    return {
        resourceClass: String(window.resourceClass || ""),
        resourceName: String(window.resourceName || ""),
        windowRole: String(window.windowRole || "")
    };
}

// Pencere kimliğini KRunner dahil gerçek sınıf değerlerini journal'dan
// gözlemlemeye elverişli tek satırlık bir metne dönüştürür.
function formatWindowIdentity(window, identity) {
    return (
        `caption=${windowCaption(window)}, `
        + `resourceClass=${identity.resourceClass || "<boş>"}, `
        + `resourceName=${identity.resourceName || "<boş>"}, `
        + `windowRole=${identity.windowRole || "<boş>"}`
    );
}

// Bir denylist regex'inin resourceClass, resourceName veya windowRole
// alanlarından hangisiyle eşleştiğini döndürür.
function matchingDenylistRule(identity) {
    const fields = [
        {name: "resourceClass", value: identity.resourceClass},
        {name: "resourceName", value: identity.resourceName},
        {name: "windowRole", value: identity.windowRole}
    ];

    for (let ruleIndex = 0; ruleIndex < denylistRules.length; ruleIndex += 1) {
        const rule = denylistRules[ruleIndex];

        for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
            const field = fields[fieldIndex];

            if (field.value && rule.regex.test(field.value)) {
                return {
                    pattern: rule.pattern,
                    field: field.name
                };
            }
        }
    }

    return null;
}

// Kesin filtre sırasını uygular: önce resourceClass'tan bağımsız yapısal
// istisnalar, yalnızca geçenlerde kimlik regex denylist'i, sonra zorunlu tiling.
function shouldTileWindow(window) {
    const structuralReason = structuralExclusionReason(window);

    if (structuralReason) {
        const typeValue = window && window.windowType !== undefined
            ? window.windowType
            : "<yok>";
        const layerValue = window && window.layer !== undefined
            ? window.layer
            : "<yok>";

        log(
            `Yapısal istisna: caption=${windowCaption(window)}, `
            + `neden=${structuralReason}, `
            + `hasTransientParent=${hasTransientParent(window)}, `
            + `layer=${layerValue}, type=${typeValue}`
        );
        return false;
    }

    if (windowIsExplicitlyFloating(window)) {
        log(`Kullanıcı float istisnası: caption=${windowCaption(window)}`);
        return false;
    }

    const identity = windowIdentity(window);
    const identityText = formatWindowIdentity(window, identity);
    const matchingRule = matchingDenylistRule(identity);

    if (matchingRule) {
        log(
            `Denylist istisnası: ${identityText}, `
            + `regex=${matchingRule.pattern}, alan=${matchingRule.field}`
        );
        return false;
    }

    if (!identity.resourceClass || !identity.windowRole) {
        log(
            `Kimlik alanı henüz boş; sinyalde tekrar değerlendirilecek: `
            + identityText
        );
    }

    log(`Zorunlu tiling: ${identityText}`);
    return true;
}

// Tüm açık pencerelere kesin filtre sırasını bir kez uygulayarak zorunlu
// tiling'e girecek pencere listesini oluşturur.
function tileableWindows(allWindows) {
    const result = [];

    for (let index = 0; index < allWindows.length; index += 1) {
        if (shouldTileWindow(allWindows[index])) {
            result.push(allWindows[index]);
        }
    }

    return result;
}

// Bir Window nesnesinin verilen listede nesne kimliğiyle bulunduğu indeksi
// döndürür; eşleşme yoksa -1 verir.
function windowIndexInList(windows, targetWindow) {
    for (let index = 0; index < windows.length; index += 1) {
        if (windows[index] === targetWindow) {
            return index;
        }
    }

    return -1;
}

// Bir Window nesnesinin verilen listede bulunup bulunmadığını nesne kimliğiyle
// denetler.
function windowIsInList(windows, targetWindow) {
    return windowIndexInList(windows, targetWindow) !== -1;
}

// Yeni pencereyi kararlı tiling sırasının sonuna, varsa eski kaydını kaldırarak
// ekler.
function appendWindowToOrder(window) {
    const existingIndex = windowIndexInList(windowOrder, window);

    if (existingIndex !== -1) {
        windowOrder.splice(existingIndex, 1);
    }

    windowOrder.push(window);
}

// Yeni pencereyi imleç altındaki mevcut tile'dan hemen önce ekleyerek binary
// split sonucunda o layout bölgesini yeni pencereye verir.
function insertWindowBefore(window, anchorWindow) {
    const existingIndex = windowIndexInList(windowOrder, window);

    if (existingIndex !== -1) {
        windowOrder.splice(existingIndex, 1);
    }

    const anchorIndex = windowIndexInList(windowOrder, anchorWindow);

    if (anchorIndex === -1) {
        windowOrder.push(window);
        return;
    }

    windowOrder.splice(anchorIndex, 0, window);
}

// Yeni pencereyi belirtilen layout çapasının hemen sonrasına yerleştirir;
// çapa artık yoksa kararlı sıranın sonuna ekler.
function insertWindowAfter(window, anchorWindow) {
    const existingIndex = windowIndexInList(windowOrder, window);

    if (existingIndex !== -1) {
        windowOrder.splice(existingIndex, 1);
    }

    const anchorIndex = windowIndexInList(windowOrder, anchorWindow);

    if (anchorIndex === -1) {
        windowOrder.push(window);
        return;
    }

    windowOrder.splice(anchorIndex + 1, 0, window);
}

// Kaldırılan pencereyi kararlı tiling sırasından çıkarır.
function forgetWindowOrder(window) {
    const index = windowIndexInList(windowOrder, window);

    if (index !== -1) {
        windowOrder.splice(index, 1);
    }
}

// Verilen nesne-kimlikli listeden pencereyi çıkarır ve gerçekten kayıt
// silinmişse true döndürür.
function removeWindowFromList(windows, window) {
    const index = windowIndexInList(windows, window);

    if (index === -1) {
        return false;
    }

    windows.splice(index, 1);
    return true;
}

// İki tiled pencerenin kararlı layout sırasındaki yerlerini değiştirir.
function swapWindowsInOrder(firstWindow, secondWindow) {
    const firstIndex = windowIndexInList(windowOrder, firstWindow);
    const secondIndex = windowIndexInList(windowOrder, secondWindow);

    if (firstIndex === -1 || secondIndex === -1 || firstIndex === secondIndex) {
        return false;
    }

    windowOrder[firstIndex] = secondWindow;
    windowOrder[secondIndex] = firstWindow;
    swapWindowsInSharedBinaryTree(firstWindow, secondWindow);
    return true;
}

// Binary-split düzenini gerçek bir ağaç olarak tutar. Her yaprak tek pencere,
// her iç düğüm ise yalnızca kendi dikdörtgenini ikiye bölen bir ayraçtır.
function binaryLeaf(window) {
    return {window};
}

function binaryTreeContainsWindow(node, window) {
    if (!node) {
        return false;
    }

    if (node.window) {
        return node.window === window;
    }

    return binaryTreeContainsWindow(node.first, window)
        || binaryTreeContainsWindow(node.second, window);
}

function pruneBinaryTree(node, allowedWindows, seenWindows) {
    if (!node) {
        return null;
    }

    const seen = seenWindows || [];

    if (node.window) {
        if (
            !windowIsInList(allowedWindows, node.window)
            || windowIsInList(seen, node.window)
        ) {
            return null;
        }

        seen.push(node.window);
        return node;
    }

    node.first = pruneBinaryTree(node.first, allowedWindows, seen);
    node.second = pruneBinaryTree(node.second, allowedWindows, seen);

    if (!node.first) {
        return node.second;
    }
    if (!node.second) {
        return node.first;
    }

    return node;
}

function rightmostBinaryLeaf(node, depth) {
    if (node.window) {
        return {node, depth};
    }

    return rightmostBinaryLeaf(node.second, depth + 1);
}

function binaryLeafLocation(node, window, depth) {
    if (node.window) {
        return node.window === window ? {node, depth} : null;
    }

    return binaryLeafLocation(node.first, window, depth + 1)
        || binaryLeafLocation(node.second, window, depth + 1);
}

function splitBinaryLeafNode(
    leaf,
    newWindow,
    orientation,
    newWindowFirst
) {
    const existingWindow = leaf.window;
    delete leaf.window;
    leaf.orientation = orientation;
    leaf.first = binaryLeaf(
        newWindowFirst ? newWindow : existingWindow
    );
    leaf.second = binaryLeaf(
        newWindowFirst ? existingWindow : newWindow
    );
}

// Script yeniden yüklendiğinde veya bir pencere başka layout'tan binary-split'e
// döndüğünde eksik yaprakları eski bwm sırasına uyumlu biçimde tamamlar.
function ensureBinarySplitTree(output, desktop, windows) {
    const key = workspaceKey(output, desktop);
    let root = pruneBinaryTree(binarySplitTrees[key] || null, windows);

    for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index];

        if (!root) {
            root = binaryLeaf(window);
            continue;
        }

        if (binaryTreeContainsWindow(root, window)) {
            continue;
        }

        let target = null;

        for (
            let nextIndex = index + 1;
            nextIndex < windows.length;
            nextIndex += 1
        ) {
            target = binaryLeafLocation(root, windows[nextIndex], 0);
            if (target) {
                break;
            }
        }

        const insertBefore = Boolean(target);
        if (!target) {
            target = rightmostBinaryLeaf(root, 0);
        }

        splitBinaryLeafNode(
            target.node,
            window,
            target.depth % 2 === 0 ? "vertical" : "horizontal",
            insertBefore
        );
    }

    binarySplitTrees[key] = root;
    return root;
}

// Yeni pencereyi imlecin altında kalan gerçek yaprağın içine ekler. İmlecin
// yaprak merkezinin hangi tarafında olduğuna göre yeni pencere o yarıyı alır.
function splitBinaryTreeAtCursor(
    output,
    desktop,
    outputWindows,
    newWindow,
    cursorPosition,
    initialGeometry
) {
    const key = workspaceKey(output, desktop);
    let root = ensureBinarySplitTree(output, desktop, outputWindows);

    if (!root) {
        root = binaryLeaf(newWindow);
        binarySplitTrees[key] = root;
        return {
            geometry: normalizedGeometry(initialGeometry),
            position: 0
        };
    }

    // Aynı Window nesnesi yeniden bildirilse bile ekleme işlemi idempotent
    // kalmalıdır; aksi hâlde aynı pencere bir ayrımın iki yaprağını da kaplayıp
    // yarım boyutta kalabilir.
    if (binaryTreeContainsWindow(root, newWindow)) {
        const existingIndex = windowIndexInList(outputWindows, newWindow);
        return {
            geometry: normalizedGeometry(
                geometryIsUsable(newWindow.frameGeometry)
                    ? newWindow.frameGeometry
                    : initialGeometry
            ),
            position: existingIndex === -1
                ? outputWindows.length
                : existingIndex
        };
    }

    const anchorWindow = nearestWindowToPoint(
        outputWindows,
        cursorPosition
    );
    if (!anchorWindow) {
        return {
            geometry: normalizedGeometry(initialGeometry),
            position: outputWindows.length
        };
    }

    const anchorGeometry = anchorWindow.frameGeometry;
    const center = geometryCenter(anchorGeometry);
    const orientation = anchorGeometry.width >= anchorGeometry.height
        ? "vertical"
        : "horizontal";
    const newWindowFirst = orientation === "vertical"
        ? cursorPosition.x < center.x
        : cursorPosition.y < center.y;

    function splitMatchingLeaf(node) {
        if (node.window) {
            if (node.window !== anchorWindow) {
                return false;
            }

            splitBinaryLeafNode(
                node,
                newWindow,
                orientation,
                newWindowFirst
            );
            return true;
        }

        return splitMatchingLeaf(node.first)
            || splitMatchingLeaf(node.second);
    }

    if (!splitMatchingLeaf(root)) {
        return {geometry: anchorGeometry, position: outputWindows.length};
    }

    const anchorIndex = windowIndexInList(outputWindows, anchorWindow);
    return {
        geometry: normalizedGeometry(anchorGeometry),
        position: anchorIndex + (newWindowFirst ? 0 : 1)
    };
}

function swapWindowsInSharedBinaryTree(firstWindow, secondWindow) {
    const keys = Object.keys(binarySplitTrees);

    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const root = binarySplitTrees[keys[keyIndex]];

        if (
            !binaryTreeContainsWindow(root, firstWindow)
            || !binaryTreeContainsWindow(root, secondWindow)
        ) {
            continue;
        }

        function swapLeaves(node) {
            if (node.window === firstWindow) {
                node.window = secondWindow;
                return;
            }
            if (node.window === secondWindow) {
                node.window = firstWindow;
                return;
            }
            if (!node.window) {
                swapLeaves(node.first);
                swapLeaves(node.second);
            }
        }

        swapLeaves(root);
        return;
    }
}

// workspace.windowList() içindeki açık pencereleri kararlı ekleme sırasına göre
// döndürür ve sinyali kaçmış yeni nesneleri listenin sonuna tamamlar.
function windowsInStableOrder(allWindows) {
    const result = [];

    for (let index = 0; index < windowOrder.length; index += 1) {
        if (windowIsInList(allWindows, windowOrder[index])) {
            result.push(windowOrder[index]);
        }
    }

    for (let index = 0; index < allWindows.length; index += 1) {
        if (!windowIsInList(result, allWindows[index])) {
            result.push(allWindows[index]);
            appendWindowToOrder(allWindows[index]);
        }
    }

    return result;
}

// Önceden iki aşamalı filtreden geçmiş pencerelerden verilen ekran ve
// masaüstüne ait olanları seçer.
function windowsForOutput(allWindows, output, desktop) {
    const result = [];

    for (let index = 0; index < allWindows.length; index += 1) {
        const window = allWindows[index];

        if (!window.output) {
            continue;
        }

        if (window.output.name !== output.name) {
            continue;
        }

        if (!windowBelongsToDesktop(window, desktop)) {
            continue;
        }

        if (!windowBelongsToCurrentActivity(window)) {
            continue;
        }

        result.push(window);
    }

    return result;
}

// Karşılıklı iki boşluk toplamını kullanılabilir uzunlukta en az bir piksel
// kalacak biçimde orantılı sınırlar.
function clampedOpposingGaps(firstGap, secondGap, length) {
    const first = Math.max(0, Math.round(Number(firstGap) || 0));
    const second = Math.max(0, Math.round(Number(secondGap) || 0));
    const maximumTotal = Math.max(0, Math.round(length) - 1);
    const requestedTotal = first + second;

    if (requestedTotal <= maximumTotal) {
        return {first, second};
    }

    if (requestedTotal === 0) {
        return {first: 0, second: 0};
    }

    const clampedFirst = Math.round(
        maximumTotal * (first / requestedTotal)
    );
    return {
        first: clampedFirst,
        second: maximumTotal - clampedFirst
    };
}

// Bir dikdörtgenin her kenarına ayrı dış boşluk uygular. Aşırı büyük kullanıcı
// değerlerinde dahi sonuç ekran sınırında ve en az 1x1 kalır.
function insetRectangleByEdges(rectangle, gaps) {
    const source = normalizedGeometry(rectangle);
    const horizontal = clampedOpposingGaps(
        gaps.left,
        gaps.right,
        source.width
    );
    const vertical = clampedOpposingGaps(
        gaps.top,
        gaps.bottom,
        source.height
    );

    return {
        x: source.x + horizontal.first,
        y: source.y + vertical.first,
        width: source.width - horizontal.first - horizontal.second,
        height: source.height - vertical.first - vertical.second
    };
}

// Smart gaps etkinken eşik kadar veya daha az pencere için yalnızca dış
// boşlukları sıfırlar; iç boşluk çoklu pencere düzeninde korunur.
function effectiveGapSettings(windowCount) {
    const settings = gapSettings || readGapSettings();
    const useSmartOuterGaps = Boolean(
        settings.smart && windowCount <= settings.smartThreshold
    );

    return {
        inner: settings.inner,
        top: useSmartOuterGaps ? 0 : settings.top,
        right: useSmartOuterGaps ? 0 : settings.right,
        bottom: useSmartOuterGaps ? 0 : settings.bottom,
        left: useSmartOuterGaps ? 0 : settings.left,
        smartApplied: useSmartOuterGaps
    };
}

// Hesaplanan dikdörtgeni KWin'in frameGeometry için beklediği tam sayı
// alanlarına ve en az 1x1 boyuta dönüştürür.
function normalizedGeometry(rectangle) {
    const left = Math.round(Number(rectangle.x));
    const top = Math.round(Number(rectangle.y));
    const right = Math.round(
        Number(rectangle.x) + Number(rectangle.width)
    );
    const bottom = Math.round(
        Number(rectangle.y) + Number(rectangle.height)
    );

    return {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
    };
}

function geometryIsUsable(geometry) {
    return Boolean(
        geometry
        && isFinite(Number(geometry.x))
        && isFinite(Number(geometry.y))
        && isFinite(Number(geometry.width))
        && isFinite(Number(geometry.height))
        && Number(geometry.width) > 0
        && Number(geometry.height) > 0
    );
}

// KWin output/desktop geçişi sırasında kısa süreli null veya geçersiz alan
// döndürebilir. Böyle bir anda exception ile tüm callback'i kesmek yerine bu
// retile turunu güvenle atlar.
function clientAreaForOutput(output, desktop) {
    if (!output || !desktop) {
        return null;
    }

    try {
        const area = workspace.clientArea(
            KWin.MaximizeArea,
            output,
            desktop
        );

        if (geometryIsUsable(area)) {
            return normalizedGeometry(area);
        }

        log(
            `Geçersiz clientArea; retile atlandı: output=${output.name}, `
            + `desktop=${desktop.name}`
        );
    } catch (error) {
        log(
            `clientArea okunamadı; retile atlandı: output=${output.name}, `
            + `desktop=${desktop.name}, hata=${error}`
        );
    }

    return null;
}

function geometryDifferenceExceedsTolerance(actual, expected, tolerance) {
    if (!geometryIsUsable(actual) || !geometryIsUsable(expected)) {
        return true;
    }

    return Boolean(
        Math.abs(actual.x - expected.x) > tolerance
        || Math.abs(actual.y - expected.y) > tolerance
        || Math.abs(actual.width - expected.width) > tolerance
        || Math.abs(actual.height - expected.height) > tolerance
    );
}

function expectedWindowGeometryIndex(window) {
    for (let index = 0; index < expectedWindowGeometries.length; index += 1) {
        if (expectedWindowGeometries[index].window === window) {
            return index;
        }
    }

    return -1;
}

function rememberExpectedWindowGeometry(window, geometry) {
    const normalized = normalizedGeometry(geometry);
    const index = expectedWindowGeometryIndex(window);

    if (index === -1) {
        expectedWindowGeometries.push({window, geometry: normalized});
        return;
    }

    expectedWindowGeometries[index].geometry = normalized;
}

function expectedWindowGeometry(window) {
    const index = expectedWindowGeometryIndex(window);
    return index === -1 ? null : expectedWindowGeometries[index].geometry;
}

function forgetExpectedWindowGeometry(window) {
    const index = expectedWindowGeometryIndex(window);
    if (index !== -1) {
        expectedWindowGeometries.splice(index, 1);
    }
}

// Bir frameGeometry dikdörtgeninin tam sayı merkez koordinatını hesaplar.
function geometryCenter(geometry) {
    return {
        x: Math.round(geometry.x + (geometry.width / 2)),
        y: Math.round(geometry.y + (geometry.height / 2))
    };
}

// Verilen noktanın pencere frameGeometry dikdörtgeninin içinde olup olmadığını
// sınırlar dahil olacak şekilde denetler.
function pointIsInsideGeometry(point, geometry) {
    return Boolean(
        point.x >= geometry.x
        && point.x <= geometry.x + geometry.width
        && point.y >= geometry.y
        && point.y <= geometry.y + geometry.height
    );
}

// İki nokta arasındaki Öklid mesafesinin kare değerini karekök almadan
// karşılaştırma için hesaplar.
function squaredPointDistance(firstPoint, secondPoint) {
    const deltaX = secondPoint.x - firstPoint.x;
    const deltaY = secondPoint.y - firstPoint.y;
    return (deltaX * deltaX) + (deltaY * deltaY);
}

// Uygulama veya kullanıcı fullscreen istediğinde pencereyi layout'tan çıkarmak
// yerine fullscreen durumunu kapatır. Böylece aynı pencere dış/iç boşluklarıyla
// normal bir Keirokit KDE tile'ı olarak kalır.
function leaveFullscreenForTiling(window) {
    if (!window || window.fullScreen !== true) {
        return;
    }

    const previousMutationState = managedWindowMutationInProgress;

    try {
        managedWindowMutationInProgress = true;
        window.fullScreen = false;
        log(
            `Tam ekran tiled düzene alındı: caption=${windowCaption(window)}`
        );
    } catch (error) {
        log(
            `Tam ekran durumu kaldırılamadı: caption=${windowCaption(window)}, `
            + `hata=${error}`
        );
    } finally {
        managedWindowMutationInProgress = previousMutationState;
    }
}

// Pencere geometrisini doğrulanmış frameGeometry write API'siyle uygular.
function applyWindowGeometry(window, rectangle) {
    const targetGeometry = normalizedGeometry(rectangle);
    rememberExpectedWindowGeometry(window, targetGeometry);
    leaveFullscreenForTiling(window);

    if (window && window.tile) {
        try {
            window.tile = null;
        } catch (error) {
            log(
                `KWin tile bağı kaldırılamadı: caption=${windowCaption(window)}, `
                + `hata=${error}`
            );
        }
    }

    if (
        window
        && window.maximizeMode
        && typeof window.setMaximize === "function"
    ) {
        try {
            window.setMaximize(false, false);
        } catch (error) {
            log(
                `Maximize durumu kaldırılamadı: `
                + `caption=${windowCaption(window)}, hata=${error}`
            );
        }
    }

    try {
        window.frameGeometry = targetGeometry;
    } catch (error) {
        log(
            `Pencere geometrisi uygulanamadı: `
            + `caption=${windowCaption(window)}, hata=${error}`
        );
    }
}

// Columns/rows/master-stack gibi diğer düzenlerde mevcut tile geometrilerinden
// imleci içeren, yoksa merkezi en yakın pencerenin sıra indeksini seçer.
function cursorAnchorInsertionChoice(
    outputWindows,
    clientArea,
    gaps,
    cursorPosition
) {
    if (outputWindows.length === 0) {
        return {
            geometry: insetRectangleByEdges(clientArea, gaps),
            position: 0
        };
    }

    let bestPosition = 0;
    let bestDistance = Infinity;

    for (let index = 0; index < outputWindows.length; index += 1) {
        const geometry = outputWindows[index].frameGeometry;
        const distance = pointIsInsideGeometry(cursorPosition, geometry)
            ? 0
            : squaredPointDistance(
                cursorPosition,
                geometryCenter(geometry)
            );

        if (distance < bestDistance) {
            bestDistance = distance;
            bestPosition = index;
        }
    }

    return {
        geometry: normalizedGeometry(
            outputWindows[bestPosition].frameGeometry
        ),
        position: bestPosition
    };
}

// Bir BSP düğümünün yalnızca kendine ayrılmış alanını ikiye böler. Böylece yeni
// yaprak eklendiğinde ağacın diğer dalındaki pencerelerin geometrisi değişmez.
function splitBinaryRectangle(rectangle, gap, orientation) {
    if (orientation === "vertical") {
        if (rectangle.width < 2) {
            return {first: rectangle, second: rectangle};
        }

        const effectiveGap = Math.min(
            Math.max(0, Math.round(gap)),
            rectangle.width - 2
        );
        const usableWidth = rectangle.width - effectiveGap;
        const firstWidth = Math.max(1, Math.floor(usableWidth / 2));

        return {
            first: {
                x: rectangle.x,
                y: rectangle.y,
                width: firstWidth,
                height: rectangle.height
            },
            second: {
                x: rectangle.x + firstWidth + effectiveGap,
                y: rectangle.y,
                width: rectangle.width - firstWidth - effectiveGap,
                height: rectangle.height
            }
        };
    }

    if (rectangle.height < 2) {
        return {first: rectangle, second: rectangle};
    }

    const effectiveGap = Math.min(
        Math.max(0, Math.round(gap)),
        rectangle.height - 2
    );
    const usableHeight = rectangle.height - effectiveGap;
    const firstHeight = Math.max(1, Math.floor(usableHeight / 2));
    return {
        first: {
            x: rectangle.x,
            y: rectangle.y,
            width: rectangle.width,
            height: firstHeight
        },
        second: {
            x: rectangle.x,
            y: rectangle.y + firstHeight + effectiveGap,
            width: rectangle.width,
            height: rectangle.height - firstHeight - effectiveGap
        }
    };
}

function applyBinaryTreeNode(node, rectangle, innerGap) {
    if (node.window) {
        applyWindowGeometry(node.window, rectangle);
        return;
    }

    const split = splitBinaryRectangle(
        rectangle,
        innerGap,
        node.orientation
    );
    applyBinaryTreeNode(node.first, split.first, innerGap);
    applyBinaryTreeNode(node.second, split.second, innerGap);
}

function applyBinarySplitLayout(windows, clientArea, gaps, output, desktop) {
    const key = workspaceKey(output, desktop);

    // Tek görünür uygulama her zaman kullanılabilir alanın tamamını alır.
    // Ağacı yenilemek, yarıda kalan yeniden yükleme veya yinelenen bildirimden
    // kalmış eski/yinelenen yaprakları da onarır.
    if (windows.length === 1) {
        binarySplitTrees[key] = binaryLeaf(windows[0]);
        applyWindowGeometry(
            windows[0],
            insetRectangleByEdges(clientArea, gaps)
        );
        return;
    }

    const root = ensureBinarySplitTree(output, desktop, windows);

    if (!root) {
        return;
    }

    applyBinaryTreeNode(
        root,
        insetRectangleByEdges(clientArea, gaps),
        gaps.inner
    );
}

// Tüm pencereleri aynı clientArea geometrisine koyar; KWin'in mevcut stacking
// sırası aktif pencereyi önde, diğerlerini arkada bırakır ve odak değiştirilmez.
function applyMonocleLayout(windows, clientArea, gaps) {
    const targetGeometry = insetRectangleByEdges(clientArea, gaps);

    for (let index = 0; index < windows.length; index += 1) {
        applyWindowGeometry(windows[index], targetGeometry);
    }
}

// Alanı eşit sütunlara veya satırlara böler. Yuvarlama hatasını son pencereye
// kalan tüm alanı vererek kapatır.
function applyLinearLayout(windows, clientArea, gaps, verticalColumns) {
    const area = insetRectangleByEdges(clientArea, gaps);
    const count = windows.length;
    const axisLength = verticalColumns ? area.width : area.height;
    const innerGap = count > 1
        ? Math.min(
            gaps.inner,
            Math.max(0, Math.floor((axisLength - count) / (count - 1)))
        )
        : 0;
    const axisEnd = verticalColumns
        ? area.x + area.width
        : area.y + area.height;
    let cursor = verticalColumns ? area.x : area.y;

    for (let index = 0; index < count; index += 1) {
        const isLast = index === count - 1;
        const remainingCount = count - index;
        const slotCursor = Math.min(cursor, axisEnd - 1);
        const available = Math.max(1, axisEnd - slotCursor);
        const length = isLast
            ? available
            : Math.max(
                1,
                Math.floor(
                    (available - (innerGap * (remainingCount - 1)))
                    / remainingCount
                )
            );
        const geometry = verticalColumns
            ? {
                x: slotCursor,
                y: area.y,
                width: length,
                height: area.height
            }
            : {
                x: area.x,
                y: slotCursor,
                width: area.width,
                height: length
            };

        applyWindowGeometry(windows[index], geometry);
        cursor = slotCursor + length + innerGap;
    }
}

// İlk N pencereyi soldaki master alanında, kalanları sağdaki stack alanında
// dikey olarak paylaştırır.
function applyMasterStackLayout(windows, clientArea, gaps) {
    const area = insetRectangleByEdges(clientArea, gaps);
    const masters = Math.min(masterCount, windows.length);

    if (windows.length <= masters) {
        applyLinearLayout(windows, clientArea, gaps, true);
        return;
    }

    if (area.width < 2) {
        applyMonocleLayout(windows, clientArea, gaps);
        return;
    }

    const columnGap = Math.min(gaps.inner, Math.max(0, area.width - 2));
    const usableWidth = area.width - columnGap;
    const masterWidth = Math.min(
        usableWidth - 1,
        Math.max(
            1,
            Math.round(usableWidth * (masterRatio / 100))
        )
    );
    const stackWidth = usableWidth - masterWidth;
    const masterArea = {
        x: area.x,
        y: area.y,
        width: masterWidth,
        height: area.height
    };
    const stackArea = {
        x: area.x + masterWidth + columnGap,
        y: area.y,
        width: stackWidth,
        height: area.height
    };
    const noOuterGaps = {
        inner: gaps.inner,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
    };

    applyLinearLayout(
        windows.slice(0, masters),
        masterArea,
        noOuterGaps,
        false
    );
    applyLinearLayout(
        windows.slice(masters),
        stackArea,
        noOuterGaps,
        false
    );
}

// Tek ekranın geçerli masaüstündeki pencerelerine seçili layout'u uygular.
function layoutOutput(allWindows, output) {
    const desktop = currentDesktopForOutput(output);
    if (!desktop) {
        log(`Output masaüstü hazır değil; retile atlandı: ${output.name}`);
        return;
    }

    const windows = windowsForOutput(allWindows, output, desktop);

    if (windows.length === 0) {
        return;
    }

    const clientArea = clientAreaForOutput(output, desktop);
    if (!clientArea) {
        return;
    }
    const layout = layoutForOutputDesktop(output, desktop);
    const gaps = effectiveGapSettings(windows.length);

    log(
        `${output.name}/${desktop.name}: ${windows.length} pencere, `
        + `${layout}, inner=${gaps.inner}, `
        + `outer=${gaps.top}/${gaps.right}/${gaps.bottom}/${gaps.left}, `
        + `smart=${gaps.smartApplied}`
    );

    if (layout === LAYOUT_MONOCLE) {
        applyMonocleLayout(windows, clientArea, gaps);
        return;
    }

    if (layout === LAYOUT_MASTER_STACK) {
        applyMasterStackLayout(windows, clientArea, gaps);
        return;
    }

    if (layout === LAYOUT_COLUMNS) {
        applyLinearLayout(windows, clientArea, gaps, true);
        return;
    }

    if (layout === LAYOUT_ROWS) {
        applyLinearLayout(windows, clientArea, gaps, false);
        return;
    }

    applyBinarySplitLayout(
        windows,
        clientArea,
        gaps,
        output,
        desktop
    );
}

// workspace.windowList() sonucunu tüm ekranlarda yeniden düzenler.
function retileAll(allWindows) {
    if (retileInProgress) {
        return lastTileableOrder;
    }

    retileInProgress = true;
    let windows = lastTileableOrder;

    try {
        const openWindows = allWindows || workspace.windowList();
        const stableWindows = windowsInStableOrder(openWindows);
        const screens = workspace.screens;

        windows = tileableWindows(stableWindows);
        lastTileableOrder = windows.slice();

        for (let index = 0; index < screens.length; index += 1) {
            try {
                layoutOutput(windows, screens[index]);
            } catch (error) {
                log(
                    `Output yerleşimi uygulanamadı: `
                    + `output=${screens[index].name}, hata=${error}`
                );
            }
        }
    } finally {
        retileInProgress = false;
    }

    return windows;
}

// Global kısayol tetiklendiğinde aktif ekran/masaüstünün layout'unu desteklenen
// beşli sırada ilerletip yalnızca runtime override olarak saklar.
function toggleLayout() {
    const output = workspace.activeScreen
        || (workspace.activeWindow && workspace.activeWindow.output)
        || workspace.screens[0];

    if (!output) {
        return;
    }

    const desktop = currentDesktopForOutput(output);
    if (!desktop) {
        log(`Layout değiştirilemedi; masaüstü hazır değil: ${output.name}`);
        return;
    }

    const currentLayout = layoutForOutputDesktop(output, desktop);
    const currentIndex = ALL_LAYOUTS.indexOf(currentLayout);
    const nextLayout = ALL_LAYOUTS[
        (currentIndex + 1) % ALL_LAYOUTS.length
    ];

    runtimeLayoutOverrides[workspaceKey(output, desktop)] = nextLayout;
    log(
        `Layout değiştirildi: ${output.name}/${desktop.name}: `
        + `${currentLayout} -> ${nextLayout}`
    );
    retileAll();
}

// Kararlı tiled listesinden her ekranın o anda gösterdiği masaüstünde bulunan
// ve yönlü odak için erişilebilir pencereleri seçer.
function visibleTiledWindows(tiledWindows) {
    const result = [];

    for (let index = 0; index < tiledWindows.length; index += 1) {
        const window = tiledWindows[index];

        if (!window.output) {
            continue;
        }

        const desktop = currentDesktopForOutput(window.output);

        if (
            windowBelongsToDesktop(window, desktop)
            && windowBelongsToCurrentActivity(window)
        ) {
            result.push(window);
        }
    }

    return result;
}

// Yeni pencereyi varsayılan olarak sıranın sonuna; openAtCursor açıksa
// imleç ekranına ve imlecin altındaki layout bölgesinin önüne yerleştirir.
function placeNewWindowInOrder(window) {
    appendWindowToOrder(window);

    if (
        !openAtCursor
        || !shouldTileWindow(window)
        || !windowBelongsToCurrentActivity(window)
    ) {
        return;
    }

    try {
        const cursorPosition = workspace.cursorPos;
        const cursorOutput = workspace.screenAt(cursorPosition);

        if (!cursorOutput) {
            log(
                `OpenAtCursor uygulanamadı: ${windowCaption(window)}, `
                + "imleç ekranı bulunamadı."
            );
            return;
        }

        const desktop = currentDesktopForOutput(cursorOutput);
        if (!desktop) {
            log(
                `OpenAtCursor uygulanamadı: ${windowCaption(window)}, `
                + "hedef masaüstü hazır değil."
            );
            return;
        }

        const outputWindows = windowsForOutput(
            lastTileableOrder,
            cursorOutput,
            desktop
        );
        const clientArea = clientAreaForOutput(cursorOutput, desktop);
        if (!clientArea) {
            return;
        }
        const layout = layoutForOutputDesktop(cursorOutput, desktop);
        const gaps = effectiveGapSettings(outputWindows.length + 1);
        const insertionChoice = layout === LAYOUT_BINARY_SPLIT
            ? splitBinaryTreeAtCursor(
                cursorOutput,
                desktop,
                outputWindows,
                window,
                cursorPosition,
                insetRectangleByEdges(clientArea, gaps)
            )
            : cursorAnchorInsertionChoice(
                outputWindows,
                clientArea,
                gaps,
                cursorPosition
            );
        const insertionGeometry = geometryIsUsable(insertionChoice.geometry)
            ? normalizedGeometry(insertionChoice.geometry)
            : insetRectangleByEdges(clientArea, gaps);

        const previousMutationState = managedWindowMutationInProgress;
        try {
            managedWindowMutationInProgress = true;

            if (!windowBelongsToDesktop(window, desktop)) {
                window.desktops = [desktop];
            }

            if (window.output !== cursorOutput) {
                workspace.sendClientToScreen(window, cursorOutput);
            }
        } finally {
            managedWindowMutationInProgress = previousMutationState;
        }

        if (insertionChoice.position < outputWindows.length) {
            insertWindowBefore(
                window,
                outputWindows[insertionChoice.position]
            );
        } else if (outputWindows.length > 0) {
            insertWindowAfter(
                window,
                outputWindows[outputWindows.length - 1]
            );
        }

        log(
            `OpenAtCursor: caption=${windowCaption(window)}, `
            + `screen=${cursorOutput.name}, `
            + `cursor=${cursorPosition.x},${cursorPosition.y}, `
            + `position=${insertionChoice.position}/`
            + `${outputWindows.length}, `
            + `target=${insertionGeometry.x},`
            + `${insertionGeometry.y},`
            + `${insertionGeometry.width}x`
            + `${insertionGeometry.height}`
        );
    } catch (error) {
        log(
            `OpenAtCursor hatası; varsayılan sıra korunuyor: `
            + `${windowCaption(window)}, hata=${error}`
        );
    }
}

// Hedef merkez farkının istenen sol/sağ/yukarı/aşağı yarı düzleminde olup
// olmadığını belirler.
function targetIsInDirection(sourceCenter, targetCenter, direction) {
    if (direction === FOCUS_LEFT) {
        return targetCenter.x < sourceCenter.x;
    }

    if (direction === FOCUS_RIGHT) {
        return targetCenter.x > sourceCenter.x;
    }

    if (direction === FOCUS_UP) {
        return targetCenter.y < sourceCenter.y;
    }

    if (direction === FOCUS_DOWN) {
        return targetCenter.y > sourceCenter.y;
    }

    return false;
}

// Bir kaynak noktadan istenen yöndeki aday pencereler arasından uzamsal olarak
// en yakın olanı seçer.
function findDirectionalWindow(
    sourceCenter,
    candidates,
    direction,
    excludedWindow
) {
    let nearestWindow = null;
    let nearestDistance = Infinity;

    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];

        if (candidate === excludedWindow) {
            continue;
        }

        const candidateCenter = geometryCenter(candidate.frameGeometry);

        if (!targetIsInDirection(sourceCenter, candidateCenter, direction)) {
            continue;
        }

        const deltaX = Math.abs(candidateCenter.x - sourceCenter.x);
        const deltaY = Math.abs(candidateCenter.y - sourceCenter.y);
        const primaryDistance = (
            direction === FOCUS_LEFT || direction === FOCUS_RIGHT
        ) ? deltaX : deltaY;
        const secondaryDistance = (
            direction === FOCUS_LEFT || direction === FOCUS_RIGHT
        ) ? deltaY : deltaX;
        // Önce istenen eksendeki yakınlığı, sonra çapraz sapmayı tartar. Bu
        // sayede ekran sınırının hemen ötesindeki pencere uzak bir diyagonal
        // adaydan daha doğal seçilir.
        const distance = (primaryDistance * primaryDistance)
            + (secondaryDistance * secondaryDistance * 2);

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestWindow = candidate;
        }
    }

    return nearestWindow;
}

// Tamamlanan veya timeout olan cursor warp isteğinin timer'larını durdurup
// global bekleyen istek listesinden çıkarır.
function finishWarpRequest(request) {
    if (!request || request.completed) {
        return;
    }

    request.completed = true;
    request.timer.stop();
    if (request.settleTimer) {
        request.settleTimer.stop();
    }

    const requestIndex = pendingWarpRequests.indexOf(request);

    if (requestIndex !== -1) {
        pendingWarpRequests.splice(requestIndex, 1);
    }
}

// Bir eksendeki göreli ydotool girdisinin KWin'de ürettiği gerçek hareketten
// güncel input/output kazancını hesaplar. Libinput ivmesi hareket büyüklüğüne
// göre değiştiği için bu değer her düzeltme turunda yeniden öğrenilir.
function updatedCursorInputGain(previousGain, inputDelta, actualDelta) {
    if (
        inputDelta === 0
        || actualDelta === 0
        || Math.sign(inputDelta) !== Math.sign(actualDelta)
    ) {
        return previousGain;
    }

    const observedGain = Math.abs(actualDelta / inputDelta);
    if (
        observedGain < CURSOR_MIN_INPUT_GAIN
        || observedGain > CURSOR_MAX_INPUT_GAIN
    ) {
        return previousGain;
    }

    return (previousGain + observedGain) / 2;
}

// Hedef koordinata kalan fark tolerans içindeyse hareketi başarıyla tamamlar.
function cursorRequestReachedTarget(request, position) {
    return Boolean(
        Math.abs(request.target.x - position.x) <= CURSOR_WARP_TOLERANCE_PX
        && Math.abs(request.target.y - position.y) <= CURSOR_WARP_TOLERANCE_PX
    );
}

// Bir göreli hareketten sonra compositor'ın input event'ini işlemesini bekler,
// gerçek KWin cursorPos değerinden kazancı günceller ve gerekirse yeni düzeltme
// turu başlatır.
function checkCursorCorrection(
    request,
    previousPosition,
    inputX,
    inputY
) {
    if (!request || request.completed) {
        return;
    }

    const position = workspace.cursorPos;
    request.gainX = updatedCursorInputGain(
        request.gainX,
        inputX,
        position.x - previousPosition.x
    );
    request.gainY = updatedCursorInputGain(
        request.gainY,
        inputY,
        position.y - previousPosition.y
    );

    if (cursorRequestReachedTarget(request, position)) {
        finishWarpRequest(request);
        log(
            `İmleç hedefe ulaştı: caption=${request.caption}, `
            + `target=${request.target.x},${request.target.y}, `
            + `actual=${position.x},${position.y}, `
            + `tur=${request.attempts}`
        );
        return;
    }

    if (request.attempts >= CURSOR_WARP_MAX_ATTEMPTS) {
        finishWarpRequest(request);
        log(
            `İmleç hedef toleransına ulaşamadı: caption=${request.caption}, `
            + `target=${request.target.x},${request.target.y}, `
            + `actual=${position.x},${position.y}`
        );
        return;
    }

    sendNextCursorCorrection(request);
}

// CursorHelper göreli hareket sonucunu aldıktan sonra KWin'in cursorPos
// güncellemesini kısa bir timer ile bekler.
function handleRelativeMoveReply(
    request,
    previousPosition,
    inputX,
    inputY,
    succeeded
) {
    if (!request || request.completed) {
        return;
    }

    if (succeeded !== true) {
        finishWarpRequest(request);
        log(
            `CursorHelper imleci taşıyamadı: `
            + `caption=${request.caption}, sonuç=false`
        );
        return;
    }

    const settleTimer = new QTimer();
    request.settleTimer = settleTimer;
    settleTimer.singleShot = true;
    settleTimer.interval = CURSOR_MOVE_SETTLE_MS;
    settleTimer.timeout.connect(
        checkCursorCorrection.bind(
            null,
            request,
            previousPosition,
            inputX,
            inputY
        )
    );
    settleTimer.start();
}

// KWin callDBus hata durumunda callback çağırmadığı için servis kapalı veya
// erişilemez olduğunda watchdog timeout mesajını Keirokit KDE önekiyle üretir.
function handleWarpTimeout(request) {
    if (!request || request.completed) {
        return;
    }

    finishWarpRequest(request);
    log(
        `CursorHelper yanıt vermedi: caption=${request.caption}; `
        + `target=${request.target.x},${request.target.y}; `
        + "servis kapalı veya D-Bus erişilemez olabilir."
    );
}

// KWin'in bildiği gerçek konumdan hedefe kalan farkı libinput kazancına göre
// göreli ydotool girdisine çevirir ve CursorHelper'a gönderir.
function sendNextCursorCorrection(request) {
    if (!request || request.completed) {
        return;
    }

    const position = workspace.cursorPos;
    const errorX = request.target.x - position.x;
    const errorY = request.target.y - position.y;

    if (cursorRequestReachedTarget(request, position)) {
        finishWarpRequest(request);
        return;
    }

    let inputX = Math.round(errorX / request.gainX);
    let inputY = Math.round(errorY / request.gainY);

    if (inputX === 0 && Math.abs(errorX) > CURSOR_WARP_TOLERANCE_PX) {
        inputX = Math.sign(errorX);
    }
    if (inputY === 0 && Math.abs(errorY) > CURSOR_WARP_TOLERANCE_PX) {
        inputY = Math.sign(errorY);
    }

    request.attempts += 1;
    callDBus(
        "Keirokit.KDE.CursorHelper",
        "/Keirokit/KDE/CursorHelper",
        "Keirokit.KDE.CursorHelper",
        "MoveCursorRelative",
        inputX,
        inputY,
        handleRelativeMoveReply.bind(
            null,
            request,
            {x: position.x, y: position.y},
            inputX,
            inputY
        )
    );
}

// Herhangi bir global hedef noktaya KWin cursorPos geri bildirimiyle birkaç
// göreli düzeltme turunda gider. force=true yalnızca boş ekrana yönlü geçişte,
// ortada odaklanacak pencere bulunmadığı durumda kullanılır.
function warpCursorToPoint(target, caption, force) {
    if ((!mouseFollowsFocus && force !== true) || !target) {
        return;
    }

    let request = null;

    try {
        const timer = new QTimer();

        while (pendingWarpRequests.length > 0) {
            finishWarpRequest(
                pendingWarpRequests[pendingWarpRequests.length - 1]
            );
        }

        request = {
            attempts: 0,
            caption,
            completed: false,
            gainX: CURSOR_INITIAL_INPUT_GAIN,
            gainY: CURSOR_INITIAL_INPUT_GAIN,
            settleTimer: null,
            target: {
                x: Math.round(target.x),
                y: Math.round(target.y)
            },
            timer
        };
        pendingWarpRequests.push(request);

        timer.singleShot = true;
        timer.interval = CURSOR_WARP_TIMEOUT_MS;
        timer.timeout.connect(handleWarpTimeout.bind(null, request));
        timer.start();
        sendNextCursorCorrection(request);
    } catch (error) {
        if (request) {
            finishWarpRequest(request);
        }

        log(
            `CursorHelper D-Bus çağrısı başarısız: `
            + `caption=${caption}, hata=${error}`
        );
    }
}

// Odaklanan tiled pencerenin merkezine gider.
function warpCursorToWindow(window) {
    if (!window) {
        return;
    }

    warpCursorToPoint(
        geometryCenter(window.frameGeometry),
        windowCaption(window),
        false
    );
}

// Normal KWin odak sinyalini çok kısa geciktirir. Böylece hemen arkasından bir
// windowRemoved gelirse bunun kullanıcı odak seçimi değil, kapanışın otomatik
// odak devri olduğu anlaşılır ve imleç hareketi iptal edilebilir.
function cancelPendingExternalFocusWarp() {
    if (!pendingExternalFocusWarp) {
        return;
    }

    pendingExternalFocusWarp.timer.stop();
    pendingExternalFocusWarp = null;
}

function runPendingExternalFocusWarp(focusState) {
    if (pendingExternalFocusWarp !== focusState) {
        return;
    }

    pendingExternalFocusWarp = null;

    if (
        closeFocusWarpSuppressed
        || workspace.activeWindow !== focusState.window
        || pendingWarpRequests.length !== 0
    ) {
        return;
    }

    const candidates = visibleTiledWindows(lastTileableOrder);
    if (
        windowIsInList(candidates, focusState.window)
        && !pointIsInsideGeometry(
            workspace.cursorPos,
            focusState.window.frameGeometry
        )
    ) {
        warpCursorToWindow(focusState.window);
    }
}

function scheduleExternalFocusWarp(window) {
    cancelPendingExternalFocusWarp();

    const timer = new QTimer();
    const focusState = {window, timer};
    pendingExternalFocusWarp = focusState;
    timer.singleShot = true;
    timer.interval = EXTERNAL_FOCUS_WARP_SETTLE_MS;
    timer.timeout.connect(
        runPendingExternalFocusWarp.bind(null, focusState)
    );
    timer.start();
}

function clearCloseFocusWarpSuppression(timer) {
    if (closeFocusSuppressionTimer !== timer) {
        return;
    }

    focusWindowUnderCursor("kapanış sonrası imleç-altı odak doğrulaması");
    closeFocusSuppressionTimer = null;
    closeFocusWarpSuppressed = false;
}

// Kapanışın ürettiği otomatik windowActivated sinyalini kısa süreliğine normal
// odak değişiminden ayırır; devam eden bir merkezleme varsa onu da durdurur.
function suppressFocusWarpForWindowClose() {
    closeFocusWarpSuppressed = true;
    cancelPendingExternalFocusWarp();

    while (pendingWarpRequests.length > 0) {
        finishWarpRequest(
            pendingWarpRequests[pendingWarpRequests.length - 1]
        );
    }

    if (closeFocusSuppressionTimer) {
        closeFocusSuppressionTimer.stop();
    }

    const timer = new QTimer();
    closeFocusSuppressionTimer = timer;
    timer.singleShot = true;
    timer.interval = WINDOW_CLOSE_FOCUS_SUPPRESS_MS;
    timer.timeout.connect(
        clearCloseFocusWarpSuppression.bind(null, timer)
    );
    timer.start();
}

// Son odaklanan tiled pencereyi ekran/masaüstü bazında hatırlar. KWin odağı
// Alt+Tab, görev yöneticisi veya başka bir klavye yoluyla değiştirdiyse ve
// imleç hedef pencerenin içinde değilse imleci merkeze taşır. Fare tıklamasıyla
// odaklanan pencere zaten imleci içerdiğinden gereksiz geri sıçrama oluşmaz.
function handleWindowActivated(window) {
    if (!window) {
        return;
    }

    if (
        pendingExternalFocusWarp
        && pendingExternalFocusWarp.window !== window
    ) {
        cancelPendingExternalFocusWarp();
    }

    const candidates = visibleTiledWindows(lastTileableOrder);

    if (!windowIsInList(candidates, window)) {
        return;
    }

    const desktop = currentDesktopForOutput(window.output);
    lastFocusedWindowByWorkspace[
        workspaceKey(window.output, desktop)
    ] = window;
    log(`Odak değişti: ${windowCaption(window)}`);

    if (
        !keirokitFocusChangeInProgress
        && mouseFollowsFocus
        && !pointIsInsideGeometry(workspace.cursorPos, window.frameGeometry)
    ) {
        if (closeFocusWarpSuppressed) {
            log(
                `Kapanış sonrası imleç konumu korundu: `
                + `${windowCaption(window)}`
            );
        } else if (pendingWarpRequests.length === 0) {
            scheduleExternalFocusWarp(window);
        }
    }
}

// Geçerli ve görünür bir tiled pencereyi workspace.activeWindow üzerinden
// etkinleştirir ve Keirokit KDE klavye eylemiyle birlikte imleci hedefe taşır.
function activateTiledWindow(window, reason, moveCursor) {
    if (!window) {
        return false;
    }

    try {
        keirokitFocusChangeInProgress = true;
        try {
            workspace.activeWindow = window;
        } finally {
            keirokitFocusChangeInProgress = false;
        }
        workspace.raiseWindow(window);
        if (moveCursor !== false) {
            warpCursorToWindow(window);
        }
        log(`Odak atandı: ${windowCaption(window)}, neden=${reason}`);
        return true;
    } catch (error) {
        log(
            `Odak atanamadı: ${windowCaption(window)}, `
            + `neden=${reason}, hata=${error}`
        );
        return false;
    }
}

function windowsOnOutput(windows, output) {
    const result = [];

    for (let index = 0; index < windows.length; index += 1) {
        if (
            windows[index].output
            && windows[index].output.name === output.name
        ) {
            result.push(windows[index]);
        }
    }

    return result;
}

// Fiziksel ekran merkezleri üzerinden istenen yöndeki en yakın output'u bulur.
function findDirectionalOutput(sourceOutput, direction) {
    const sourceCenter = geometryCenter(sourceOutput.geometry);
    const screens = workspace.screens;
    let nearestOutput = null;
    let nearestDistance = Infinity;

    for (let index = 0; index < screens.length; index += 1) {
        const candidate = screens[index];

        if (candidate === sourceOutput || candidate.name === sourceOutput.name) {
            continue;
        }

        const candidateCenter = geometryCenter(candidate.geometry);
        if (!targetIsInDirection(sourceCenter, candidateCenter, direction)) {
            continue;
        }

        const deltaX = Math.abs(candidateCenter.x - sourceCenter.x);
        const deltaY = Math.abs(candidateCenter.y - sourceCenter.y);
        const primaryDistance = (
            direction === FOCUS_LEFT || direction === FOCUS_RIGHT
        ) ? deltaX : deltaY;
        const secondaryDistance = (
            direction === FOCUS_LEFT || direction === FOCUS_RIGHT
        ) ? deltaY : deltaX;
        const distance = (primaryDistance * primaryDistance)
            + (secondaryDistance * secondaryDistance * 2);

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestOutput = candidate;
        }
    }

    return nearestOutput;
}

function clearActiveWindowFocus(reason) {
    try {
        keirokitFocusChangeInProgress = true;
        try {
            workspace.activeWindow = null;
        } finally {
            keirokitFocusChangeInProgress = false;
        }
        log(`Pencere odağı temizlendi: neden=${reason}`);
        return true;
    } catch (error) {
        log(`Pencere odağı temizlenemedi: neden=${reason}, hata=${error}`);
        return false;
    }
}

// İmlecin bulunduğu output'taki tile'ı (gap üzerindeyse en yakın tile'ı)
// odaklar. O output'ta pencere yoksa başka ekrana odak sıçratmak yerine pencere
// odağını temizler. İmleç hiçbir durumda hareket ettirilmez.
function focusWindowUnderCursor(reason) {
    const cursorPosition = workspace.cursorPos;
    const cursorOutput = workspace.screenAt(cursorPosition);

    if (!cursorOutput) {
        return false;
    }

    const candidates = windowsOnOutput(
        visibleTiledWindows(lastTileableOrder),
        cursorOutput
    );
    const targetWindow = nearestWindowToPoint(candidates, cursorPosition);

    if (!targetWindow) {
        return clearActiveWindowFocus(`${reason}; imleç ekranı boş`);
    }

    if (workspace.activeWindow === targetWindow) {
        return true;
    }

    return activateTiledWindow(targetWindow, reason, false);
}

// Boş output'a da yönlü gezinilebilmesi için pencere odağını temizler ve
// imleci fiziksel ekranın tam merkezine taşır.
function activateEmptyOutput(output, direction) {
    const center = geometryCenter(output.geometry);
    clearActiveWindowFocus(`boş ekran ${output.name}`);
    warpCursorToPoint(center, `boş ekran ${output.name}`, true);
    log(
        `Boş ekrana odak geçişi: yön=${direction}, ekran=${output.name}, `
        + `merkez=${center.x},${center.y}`
    );
}

// Önce kaynak output içindeki komşuya, orada aday yoksa fiziksel komşu
// output'a geçer. Hedef output boşsa imleç ekran merkezine taşınır.
function focusInDirection(direction) {
    const candidates = visibleTiledWindows(lastTileableOrder);
    const activeWindow = workspace.activeWindow;
    const sourceWindow = windowIsInList(candidates, activeWindow)
        ? activeWindow
        : null;
    const sourcePoint = sourceWindow
        ? geometryCenter(sourceWindow.frameGeometry)
        : workspace.cursorPos;
    const sourceOutput = sourceWindow && sourceWindow.output
        ? sourceWindow.output
        : workspace.screenAt(sourcePoint);

    if (!sourceOutput) {
        log(`Yönlü odak atlandı: yön=${direction}, kaynak ekran yok.`);
        return;
    }

    const sameOutputCandidates = windowsOnOutput(candidates, sourceOutput);
    const targetOnSameOutput = findDirectionalWindow(
        sourcePoint,
        sameOutputCandidates,
        direction,
        sourceWindow
    );

    if (targetOnSameOutput) {
        activateTiledWindow(targetOnSameOutput, `yön=${direction}`);
        return;
    }

    const targetOutput = findDirectionalOutput(sourceOutput, direction);
    if (!targetOutput) {
        log(`Yönlü odak komşusu yok: yön=${direction}`);
        return;
    }

    const targetCandidates = windowsOnOutput(candidates, targetOutput);
    if (targetCandidates.length === 0) {
        activateEmptyOutput(targetOutput, direction);
        return;
    }

    const targetWindow = nearestWindowToPoint(
        targetCandidates,
        sourcePoint
    );
    activateTiledWindow(targetWindow, `yön=${direction}, ekran=${targetOutput.name}`);
}

// Sol yönlü odak kısayolunu en yakın tiled pencereye bağlar.
function focusLeft() {
    focusInDirection(FOCUS_LEFT);
}

// Sağ yönlü odak kısayolunu en yakın tiled pencereye bağlar.
function focusRight() {
    focusInDirection(FOCUS_RIGHT);
}

// Yukarı yönlü odak kısayolunu en yakın tiled pencereye bağlar.
function focusUp() {
    focusInDirection(FOCUS_UP);
}

// Aşağı yönlü odak kısayolunu en yakın tiled pencereye bağlar.
function focusDown() {
    focusInDirection(FOCUS_DOWN);
}

// Odaklı normal pencerenin Keirokit KDE tiling üyeliğini yalnızca açık float
// kısayoluyla değiştirir. Sürükleme veya fullscreen kendi başına float üretmez.
function toggleFocusedWindowFloating() {
    const window = workspace.activeWindow;

    if (!window) {
        log("Float değişimi atlandı: odaklı pencere yok.");
        return;
    }

    if (windowIsExplicitlyFloating(window)) {
        removeWindowFromList(explicitlyFloatingWindows, window);
        retileAll();
        log(`Pencere tiled yapıldı: caption=${windowCaption(window)}`);
        return;
    }

    if (!windowIsInList(lastTileableOrder, window)) {
        log(
            `Float değişimi atlandı: caption=${windowCaption(window)}, `
            + "pencere Keirokit KDE tile'ı değil."
        );
        return;
    }

    explicitlyFloatingWindows.push(window);
    retileAll();
    log(`Pencere float yapıldı: caption=${windowCaption(window)}`);
}

// Bir pencerenin sürmekte olan etkileşimli taşıma/boyutlandırma kaydını bulur.
function interactiveMoveResizeStateIndex(window) {
    for (
        let index = 0;
        index < interactiveMoveResizeStates.length;
        index += 1
    ) {
        if (interactiveMoveResizeStates[index].window === window) {
            return index;
        }
    }

    return -1;
}

// Bırakma noktasını içeren tile'ı; hiçbiri içermiyorsa merkezi en yakın tile'ı
// seçer. Böylece pencere serbest konumda kalmak yerine kesin bir layout slotuna
// geri döner.
function nearestWindowToPoint(windows, point) {
    let nearestWindow = null;
    let nearestDistance = Infinity;

    for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index];
        const geometry = window.frameGeometry;

        if (pointIsInsideGeometry(point, geometry)) {
            return window;
        }

        const distance = squaredPointDistance(point, geometryCenter(geometry));
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestWindow = window;
        }
    }

    return nearestWindow;
}

// Tiled bir pencerede kullanıcı taşıma/boyutlandırmaya başladığında işlemi
// işaretler; yerleşim sinyalleri sürükleme bitene kadar pencereyi erken snap'lemez.
function handleInteractiveMoveResizeStarted(window) {
    if (
        !windowIsInList(lastTileableOrder, window)
        || interactiveMoveResizeStateIndex(window) !== -1
    ) {
        return;
    }

    interactiveMoveResizeStates.push({
        window,
        reorderOnFinish: window.resize !== true,
        sourceOutput: window.output,
        sourceDesktop: window.output
            ? currentDesktopForOutput(window.output)
            : null
    });
    log(
        `Tiled etkileşim başladı: caption=${windowCaption(window)}, `
        + `tür=${window.resize === true ? "boyutlandırma" : "taşıma"}`
    );
}

// Sürüklenen tile'ı bırakıldığı ekranın geçerli masaüstüne alır, en yakın tile
// ile layout sırasını değiştirir ve hemen yeniden döşer. Boyutlandırma da kalıcı
// float/özel geometri bırakmadan mevcut slot geometrisine geri döner.
function handleInteractiveMoveResizeFinished(window) {
    const stateIndex = interactiveMoveResizeStateIndex(window);

    if (stateIndex === -1) {
        return;
    }

    const state = interactiveMoveResizeStates[stateIndex];
    const dropPoint = workspace.cursorPos || geometryCenter(window.frameGeometry);
    const targetOutput = workspace.screenAt(dropPoint) || window.output;
    const targetDesktop = targetOutput
        ? currentDesktopForOutput(targetOutput)
        : null;
    let targetWindow = null;

    if (state.reorderOnFinish && targetOutput && targetDesktop) {
        const targetCandidates = windowsForOutput(
            lastTileableOrder,
            targetOutput,
            targetDesktop
        ).filter(function filterDraggedWindow(candidate) {
            return candidate !== window;
        });

        targetWindow = nearestWindowToPoint(targetCandidates, dropPoint);

        const previousMutationState = managedWindowMutationInProgress;
        try {
            managedWindowMutationInProgress = true;

            if (!windowBelongsToDesktop(window, targetDesktop)) {
                window.desktops = [targetDesktop];
            }

            if (window.output !== targetOutput) {
                workspace.sendClientToScreen(window, targetOutput);
            }
        } finally {
            managedWindowMutationInProgress = previousMutationState;
        }

        if (targetWindow) {
            if (
                state.sourceOutput === targetOutput
                && state.sourceDesktop === targetDesktop
            ) {
                swapWindowsInOrder(window, targetWindow);
            } else {
                forgetWindowOrder(window);
                insertWindowBefore(window, targetWindow);
            }
        } else {
            forgetWindowOrder(window);
            if (targetCandidates.length > 0) {
                insertWindowAfter(
                    window,
                    targetCandidates[targetCandidates.length - 1]
                );
            } else {
                appendWindowToOrder(window);
            }
        }
    }

    interactiveMoveResizeStates.splice(stateIndex, 1);
    retileAll();
    log(
        `Tiled etkileşim tamamlandı: caption=${windowCaption(window)}, `
        + `hedef=${targetWindow ? windowCaption(targetWindow) : "kendi slotu"}`
    );
}

// Masaüstü nesnesini kimliğiyle bulur.
function desktopById(desktopId) {
    const desktops = workspace.desktops;

    for (let index = 0; index < desktops.length; index += 1) {
        if (desktops[index].id === desktopId) {
            return desktops[index];
        }
    }

    return null;
}

// Verilen ekran/masaüstündeki son odaklanan pencereyi, yoksa kararlı listedeki
// ilk tiled pencereyi döndürür.
function preferredWindowForWorkspace(output, desktop) {
    const candidates = windowsForOutput(
        lastTileableOrder,
        output,
        desktop
    );
    const remembered = lastFocusedWindowByWorkspace[
        workspaceKey(output, desktop)
    ];

    if (remembered && windowIsInList(candidates, remembered)) {
        return remembered;
    }

    return candidates.length > 0 ? candidates[0] : null;
}

// Hedef masaüstünü eşlendiği ekranda gösterir; eşleme yoksa aktif ekranı
// kullanır. Ekran başına masaüstü API'si Plasma 6.7'de doğrudan KWin sağlar.
function switchToDesktop(desktop, focusReason) {
    if (!desktop) {
        return false;
    }

    const output = mappedOutputForDesktop(desktop)
        || workspace.activeScreen
        || (workspace.activeWindow && workspace.activeWindow.output)
        || workspace.screens[0];

    if (!output) {
        return false;
    }

    desktopMapChangeInProgress = true;
    try {
        workspace.setCurrentDesktopForScreen(desktop, output);
        lastValidDesktopByOutput[output.name] = desktop.id;
    } catch (error) {
        log(
            `Masaüstü gösterilemedi: desktop=${desktopNumber(desktop)}, `
            + `output=${output.name}, hata=${error}`
        );
        return false;
    } finally {
        desktopMapChangeInProgress = false;
    }

    retileAll();

    const target = preferredWindowForWorkspace(output, desktop);
    if (target) {
        activateTiledWindow(target, focusReason || "masaüstüne geçiş");
    }

    log(
        `Masaüstü gösterildi: ${desktopNumber(desktop)} `
        + `ekran=${output.name}`
    );
    return true;
}

// Aktif pencereyi hedef masaüstüne ve o masaüstünün eşlenmiş ekranına taşır;
// hedefi gösterdikten sonra pencereyi odaklı tutup imleci de taşır.
function moveActiveWindowToDesktop(desktop) {
    const window = workspace.activeWindow;

    if (!desktop || !window || !shouldTileWindow(window)) {
        log(
            `Pencere taşıma atlandı: desktop=`
            + `${desktop ? desktopNumber(desktop) : "<yok>"}, `
            + "aktif tiled pencere yok."
        );
        return false;
    }

    const targetOutput = mappedOutputForDesktop(desktop)
        || window.output
        || workspace.activeScreen;

    managedWindowMutationInProgress = true;
    desktopMapChangeInProgress = true;
    try {
        window.desktops = [desktop];

        if (targetOutput && window.output !== targetOutput) {
            workspace.sendClientToScreen(window, targetOutput);
        }

        if (targetOutput) {
            workspace.setCurrentDesktopForScreen(desktop, targetOutput);
            lastValidDesktopByOutput[targetOutput.name] = desktop.id;
        }
    } catch (error) {
        log(
            `Pencere masaüstüne taşınamadı: `
            + `${windowCaption(window)}, hata=${error}`
        );
        return false;
    } finally {
        desktopMapChangeInProgress = false;
        managedWindowMutationInProgress = false;
    }

    retileAll();
    activateTiledWindow(
        window,
        `masaüstü ${desktopNumber(desktop)}'e taşıma`
    );
    log(
        `Pencere taşındı: ${windowCaption(window)}, `
        + `desktop=${desktopNumber(desktop)}, `
        + `screen=${targetOutput ? targetOutput.name : "<değişmedi>"}`
    );
    return true;
}

// Kısayol callback'lerinde masaüstü numarasını kapatır.
function switchToDesktopNumber(number) {
    switchToDesktop(
        desktopByNumber(number),
        `masaüstü ${number}'e geçiş`
    );
}

// Kısayol callback'lerinde taşıma hedefi masaüstü numarasını kapatır.
function moveActiveWindowToDesktopNumber(number) {
    moveActiveWindowToDesktop(desktopByNumber(number));
}

// Bir Keirokit KDE global kısayolunu kaydedip kayıt sonucunu ortak log biçimiyle
// görünür kılar.
function registerKeirokitShortcut(objectName, text, keySequence, callback) {
    const registered = registerShortcut(
        objectName,
        text,
        keySequence,
        callback
    );

    log(
        `Kısayol ${registered ? "kaydedildi" : "kaydedilemedi"}: `
        + `${keySequence} (${objectName})`
    );
    return registered;
}

// Layout geçişi, float değişimi ve dört yönlü odak kısayolunu kaydedip başarılı
// kayıt sayısını döndürür.
function registerAllShortcuts() {
    const registrations = [
        registerKeirokitShortcut(
            "Keirokit KDE Toggle Layout",
            "Keirokit KDE: cycle the active workspace layout",
            "Meta+Alt+Space",
            toggleLayout
        ),
        registerKeirokitShortcut(
            "Keirokit KDE Toggle Floating",
            "Keirokit KDE: toggle the focused window between tiled and floating",
            "Meta+Alt+F",
            toggleFocusedWindowFloating
        ),
        registerKeirokitShortcut(
            "Keirokit KDE Focus Left",
            "Keirokit KDE: focus tiled window to the left",
            "Meta+Ctrl+Alt+H",
            focusLeft
        ),
        registerKeirokitShortcut(
            "Keirokit KDE Focus Down",
            "Keirokit KDE: focus tiled window below",
            "Meta+Ctrl+Alt+J",
            focusDown
        ),
        registerKeirokitShortcut(
            "Keirokit KDE Focus Up",
            "Keirokit KDE: focus tiled window above",
            "Meta+Ctrl+Alt+K",
            focusUp
        ),
        registerKeirokitShortcut(
            "Keirokit KDE Focus Right",
            "Keirokit KDE: focus tiled window to the right",
            "Meta+Ctrl+Alt+L",
            focusRight
        )
    ];
    // Henüz oluşturulmamış masaüstlerinin kısayollarını da kaydet. Callback
    // çalıştığı anda canlı masaüstü listesini çözer; böylece sonradan eklenen
    // masaüstleri script yeniden yüklenmeden kullanılabilir.
    for (let number = 1; number <= MAX_SHORTCUT_DESKTOP; number += 1) {
        registrations.push(
            registerKeirokitShortcut(
                `Keirokit KDE Switch to Desktop ${number}`,
                `Keirokit KDE: show desktop ${number} on its assigned output`,
                `Meta+Shift+F${number}`,
                switchToDesktopNumber.bind(null, number)
            )
        );
        registrations.push(
            registerKeirokitShortcut(
                `Keirokit KDE Move Window to Desktop ${number}`,
                `Keirokit KDE: move focused window and follow to desktop ${number}`,
                `Meta+Ctrl+Shift+F${number}`,
                moveActiveWindowToDesktopNumber.bind(null, number)
            )
        );
    }

    let registeredCount = 0;

    for (let index = 0; index < registrations.length; index += 1) {
        if (registrations[index]) {
            registeredCount += 1;
        }
    }

    return {
        registered: registeredCount,
        total: registrations.length
    };
}

// Output'un geçerli masaüstünü yapılandırılmış grubunda tutar.
function enforceDesktopAssignmentForOutput(output) {
    if (!enforceOutputDesktopAssignments || !output) {
        return false;
    }

    const assigned = outputDesktopAssignments[output.name];

    if (!assigned || assigned.length === 0) {
        return false;
    }

    const current = currentDesktopForOutput(output);

    if (!current) {
        log(`Output masaüstü hazır değil; eşleme atlandı: ${output.name}`);
        return false;
    }

    if (desktopIsAllowedOnOutput(current, output)) {
        lastValidDesktopByOutput[output.name] = current.id;
        return false;
    }

    const remembered = desktopById(lastValidDesktopByOutput[output.name]);
    const replacement = (
        remembered && desktopIsAllowedOnOutput(remembered, output)
    ) ? remembered : assigned[0];

    desktopMapChangeInProgress = true;
    try {
        workspace.setCurrentDesktopForScreen(replacement, output);
        lastValidDesktopByOutput[output.name] = replacement.id;
    } catch (error) {
        log(
            `Masaüstü eşlemesi uygulanamadı: output=${output.name}, `
            + `desktop=${desktopNumber(replacement)}, hata=${error}`
        );
        return false;
    } finally {
        desktopMapChangeInProgress = false;
    }

    log(
        `İzin verilmeyen masaüstü düzeltildi: ekran=${output.name}, `
        + `istenen=${desktopNumber(current)}, `
        + `gösterilen=${desktopNumber(replacement)}`
    );
    return true;
}

// Tüm bağlı output'larda masaüstü gruplarını uygular.
function enforceAllDesktopAssignments() {
    const screens = workspace.screens;

    for (let index = 0; index < screens.length; index += 1) {
        enforceDesktopAssignmentForOutput(screens[index]);
    }
}

// Masaüstü/output/layout eşlemelerini canlı ekran ve masaüstü nesnelerine göre
// yeniden derler.
function rebuildWorkspaceConfiguration() {
    const assignments = readOutputDesktopAssignments();
    outputDesktopAssignments = assignments.byOutput;
    desktopOutputAssignments = assignments.byDesktop;
    configuredLayoutOverrides = readLayoutOverrides();
    runtimeLayoutOverrides = {};

    const mappingSummaries = [];
    const outputNames = Object.keys(outputDesktopAssignments);

    for (let index = 0; index < outputNames.length; index += 1) {
        const outputName = outputNames[index];
        const desktops = outputDesktopAssignments[outputName];
        const numbers = [];

        for (
            let desktopIndex = 0;
            desktopIndex < desktops.length;
            desktopIndex += 1
        ) {
            numbers.push(desktopNumber(desktops[desktopIndex]));
        }

        mappingSummaries.push(`${outputName}=${numbers.join(",")}`);
    }

    log(
        `Ekran/masaüstü eşlemeleri: `
        + `${mappingSummaries.length > 0
            ? mappingSummaries.join("; ")
            : "<eşleme yok>"}`
    );
}

// KWin 6.7'nin ekran bilgili currentDesktopChanged sinyalini işler.
function handleCurrentDesktopChanged(previous, current, output) {
    if (desktopMapChangeInProgress) {
        return;
    }

    const changedOutput = output
        || workspace.activeScreen
        || (workspace.activeWindow && workspace.activeWindow.output);

    if (!changedOutput || !current) {
        retileAll();
        return;
    }

    if (
        enforceOutputDesktopAssignments
        && !desktopIsAllowedOnOutput(current, changedOutput)
    ) {
        enforceDesktopAssignmentForOutput(changedOutput);
        retileAll();
        return;
    }

    lastValidDesktopByOutput[changedOutput.name] = current.id;
    log(
        `Masaüstü değişti: ekran=${changedOutput.name}, `
        + `${previous ? desktopNumber(previous) : "<yok>"} -> `
        + `${desktopNumber(current)}`
    );
    retileAll();
}

// Ekran veya masaüstü listesi değiştiğinde nesne referanslı eşlemeleri yeniden
// kurup geçerli grupları uygular.
function handleWorkspaceTopologyChanged() {
    rebuildWorkspaceConfiguration();
    enforceAllDesktopAssignments();
    retileAll();
}

// Ekran geometrisi/panel kullanılabilir alanı değiştiğinde yeniden döşer.
function handleWorkspaceGeometryChanged() {
    retileAll();
}

// Etkinlik değişiminde aynı masaüstü/output geometrisinde görünür pencere
// kümesi değişir; etkin olmayan activity pencereleri layout'u etkilemez.
function handleCurrentActivityChanged() {
    retileAll();
}

// Tüm KConfig değerlerini yeniden okuyup nesne referanslı eşlemeleri kurar.
function readAllConfiguration() {
    activeLayout = readConfiguredLayout();
    denylistRules = readConfiguredDenylist();
    mouseFollowsFocus = readMouseFollowsFocus();
    openAtCursor = readOpenAtCursor();
    enforceOutputDesktopAssignments = readBooleanConfig(
        "EnforceOutputDesktopAssignments",
        true
    );
    gapSettings = readGapSettings();
    masterRatio = readBoundedIntegerConfig(
        "MasterRatio",
        DEFAULT_MASTER_RATIO,
        10,
        90
    );
    masterCount = readBoundedIntegerConfig("MasterCount", 1, 1, 10);
    rebuildWorkspaceConfiguration();
}

// Generic scripted KCM kaydedildiğinde KWin reconfigure/options.configChanged
// sinyali üretir. Ayarları script'i kapatıp açmadan canlı uygular.
function handleConfigurationChanged() {
    readAllConfiguration();
    enforceAllDesktopAssignments();
    retileAll();
    log("Yapılandırma canlı olarak yeniden yüklendi.");
}

// Çıkan pencerenin önceki layout indeksini yeni aday listesine taşıyarak aynı
// indekse kayan "sonraki" pencereyi, son eleman çıkmışsa ilk pencereyi seçer.
function nextWindowAfterExit(previousCandidates, newCandidates, exitedWindow) {
    if (newCandidates.length === 0) {
        return null;
    }

    const previousIndex = windowIndexInList(
        previousCandidates,
        exitedWindow
    );

    if (previousIndex === -1) {
        return newCandidates[0];
    }

    return newCandidates[previousIndex % newCandidates.length];
}

// Aktif tiled pencere kapanınca veya filtre nedeniyle tiling dışına çıkınca
// boşalan odağı layout sırasındaki bir sonraki görünür tiled pencereye verir.
function repairFocusAfterExit(
    exitedWindow,
    previousCandidates,
    wasActive,
    reason,
    moveCursor
) {
    if (!wasActive && workspace.activeWindow) {
        return;
    }

    const newCandidates = visibleTiledWindows(lastTileableOrder);
    const targetWindow = nextWindowAfterExit(
        previousCandidates,
        newCandidates,
        exitedWindow
    );

    if (!targetWindow) {
        log(`Odak devri atlandı: neden=${reason}, tiled pencere kalmadı.`);
        return;
    }

    activateTiledWindow(targetWindow, reason, moveCursor !== false);
}

// Aynı Window nesnesinin kimlik sinyallerine birden fazla kez bağlanılmasını
// engellemek için gözlem listesinde nesne kimliğiyle arama yapar.
function observedWindowIndex(window) {
    for (let index = 0; index < observedWindows.length; index += 1) {
        if (observedWindows[index] === window) {
            return index;
        }
    }

    return -1;
}

// Wayland istemcilerinde sonradan dolabilen class/role alanları değiştiğinde
// pencereyi yeniden değerlendirip tüm layout'u günceller.
function handleWindowIdentityChanged(window, signalName) {
    const previousCandidates = visibleTiledWindows(lastTileableOrder);
    const wasTileable = windowIsInList(lastTileableOrder, window);
    const wasActive = workspace.activeWindow === window
        || window.active === true;

    log(
        `Pencere kimlik sinyali: ${signalName}, `
        + `caption=${windowCaption(window)}; filtre yeniden çalıştırılıyor.`
    );
    retileAll();

    if (wasTileable && !windowIsInList(lastTileableOrder, window)) {
        repairFocusAfterExit(
            window,
            previousCandidates,
            wasActive,
            `${signalName} sonrası tiling dışı`
        );
    }
}

// windowClassChanged sinyalini ortak kimlik yeniden değerlendirme yoluna taşır.
function handleWindowClassChanged(window) {
    handleWindowIdentityChanged(window, "windowClassChanged");
}

// windowRoleChanged sinyalini ortak kimlik yeniden değerlendirme yoluna taşır.
function handleWindowRoleChanged(window) {
    handleWindowIdentityChanged(window, "windowRoleChanged");
}

// Fullscreen/maximize/quick-tile sinyalinin KWin iç durumuna tamamen yazılması
// için kısa süre bekleyip pencereyi yeniden Keirokit KDE geometrisine normalleştirir.
function retileAfterWindowStateSettled(timerState) {
    const stateIndex = pendingWindowStateTimers.indexOf(timerState);
    if (stateIndex !== -1) {
        pendingWindowStateTimers.splice(stateIndex, 1);
    }

    if (
        !timerState.window
        || observedWindowIndex(timerState.window) === -1
    ) {
        return;
    }

    retileAll();
}

// Aynı pencere için art arda gelen state sinyallerini tek bir gecikmeli retile
// işleminde birleştirir.
function scheduleWindowStateRetile(window, signalName) {
    for (
        let index = pendingWindowStateTimers.length - 1;
        index >= 0;
        index -= 1
    ) {
        if (pendingWindowStateTimers[index].window === window) {
            pendingWindowStateTimers[index].timer.stop();
            pendingWindowStateTimers.splice(index, 1);
        }
    }

    const timer = new QTimer();
    const timerState = {window, signalName, timer};
    pendingWindowStateTimers.push(timerState);
    timer.singleShot = true;
    timer.interval = WINDOW_STATE_SETTLE_MS;
    timer.timeout.connect(
        retileAfterWindowStateSettled.bind(null, timerState)
    );
    timer.start();
}

function removePendingWindowOpenTimer(timerState) {
    const index = pendingWindowOpenTimers.indexOf(timerState);
    if (index !== -1) {
        pendingWindowOpenTimers.splice(index, 1);
    }
}

// Bazı Wayland istemcileri kaydedilmiş doğal boyutlarını windowAdded sonrasında
// yeniden uygular. Yalnızca hâlâ tiled olan ve hedef geometrisinden gerçekten
// sapmış pencereleri kontrol noktalarında yeniden döşer; normal açılışta hiçbir
// ek geometri yazımı yapmaz.
function correctOpeningWindowGeometry(timerState) {
    removePendingWindowOpenTimer(timerState);

    const window = timerState.window;
    if (
        !window
        || observedWindowIndex(window) === -1
        || interactiveMoveResizeStateIndex(window) !== -1
        || window.move === true
        || window.resize === true
        || windowIsExplicitlyFloating(window)
        || window.minimized === true
    ) {
        return;
    }

    if (!windowIsInList(lastTileableOrder, window)) {
        const identity = windowIdentity(window);
        if (
            !structuralExclusionReason(window)
            && !matchingDenylistRule(identity)
        ) {
            retileAll();
        }
        return;
    }

    const expected = expectedWindowGeometry(window);
    if (
        !expected
        || !geometryDifferenceExceedsTolerance(
            window.frameGeometry,
            expected,
            WINDOW_GEOMETRY_TOLERANCE_PX
        )
    ) {
        return;
    }

    const actual = geometryIsUsable(window.frameGeometry)
        ? normalizedGeometry(window.frameGeometry)
        : null;
    const checkpoint = timerState.checkpoint
        || `${timerState.delay}ms`;
    log(
        `Açılış geometrisi düzeltildi: caption=${windowCaption(window)}, `
        + `kontrol=${checkpoint}, `
        + `actual=${actual
            ? `${actual.x},${actual.y},${actual.width}x${actual.height}`
            : "<geçersiz>"}, `
        + `expected=${expected.x},${expected.y},`
        + `${expected.width}x${expected.height}`
    );
    retileAll();
}

// KWin pencerenin ilk boyamaya hazır olduğunu bildirdiği anda, istemcinin ilk
// geometri isteğini reddetmiş olma ihtimalini zamanlayıcıyı beklemeden düzeltir.
function handleWindowReadyForPaintingChanged(window) {
    if (window.readyForPainting === false) {
        return;
    }

    correctOpeningWindowGeometry({
        window,
        checkpoint: "readyForPaintingChanged"
    });
}

function scheduleOpeningWindowGeometryChecks(window) {
    for (
        let delayIndex = 0;
        delayIndex < WINDOW_OPEN_SETTLE_DELAYS_MS.length;
        delayIndex += 1
    ) {
        const delay = WINDOW_OPEN_SETTLE_DELAYS_MS[delayIndex];
        const timer = new QTimer();
        const timerState = {window, delay, timer};
        pendingWindowOpenTimers.push(timerState);
        timer.singleShot = true;
        timer.interval = delay;
        timer.timeout.connect(
            correctOpeningWindowGeometry.bind(null, timerState)
        );
        timer.start();
    }
}

// Pencere masaüstü, ekran, minimize, fullscreen, maximize veya native KWin tile
// durumu Keirokit KDE dışından değiştirildiğinde eski/yeni alanları yeniden döşer.
function handleWindowPlacementStateChanged(window, signalName) {
    if (
        retileInProgress
        || managedWindowMutationInProgress
        || interactiveMoveResizeStateIndex(window) !== -1
    ) {
        return;
    }

    log(
        `Pencere yerleşim sinyali: ${signalName}, `
        + `caption=${windowCaption(window)}`
    );

    if (
        signalName === "fullScreenChanged"
        || signalName === "maximizedChanged"
        || signalName === "quickTileModeChanged"
        || signalName === "tileChanged"
    ) {
        scheduleWindowStateRetile(window, signalName);
        return;
    }

    retileAll();
}

// Yeni ve başlangıçta mevcut her pencerenin windowClassChanged ile
// windowRoleChanged sinyallerini yalnızca bir kez izlemeye alır.
function observeWindowIdentity(window) {
    if (!window || observedWindowIndex(window) !== -1) {
        return;
    }

    observedWindows.push(window);

    if (window.windowClassChanged && window.windowClassChanged.connect) {
        window.windowClassChanged.connect(
            handleWindowClassChanged.bind(null, window)
        );
    }

    if (window.windowRoleChanged && window.windowRoleChanged.connect) {
        window.windowRoleChanged.connect(
            handleWindowRoleChanged.bind(null, window)
        );
    }

    if (
        window.readyForPaintingChanged
        && window.readyForPaintingChanged.connect
    ) {
        window.readyForPaintingChanged.connect(
            handleWindowReadyForPaintingChanged.bind(null, window)
        );
    }

    const placementSignals = [
        {name: "desktopsChanged", signal: window.desktopsChanged},
        {name: "activitiesChanged", signal: window.activitiesChanged},
        {name: "outputChanged", signal: window.outputChanged},
        {name: "minimizedChanged", signal: window.minimizedChanged},
        {name: "hiddenChanged", signal: window.hiddenChanged},
        {name: "fullScreenChanged", signal: window.fullScreenChanged},
        {name: "maximizedChanged", signal: window.maximizedChanged},
        {name: "quickTileModeChanged", signal: window.quickTileModeChanged},
        {name: "tileChanged", signal: window.tileChanged}
    ];

    for (let index = 0; index < placementSignals.length; index += 1) {
        const placementSignal = placementSignals[index];

        if (placementSignal.signal && placementSignal.signal.connect) {
            placementSignal.signal.connect(
                handleWindowPlacementStateChanged.bind(
                    null,
                    window,
                    placementSignal.name
                )
            );
        }
    }

    if (
        window.interactiveMoveResizeStarted
        && window.interactiveMoveResizeStarted.connect
    ) {
        window.interactiveMoveResizeStarted.connect(
            handleInteractiveMoveResizeStarted.bind(null, window)
        );
    }

    if (
        window.interactiveMoveResizeFinished
        && window.interactiveMoveResizeFinished.connect
    ) {
        window.interactiveMoveResizeFinished.connect(
            handleInteractiveMoveResizeFinished.bind(null, window)
        );
    }
}

// Kaldırılan pencereyi gözlem listesinden çıkararak gereksiz nesne referansını
// serbest bırakır.
function forgetObservedWindow(window) {
    const index = observedWindowIndex(window);

    if (index !== -1) {
        observedWindows.splice(index, 1);
    }

    removeWindowFromList(explicitlyFloatingWindows, window);
    forgetExpectedWindowGeometry(window);

    const interactiveStateIndex = interactiveMoveResizeStateIndex(window);
    if (interactiveStateIndex !== -1) {
        interactiveMoveResizeStates.splice(interactiveStateIndex, 1);
    }

    for (
        let timerIndex = pendingWindowStateTimers.length - 1;
        timerIndex >= 0;
        timerIndex -= 1
    ) {
        if (pendingWindowStateTimers[timerIndex].window === window) {
            pendingWindowStateTimers[timerIndex].timer.stop();
            pendingWindowStateTimers.splice(timerIndex, 1);
        }
    }

    for (
        let timerIndex = pendingWindowOpenTimers.length - 1;
        timerIndex >= 0;
        timerIndex -= 1
    ) {
        if (pendingWindowOpenTimers[timerIndex].window === window) {
            pendingWindowOpenTimers[timerIndex].timer.stop();
            pendingWindowOpenTimers.splice(timerIndex, 1);
        }
    }
}

// Yeni pencere eklendiğinde kimlik sinyallerini bağlar ve güncel pencere
// listesini iki aşamalı filtreden geçirerek tekrar düzenler.
function handleWindowAdded(window) {
    if (observedWindowIndex(window) !== -1) {
        log(`Yinelenen windowAdded atlandı: ${windowCaption(window)}`);
        retileAll();
        return;
    }

    log(`Pencere eklendi: ${windowCaption(window)}`);
    observeWindowIdentity(window);
    placeNewWindowInOrder(window);
    retileAll();
    scheduleOpeningWindowGeometryChecks(window);
}

// Pencere kaldırıldığında gözlem/sıra kaydını temizler, alanı yeniden paylaştırır
// ve KWin'in rastgele odak devrini imlecin altındaki tiled pencereye düzeltir.
function handleWindowRemoved(window) {
    const previousCandidates = visibleTiledWindows(lastTileableOrder);
    const wasActive = workspace.activeWindow === window
        || window.active === true;
    const shouldRepairCursorFocus = wasActive
        || windowIsInList(previousCandidates, window);

    if (shouldRepairCursorFocus) {
        suppressFocusWarpForWindowClose();
    }
    log(`Pencere kaldırıldı: ${windowCaption(window)}`);
    forgetObservedWindow(window);
    forgetWindowOrder(window);
    retileAll();
    if (shouldRepairCursorFocus) {
        focusWindowUnderCursor("pencere kapandı; imleç-altı odak");
    }
}

// Başlangıç config'ini yükler, sinyalleri ve kısayolu kaydeder, mevcut
// pencereleri workspace.windowList() ile tarayıp ilk layout'u uygular.
function initialize() {
    readAllConfiguration();

    if (
        typeof options !== "undefined"
        && options.perOutputVirtualDesktops !== true
    ) {
        log(
            "UYARI: KWin PerOutputVirtualDesktops kapalı. "
            + "Ekran başına ayrı masaüstleri için kurulumu yeniden çalıştırın "
            + "veya Sistem Ayarları'ndan bu özelliği açın."
        );
    }

    workspace.windowAdded.connect(handleWindowAdded);
    workspace.windowRemoved.connect(handleWindowRemoved);
    workspace.windowActivated.connect(handleWindowActivated);
    workspace.currentDesktopChanged.connect(handleCurrentDesktopChanged);
    workspace.screensChanged.connect(handleWorkspaceTopologyChanged);
    workspace.desktopsChanged.connect(handleWorkspaceTopologyChanged);
    workspace.virtualScreenGeometryChanged.connect(
        handleWorkspaceGeometryChanged
    );
    if (
        workspace.currentActivityChanged
        && workspace.currentActivityChanged.connect
    ) {
        workspace.currentActivityChanged.connect(
            handleCurrentActivityChanged
        );
    }
    if (
        typeof options !== "undefined"
        && options.configChanged
        && options.configChanged.connect
    ) {
        options.configChanged.connect(handleConfigurationChanged);
    }

    const existingWindows = workspace.windowList();

    for (let index = 0; index < existingWindows.length; index += 1) {
        observeWindowIdentity(existingWindows[index]);
        appendWindowToOrder(existingWindows[index]);
    }

    enforceAllDesktopAssignments();

    const shortcutRegistration = registerAllShortcuts();

    log(
        `Başlatıldı: layout=${activeLayout}, `
        + `mevcut pencere sayısı=${existingWindows.length}, `
        + `mouseFollowsFocus=${mouseFollowsFocus}, `
        + `openAtCursor=${openAtCursor}, `
        + `master=${masterRatio}%/${masterCount}, `
        + `desktopMap=${enforceOutputDesktopAssignments}, `
        + `kısayol=${shortcutRegistration.registered}/`
        + `${shortcutRegistration.total}`
    );
    retileAll(existingWindows);
}

initialize();
