"use strict";

const FLIP_SETTINGS_KEY = "motion-lab:flip-panels-settings:v1";
const FONT_DATABASE_NAME = "motion-lab-assets";
const FONT_STORE_NAME = "fonts";
const FONT_ASSET_KEY = "flip-panels-local-font";
const SETTLED_TEXT_COLOR = "#e0041d";
const MAX_LINES = 2;
const MAX_PER_LINE = 12;
const elements = {
  canvas: document.querySelector("#previewCanvas"), frontText: document.querySelector("#frontText"), backText: document.querySelector("#backText"), frontCount: document.querySelector("#frontCount"), backCount: document.querySelector("#backCount"), randomDummy: document.querySelector("#randomDummyButton"),
  panelGap: document.querySelector("#panelGap"), panelGapValue: document.querySelector("#panelGapValue"), cornerRadius: document.querySelector("#cornerRadius"), cornerRadiusValue: document.querySelector("#cornerRadiusValue"), fontFamily: document.querySelector("#fontFamily"), fontFile: document.querySelector("#fontFile"), fontFileName: document.querySelector("#fontFileName"), fontClear: document.querySelector("#fontClearButton"), panelColor: document.querySelector("#panelColor"), textColor: document.querySelector("#textColor"), settledColor: document.querySelector("#settledColor"), backgroundColor: document.querySelector("#backgroundColor"),
  duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"), minTurns: document.querySelector("#minTurns"), minTurnsValue: document.querySelector("#minTurnsValue"), maxTurns: document.querySelector("#maxTurns"), maxTurnsValue: document.querySelector("#maxTurnsValue"), timingMode: document.querySelector("#timingMode"), autoTimingControls: document.querySelector("#autoTimingControls"), settleSpan: document.querySelector("#settleSpan"), settleSpanValue: document.querySelector("#settleSpanValue"), settleOrder: document.querySelector("#settleOrder"), individualTiming: document.querySelector("#individualTiming"), panelTimingGrid: document.querySelector("#panelTimingGrid"), selectedPanelLabel: document.querySelector("#selectedPanelLabel"), panelSettleTime: document.querySelector("#panelSettleTime"), panelSettleTimeValue: document.querySelector("#panelSettleTimeValue"), panelSettleTimeNumber: document.querySelector("#panelSettleTimeNumber"), copyAutomatic: document.querySelector("#copyAutomaticButton"), evenTiming: document.querySelector("#evenTimingButton"), randomTiming: document.querySelector("#randomTimingButton"), randomDirection: document.querySelector("#randomDirection"), shuffle: document.querySelector("#shuffleButton"), stageStatus: document.querySelector("#stageStatus"), previewSpeed: document.querySelector("#previewSpeed"), imageTime: document.querySelector("#imageTime"), outputSize: document.querySelector("#outputSize"), stageDimensions: document.querySelector("#stageDimensions"),
};
const context = elements.canvas.getContext("2d");
const state = { seed: Date.now(), frontLines: [], backLines: [], panels: [], columns: 1, rows: 1, customTimes: [], selectedPanel: 0, localFontFamily: "", localFontName: "" };
let player = null;

function sanitizeLines(value) {
  const rawLines = String(value).replace(/\r/g, "").split("\n").slice(0, MAX_LINES);
  return rawLines.map((line) => MotionToolkit.graphemes(line).slice(0, MAX_PER_LINE));
}

function normalizedText(value) {
  return sanitizeLines(value).map((line) => line.join("")).join("\n");
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
    const request = database.transaction(FONT_STORE_NAME, "readonly").objectStore(FONT_STORE_NAME).get(FONT_ASSET_KEY);
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
    // The tool still works when the stored font cannot be removed.
  }
}

function saveSettings() {
  MotionStorage.write(FLIP_SETTINGS_KEY, {
    frontText: elements.frontText.value, backText: elements.backText.value, seed: state.seed,
    panelGap: elements.panelGap.value, cornerRadius: elements.cornerRadius.value, fontFamily: elements.fontFamily.value,
    panelColor: elements.panelColor.value, textColor: elements.textColor.value, settledColor: elements.settledColor.value,
    backgroundColor: elements.backgroundColor.value, duration: elements.duration.value,
    minTurns: elements.minTurns.value, maxTurns: elements.maxTurns.value, timingMode: elements.timingMode.value,
    settleSpan: elements.settleSpan.value, settleOrder: elements.settleOrder.value,
    customTimes: state.customTimes, selectedPanel: state.selectedPanel,
    randomDirection: elements.randomDirection.checked, localFontName: state.localFontName,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(FLIP_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (typeof settings.frontText === "string") elements.frontText.value = normalizedText(settings.frontText);
  if (typeof settings.backText === "string") elements.backText.value = normalizedText(settings.backText);
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  ["panelGap", "cornerRadius", "fontFamily", "backgroundColor", "duration", "minTurns", "maxTurns", "timingMode", "settleSpan", "settleOrder", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  MotionStorage.restoreControl(elements.panelColor, settings.panelColor ?? settings.frontPanelColor);
  MotionStorage.restoreControl(elements.textColor, settings.textColor ?? settings.frontTextColor);
  MotionStorage.restoreControl(elements.settledColor, settings.settledColor ?? settings.backPanelColor);
  if (typeof settings.randomDirection === "boolean") elements.randomDirection.checked = settings.randomDirection;
  if (Array.isArray(settings.customTimes)) state.customTimes = settings.customTimes.map(Number);
  if (Number.isInteger(Number(settings.selectedPanel))) state.selectedPanel = Number(settings.selectedPanel);
  return settings;
}

function rebuildPanels() {
  state.frontLines = sanitizeLines(elements.frontText.value);
  state.backLines = sanitizeLines(elements.backText.value);
  state.rows = Math.max(1, state.frontLines.length, state.backLines.length);
  state.columns = Math.max(1, ...state.frontLines.map((line) => line.length), ...state.backLines.map((line) => line.length));
  const count = state.rows * state.columns;
  const random = MotionToolkit.seededRandom(state.seed);
  const randomRanks = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [randomRanks[index], randomRanks[swap]] = [randomRanks[swap], randomRanks[index]];
  }
  const minTurns = Math.min(Number(elements.minTurns.value), Number(elements.maxTurns.value));
  const maxTurns = Math.max(Number(elements.minTurns.value), Number(elements.maxTurns.value));
  state.panels = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / state.columns);
    const column = index % state.columns;
    return {
      index, row, column,
      front: state.frontLines[row]?.[column] || "",
      back: state.backLines[row]?.[column] || "",
      turns: MotionToolkit.lerp(minTurns, maxTurns, random()),
      direction: elements.randomDirection.checked && random() < 0.5 ? -1 : 1,
      randomRank: randomRanks.indexOf(index),
    };
  });
  const duration = Number(elements.duration.value);
  state.customTimes = state.panels.map((panel, index) => {
    const saved = Number(state.customTimes[index]);
    if (Number.isFinite(saved)) return MotionToolkit.clamp(saved, 0, duration);
    return Math.round(automaticStopAt(panel) * duration * 10) / 10;
  });
  state.selectedPanel = MotionToolkit.clamp(state.selectedPanel, 0, Math.max(0, state.panels.length - 1));
  renderTimingGrid();
  syncTimingEditor();
  updateLabels();
  player?.update();
}

function rankFor(panel) {
  if (elements.settleOrder.value === "simultaneous") return 0;
  if (elements.settleOrder.value === "random") return panel.randomRank;
  if (elements.settleOrder.value === "center") {
    const dx = panel.column - (state.columns - 1) / 2;
    const dy = panel.row - (state.rows - 1) / 2;
    return Math.round(Math.hypot(dx, dy) * 10);
  }
  return panel.index;
}

function automaticStopAt(panel) {
  if (elements.settleOrder.value === "simultaneous") return 1;
  const maxRank = Math.max(1, ...state.panels.map(rankFor));
  const stopRange = Number(elements.settleSpan.value) / 100;
  return MotionToolkit.lerp(Math.max(0.12, 1 - stopRange), 1, rankFor(panel) / maxRank);
}

function panelProgress(panel, progress) {
  const stopAt = panelStopAt(panel);
  if (stopAt <= 0) return 1;
  return MotionToolkit.clamp(progress / stopAt, 0, 1);
}

function panelStopAt(panel) {
  if (elements.timingMode.value === "individual") {
    const settleSeconds = Number(state.customTimes[panel.index]);
    if (!Number.isFinite(settleSeconds)) return 1;
    const duration = Math.max(0.001, Number(elements.duration.value));
    return MotionToolkit.clamp(settleSeconds / duration, 0, 1);
  }
  return automaticStopAt(panel);
}

function selectedPanelDescription(panel) {
  if (!panel) return "パネルなし";
  const character = panel.front || "空白";
  return `${panel.index + 1}番 · ${panel.row + 1}行${panel.column + 1}列 · ${character}`;
}

function renderTimingGrid() {
  elements.panelTimingGrid.replaceChildren();
  state.panels.forEach((panel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.panelIndex = String(panel.index);
    button.classList.toggle("is-active", panel.index === state.selectedPanel);
    button.setAttribute("aria-pressed", String(panel.index === state.selectedPanel));
    button.title = selectedPanelDescription(panel);
    const character = document.createElement("span");
    character.textContent = panel.front || "·";
    const time = document.createElement("small");
    time.textContent = `${Number(state.customTimes[panel.index] || 0).toFixed(1)}s`;
    button.append(character, time);
    button.addEventListener("click", () => {
      state.selectedPanel = panel.index;
      syncTimingEditor();
      saveSettings();
    });
    elements.panelTimingGrid.append(button);
  });
}

function syncTimingEditor() {
  const isIndividual = elements.timingMode.value === "individual";
  elements.autoTimingControls.hidden = isIndividual;
  elements.individualTiming.hidden = !isIndividual;
  const duration = Number(elements.duration.value);
  elements.panelSettleTime.max = String(duration);
  elements.panelSettleTimeNumber.max = String(duration);
  const panel = state.panels[state.selectedPanel];
  const value = panel ? MotionToolkit.clamp(Number(state.customTimes[panel.index]) || 0, 0, duration) : 0;
  elements.selectedPanelLabel.value = selectedPanelDescription(panel);
  elements.panelSettleTime.value = String(value);
  elements.panelSettleTimeNumber.value = value.toFixed(1);
  elements.panelSettleTimeValue.value = `${value.toFixed(1)} 秒`;
  elements.panelSettleTime.disabled = !panel;
  elements.panelSettleTimeNumber.disabled = !panel;
  [...elements.panelTimingGrid.children].forEach((button) => {
    const active = Number(button.dataset.panelIndex) === state.selectedPanel;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setSelectedPanelTime(value) {
  const panel = state.panels[state.selectedPanel];
  if (!panel || value === "") return;
  const seconds = Math.round(MotionToolkit.clamp(Number(value) || 0, 0, Number(elements.duration.value)) * 10) / 10;
  state.customTimes[panel.index] = seconds;
  renderTimingGrid();
  syncTimingEditor();
  player.reset();
  saveSettings();
  render();
}

function applyTimingPreset(mode) {
  const duration = Number(elements.duration.value);
  const random = MotionToolkit.seededRandom(Date.now());
  state.customTimes = state.panels.map((panel, index) => {
    if (mode === "automatic") return Math.round(automaticStopAt(panel) * duration * 10) / 10;
    if (mode === "random") return Math.round(random() * duration * 10) / 10;
    const amount = state.panels.length <= 1 ? 1 : index / (state.panels.length - 1);
    return Math.round(MotionToolkit.lerp(Math.min(0.1, duration), duration, amount) * 10) / 10;
  });
  renderTimingGrid();
  syncTimingEditor();
  player.reset();
  saveSettings();
  render();
}

function panelAngle(panel, progress) {
  const remaining = Math.max(0, panelStopAt(panel) - progress);
  return panel.direction * panel.turns * Math.PI * 2 * remaining;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
}

function fontStack() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontFamily.value === "serif") return '"Yu Mincho", "Noto Serif JP", serif';
  if (elements.fontFamily.value === "mono") return 'Consolas, "Noto Sans Mono", monospace';
  return 'Inter, "Yu Gothic", "Noto Sans JP", sans-serif';
}

function updateLocalFontUI() {
  elements.fontFileName.textContent = state.localFontName || "端末内のフォント";
  elements.fontClear.hidden = !state.localFontName;
}

async function applyLocalFont(buffer, name) {
  const family = `FlipPanelsLocal${Date.now()}`;
  const font = new FontFace(family, buffer);
  await font.load();
  document.fonts.add(font);
  state.localFontFamily = family;
  state.localFontName = name;
  updateLocalFontUI();
  saveSettings();
  render();
}

async function loadLocalFont(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) {
    player.showToast("30MB以下のフォントを選択してください");
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    await applyLocalFont(buffer, file.name);
    await writeFontAsset({ buffer, name: file.name });
    player.showToast(`${file.name}を適用しました`);
  } catch {
    player.showToast("フォントを読み込めませんでした");
  }
}

async function clearLocalFont(removeStored = true, announce = false) {
  state.localFontFamily = "";
  state.localFontName = "";
  updateLocalFontUI();
  if (removeStored) await deleteFontAsset();
  saveSettings();
  render();
  if (announce) player.showToast("ローカルフォントを解除しました");
}

async function restoreLocalFont(settings) {
  if (!settings?.localFontName) {
    updateLocalFontUI();
    return;
  }
  try {
    const asset = await readFontAsset();
    if (!asset?.buffer) throw new Error("Stored font was not found");
    await applyLocalFont(asset.buffer, asset.name || settings.localFontName);
  } catch {
    await clearLocalFont(false);
  }
}

function render(progress = player?.state.playhead || 0) {
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value; context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  const outerX = 86; const outerY = 112;
  const availableWidth = elements.canvas.width - outerX * 2;
  const availableHeight = elements.canvas.height - outerY * 2;
  const gap = Number(elements.panelGap.value);
  const panelWidth = Math.min(150, (availableWidth - gap * Math.max(0, state.columns - 1)) / state.columns);
  const panelHeight = Math.min(220, (availableHeight - gap * Math.max(0, state.rows - 1)) / state.rows * 0.84);
  const gridWidth = panelWidth * state.columns + gap * Math.max(0, state.columns - 1);
  const gridHeight = panelHeight * state.rows + gap * Math.max(0, state.rows - 1);
  const startX = (elements.canvas.width - gridWidth) / 2;
  const startY = (elements.canvas.height - gridHeight) / 2;
  state.panels.forEach((panel) => {
    const settled = panelProgress(panel, progress) >= 0.999;
    const angle = panelAngle(panel, progress);
    const cosine = Math.cos(angle);
    const widthScale = Math.max(0.035, Math.abs(cosine));
    const front = cosine >= 0;
    const x = startX + panel.column * (panelWidth + gap);
    const y = startY + panel.row * (panelHeight + gap);
    const centerX = x + panelWidth / 2;
    const visibleWidth = panelWidth * widthScale;
    const faceX = centerX - visibleWidth / 2;
    const radius = Number(elements.cornerRadius.value) * widthScale;
    const character = front ? panel.front : panel.back;
    context.save();
    const shadowAlpha = 0.12 + 0.16 * widthScale;
    context.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
    context.shadowBlur = 6 + 10 * widthScale;
    context.shadowOffsetX = 0; context.shadowOffsetY = 3 + 3 * widthScale;
    roundRect(context, faceX, y, visibleWidth, panelHeight, radius);
    context.fillStyle = elements.panelColor.value;
    context.fill(); context.shadowColor = "transparent";
    context.strokeStyle = settled ? elements.settledColor.value : "rgba(12,24,30,.48)";
    context.lineWidth = 6;
    context.stroke();
    context.save(); context.beginPath(); context.rect(faceX, y, visibleWidth, panelHeight); context.clip();
    context.translate(centerX, y + panelHeight / 2); context.scale(widthScale, 1);
    const fontSize = Math.min(panelWidth * 0.57, panelHeight * 0.47, 74);
    context.font = `800 ${fontSize}px ${fontStack()}`;
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillStyle = settled ? SETTLED_TEXT_COLOR : elements.textColor.value;
    context.fillText(character, 0, 2); context.restore();
    context.fillStyle = "rgba(255,255,255,.10)";
    context.fillRect(faceX, y, Math.max(1, visibleWidth * 0.5), panelHeight);
    context.restore();
  });
  context.restore();
}

function updateLabels(progress = player?.state.playhead || 0) {
  elements.frontCount.value = `${state.frontLines.flat().length} / 24`;
  elements.backCount.value = `${state.backLines.flat().length} / 24`;
  elements.panelGapValue.value = `${elements.panelGap.value} px`;
  elements.cornerRadiusValue.value = `${elements.cornerRadius.value} px`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.minTurnsValue.value = `${elements.minTurns.value} 回`;
  elements.maxTurnsValue.value = `${elements.maxTurns.value} 回`;
  elements.settleSpanValue.value = `${elements.settleSpan.value}%`;
  document.querySelectorAll('.color-control input[type="color"]').forEach((input) => { input.nextElementSibling.value = input.value.toUpperCase(); });
  const fixed = state.panels.filter((panel) => panelProgress(panel, progress) >= 0.999).length;
  elements.stageStatus.textContent = `${fixed} / ${state.panels.length}パネル 確定`;
  [...elements.panelTimingGrid.children].forEach((button) => {
    const panel = state.panels[Number(button.dataset.panelIndex)];
    const settled = panel ? panelProgress(panel, progress) >= 0.999 : false;
    button.classList.toggle("is-settled", settled);
    button.style.setProperty("--settled-color", elements.settledColor.value);
  });
}

function resizeOutputCanvas() {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas, getDuration: () => elements.duration.value,
  isReady: () => state.panels.length, render, onUpdate: updateLabels,
  onControlChange: saveSettings, getFileBase: () => "flip-panels",
});

function updateTextInput(input) {
  const cursor = input.selectionStart;
  const sanitized = normalizedText(input.value);
  if (input.value !== sanitized) {
    input.value = sanitized;
    input.setSelectionRange(Math.min(cursor, sanitized.length), Math.min(cursor, sanitized.length));
  }
  rebuildPanels(); player.reset(); saveSettings(); render();
}

elements.frontText.addEventListener("input", () => updateTextInput(elements.frontText));
elements.backText.addEventListener("input", () => updateTextInput(elements.backText));
elements.randomDummy.addEventListener("click", () => {
  const chars = MotionToolkit.graphemes("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789アイウエオカキクケコ");
  const random = MotionToolkit.seededRandom(Date.now());
  elements.backText.value = state.frontLines.map((line) => line.map(() => chars[Math.floor(random() * chars.length)]).join("")).join("\n");
  updateTextInput(elements.backText); player.showToast("裏面のダミー文字を生成しました");
});
[elements.panelGap, elements.cornerRadius, elements.duration, elements.minTurns, elements.maxTurns, elements.settleSpan].forEach((control) => control.addEventListener("input", () => {
  if (control === elements.minTurns || control === elements.maxTurns) { state.seed = Date.now(); rebuildPanels(); }
  if (control === elements.duration) {
    const duration = Number(elements.duration.value);
    state.customTimes = state.customTimes.map((time) => MotionToolkit.clamp(Number(time) || 0, 0, duration));
    renderTimingGrid();
    syncTimingEditor();
  }
  player.reset(); updateLabels(); saveSettings(); render();
}));
elements.settleOrder.addEventListener("change", () => { player.reset(); saveSettings(); render(); });
elements.fontFamily.addEventListener("change", async () => {
  if (state.localFontName) await clearLocalFont(true);
  else { saveSettings(); render(); }
});
elements.fontFile.addEventListener("change", async () => {
  await loadLocalFont(elements.fontFile.files[0]);
  elements.fontFile.value = "";
});
elements.fontClear.addEventListener("click", () => clearLocalFont(true, true));
elements.timingMode.addEventListener("change", () => { syncTimingEditor(); player.reset(); saveSettings(); render(); });
elements.panelSettleTime.addEventListener("input", () => setSelectedPanelTime(elements.panelSettleTime.value));
elements.panelSettleTimeNumber.addEventListener("change", () => setSelectedPanelTime(elements.panelSettleTimeNumber.value));
elements.copyAutomatic.addEventListener("click", () => { applyTimingPreset("automatic"); player.showToast("自動の確定時刻を個別設定へ反映しました"); });
elements.evenTiming.addEventListener("click", () => { applyTimingPreset("even"); player.showToast("確定時刻を均等に配置しました"); });
elements.randomTiming.addEventListener("click", () => { applyTimingPreset("random"); player.showToast("確定時刻をランダムに配置しました"); });
elements.randomDirection.addEventListener("change", () => { state.seed = Date.now(); rebuildPanels(); player.reset(); saveSettings(); render(); });
elements.outputSize.addEventListener("change", () => { resizeOutputCanvas(); player.reset(); saveSettings(); render(); });
document.querySelectorAll('.color-control input[type="color"]').forEach((input) => input.addEventListener("input", () => { updateLabels(); saveSettings(); render(); }));
elements.shuffle.addEventListener("click", () => { state.seed = Date.now(); rebuildPanels(); player.reset(); saveSettings(); render(); player.showToast("回転数・向き・確定順を再抽選しました"); });

(async function init() {
  const restoredSettings = restoreSettings();
  resizeOutputCanvas();
  elements.frontText.value = normalizedText(elements.frontText.value);
  elements.backText.value = normalizedText(elements.backText.value);
  rebuildPanels(); updateLabels(); render();
  await restoreLocalFont(restoredSettings);
})();
