"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Signal {
    constructor() {
        this.callbacks = [];
    }

    connect(callback) {
        this.callbacks.push(callback);
    }

    emit(...arguments_) {
        for (const callback of this.callbacks.slice()) {
            callback(...arguments_);
        }
    }
}

function makeDesktop(number) {
    return {
        id: `desktop-${number}`,
        name: String(number),
        x11DesktopNumber: number
    };
}

function makeOutput(name, x) {
    return {
        name,
        geometry: {x, y: 0, width: 1920, height: 1080}
    };
}

function makeWindow(caption, output, desktop, resourceClass) {
    const signals = {
        windowClassChanged: new Signal(),
        windowRoleChanged: new Signal(),
        desktopsChanged: new Signal(),
        activitiesChanged: new Signal(),
        outputChanged: new Signal(),
        minimizedChanged: new Signal(),
        hiddenChanged: new Signal(),
        fullScreenChanged: new Signal(),
        maximizedChanged: new Signal(),
        quickTileModeChanged: new Signal(),
        tileChanged: new Signal(),
        frameGeometryChanged: new Signal(),
        readyForPaintingChanged: new Signal(),
        interactiveMoveResizeStarted: new Signal(),
        interactiveMoveResizeFinished: new Signal()
    };
    let desktops = [desktop];
    let activities = [];
    let frameGeometry = {x: 0, y: 0, width: 100, height: 100};
    let ignoredFrameGeometryWrites = 0;
    let fullScreen = false;
    let hidden = false;
    let tile = null;

    const window = {
        caption,
        managed: true,
        normalWindow: true,
        deleted: false,
        specialWindow: false,
        popupWindow: false,
        dialog: false,
        modal: false,
        desktopWindow: false,
        dock: false,
        splash: false,
        utility: false,
        toolbar: false,
        menu: false,
        dropdownMenu: false,
        popupMenu: false,
        tooltip: false,
        notification: false,
        criticalNotification: false,
        appletPopup: false,
        onScreenDisplay: false,
        comboBox: false,
        dndIcon: false,
        inputMethod: false,
        outline: false,
        transient: false,
        transientFor: null,
        moveable: true,
        resizeable: true,
        wantsInput: true,
        move: false,
        resize: false,
        minimized: false,
        maximizeMode: 0,
        output,
        resourceClass: resourceClass || caption.toLowerCase(),
        resourceName: resourceClass || caption.toLowerCase(),
        windowRole: "main",
        readyForPainting: true,
        active: false,
        ignoreNextFrameGeometryWrites(count) {
            ignoredFrameGeometryWrites = Math.max(0, Number(count) || 0);
        },
        setMaximize() {
            this.maximizeMode = 0;
            this.moveable = true;
            this.resizeable = true;
            signals.maximizedChanged.emit();
        },
        ...signals
    };

    Object.defineProperty(window, "desktops", {
        get() {
            return desktops;
        },
        set(value) {
            desktops = value;
            signals.desktopsChanged.emit();
        }
    });
    Object.defineProperty(window, "activities", {
        get() {
            return activities;
        },
        set(value) {
            activities = value;
            signals.activitiesChanged.emit();
        }
    });
    Object.defineProperty(window, "frameGeometry", {
        get() {
            return frameGeometry;
        },
        set(value) {
            if (ignoredFrameGeometryWrites > 0) {
                ignoredFrameGeometryWrites -= 1;
                return;
            }

            const previousGeometry = frameGeometry;
            frameGeometry = {...value};
            signals.frameGeometryChanged.emit(previousGeometry);
        }
    });
    Object.defineProperty(window, "fullScreen", {
        get() {
            return fullScreen;
        },
        set(value) {
            fullScreen = value;
            window.moveable = !value;
            window.resizeable = !value;
            signals.fullScreenChanged.emit();
        }
    });
    Object.defineProperty(window, "hidden", {
        get() {
            return hidden;
        },
        set(value) {
            hidden = value;
            signals.hiddenChanged.emit();
        }
    });
    Object.defineProperty(window, "tile", {
        get() {
            return tile;
        },
        set(value) {
            tile = value;
            signals.tileChanged.emit();
        }
    });

    return window;
}

const desktops = Array.from({length: 8}, (_, index) => makeDesktop(index + 1));
const leftOutput = makeOutput("DP-2", 0);
const rightOutput = makeOutput("HDMI-A-1", 1920);
const leftA = makeWindow("left-a", leftOutput, desktops[0], "left-a");
const leftB = makeWindow("left-b", leftOutput, desktops[0], "left-b");
const rightA = makeWindow("right-a", rightOutput, desktops[4], "right-a");
const rightB = makeWindow("right-b", rightOutput, desktops[4], "right-b");
const windows = [leftA, leftB, rightA, rightB];
const currentDesktopByOutput = new Map([
    [leftOutput, desktops[0]],
    [rightOutput, desktops[4]]
]);
const shortcuts = new Map();
const dbusCalls = [];
const logMessages = [];
const options = {
    perOutputVirtualDesktops: true,
    configChanged: new Signal()
};

const workspace = {
    desktops,
    screens: [leftOutput, rightOutput],
    currentActivity: "activity-1",
    activeScreen: leftOutput,
    cursorPos: {x: 500, y: 500},
    windowAdded: new Signal(),
    windowRemoved: new Signal(),
    windowActivated: new Signal(),
    currentDesktopChanged: new Signal(),
    currentActivityChanged: new Signal(),
    screensChanged: new Signal(),
    desktopsChanged: new Signal(),
    virtualScreenGeometryChanged: new Signal(),
    windowList() {
        return windows.slice();
    },
    currentDesktopForScreen(output) {
        return currentDesktopByOutput.get(output);
    },
    setCurrentDesktopForScreen(desktop, output) {
        const previous = currentDesktopByOutput.get(output);
        currentDesktopByOutput.set(output, desktop);
        this.currentDesktopChanged.emit(previous, desktop, output);
    },
    clientArea(_option, output) {
        return {...output.geometry};
    },
    screenAt(point) {
        return point.x < 1920 ? leftOutput : rightOutput;
    },
    sendClientToScreen(window, output) {
        window.output = output;
        window.outputChanged.emit();
    },
    raiseWindow() {
        // Stacking is irrelevant to geometry and focus assertions.
    }
};

let activeWindow = null;
Object.defineProperty(workspace, "activeWindow", {
    get() {
        return activeWindow;
    },
    set(window) {
        if (activeWindow) {
            activeWindow.active = false;
        }
        activeWindow = window;
        if (window) {
            window.active = true;
            workspace.activeScreen = window.output;
        }
        workspace.windowActivated.emit(window);
    }
});

const timers = [];

class FakeTimer {
    constructor() {
        this.timeout = new Signal();
        this.singleShot = false;
        this.interval = 0;
        this.running = false;
        timers.push(this);
    }

    start() {
        this.running = true;
        if (this.singleShot && this.interval <= 50) {
            this.running = false;
            this.timeout.emit();
        }
    }

    stop() {
        this.running = false;
    }
}

function fireTimersWithInterval(interval) {
    for (const timer of timers.slice()) {
        if (timer.running && timer.interval === interval) {
            timer.running = false;
            timer.timeout.emit();
        }
    }
}

const config = {
    LayoutAlgorithm: 0,
    InnerGap: 6,
    OuterGapTop: 10,
    OuterGapRight: 10,
    OuterGapBottom: 10,
    OuterGapLeft: 10,
    SmartGaps: true,
    SmartGapsThreshold: 1,
    MasterRatio: 60,
    MasterCount: 1,
    EnforceOutputDesktopAssignments: true,
    OutputDesktopAssignments: ["DP-2=1-4", "HDMI-A-1=5-8"],
    LayoutOverrides: ["HDMI-A-1:5=monocle"],
    WindowDenylist: [],
    MouseFollowsFocus: true,
    OpenAtCursor: true
};

const context = vm.createContext({
    workspace,
    options,
    KWin: {MaximizeArea: 1},
    QTimer: FakeTimer,
    console: {
        log(message) {
            logMessages.push(String(message));
        }
    },
    readConfig(key, defaultValue) {
        return Object.hasOwn(config, key) ? config[key] : defaultValue;
    },
    registerShortcut(objectName, _text, keySequence, callback) {
        shortcuts.set(keySequence, {objectName, callback});
        return true;
    },
    callDBus(...arguments_) {
        dbusCalls.push(arguments_.slice(0, -1));
        if (arguments_[3] === "MoveCursorRelative") {
            workspace.cursorPos = {
                x: workspace.cursorPos.x + Math.round(arguments_[4] * 1.85),
                y: workspace.cursorPos.y + Math.round(arguments_[5] * 1.85)
            };
        }
        const callback = arguments_.at(-1);
        if (typeof callback === "function") {
            callback(true);
        }
    }
});

const scriptPath = path.join(
    __dirname,
    "..",
    "kwin-script",
    "contents",
    "code",
    "main.js"
);
vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, {
    filename: scriptPath
});

function runShortcut(keySequence) {
    const shortcut = shortcuts.get(keySequence);
    assert(shortcut, `shortcut must be registered: ${keySequence}`);
    shortcut.callback();
}

function assertGeometry(actual, expected, message) {
    assert.deepEqual(
        {...actual},
        expected,
        message
    );
}

function assertPointNear(actual, expected, tolerance, message) {
    assert(
        Math.abs(actual.x - expected.x) <= tolerance
        && Math.abs(actual.y - expected.y) <= tolerance,
        `${message}: actual=${actual.x},${actual.y}`
    );
}

assert.equal(shortcuts.size, 24, "six core and eighteen desktop shortcuts");
assert(
    shortcuts.has("Meta+Shift+F9")
    && shortcuts.has("Meta+Ctrl+Shift+F9"),
    "desktop 9 shortcuts exist before desktop 9 is created"
);
assert.equal(
    vm.runInContext("normalizeLayoutName('4')", context),
    "monocle",
    "string-encoded KConfig enum values select the intended layout"
);

assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 947, height: 1060},
    "binary split uses independent outer and inner gaps"
);
assertGeometry(
    leftB.frameGeometry,
    {x: 963, y: 10, width: 947, height: 1060},
    "binary split fills the remainder without double outer gaps"
);
assertGeometry(
    rightA.frameGeometry,
    {x: 1930, y: 10, width: 1900, height: 1060},
    "per-workspace monocle override is honored"
);
assertGeometry(
    rightB.frameGeometry,
    rightA.frameGeometry,
    "monocle windows share one geometry"
);

const extremeInset = JSON.parse(vm.runInContext(
    "JSON.stringify(insetRectangleByEdges({x: 100, y: 200, width: 5, height: 3}, {left: 200, right: 200, top: 200, bottom: 200}))",
    context
));
assertGeometry(
    extremeInset,
    {x: 102, y: 201, width: 1, height: 1},
    "oversized outer gaps stay inside the usable area"
);

const fractionalGeometry = JSON.parse(vm.runInContext(
    "JSON.stringify(normalizedGeometry({x: 0.6, y: 10.6, width: 1919.6, height: 1069.6}))",
    context
));
assertGeometry(
    fractionalGeometry,
    {x: 1, y: 11, width: 1919, height: 1069},
    "fractional-scale geometry rounds edges without growing past the area"
);

const extremeBinarySplit = JSON.parse(vm.runInContext(
    "JSON.stringify(splitBinaryRectangle({x: 10, y: 20, width: 5, height: 7}, 200, 'vertical'))",
    context
));
assertGeometry(
    extremeBinarySplit.first,
    {x: 10, y: 20, width: 1, height: 7},
    "an oversized binary gap preserves the first pixel-wide leaf"
);
assertGeometry(
    extremeBinarySplit.second,
    {x: 14, y: 20, width: 1, height: 7},
    "an oversized binary gap cannot push the second leaf outside the area"
);

const extremeLinearGeometries = JSON.parse(vm.runInContext(
    `(function () {
        const stressWindows = [
            {caption: "stress-a", fullScreen: false, tile: null, maximizeMode: 0},
            {caption: "stress-b", fullScreen: false, tile: null, maximizeMode: 0},
            {caption: "stress-c", fullScreen: false, tile: null, maximizeMode: 0}
        ];
        applyLinearLayout(
            stressWindows,
            {x: 100, y: 200, width: 5, height: 4},
            {inner: 200, top: 0, right: 0, bottom: 0, left: 0},
            true
        );
        return JSON.stringify(stressWindows.map(function (window) {
            return window.frameGeometry;
        }));
    }())`,
    context
));
assert.deepEqual(
    extremeLinearGeometries,
    [
        {x: 100, y: 200, width: 1, height: 4},
        {x: 102, y: 200, width: 1, height: 4},
        {x: 104, y: 200, width: 1, height: 4}
    ],
    "linear layouts clamp impossible gaps without overflowing the client area"
);

const extremeMasterGeometries = JSON.parse(vm.runInContext(
    `(function () {
        const previousMasterRatio = masterRatio;
        const stressWindows = [
            {caption: "master-a", fullScreen: false, tile: null, maximizeMode: 0},
            {caption: "master-b", fullScreen: false, tile: null, maximizeMode: 0}
        ];
        masterRatio = 90;
        applyMasterStackLayout(
            stressWindows,
            {x: 10, y: 20, width: 2, height: 3},
            {inner: 200, top: 0, right: 0, bottom: 0, left: 0}
        );
        masterRatio = previousMasterRatio;
        return JSON.stringify(stressWindows.map(function (window) {
            return window.frameGeometry;
        }));
    }())`,
    context
));
assert.deepEqual(
    extremeMasterGeometries,
    [
        {x: 10, y: 20, width: 1, height: 3},
        {x: 11, y: 20, width: 1, height: 3}
    ],
    "master-stack keeps both columns inside a two-pixel client area"
);

assert.equal(vm.runInContext(
    `(function () {
        const originalExpectedCount = expectedWindowGeometries.length;
        const originalMasterRatio = masterRatio;
        const stressOutput = {name: "geometry-stress"};
        const stressDesktop = {id: "geometry-stress", name: "stress"};
        const widths = [1, 2, 3, 17];
        const heights = [1, 2, 11];
        const counts = [1, 2, 3, 8];
        const innerGaps = [0, 1, 200];
        const layouts = [
            function binary(windows, area, gaps) {
                delete binarySplitTrees[workspaceKey(stressOutput, stressDesktop)];
                applyBinarySplitLayout(
                    windows,
                    area,
                    gaps,
                    stressOutput,
                    stressDesktop
                );
            },
            function master(windows, area, gaps) {
                applyMasterStackLayout(windows, area, gaps);
            },
            function columns(windows, area, gaps) {
                applyLinearLayout(windows, area, gaps, true);
            },
            function rows(windows, area, gaps) {
                applyLinearLayout(windows, area, gaps, false);
            },
            function monocle(windows, area, gaps) {
                applyMonocleLayout(windows, area, gaps);
            }
        ];

        masterRatio = 90;
        for (let widthIndex = 0; widthIndex < widths.length; widthIndex += 1) {
            for (let heightIndex = 0; heightIndex < heights.length; heightIndex += 1) {
                for (let countIndex = 0; countIndex < counts.length; countIndex += 1) {
                    for (let gapIndex = 0; gapIndex < innerGaps.length; gapIndex += 1) {
                        for (let layoutIndex = 0; layoutIndex < layouts.length; layoutIndex += 1) {
                            const area = {
                                x: -7,
                                y: 13,
                                width: widths[widthIndex],
                                height: heights[heightIndex]
                            };
                            const gaps = {
                                inner: innerGaps[gapIndex],
                                top: 200,
                                right: 200,
                                bottom: 200,
                                left: 200
                            };
                            const stressWindows = [];
                            for (let index = 0; index < counts[countIndex]; index += 1) {
                                stressWindows.push({
                                    caption: "stress-" + index,
                                    fullScreen: false,
                                    tile: null,
                                    maximizeMode: 0
                                });
                            }

                            layouts[layoutIndex](stressWindows, area, gaps);
                            for (let index = 0; index < stressWindows.length; index += 1) {
                                const geometry = stressWindows[index].frameGeometry;
                                if (
                                    !geometryIsUsable(geometry)
                                    || geometry.x < area.x
                                    || geometry.y < area.y
                                    || geometry.x + geometry.width > area.x + area.width
                                    || geometry.y + geometry.height > area.y + area.height
                                ) {
                                    throw new Error(
                                        "layout escaped client area: "
                                        + JSON.stringify({area, geometry})
                                    );
                                }
                            }
                            expectedWindowGeometries.length = originalExpectedCount;
                        }
                    }
                }
            }
        }

        delete binarySplitTrees[workspaceKey(stressOutput, stressDesktop)];
        masterRatio = originalMasterRatio;
        return true;
    }())`,
    context
), true, "all layouts stay within tiny client areas across gap stress cases");

const originalClientArea = workspace.clientArea;
workspace.clientArea = function invalidClientArea() {
    return {x: 0, y: 0, width: 0, height: 0};
};
assert.equal(
    vm.runInContext(
        "clientAreaForOutput(workspace.screens[0], workspace.desktops[0])",
        context
    ),
    null,
    "a transient invalid KWin client area safely skips the layout pass"
);
workspace.clientArea = originalClientArea;

const originalCurrentDesktopForScreen = workspace.currentDesktopForScreen;
workspace.currentDesktopForScreen = function unavailableDesktopState() {
    throw new Error("desktop transition in progress");
};
assert.equal(
    vm.runInContext(
        "currentDesktopForOutput(workspace.screens[0])",
        context
    ),
    null,
    "a transient KWin desktop lookup error safely skips the layout pass"
);
workspace.currentDesktopForScreen = originalCurrentDesktopForScreen;

const temporarilyUnavailableDesktop = currentDesktopByOutput.get(leftOutput);
currentDesktopByOutput.delete(leftOutput);
runShortcut("Meta+Alt+Space");
assert(
    logMessages.some(message => (
        message.includes("Layout değiştirilemedi; masaüstü hazır değil")
    )),
    "layout cycling safely ignores a transiently unavailable desktop"
);
currentDesktopByOutput.set(leftOutput, temporarilyUnavailableDesktop);

const originalAssignmentConfig = config.OutputDesktopAssignments;
config.OutputDesktopAssignments = ["DP-2=1-2", "DP-2=2-4"];
assert.deepEqual(
    JSON.parse(vm.runInContext(
        "JSON.stringify(readOutputDesktopAssignments().byOutput['DP-2'].map(function (desktop) { return desktop.x11DesktopNumber; }))",
        context
    )),
    [1, 2, 3, 4],
    "repeated output assignment rows merge without losing earlier desktops"
);
config.OutputDesktopAssignments = originalAssignmentConfig;
assert.deepEqual(
    JSON.parse(vm.runInContext(
        "JSON.stringify(parseDesktopNumberSpec('1-999999999'))",
        context
    )),
    [1, 2, 3, 4, 5, 6, 7, 8],
    "mistyped huge desktop ranges are bounded to existing desktops"
);
assert.deepEqual(
    JSON.parse(vm.runInContext(
        "JSON.stringify(activeConfigLines('', ['fallback']))",
        context
    )),
    [],
    "an explicitly empty list stays empty instead of restoring defaults"
);

vm.runInContext(
    "binarySplitTrees['DP-2::desktop-1'] = {orientation: 'vertical', first: {window: windowOrder[0]}, second: {window: windowOrder[0]}}; retileAll();",
    context
);
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 947, height: 1060},
    "a stale duplicate BSP leaf is retained only once"
);
assertGeometry(
    leftB.frameGeometry,
    {x: 963, y: 10, width: 947, height: 1060},
    "a missing BSP leaf is restored after duplicate pruning"
);

// Her KCM alanının configChanged sonrasında çalışan betiğe ulaştığını tek bir
// izole ayar matrisiyle doğrula. Sonunda başlangıç config'i eksiksiz geri
// yüklenir; aşağıdaki davranış testleri varsayılan durumdan devam eder.
const initialConfig = {...config};
Object.assign(config, {
    LayoutAlgorithm: 4,
    InnerGap: 9,
    OuterGapTop: 11,
    OuterGapRight: 17,
    OuterGapBottom: 15,
    OuterGapLeft: 13,
    SmartGaps: false,
    SmartGapsThreshold: 3,
    MasterRatio: 73,
    MasterCount: 2,
    EnforceOutputDesktopAssignments: false,
    OutputDesktopAssignments: ["DP-2=1,3-4", "HDMI-A-1=5-8"],
    LayoutOverrides: ["DP-2:1=rows"],
    WindowDenylist: ["^right-b$"],
    MouseFollowsFocus: false,
    OpenAtCursor: false
});
options.configChanged.emit();

assert.equal(
    vm.runInContext("activeLayout", context),
    "monocle",
    "LayoutAlgorithm reloads from the KCM enum"
);
assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify(gapSettings)", context)),
    {
        inner: 9,
        top: 11,
        right: 17,
        bottom: 15,
        left: 13,
        smart: false,
        smartThreshold: 3
    },
    "all inner, outer, smart-gap and threshold settings reload"
);
assert.equal(
    vm.runInContext("masterRatio", context),
    73,
    "MasterRatio reloads"
);
assert.equal(
    vm.runInContext("masterCount", context),
    2,
    "MasterCount reloads"
);
assert.equal(
    vm.runInContext("enforceOutputDesktopAssignments", context),
    false,
    "desktop assignment enforcement reloads"
);
assert.deepEqual(
    JSON.parse(vm.runInContext(
        "JSON.stringify(outputDesktopAssignments['DP-2'].map(d => d.x11DesktopNumber))",
        context
    )),
    [1, 3, 4],
    "output assignment lists support numbers, commas and ranges"
);
assert.equal(
    vm.runInContext(
        "configuredLayoutOverrides['DP-2::desktop-1']",
        context
    ),
    "rows",
    "per-output desktop layout overrides reload"
);
assert.deepEqual(
    JSON.parse(vm.runInContext(
        "JSON.stringify(denylistRules.map(rule => rule.pattern))",
        context
    )),
    ["^right-b$"],
    "window denylist rules compile after a settings save"
);
assert.equal(
    vm.runInContext("mouseFollowsFocus", context),
    false,
    "MouseFollowsFocus reloads"
);
assert.equal(
    vm.runInContext("openAtCursor", context),
    false,
    "OpenAtCursor reloads"
);
assertGeometry(
    leftA.frameGeometry,
    {x: 13, y: 11, width: 1890, height: 522},
    "row override uses every configured edge and inner gap"
);
assertGeometry(
    leftB.frameGeometry,
    {x: 13, y: 542, width: 1890, height: 523},
    "row override fills the remaining gapped area"
);
assertGeometry(
    rightA.frameGeometry,
    {x: 1933, y: 11, width: 1890, height: 1054},
    "default monocle and the denylist are both applied"
);

workspace.cursorPos = {x: 2500, y: 500};
const openAtCursorDisabledWindow = makeWindow(
    "open-at-cursor-disabled",
    leftOutput,
    desktops[0],
    "open-at-cursor-disabled"
);
windows.push(openAtCursorDisabledWindow);
workspace.windowAdded.emit(openAtCursorDisabledWindow);
assert.equal(
    openAtCursorDisabledWindow.output,
    leftOutput,
    "OpenAtCursor=false leaves a new window on its original output"
);
assert.equal(
    openAtCursorDisabledWindow.desktops[0],
    desktops[0],
    "OpenAtCursor=false leaves the original desktop unchanged"
);
windows.splice(windows.indexOf(openAtCursorDisabledWindow), 1);
workspace.windowRemoved.emit(openAtCursorDisabledWindow);
fireTimersWithInterval(150);

workspace.cursorPos = {x: 100, y: 100};
const mouseFollowDisabledCallCount = dbusCalls.length;
workspace.activeWindow = rightA;
assert.equal(
    dbusCalls.length,
    mouseFollowDisabledCallCount,
    "MouseFollowsFocus=false suppresses external focus cursor warps"
);

config.SmartGaps = true;
config.SmartGapsThreshold = 2;
options.configChanged.emit();
assertGeometry(
    leftA.frameGeometry,
    {x: 0, y: 0, width: 1920, height: 535},
    "SmartGapsThreshold removes all outer edges at the configured count"
);

Object.assign(config, {
    LayoutAlgorithm: 1,
    LayoutOverrides: [],
    SmartGaps: false,
    MasterRatio: 73,
    MasterCount: 1
});
options.configChanged.emit();
assertGeometry(
    leftA.frameGeometry,
    {x: 13, y: 11, width: 1373, height: 1054},
    "MasterRatio controls the master-stack share"
);
assertGeometry(
    leftB.frameGeometry,
    {x: 1395, y: 11, width: 508, height: 1054},
    "master-stack leaves the configured inner gap"
);

config.MasterCount = 2;
options.configChanged.emit();
assertGeometry(
    leftA.frameGeometry,
    {x: 13, y: 11, width: 940, height: 1054},
    "MasterCount expands the master area to the configured window count"
);

Object.assign(config, initialConfig);
options.configChanged.emit();
workspace.cursorPos = {x: 500, y: 500};
workspace.activeWindow = null;

// Bazı istemciler ilk frameGeometry yazımlarını henüz hazır olmadıkları için
// yok sayar veya doğru tile geometrisini kendi kayıtlı boyutlarıyla ezer.
// Açılış kontrol noktaları iki durumu da hedef tile'a geri döndürmelidir.
workspace.cursorPos = {x: 100, y: 100};
const delayedGeometryWindow = makeWindow(
    "delayed-geometry-window",
    leftOutput,
    desktops[0],
    "delayed-geometry-window"
);
delayedGeometryWindow.ignoreNextFrameGeometryWrites(2);
windows.push(delayedGeometryWindow);
workspace.windowAdded.emit(delayedGeometryWindow);
assertGeometry(
    delayedGeometryWindow.frameGeometry,
    {x: 0, y: 0, width: 100, height: 100},
    "an unready client may ignore the immediate and 40ms geometry writes"
);
delayedGeometryWindow.readyForPaintingChanged.emit();
assertGeometry(
    delayedGeometryWindow.frameGeometry,
    {x: 10, y: 10, width: 947, height: 527},
    "readyForPainting repairs initially ignored geometry without another delay"
);
delayedGeometryWindow.frameGeometry = {
    x: 200,
    y: 180,
    width: 640,
    height: 480
};
fireTimersWithInterval(120);
assertGeometry(
    delayedGeometryWindow.frameGeometry,
    {x: 10, y: 10, width: 947, height: 527},
    "the timer fallback repairs a client restoring its natural size"
);
assert(
    logMessages.some(message => (
        message.includes("Açılış geometrisi düzeltildi")
        && message.includes("delayed-geometry-window")
    )),
    "opening geometry correction is visible in the diagnostic log"
);
windows.splice(windows.indexOf(delayedGeometryWindow), 1);
workspace.windowRemoved.emit(delayedGeometryWindow);
fireTimersWithInterval(150);

// Boş bir output/desktop üzerindeki ilk BSP yaprağının daima geçerli bir hedef
// geometrisi olmalıdır; önceki null hedefi günlükte TypeError üretiyordu.
currentDesktopByOutput.set(rightOutput, desktops[5]);
workspace.cursorPos = {x: 2500, y: 500};
const firstWindowLogStart = logMessages.length;
const protocolHelperWindow = makeWindow(
    "protocol-helper-window",
    rightOutput,
    desktops[5],
    "protocol-helper-window"
);
protocolHelperWindow.resourceClass = "";
protocolHelperWindow.resourceName = "";
protocolHelperWindow.windowRole = "";
protocolHelperWindow.wantsInput = false;
windows.push(protocolHelperWindow);
workspace.windowAdded.emit(protocolHelperWindow);
assert.deepEqual(
    {...protocolHelperWindow.frameGeometry},
    {x: 0, y: 0, width: 100, height: 100},
    "a focusless KWin InternalWindow never consumes a tile"
);
const inactiveActivityWindow = makeWindow(
    "inactive-activity-window",
    rightOutput,
    desktops[5],
    "inactive-activity-window"
);
inactiveActivityWindow.activities = ["activity-2"];
windows.push(inactiveActivityWindow);
workspace.windowAdded.emit(inactiveActivityWindow);
assertGeometry(
    inactiveActivityWindow.frameGeometry,
    {x: 0, y: 0, width: 100, height: 100},
    "a window on another Plasma activity does not consume a visible tile"
);
const hiddenNormalWindow = makeWindow(
    "hidden-normal-window",
    rightOutput,
    desktops[5],
    "hidden-normal-window"
);
hiddenNormalWindow.hidden = true;
windows.push(hiddenNormalWindow);
workspace.windowAdded.emit(hiddenNormalWindow);
assertGeometry(
    hiddenNormalWindow.frameGeometry,
    {x: 0, y: 0, width: 100, height: 100},
    "a hidden normal window does not consume a visible tile"
);
const firstEmptyWorkspaceWindow = makeWindow(
    "first-empty-workspace-window",
    leftOutput,
    desktops[0],
    "first-empty-workspace-window"
);
windows.push(firstEmptyWorkspaceWindow);
workspace.windowAdded.emit(firstEmptyWorkspaceWindow);
assert.equal(
    firstEmptyWorkspaceWindow.output,
    rightOutput,
    "the first window on an empty workspace follows the cursor output"
);
assert.equal(
    firstEmptyWorkspaceWindow.desktops[0],
    desktops[5],
    "the first window uses the empty output's current desktop"
);
assertGeometry(
    firstEmptyWorkspaceWindow.frameGeometry,
    {x: 1920, y: 0, width: 1920, height: 1080},
    "the first visible BSP window receives the full smart-gaps target"
);
workspace.windowAdded.emit(firstEmptyWorkspaceWindow);
assertGeometry(
    firstEmptyWorkspaceWindow.frameGeometry,
    {x: 1920, y: 0, width: 1920, height: 1080},
    "a duplicate windowAdded signal cannot split a window against itself"
);
assert.equal(
    vm.runInContext(
        "binarySplitTrees['HDMI-A-1::desktop-6'].window === lastTileableOrder.find(window => window.caption === 'first-empty-workspace-window')",
        context
    ),
    true,
    "the repaired one-window BSP tree contains exactly one leaf"
);
assert(
    !logMessages.slice(firstWindowLogStart).some(message => (
        message.includes("OpenAtCursor hatası")
    )),
    "the first BSP window never dereferences a null insertion geometry"
);
windows.splice(windows.indexOf(firstEmptyWorkspaceWindow), 1);
workspace.windowRemoved.emit(firstEmptyWorkspaceWindow);
workspace.currentActivity = "activity-2";
workspace.currentActivityChanged.emit("activity-2");
assertGeometry(
    inactiveActivityWindow.frameGeometry,
    {x: 1920, y: 0, width: 1920, height: 1080},
    "changing Plasma activity retiles the newly visible window"
);
workspace.currentActivity = "activity-1";
workspace.currentActivityChanged.emit("activity-1");
windows.splice(windows.indexOf(inactiveActivityWindow), 1);
workspace.windowRemoved.emit(inactiveActivityWindow);
windows.splice(windows.indexOf(hiddenNormalWindow), 1);
workspace.windowRemoved.emit(hiddenNormalWindow);
windows.splice(windows.indexOf(protocolHelperWindow), 1);
workspace.windowRemoved.emit(protocolHelperWindow);
fireTimersWithInterval(150);
currentDesktopByOutput.set(rightOutput, desktops[4]);

workspace.cursorPos = {x: 100, y: 100};
const cursorWindow = makeWindow(
    "cursor-window",
    leftOutput,
    desktops[0],
    "cursor-window"
);
windows.push(cursorWindow);
workspace.windowAdded.emit(cursorWindow);
assertGeometry(
    cursorWindow.frameGeometry,
    {x: 10, y: 10, width: 947, height: 527},
    "new windows split only the tile under the cursor"
);
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 543, width: 947, height: 527},
    "the window under the cursor shares its original tile"
);
assertGeometry(
    leftB.frameGeometry,
    {x: 963, y: 10, width: 947, height: 1060},
    "the opposite binary-tree branch is left unchanged"
);

workspace.activeWindow = cursorWindow;
workspace.cursorPos = {x: 100, y: 100};
cursorWindow.active = false;
rightA.active = true;
activeWindow = rightA;
const closeWarpCount = dbusCalls.length;
windows.splice(windows.indexOf(cursorWindow), 1);
workspace.windowRemoved.emit(cursorWindow);
assert.deepEqual(
    workspace.cursorPos,
    {x: 100, y: 100},
    "closing an active tiled window preserves the cursor position"
);
assert.equal(
    dbusCalls.length,
    closeWarpCount,
    "closing a window does not request a cursor warp"
);
assert.equal(
    workspace.activeWindow,
    leftA,
    "focus is still repaired after closing the active tiled window"
);
fireTimersWithInterval(150);
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 947, height: 1060},
    "removing the cursor-positioned window restores the previous layout"
);

workspace.cursorPos = {x: 1500, y: 100};
const rightSplitWindow = makeWindow(
    "right-split-window",
    leftOutput,
    desktops[0],
    "right-split-window"
);
windows.push(rightSplitWindow);
workspace.windowAdded.emit(rightSplitWindow);
assertGeometry(
    rightSplitWindow.frameGeometry,
    {x: 963, y: 10, width: 947, height: 527},
    "opening on the right splits the right tile"
);
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 947, height: 1060},
    "opening on the right does not resize the left tile"
);
windows.splice(windows.indexOf(rightSplitWindow), 1);
workspace.windowRemoved.emit(rightSplitWindow);
fireTimersWithInterval(150);

workspace.cursorPos = {x: 2500, y: 500};
const crossOutputWindow = makeWindow(
    "cross-output-window",
    leftOutput,
    desktops[0],
    "cross-output-window"
);
windows.push(crossOutputWindow);
workspace.windowAdded.emit(crossOutputWindow);
assert.equal(
    crossOutputWindow.output,
    rightOutput,
    "new windows move to the physical output under the cursor"
);
assert.equal(
    crossOutputWindow.desktops[0],
    desktops[4],
    "new windows use the desktop currently shown under the cursor"
);
windows.splice(windows.indexOf(crossOutputWindow), 1);
workspace.windowRemoved.emit(crossOutputWindow);
fireTimersWithInterval(150);
workspace.cursorPos = {x: 100, y: 100};
workspace.activeWindow = leftA;

runShortcut("Meta+Alt+Space");
assert.equal(
    leftA.frameGeometry.width,
    1136,
    "master-stack gives the configured 60% share to the master"
);
runShortcut("Meta+Alt+Space");
assert.equal(
    leftA.frameGeometry.width,
    947,
    "columns divides the workspace into equal vertical tiles"
);
runShortcut("Meta+Alt+Space");
assert.equal(
    leftA.frameGeometry.height,
    527,
    "rows divides the workspace into equal horizontal tiles"
);
runShortcut("Meta+Alt+Space");
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 1900, height: 1060},
    "monocle fills the usable workspace"
);
runShortcut("Meta+Alt+Space");
assert.equal(
    leftA.frameGeometry.width,
    947,
    "a full layout cycle returns to binary-split"
);

config.InnerGap = 12;
options.configChanged.emit();
assert.equal(
    leftB.frameGeometry.x - (
        leftA.frameGeometry.x + leftA.frameGeometry.width
    ),
    12,
    "KWin configChanged applies settings without restarting the script"
);
config.InnerGap = 6;
options.configChanged.emit();

leftA.fullScreen = true;
assert.equal(
    leftA.fullScreen,
    false,
    "fullscreen requests are converted back into tiled windows"
);
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 947, height: 1060},
    "a fullscreen request keeps the window in the gapped tiled layout"
);

leftA.maximizeMode = 3;
leftA.moveable = false;
leftA.resizeable = false;
leftA.maximizedChanged.emit();
assert.equal(leftA.maximizeMode, 0, "maximize is converted back into tiling");
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 947, height: 1060},
    "maximized windows retain the Keirokit KDE gaps"
);

leftA.tile = {native: true};
assert.equal(leftA.tile, null, "native KWin quick tiles are normalized to Keirokit KDE");

workspace.activeWindow = leftA;
runShortcut("Meta+Alt+F");
assertGeometry(
    leftB.frameGeometry,
    {x: 0, y: 0, width: 1920, height: 1080},
    "the explicit float shortcut removes only the focused window from tiling"
);
runShortcut("Meta+Alt+F");
assertGeometry(
    leftA.frameGeometry,
    {x: 10, y: 10, width: 947, height: 1060},
    "the float shortcut restores the window to its previous tiled order"
);

leftB.move = true;
leftB.interactiveMoveResizeStarted.emit();
workspace.cursorPos = {x: 100, y: 100};
leftB.frameGeometry = {x: 50, y: 50, width: 600, height: 600};
leftB.move = false;
leftB.interactiveMoveResizeFinished.emit();
assert.equal(
    leftB.frameGeometry.x,
    10,
    "dragging a tiled window swaps it into the target tile instead of floating"
);
assert.equal(leftA.frameGeometry.x, 963, "the previous tile occupant is swapped");

leftB.move = true;
leftB.interactiveMoveResizeStarted.emit();
workspace.cursorPos = {x: 1500, y: 500};
leftB.move = false;
leftB.interactiveMoveResizeFinished.emit();
assert.equal(leftA.frameGeometry.x, 10, "a second drag restores the stable order");
assert.equal(leftB.frameGeometry.x, 963, "dragged tiles always snap to a slot");

workspace.cursorPos = {x: 100, y: 100};
const externalFocusWarpCount = dbusCalls.length;
workspace.activeWindow = rightA;
assert.equal(
    dbusCalls.length,
    externalFocusWarpCount + 1,
    "non-Keirokit KDE keyboard focus changes also move the cursor"
);
assertPointNear(
    workspace.cursorPos,
    {x: 2880, y: 540},
    4,
    "external focus changes converge on the tiled window center"
);

workspace.activeWindow = leftB;
runShortcut("Meta+Ctrl+Alt+L");
assert.equal(
    workspace.activeWindow,
    rightA,
    "directional focus crosses the physical output boundary"
);
assert.deepEqual(
    dbusCalls.at(-1).slice(0, 4),
    [
        "Keirokit.KDE.CursorHelper",
        "/Keirokit/KDE/CursorHelper",
        "Keirokit.KDE.CursorHelper",
        "MoveCursorRelative"
    ],
    "keyboard focus uses cursor-helper relative feedback"
);
assertPointNear(
    workspace.cursorPos,
    {x: 2880, y: 540},
    4,
    "cursor converges on the focused window center"
);

runShortcut("Meta+Ctrl+Alt+H");
assert.equal(
    workspace.activeWindow,
    leftB,
    "directional focus crosses back from the right output to the left output"
);
assertPointNear(
    workspace.cursorPos,
    {x: 1437, y: 540},
    4,
    "reverse cross-output focus also converges on the center"
);

rightA.desktops = [desktops[5]];
rightB.desktops = [desktops[5]];
runShortcut("Meta+Ctrl+Alt+L");
assert.equal(
    workspace.activeWindow,
    null,
    "directional focus clears window focus on an empty adjacent output"
);
assertPointNear(
    workspace.cursorPos,
    {x: 2880, y: 540},
    4,
    "directional focus moves to the center of an empty adjacent output"
);
runShortcut("Meta+Ctrl+Alt+H");
assert.equal(
    workspace.activeWindow,
    leftB,
    "directional focus can return from an empty output to a tiled window"
);
assertPointNear(
    workspace.cursorPos,
    {x: 1437, y: 540},
    4,
    "returning from an empty output centers the cursor on the target tile"
);
rightA.desktops = [desktops[4]];
rightB.desktops = [desktops[4]];

currentDesktopByOutput.set(rightOutput, desktops[0]);
workspace.currentDesktopChanged.emit(desktops[4], desktops[0], rightOutput);
assert.equal(
    currentDesktopByOutput.get(rightOutput),
    desktops[4],
    "an output cannot show a desktop assigned to the other output"
);

runShortcut("Meta+Shift+F7");
assert.equal(
    currentDesktopByOutput.get(rightOutput),
    desktops[6],
    "desktop shortcut switches the mapped output"
);

workspace.activeWindow = leftA;
runShortcut("Meta+Ctrl+Shift+F6");
assert.equal(leftA.desktops[0], desktops[5], "window moves to requested desktop");
assert.equal(leftA.output, rightOutput, "window follows its desktop output mapping");
assert.equal(
    currentDesktopByOutput.get(rightOutput),
    desktops[5],
    "destination desktop is shown on the mapped output"
);
assert.equal(
    workspace.activeWindow,
    leftA,
    "focus follows the moved window to the destination desktop"
);
assertGeometry(
    leftB.frameGeometry,
    {x: 0, y: 0, width: 1920, height: 1080},
    "smart gaps remove outer gaps when one tiled window remains"
);

console.log("Keirokit KDE KWin harness: all assertions passed");
