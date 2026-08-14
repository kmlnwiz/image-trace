"use strict";

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 1000;
const MAX_COLUMNS = 12;
const MAX_ROWS = 40;
const DEFAULT_COLUMN_TEXTS = ["あいうえお", "かきくけこ", "さしすせそ", "たちつてと"];
const REEL_SETTINGS_KEY = "motion-lab:text-reel-settings:v1";
const FONT_DATABASE_NAME = "motion-lab-assets";
const FONT_STORE_NAME = "fonts";
const FONT_ASSET_KEY = "text-reel-local-font";

const elements = {
  canvas: document.querySelector("#reelCanvas"),
  columnCount: document.querySelector("#columnCount"),
  columnOptions: document.querySelector("#columnOptions"),
  addColumnButton: document.querySelector("#addColumnButton"),
  randomizeButton: document.querySelector("#randomizeButton"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  durationMeta: document.querySelector("#durationMeta"),
  fontStyle: document.querySelector("#fontStyle"),
  fontFile: document.querySelector("#fontFile"),
  fontFileName: document.querySelector("#fontFileName"),
  textColor: document.querySelector("#textColor"),
  reelColor: document.querySelector("#reelColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  colorControls: [...document.querySelectorAll('.color-control input[type="color"]')],
  stageStatus: document.querySelector("#stageStatus"),
  restartButton: document.querySelector("#restartButton"),
  playButton: document.querySelector("#playButton"),
  timeline: document.querySelector("#timeline"),
  currentTime: document.querySelector("#currentTime"),
  totalTime: document.querySelector("#totalTime"),
  previewSpeed: document.querySelector("#previewSpeed"),
  imageTime: document.querySelector("#imageTime"),
  imageTimeValue: document.querySelector("#imageTimeValue"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
  imageExportButton: document.querySelector("#imageExportButton"),
  exportButton: document.querySelector("#exportButton"),
  exportButtonLabel: document.querySelector("#exportButtonLabel"),
  exportProgress: document.querySelector("#exportProgress"),
  exportProgressBar: document.querySelector("#exportProgressBar"),
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d");
const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ja", { granularity: "grapheme" })
  : null;

const state = {
  columns: [],
  settleColumns: [],
  targetRows: [],
  startRows: [],
  columnDirections: [],
  columnSpeeds: [],
  stopTimes: [],
  stopMotions: [],
  randomDirections: [],
  playhead: 0,
  isPlaying: false,
  isExporting: false,
  startedAt: 0,
  pausedAt: 0,
  rafId: 0,
  toastTimer: 0,
  localFontFamily: "",
  localFontName: "",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function splitReelCharacters(value) {
  const characters = segmenter
    ? [...segmenter.segment(value)].map((part) => part.segment)
    : Array.from(value);
  return characters.filter((character) => character !== "\n" && character !== "\r").slice(0, MAX_ROWS);
}

function columnsFromLegacyGrid(value) {
  if (typeof value !== "string") return [];
  const rows = value.replace(/\r/g, "").split("\n").slice(0, MAX_ROWS)
    .map((line) => {
      const characters = segmenter
        ? [...segmenter.segment(line)].map((part) => part.segment)
        : Array.from(line);
      return characters.slice(0, MAX_COLUMNS);
    });
  while (rows.length && rows.at(-1).length === 0) rows.pop();
  const count = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return Array.from({ length: count }, (_, columnIndex) => (
    rows.map((row) => row[columnIndex] ?? "　")
  ));
}

function randomDirection() {
  return Math.random() < 0.5 ? -1 : 1;
}

function randomStart(rowCount) {
  return rowCount ? Math.floor(Math.random() * rowCount) : 0;
}

function directionForIndex(index) {
  const direction = state.columnDirections[index] || "up";
  if (direction === "down") return -1;
  if (direction === "random") return state.randomDirections[index] || 1;
  return 1;
}

function rebuildColumns(nextColumns, preserve = true) {
  const previousColumns = state.columns;
  const previousSettle = state.settleColumns;
  const previousTargets = state.targetRows;
  const previousStarts = state.startRows;
  const previousColumnDirections = state.columnDirections;
  const previousColumnSpeeds = state.columnSpeeds;
  const previousStopTimes = state.stopTimes;
  const previousStopMotions = state.stopMotions;
  const previousRandomDirections = state.randomDirections;
  const duration = Number(elements.duration.value);
  const sourceColumns = Array.isArray(nextColumns) && nextColumns.length
    ? nextColumns
    : DEFAULT_COLUMN_TEXTS;
  state.columns = sourceColumns.slice(0, MAX_COLUMNS).map((column) => {
    const characters = Array.isArray(column)
      ? splitReelCharacters(column.join(""))
      : splitReelCharacters(String(column ?? ""));
    return characters.length ? characters : ["　"];
  });
  state.settleColumns = state.columns.map((_, index) => (
    preserve && previousColumns[index] ? previousSettle[index] !== false : true
  ));
  state.targetRows = state.columns.map((column, index) => {
    const saved = preserve && previousColumns[index] ? Number(previousTargets[index]) : 0;
    return clamp(Number.isFinite(saved) ? Math.round(saved) : 0, 0, Math.max(0, column.length - 1));
  });
  state.startRows = state.columns.map((column, index) => {
    if (preserve && previousColumns[index] && Number.isFinite(previousStarts[index])) {
      return modulo(Math.round(previousStarts[index]), Math.max(1, column.length));
    }
    return randomStart(column.length);
  });
  state.columnDirections = state.columns.map((_, index) => (
    preserve && ["up", "down", "random"].includes(previousColumnDirections[index])
      ? previousColumnDirections[index]
      : "up"
  ));
  state.columnSpeeds = state.columns.map((_, index) => {
    const saved = preserve ? Number(previousColumnSpeeds[index]) : NaN;
    return Number.isFinite(saved) ? clamp(saved, 0.5, 15) : Math.min(15, 4.4 + index * 0.8);
  });
  state.stopTimes = state.columns.map((_, index) => {
    const saved = preserve ? Number(previousStopTimes[index]) : NaN;
    return Number.isFinite(saved)
      ? clamp(saved, 0.1, duration)
      : Math.min(duration, 4 + index * 0.7);
  });
  state.stopMotions = state.columns.map((_, index) => (
    preserve && ["instant", "smooth", "bounce"].includes(previousStopMotions[index])
      ? previousStopMotions[index]
      : "smooth"
  ));
  state.randomDirections = state.columns.map((_, index) => (
    preserve && (previousRandomDirections[index] === 1 || previousRandomDirections[index] === -1)
      ? previousRandomDirections[index]
      : randomDirection()
  ));
  state.columns.forEach((_, index) => ensureStartReachable(index));
  rebuildColumnControls();
}

function createSelect(options, value, ariaLabel) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", ariaLabel);
  options.forEach(([optionValue, label]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    option.selected = optionValue === String(value);
    select.append(option);
  });
  return select;
}

function createSetting(labelText, control) {
  const label = document.createElement("label");
  label.className = "column-setting";
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(text, control);
  return label;
}

function resetColumnPlayback() {
  state.playhead = 0;
  stopPlayback();
  saveSettings();
}

function rebuildColumnControls() {
  elements.columnOptions.replaceChildren();
  if (!state.columns.length) {
    const empty = document.createElement("p");
    empty.className = "field-help";
    empty.textContent = "文字列を入力すると列設定が表示されます。";
    elements.columnOptions.append(empty);
    return;
  }

  state.columns.forEach((column, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "reel-column-option";

    const head = document.createElement("div");
    head.className = "column-option-head";
    const number = document.createElement("span");
    number.className = "column-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const sequence = document.createElement("span");
    sequence.className = "column-sequence";
    sequence.textContent = column.map((character) => character.trim() ? character : "·").join("");

    const toggle = document.createElement("label");
    toggle.className = "stop-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.settleColumns[index];
    checkbox.setAttribute("aria-label", `${index + 1}列目を途中で停止`);
    const toggleText = document.createElement("span");
    toggleText.textContent = checkbox.checked ? "停止" : "ループ";
    toggle.append(checkbox, toggleText);
    const removeButton = document.createElement("button");
    removeButton.className = "column-remove";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.title = "この列を削除";
    removeButton.setAttribute("aria-label", `${index + 1}列目を削除`);
    removeButton.disabled = state.columns.length <= 1;
    head.append(number, sequence, toggle, removeButton);

    const settings = document.createElement("div");
    settings.className = "column-setting-grid";
    const reelInput = document.createElement("input");
    reelInput.className = "column-string-input";
    reelInput.type = "text";
    reelInput.value = column.join("");
    reelInput.autocomplete = "off";
    reelInput.spellcheck = false;
    reelInput.setAttribute("aria-label", `${index + 1}列目のリール文字列`);
    const reelSetting = createSetting("リール文字列", reelInput);
    reelSetting.classList.add("column-string-setting");
    const directionSelect = createSelect(
      [["up", "上へ"], ["random", "ランダム"], ["down", "下へ"]],
      state.columnDirections[index],
      `${index + 1}列目の回転方向`,
    );
    const speedControl = document.createElement("span");
    speedControl.className = "number-with-unit";
    const speedInput = document.createElement("input");
    speedInput.className = "column-speed";
    speedInput.type = "number";
    speedInput.min = "0.5";
    speedInput.max = "15";
    speedInput.step = "0.1";
    speedInput.value = Number(state.columnSpeeds[index]).toFixed(1);
    speedInput.setAttribute("aria-label", `${index + 1}列目の回転速度`);
    speedControl.append(speedInput, " コマ/秒");

    const targetOptions = column.map((character, rowIndex) => [
      String(rowIndex),
      `${rowIndex + 1}: ${character.trim() ? character : "空白"}`,
    ]);
    const targetSelect = createSelect(targetOptions, state.targetRows[index], `${index + 1}列目の確定文字`);
    targetSelect.className = "column-target";
    const timeControl = document.createElement("span");
    timeControl.className = "number-with-unit";
    const timeInput = document.createElement("input");
    timeInput.className = "column-stop-time";
    timeInput.type = "number";
    timeInput.min = "0.1";
    timeInput.max = String(elements.duration.value);
    timeInput.step = "0.1";
    timeInput.value = Number(state.stopTimes[index]).toFixed(1);
    timeInput.setAttribute("aria-label", `${index + 1}列目の確定時刻`);
    timeControl.append(timeInput, " 秒");
    const motionSelect = createSelect(
      [["instant", "即停止"], ["smooth", "なめらか"], ["bounce", "少し弾む"]],
      state.stopMotions[index],
      `${index + 1}列目の停止動作`,
    );
    motionSelect.className = "column-motion";

    settings.append(
      reelSetting,
      createSetting("方向", directionSelect),
      createSetting("速度", speedControl),
      createSetting("確定文字", targetSelect),
      createSetting("確定時刻", timeControl),
      createSetting("停止動作", motionSelect),
    );
    const autoTiming = document.createElement("p");
    autoTiming.className = "column-auto-timing";
    wrapper.append(head, settings, autoTiming);
    elements.columnOptions.append(wrapper);

    const stopControls = [targetSelect, timeInput, motionSelect];
    const updateDisabled = () => {
      stopControls.forEach((control) => {
        control.disabled = !state.settleColumns[index];
      });
      autoTiming.hidden = !state.settleColumns[index];
      toggleText.textContent = state.settleColumns[index] ? "停止" : "ループ";
    };
    const updateTimingText = () => {
      const plan = motionPlan(index);
      const directionText = state.columnDirections[index] === "random"
        ? `ランダム（${directionForIndex(index) > 0 ? "上" : "下"}）`
        : state.columnDirections[index] === "up" ? "上" : "下";
      autoTiming.textContent = `実方向 ${directionText} · 回転開始 ${plan.startTime.toFixed(2)}秒${plan.slowDuration ? ` · 減速 ${plan.slowDuration.toFixed(2)}秒` : ""}`;
    };
    updateDisabled();
    updateTimingText();

    reelInput.addEventListener("change", () => {
      const characters = splitReelCharacters(reelInput.value);
      if (!characters.length) {
        reelInput.value = state.columns[index].join("");
        showToast("リール文字列を1文字以上入力してください");
        return;
      }
      state.columns[index] = characters;
      state.targetRows[index] = clamp(state.targetRows[index] || 0, 0, characters.length - 1);
      state.startRows[index] = randomStart(characters.length);
      ensureStartReachable(index);
      rebuildColumnControls();
      resetColumnPlayback();
    });
    checkbox.addEventListener("change", () => {
      state.settleColumns[index] = checkbox.checked;
      ensureStartReachable(index);
      updateDisabled();
      updateTimingText();
      resetColumnPlayback();
    });
    directionSelect.addEventListener("change", () => {
      state.columnDirections[index] = directionSelect.value;
      if (directionSelect.value === "random") state.randomDirections[index] = randomDirection();
      ensureStartReachable(index);
      updateTimingText();
      resetColumnPlayback();
    });
    speedInput.addEventListener("change", () => {
      state.columnSpeeds[index] = clamp(Number(speedInput.value) || 0.5, 0.5, 15);
      speedInput.value = state.columnSpeeds[index].toFixed(1);
      ensureStartReachable(index);
      updateTimingText();
      resetColumnPlayback();
    });
    targetSelect.addEventListener("change", () => {
      state.targetRows[index] = Number(targetSelect.value);
      ensureStartReachable(index);
      updateTimingText();
      resetColumnPlayback();
    });
    timeInput.addEventListener("change", () => {
      state.stopTimes[index] = clamp(Number(timeInput.value) || 0.1, 0.1, Number(elements.duration.value));
      timeInput.value = state.stopTimes[index].toFixed(1);
      ensureStartReachable(index);
      updateTimingText();
      resetColumnPlayback();
    });
    motionSelect.addEventListener("change", () => {
      state.stopMotions[index] = motionSelect.value;
      ensureStartReachable(index);
      updateTimingText();
      resetColumnPlayback();
    });
    removeButton.addEventListener("click", () => removeColumn(index));
  });
}

function removeColumn(index) {
  if (state.columns.length <= 1) return;
  [
    state.columns,
    state.settleColumns,
    state.targetRows,
    state.startRows,
    state.columnDirections,
    state.columnSpeeds,
    state.stopTimes,
    state.stopMotions,
    state.randomDirections,
  ].forEach((values) => values.splice(index, 1));
  rebuildColumnControls();
  resetColumnPlayback();
  showToast(`${index + 1}列目を削除しました`);
}

function addColumn() {
  if (state.columns.length >= MAX_COLUMNS) {
    showToast(`列は最大${MAX_COLUMNS}列です`);
    return;
  }
  const index = state.columns.length;
  const characters = splitReelCharacters(DEFAULT_COLUMN_TEXTS[index] || "あいうえお");
  state.columns.push(characters);
  state.settleColumns.push(true);
  state.targetRows.push(0);
  state.startRows.push(randomStart(characters.length));
  state.columnDirections.push("up");
  state.columnSpeeds.push(Math.min(15, 4.4 + index * 0.8));
  state.stopTimes.push(Math.min(Number(elements.duration.value), 4 + index * 0.7));
  state.stopMotions.push("smooth");
  state.randomDirections.push(randomDirection());
  ensureStartReachable(index);
  rebuildColumnControls();
  resetColumnPlayback();
  showToast(`${index + 1}列目を追加しました`);
}

function syncTimingLimits() {
  const duration = clamp(Number(elements.duration.value), 1, 90);
  elements.duration.value = String(duration);
  state.stopTimes = state.stopTimes.map((time) => clamp(Number(time) || 0.1, 0.1, duration));
  elements.imageTime.max = String(duration);
  elements.imageTime.value = String(clamp(Number(elements.imageTime.value), 0, duration));
}

function orientedDistance(index, startRow = state.startRows[index]) {
  const rowCount = state.columns[index]?.length || 1;
  const target = clamp(state.targetRows[index] || 0, 0, rowCount - 1);
  return directionForIndex(index) > 0
    ? modulo(target - startRow, rowCount)
    : modulo(startRow - target, rowCount);
}

function stopMotionDurations(index) {
  const stopTime = clamp(Number(state.stopTimes[index]) || 0.1, 0.1, Number(elements.duration.value));
  if (state.stopMotions[index] === "bounce") {
    return {
      preferred: Math.min(1.45, stopTime),
      minimum: Math.min(0.85, stopTime),
    };
  }
  if (state.stopMotions[index] === "smooth") {
    return {
      preferred: Math.min(1.1, stopTime),
      minimum: Math.min(0.55, stopTime),
    };
  }
  return { preferred: 0, minimum: 0 };
}

function ensureStartReachable(index) {
  if (!state.settleColumns[index] || state.stopMotions[index] === "instant") return;
  const rowCount = state.columns[index]?.length || 1;
  const speed = Number(state.columnSpeeds[index] || 0.5);
  const stopTime = Number(state.stopTimes[index] || 0.1);
  const availableDistance = speed * stopTime;
  const durations = stopMotionDurations(index);
  const baseDistance = orientedDistance(index);
  const minimumDistance = availableDistance / 2;
  const maximumDistance = speed * (stopTime - durations.minimum / 2);
  const firstCycle = Math.max(0, Math.ceil((minimumDistance - baseDistance - 0.000001) / rowCount));
  const lastCycle = Math.floor((maximumDistance - baseDistance + 0.000001) / rowCount);
  if (firstCycle <= lastCycle) return;

  const target = clamp(state.targetRows[index] || 0, 0, rowCount - 1);
  const direction = directionForIndex(index);
  const distance = speed * (stopTime - durations.preferred / 2);
  state.startRows[index] = modulo(target - direction * distance, rowCount);
}

function motionPlan(index) {
  const rowCount = state.columns[index]?.length || 1;
  const speed = clamp(Number(state.columnSpeeds[index]) || 0.5, 0.5, 15);
  const stopTime = clamp(Number(state.stopTimes[index]) || 0.1, 0.1, Number(elements.duration.value));
  const baseDistance = orientedDistance(index);
  const motion = state.stopMotions[index] || "smooth";
  const availableDistance = speed * stopTime;
  if (motion === "instant") {
    const cycles = Math.max(0, Math.floor((availableDistance - baseDistance) / rowCount));
    return {
      speed,
      stopTime,
      totalDistance: baseDistance + cycles * rowCount,
      slowDistance: 0,
      slowDuration: 0,
      cruiseDistance: availableDistance,
      cruiseDuration: stopTime,
      startTime: 0,
      slowStart: stopTime,
      motion,
    };
  }

  const durations = stopMotionDurations(index);
  const desiredDistance = speed * (stopTime - durations.preferred / 2);
  const minimumDistance = availableDistance / 2;
  const maximumDistance = speed * (stopTime - durations.minimum / 2);
  const firstCycle = Math.max(0, Math.ceil((minimumDistance - baseDistance - 0.000001) / rowCount));
  const lastCycle = Math.max(firstCycle, Math.floor((maximumDistance - baseDistance + 0.000001) / rowCount));
  const idealCycle = Math.round((desiredDistance - baseDistance) / rowCount);
  const cycles = clamp(idealCycle, firstCycle, lastCycle);
  const totalDistance = baseDistance + cycles * rowCount;
  const slowDuration = clamp(2 * (stopTime - totalDistance / speed), 0, stopTime);
  const slowDistance = speed * slowDuration / 2;
  const cruiseDistance = Math.max(0, totalDistance - slowDistance);
  const cruiseDuration = cruiseDistance / speed;
  return {
    speed,
    stopTime,
    totalDistance,
    slowDistance,
    slowDuration,
    cruiseDistance,
    cruiseDuration,
    startTime: 0,
    slowStart: cruiseDuration,
    motion,
  };
}

function positionAt(index, time) {
  const column = state.columns[index];
  const direction = directionForIndex(index);
  const start = state.startRows[index] || 0;
  const speed = clamp(Number(state.columnSpeeds[index]) || 0.5, 0.5, 15);
  if (!state.settleColumns[index]) return start + direction * speed * time;

  const plan = motionPlan(index);
  if (time >= plan.stopTime) return start + direction * plan.totalDistance;
  if (plan.motion === "instant") return start + direction * speed * time;
  if (!plan.slowDuration || time <= plan.slowStart) {
    return start + direction * speed * time;
  }

  const progress = clamp((time - plan.slowStart) / plan.slowDuration, 0, 1);
  const eased = 2 * progress - progress * progress;
  const bounceOffset = plan.motion === "bounce"
    ? (plan.slowDistance * 0.13 + clamp(0.14 + plan.speed * 0.004, 0.15, 0.2))
      * Math.pow(Math.sin(Math.PI * progress), 2)
    : 0;
  const distance = plan.cruiseDistance + plan.slowDistance * eased + bounceOffset;
  return start + direction * distance;
}

function hasStopped(index, time) {
  return state.settleColumns[index]
    && time >= Number(state.stopTimes[index]);
}

function openFontDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(FONT_DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(FONT_STORE_NAME)) {
        request.result.createObjectStore(FONT_STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function writeFontAsset(asset) {
  const database = await openFontDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(FONT_STORE_NAME, "readwrite");
    transaction.objectStore(FONT_STORE_NAME).put(asset, FONT_ASSET_KEY);
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  database.close();
}

async function readFontAsset() {
  const database = await openFontDatabase();
  const asset = await new Promise((resolve, reject) => {
    const request = database.transaction(FONT_STORE_NAME, "readonly")
      .objectStore(FONT_STORE_NAME).get(FONT_ASSET_KEY);
    request.addEventListener("success", () => resolve(request.result || null));
    request.addEventListener("error", () => reject(request.error));
  });
  database.close();
  return asset;
}

async function deleteFontAsset() {
  try {
    const database = await openFontDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(FONT_STORE_NAME, "readwrite");
      transaction.objectStore(FONT_STORE_NAME).delete(FONT_ASSET_KEY);
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () => reject(transaction.error));
    });
    database.close();
  } catch {
    // The tool remains usable when browser storage is unavailable.
  }
}

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "MS Gothic", monospace';
  return '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
}

async function applyLocalFont(buffer, name) {
  const family = `TextReelLocal${Date.now()}`;
  const font = new FontFace(family, buffer);
  await font.load();
  document.fonts.add(font);
  state.localFontFamily = family;
  state.localFontName = name;
  elements.fontFileName.textContent = name;
  saveSettings();
  render();
}

async function loadLocalFont(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) {
    showToast("30MB以下のフォントを選択してください");
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    await applyLocalFont(buffer, file.name);
    await writeFontAsset({ buffer, name: file.name });
    showToast(`${file.name}を適用しました`);
  } catch {
    showToast("フォントを読み込めませんでした");
  }
}

async function restoreLocalFont(settings) {
  if (!settings?.localFontName) return;
  try {
    const asset = await readFontAsset();
    if (!asset?.buffer) throw new Error("Stored font was not found");
    await applyLocalFont(asset.buffer, asset.name || settings.localFontName);
  } catch {
    state.localFontFamily = "";
    state.localFontName = "";
    elements.fontFileName.textContent = "端末内のフォント";
    saveSettings();
  }
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawReel(x, y, width, height, rowHeight, index, time) {
  const reelColor = elements.reelColor.value;
  const textColor = elements.textColor.value;
  const settledColor = "#e0041d";
  const column = state.columns[index];
  const position = positionAt(index, time);
  const centerY = y + height / 2;

  context.save();
  context.shadowColor = "rgba(22, 31, 37, 0.16)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 11;
  context.fillStyle = reelColor;
  roundedRectPath(context, x, y, width, height, 10);
  context.fill();
  context.restore();

  context.save();
  roundedRectPath(context, x, y, width, height, 10);
  context.clip();
  context.fillStyle = reelColor;
  context.fillRect(x, y, width, height);

  context.fillStyle = "rgba(10, 134, 119, 0.055)";
  context.fillRect(x, centerY - rowHeight / 2, width, rowHeight);

  const centerRow = Math.round(position);
  const fontSize = Math.min(width * 0.76, rowHeight * 0.8, 132);
  context.font = `700 ${fontSize}px ${fontFamily()}`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let row = centerRow - 2; row <= centerRow + 2; row += 1) {
    const character = column[modulo(row, column.length)];
    const glyphY = centerY + (row - position) * rowHeight;
    const rowDistance = Math.abs(glyphY - centerY) / rowHeight;
    if (rowDistance > 1.52) continue;
    const opacity = clamp(1 - Math.max(0, rowDistance - 0.12) * 0.34, 0, 1);
    if (opacity <= 0.001) continue;
    context.fillStyle = hasStopped(index, time) && Math.abs(row - position) < 0.001
      ? hexToRgba(settledColor, opacity)
      : hexToRgba(textColor, opacity);
    context.fillText(character, x + width / 2, glyphY + 2);
  }

  context.strokeStyle = "rgba(37, 49, 56, 0.12)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, centerY - rowHeight / 2);
  context.lineTo(x + width, centerY - rowHeight / 2);
  context.moveTo(x, centerY + rowHeight / 2);
  context.lineTo(x + width, centerY + rowHeight / 2);
  context.stroke();

  const topFade = context.createLinearGradient(0, y, 0, y + height * 0.34);
  topFade.addColorStop(0, reelColor);
  topFade.addColorStop(1, hexToRgba(reelColor, 0));
  context.fillStyle = topFade;
  context.fillRect(x, y, width, height * 0.34);

  const bottomFade = context.createLinearGradient(0, y + height * 0.66, 0, y + height);
  bottomFade.addColorStop(0, hexToRgba(reelColor, 0));
  bottomFade.addColorStop(1, reelColor);
  context.fillStyle = bottomFade;
  context.fillRect(x, y + height * 0.66, width, height * 0.34);
  context.restore();

  context.strokeStyle = hasStopped(index, time)
    ? "rgba(88, 101, 108, 0.32)"
    : "rgba(8, 126, 112, 0.55)";
  context.lineWidth = hasStopped(index, time) ? 2 : 3;
  roundedRectPath(context, x, y, width, height, 10);
  context.stroke();
}

function render(playhead = state.playhead) {
  const outputWidth = elements.canvas.width;
  const outputHeight = elements.canvas.height;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, outputWidth, outputHeight);

  const count = state.columns.length;
  if (!count) {
    context.fillStyle = elements.textColor.value;
    context.globalAlpha = 0.35;
    context.font = `700 44px ${fontFamily()}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("リール文字列を入力", outputWidth / 2, outputHeight / 2);
    context.restore();
    return;
  }

  const sidePadding = count <= 4 ? 100 : 76;
  const desiredGap = count <= 6 ? 24 : 14;
  const maxWidth = count <= 4 ? 260 : count <= 7 ? 205 : 140;
  const reelWidth = clamp(
    (outputWidth - sidePadding * 2 - desiredGap * (count - 1)) / count,
    72,
    maxWidth,
  );
  const gap = count > 1
    ? Math.max(6, Math.min(desiredGap, (outputWidth - sidePadding * 2 - reelWidth * count) / (count - 1)))
    : 0;
  const totalWidth = reelWidth * count + gap * (count - 1);
  const startX = (outputWidth - totalWidth) / 2;
  const rowHeight = clamp(reelWidth * 0.82, 92, 152);
  const reelHeight = rowHeight * 3;
  const startY = (outputHeight - reelHeight) / 2;
  const time = playhead * Number(elements.duration.value);

  state.columns.forEach((_, index) => {
    drawReel(startX + index * (reelWidth + gap), startY, reelWidth, reelHeight, rowHeight, index, time);
  });

  context.save();
  context.strokeStyle = "#e0ad22";
  context.lineWidth = 8;
  roundedRectPath(
    context,
    startX - 14,
    startY + reelHeight / 2 - rowHeight / 2 - 11,
    totalWidth + 28,
    rowHeight + 22,
    13,
  );
  context.stroke();
  context.restore();
  context.restore();
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function updateUI() {
  syncTimingLimits();
  const duration = Number(elements.duration.value);
  const settledCount = state.settleColumns.filter(Boolean).length;
  elements.columnCount.value = `${state.columns.length} / ${MAX_COLUMNS}列`;
  elements.addColumnButton.disabled = state.columns.length >= MAX_COLUMNS;
  elements.durationValue.value = `${duration.toFixed(1)} 秒`;
  elements.durationMeta.value = `${duration.toFixed(1)} 秒`;
  elements.stageStatus.textContent = `${state.columns.length}列 · ${settledCount}列停止 · 列別速度`;
  elements.timeline.value = String(Math.round(state.playhead * 1000));
  elements.currentTime.value = formatTime(state.playhead * duration);
  elements.totalTime.value = formatTime(duration);
  elements.imageTime.max = String(duration);
  elements.imageTime.value = String(clamp(state.playhead * duration, 0, duration));
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function saveSettings() {
  MotionStorage.write(REEL_SETTINGS_KEY, {
    columns: state.columns.map((column) => column.join("")),
    settleColumns: state.settleColumns,
    targetRows: state.targetRows,
    startRows: state.startRows,
    columnDirections: state.columnDirections,
    columnSpeeds: state.columnSpeeds,
    stopTimes: state.stopTimes,
    stopMotions: state.stopMotions,
    randomDirections: state.randomDirections,
    duration: elements.duration.value,
    fontStyle: elements.fontStyle.value,
    localFontName: state.localFontName,
    textColor: elements.textColor.value,
    reelColor: elements.reelColor.value,
    backgroundColor: elements.backgroundColor.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(REEL_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;

  const controls = {
    duration: elements.duration,
    fontStyle: elements.fontStyle,
    textColor: elements.textColor,
    reelColor: elements.reelColor,
    backgroundColor: elements.backgroundColor,
    previewSpeed: elements.previewSpeed,
    outputSize: elements.outputSize,
  };
  Object.entries(controls).forEach(([name, control]) => MotionStorage.restoreControl(control, settings[name]));
  elements.colorControls.forEach((input) => {
    input.nextElementSibling.value = input.value.toUpperCase();
  });
  return settings;
}

function resizeOutputCanvas() {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
}

function randomizeMotion(showMessage = true) {
  state.startRows = state.columns.map((column) => randomStart(column.length));
  state.randomDirections = state.columns.map(() => randomDirection());
  state.columns.forEach((_, index) => ensureStartReachable(index));
  rebuildColumnControls();
  state.playhead = 0;
  stopPlayback();
  saveSettings();
  if (showMessage) showToast("列ごとの開始位置とランダム方向を更新しました");
}

function animate(timestamp) {
  if (!state.isPlaying) return;
  const durationMs = Number(elements.duration.value) * 1000;
  const previewSpeed = Number(elements.previewSpeed.value);
  state.playhead = clamp(state.pausedAt + (timestamp - state.startedAt) * previewSpeed / durationMs, 0, 1);
  render();
  updateUI();
  if (state.playhead >= 1) {
    stopPlayback(false);
    return;
  }
  state.rafId = requestAnimationFrame(animate);
}

function startPlayback() {
  if (state.isExporting || !state.columns.length) return;
  if (state.playhead >= 1) state.playhead = 0;
  state.isPlaying = true;
  state.pausedAt = state.playhead;
  state.startedAt = performance.now();
  elements.playButton.textContent = "Ⅱ";
  elements.playButton.setAttribute("aria-label", "一時停止");
  state.rafId = requestAnimationFrame(animate);
}

function stopPlayback(renderFrame = true) {
  state.isPlaying = false;
  cancelAnimationFrame(state.rafId);
  elements.playButton.textContent = "▶";
  elements.playButton.setAttribute("aria-label", "再生");
  updateUI();
  if (renderFrame) render();
}

async function exportVideo() {
  if (state.isExporting || !state.columns.length) return;
  state.isExporting = true;
  stopPlayback();
  elements.exportButton.disabled = true;
  elements.exportButtonLabel.textContent = "書き出し中";
  elements.exportProgress.hidden = false;
  elements.exportProgressBar.style.width = "0%";
  try {
    const blob = await MotionToolkit.renderWebm({
      canvas: elements.canvas,
      totalFrames: Math.round(Number(elements.duration.value) * 60),
      render(playhead) {
        state.playhead = playhead;
        render(playhead);
      },
      onProgress(progress) {
        elements.exportProgressBar.style.width = `${progress * 100}%`;
        updateUI();
      },
    });
    MotionToolkit.downloadBlob(blob, "text-reel.webm");
    showToast(`WebMを書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (error) {
    showToast(error?.message || "動画を書き出せませんでした");
  } finally {
    state.isExporting = false;
    elements.exportButton.disabled = false;
    elements.exportButtonLabel.textContent = "動画を書き出す";
    elements.exportProgress.hidden = true;
    updateUI();
  }
}

function exportImage() {
  if (!state.columns.length) return;
  stopPlayback(false);
  const duration = Number(elements.duration.value);
  const seconds = state.playhead * duration;
  render(state.playhead);
  updateUI();
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNGを作成できませんでした");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `text-reel-${seconds.toFixed(1)}s.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`${elements.imageTimeValue.value}のPNGを書き出しました`);
  }, "image/png");
}

elements.addColumnButton.addEventListener("click", addColumn);
elements.randomizeButton.addEventListener("click", () => randomizeMotion(true));

elements.duration.addEventListener("input", () => {
  syncTimingLimits();
  state.columns.forEach((_, index) => ensureStartReachable(index));
  state.playhead = 0;
  rebuildColumnControls();
  stopPlayback();
  saveSettings();
});

elements.fontStyle.addEventListener("change", () => {
  state.localFontFamily = "";
  state.localFontName = "";
  elements.fontFileName.textContent = "端末内のフォント";
  deleteFontAsset();
  saveSettings();
  render();
});

elements.fontFile.addEventListener("change", async () => {
  await loadLocalFont(elements.fontFile.files[0]);
  elements.fontFile.value = "";
});

elements.colorControls.forEach((input) => {
  input.addEventListener("input", () => {
    input.nextElementSibling.value = input.value.toUpperCase();
    saveSettings();
    render();
  });
});

elements.playButton.addEventListener("click", () => state.isPlaying ? stopPlayback() : startPlayback());
elements.restartButton.addEventListener("click", () => {
  state.playhead = 0;
  stopPlayback();
});
elements.timeline.addEventListener("input", () => {
  state.playhead = Number(elements.timeline.value) / 1000;
  stopPlayback();
});
elements.previewSpeed.addEventListener("change", () => {
  saveSettings();
  if (state.isPlaying) {
    stopPlayback();
    startPlayback();
  }
});
elements.imageTime.addEventListener("input", () => {
  const duration = Number(elements.duration.value);
  state.playhead = duration ? clamp(Number(elements.imageTime.value) / duration, 0, 1) : 0;
  stopPlayback();
  saveSettings();
});
elements.exportButton.addEventListener("click", exportVideo);
elements.imageExportButton.addEventListener("click", exportImage);
elements.outputSize.addEventListener("change", () => {
  resizeOutputCanvas();
  saveSettings();
  render();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    if (state.isPlaying) stopPlayback();
    else startPlayback();
  }
});

(async function init() {
  const restoredSettings = restoreSettings();
  resizeOutputCanvas();
  const storedColumns = Array.isArray(restoredSettings?.columns)
    ? restoredSettings.columns.map((column) => splitReelCharacters(String(column ?? "")))
      .filter((column) => column.length)
    : columnsFromLegacyGrid(restoredSettings?.grid);
  rebuildColumns(storedColumns.length ? storedColumns : DEFAULT_COLUMN_TEXTS, false);

  if (restoredSettings) {
    state.settleColumns = state.columns.map((_, index) => restoredSettings.settleColumns?.[index] !== false);
    state.targetRows = state.columns.map((column, index) => clamp(
      Number.isFinite(Number(restoredSettings.targetRows?.[index]))
        ? Math.round(Number(restoredSettings.targetRows[index]))
        : 0,
      0,
      Math.max(0, column.length - 1),
    ));
    state.startRows = state.columns.map((column, index) => (
      Number.isFinite(Number(restoredSettings.startRows?.[index]))
        ? modulo(Math.round(Number(restoredSettings.startRows[index])), Math.max(1, column.length))
        : randomStart(column.length)
    ));
    state.randomDirections = state.columns.map((_, index) => (
      restoredSettings.randomDirections?.[index] === -1 ? -1
        : restoredSettings.randomDirections?.[index] === 1 ? 1
          : randomDirection()
    ));
    state.columnDirections = state.columns.map((_, index) => (
      ["up", "down", "random"].includes(restoredSettings.columnDirections?.[index])
        ? restoredSettings.columnDirections[index]
        : ["up", "down", "random"].includes(restoredSettings.direction)
          ? restoredSettings.direction
          : "up"
    ));
    state.columnSpeeds = state.columns.map((_, index) => clamp(
      Number(restoredSettings.columnSpeeds?.[index] ?? restoredSettings.spinSpeed) || (4.4 + index * 0.8),
      0.5,
      15,
    ));
    state.stopTimes = state.columns.map((_, index) => clamp(
      Number(restoredSettings.stopTimes?.[index])
        || (Number(restoredSettings.stopStart) + index * Number(restoredSettings.stopStagger))
        || (4 + index * 0.7),
      0.1,
      Number(elements.duration.value),
    ));
    state.stopMotions = state.columns.map((_, index) => (
      ["instant", "smooth", "bounce"].includes(restoredSettings.stopMotions?.[index])
        ? restoredSettings.stopMotions[index]
        : "smooth"
    ));
    state.columns.forEach((_, index) => ensureStartReachable(index));
  }

  syncTimingLimits();
  if (restoredSettings) {
    MotionStorage.restoreControl(elements.imageTime, restoredSettings.imageTime);
  }
  rebuildColumnControls();
  updateUI();
  render();
  await restoreLocalFont(restoredSettings);
})();
