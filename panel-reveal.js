"use strict";

const PANEL_REVEAL_SETTINGS_KEY = "motion-lab:panel-reveal-settings:v2";
const FONT_ASSET_KEY = "panel-reveal-local-font";
const SETTLED_TEXT_COLOR = "#e0041d";

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  backMode: document.querySelector("#backMode"),
  typeLegend: document.querySelector("#typeLegend"),
  panelGap: document.querySelector("#panelGap"),
  panelGapValue: document.querySelector("#panelGapValue"),
  cornerRadius: document.querySelector("#cornerRadius"),
  cornerRadiusValue: document.querySelector("#cornerRadiusValue"),
  fontStyle: document.querySelector("#fontStyle"),
  fontFile: document.querySelector("#fontFile"),
  fontFileName: document.querySelector("#fontFileName"),
  fontClear: document.querySelector("#fontClearButton"),
  fontSize: document.querySelector("#fontSize"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  panelColor: document.querySelector("#panelColor"),
  textColor: document.querySelector("#textColor"),
  settledColor: document.querySelector("#settledColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  orderMode: document.querySelector("#orderMode"),
  orderHint: document.querySelector("#orderHint"),
  specifiedEditor: document.querySelector("#specifiedOrderEditor"),
  specifiedGrid: document.querySelector("#specifiedOrderGrid"),
  specifiedCount: document.querySelector("#specifiedCount"),
  sequenceOrder: document.querySelector("#sequenceOrderButton"),
  clearOrder: document.querySelector("#clearOrderButton"),
  shuffle: document.querySelector("#shuffleButton"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  flipDuration: document.querySelector("#flipDuration"),
  flipDurationValue: document.querySelector("#flipDurationValue"),
  settleSpan: document.querySelector("#settleSpan"),
  settleSpanValue: document.querySelector("#settleSpanValue"),
  easing: document.querySelector("#easing"),
  previewSpeed: document.querySelector("#previewSpeed"),
  imageTime: document.querySelector("#imageTime"),
  stageStatus: document.querySelector("#stageStatus"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
};

const context = elements.canvas.getContext("2d");
const state = {
  panels: [],
  blankPanels: [],
  lines: [],
  specifiedOrder: [],
  randomRanks: [],
  seed: Date.now(),
  localFontFamily: "",
  localFontName: "",
  lastFontStyle: elements.fontStyle.value,
};
let player = null;

const TYPE_INFO = Object.freeze({
  hiragana: { label: "あ", name: "ひらがな" },
  katakana: { label: "ア", name: "カタカナ" },
  kanji: { label: "漢", name: "漢字" },
  latin: { label: "A", name: "英字" },
  number: { label: "数", name: "数字" },
  symbol: { label: "記", name: "記号" },
});

const fontStore = MotionFonts.createFontStore(FONT_ASSET_KEY);

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "Noto Sans Mono CJK JP", Consolas, monospace';
  return '"Yu Gothic", "Hiragino Sans", "Noto Sans JP", sans-serif';
}

function updateFontUI() {
  elements.fontFileName.textContent = state.localFontName || "端末内のフォント";
  elements.fontClear.hidden = !state.localFontName;
}

async function applyLocalFont(buffer, name) {
  const family = await MotionFonts.registerFontFile(buffer, "PanelRevealLocal");
  state.localFontFamily = family;
  state.localFontName = name;
  updateFontUI();
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
    await fontStore.write({ buffer, name: file.name });
    player.showToast(`${file.name}を適用しました`);
  } catch {
    player.showToast("フォントを読み込めませんでした");
  }
}

async function restoreLocalFont(settings) {
  if (!settings?.localFontName) return;
  try {
    const asset = await fontStore.read();
    if (!asset?.buffer) throw new Error("Stored font was not found");
    await applyLocalFont(asset.buffer, asset.name || settings.localFontName);
  } catch {
    state.localFontFamily = "";
    state.localFontName = "";
    updateFontUI();
    saveSettings();
  }
}

async function clearLocalFont(showMessage = false) {
  state.localFontFamily = "";
  state.localFontName = "";
  updateFontUI();
  await fontStore.remove();
  saveSettings();
  render();
  if (showMessage) player.showToast("端末内フォントを解除しました");
}

function classifyCharacter(character) {
  if (/^[\u3040-\u309f]$/u.test(character)) return "hiragana";
  if (/^[\u30a0-\u30ff\u31f0-\u31ff]$/u.test(character)) return "katakana";
  if (/^\p{Script=Han}$/u.test(character)) return "kanji";
  if (/^[A-Za-z]$/u.test(character)) return "latin";
  if (/^\p{Number}$/u.test(character)) return "number";
  return "symbol";
}

function sanitizedText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .split(/\r?\n/)
    .slice(0, 2)
    .map((line) => MotionToolkit.graphemes(line).slice(0, 12).join(""))
    .join("\n");
}

function parseLines() {
  return sanitizedText(elements.textInput.value)
    .split("\n")
    .map((line) => MotionToolkit.graphemes(line));
}

function sanitizeTextInput() {
  const sanitized = sanitizedText(elements.textInput.value);
  if (elements.textInput.value !== sanitized) elements.textInput.value = sanitized;
}

function shuffleRanks(length) {
  const random = MotionToolkit.seededRandom(state.seed);
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  const ranks = Array(length);
  order.forEach((panelIndex, rank) => { ranks[panelIndex] = rank; });
  return ranks;
}

function rebuildPanels() {
  state.lines = parseLines();
  state.panels = [];
  state.blankPanels = [];
  state.lines.forEach((line, lineIndex) => {
    line.forEach((character, columnIndex) => {
      if (!character.trim()) {
        state.blankPanels.push({ lineIndex, columnIndex, character: "", fixed: true });
        return;
      }
      const index = state.panels.length;
      state.panels.push({ index, lineIndex, columnIndex, character, category: classifyCharacter(character) });
    });
  });
  state.specifiedOrder = state.specifiedOrder.filter((index, position, values) => index < state.panels.length && values.indexOf(index) === position);
  state.randomRanks = shuffleRanks(state.panels.length);
  rebuildSpecifiedGrid();
  updateLabels();
}

function saveSettings() {
  MotionStorage.write(PANEL_REVEAL_SETTINGS_KEY, {
    text: elements.textInput.value,
    backMode: elements.backMode.value,
    panelGap: elements.panelGap.value,
    cornerRadius: elements.cornerRadius.value,
    fontStyle: elements.fontStyle.value,
    localFontName: state.localFontName,
    fontSize: elements.fontSize.value,
    panelColor: elements.panelColor.value,
    textColor: elements.textColor.value,
    settledColor: elements.settledColor.value,
    backgroundColor: elements.backgroundColor.value,
    orderMode: elements.orderMode.value,
    specifiedOrder: state.specifiedOrder,
    seed: state.seed,
    duration: elements.duration.value,
    flipDuration: elements.flipDuration.value,
    settleSpan: elements.settleSpan.value,
    easing: elements.easing.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(PANEL_REVEAL_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.text === "string") elements.textInput.value = settings.text;
  ["backMode", "panelGap", "cornerRadius", "fontStyle", "fontSize", "panelColor", "textColor", "settledColor", "backgroundColor", "orderMode", "duration", "flipDuration", "settleSpan", "easing", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Array.isArray(settings.specifiedOrder)) state.specifiedOrder = settings.specifiedOrder.map(Number).filter(Number.isInteger);
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  state.lastFontStyle = elements.fontStyle.value;
  return settings;
}

function typeRanks() {
  const categories = [];
  state.panels.forEach((panel) => {
    if (!categories.includes(panel.category)) categories.push(panel.category);
  });
  return new Map(categories.map((category, index) => [category, index]));
}

function specifiedRanks() {
  const assigned = new Map(state.specifiedOrder.map((panelIndex, rank) => [panelIndex, rank]));
  let nextRank = state.specifiedOrder.length;
  state.panels.forEach((panel) => {
    if (!assigned.has(panel.index)) {
      assigned.set(panel.index, nextRank);
      nextRank += 1;
    }
  });
  return assigned;
}

function ranksForCurrentMode() {
  if (elements.orderMode.value === "type") {
    const ranks = typeRanks();
    return state.panels.map((panel) => ranks.get(panel.category));
  }
  if (elements.orderMode.value === "specified") {
    const ranks = specifiedRanks();
    return state.panels.map((panel) => ranks.get(panel.index));
  }
  return state.randomRanks;
}

function flipAmount(panel, progress) {
  const ranks = ranksForCurrentMode();
  const maxRank = Math.max(0, ...ranks);
  const total = Number(elements.duration.value);
  const flipTime = Math.min(Number(elements.flipDuration.value), total);
  const delayWindow = Math.max(0, total - flipTime) * Number(elements.settleSpan.value) / 100;
  const startTime = maxRank ? ranks[panel.index] / maxRank * delayWindow : 0;
  const local = MotionToolkit.clamp((progress * total - startTime) / Math.max(0.01, flipTime), 0, 1);
  return MotionToolkit.ease(local, elements.easing.value);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function panelLayout() {
  const rows = Math.max(1, state.lines.length);
  const maxColumns = Math.max(1, ...state.lines.map((line) => line.length));
  const gap = Number(elements.panelGap.value);
  const availableWidth = elements.canvas.width - 172;
  const availableHeight = elements.canvas.height - 224;
  const width = Math.min(150, (availableWidth - gap * (maxColumns - 1)) / maxColumns);
  const height = Math.min(165, width * 1.28, (availableHeight - gap * Math.max(0, rows - 1)) / rows * 0.84);
  const rowGap = gap;
  const blockHeight = rows * height + (rows - 1) * rowGap;
  const top = (elements.canvas.height - blockHeight) / 2;
  return { width, height, gap, rowGap, top };
}

function panelPosition(panel, layout) {
  return {
    x: 86 + panel.columnIndex * (layout.width + layout.gap) + layout.width / 2,
    y: layout.top + panel.lineIndex * (layout.height + layout.rowGap) + layout.height / 2,
  };
}

function backLabel(panel) {
  return elements.backMode.value === "type" ? TYPE_INFO[panel.category].label : "?";
}

function drawPanel(panel, layout, progress) {
  const amount = panel.fixed ? 1 : flipAmount(panel, progress);
  const angle = amount * Math.PI;
  const scaleX = Math.max(0.035, Math.abs(Math.cos(angle)));
  const isFront = amount >= 0.5;
  const settled = panel.fixed || amount >= 0.999;
  const position = panelPosition(panel, layout);
  const label = panel.fixed ? "" : (isFront ? panel.character : backLabel(panel));
  const requestedSize = Number(elements.fontSize.value);
  const drawSize = Math.min(requestedSize, layout.width * 0.57, layout.height * 0.47, 74);
  const visibleWidth = layout.width * scaleX;
  const faceX = -visibleWidth / 2;

  context.save();
  context.translate(position.x, position.y);
  const shadowAlpha = 0.12 + 0.16 * scaleX;
  context.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
  context.shadowBlur = 6 + 10 * scaleX;
  context.shadowOffsetY = 3 + 3 * scaleX;
  roundedRect(context, faceX, -layout.height / 2, visibleWidth, layout.height, Number(elements.cornerRadius.value) * scaleX);
  context.fillStyle = elements.panelColor.value;
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = 6;
  context.strokeStyle = settled ? elements.settledColor.value : "rgba(12,24,30,.48)";
  context.stroke();
  context.save();
  context.beginPath();
  context.rect(faceX, -layout.height / 2, visibleWidth, layout.height);
  context.clip();
  context.scale(scaleX, 1);
  context.fillStyle = settled ? SETTLED_TEXT_COLOR : elements.textColor.value;
  context.font = `800 ${drawSize}px ${fontFamily()}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 0, 2);
  context.restore();
  context.fillStyle = "rgba(255,255,255,.10)";
  context.fillRect(faceX, -layout.height / 2, Math.max(1, visibleWidth * 0.5), layout.height);
  context.restore();
}

function render(progress = player?.state.playhead || 0) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  if (!state.panels.length && !state.blankPanels.length) {
    context.fillStyle = "rgba(255,255,255,.7)";
    context.font = `700 54px ${fontFamily()}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("左の欄に文章を入力", elements.canvas.width / 2, elements.canvas.height / 2);
    context.restore();
    return;
  }
  const layout = panelLayout();
  state.blankPanels.forEach((panel) => drawPanel(panel, layout, progress));
  state.panels.forEach((panel) => drawPanel(panel, layout, progress));
  context.restore();
}

function rebuildSpecifiedGrid() {
  elements.specifiedGrid.replaceChildren();
  state.panels.forEach((panel) => {
    const button = document.createElement("button");
    button.type = "button";
    const rank = state.specifiedOrder.indexOf(panel.index);
    button.classList.toggle("is-assigned", rank >= 0);
    button.setAttribute("aria-label", `${panel.index + 1}番目の${panel.character.trim() || "空白"}を復帰順に指定`);
    const character = document.createElement("span");
    character.textContent = panel.character.trim() || "␠";
    const order = document.createElement("small");
    order.textContent = rank >= 0 ? `${rank + 1}番` : `${panel.index + 1}`;
    button.append(character, order);
    button.addEventListener("click", () => {
      const currentRank = state.specifiedOrder.indexOf(panel.index);
      if (currentRank >= 0) state.specifiedOrder.splice(currentRank, 1);
      else state.specifiedOrder.push(panel.index);
      rebuildSpecifiedGrid();
      resetAndRender();
    });
    elements.specifiedGrid.append(button);
  });
  elements.specifiedCount.value = `${state.specifiedOrder.length} / ${state.panels.length}`;
}

function updateOrderUI() {
  const mode = elements.orderMode.value;
  elements.specifiedEditor.hidden = mode !== "specified";
  elements.shuffle.hidden = mode !== "random";
  const hints = {
    type: "文章に最初に現れた文字種から、同じ文字種のパネルをまとめて戻します。",
    specified: "パネルをクリックした順に戻します。未指定のパネルは、その後に左から戻ります。",
    random: "すべてのパネルをランダムな順番で1枚ずつ戻します。",
  };
  elements.orderHint.textContent = hints[mode];
}

function updateLabels(progress = player?.state.playhead || 0) {
  elements.characterCount.value = `${state.lines.flat().length} / 24`;
  elements.typeLegend.hidden = elements.backMode.value !== "type";
  elements.panelGapValue.value = `${elements.panelGap.value} px`;
  elements.cornerRadiusValue.value = `${elements.cornerRadius.value} px`;
  elements.fontSizeValue.value = `${elements.fontSize.value} px`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.flipDuration.max = String(Math.min(3, Number(elements.duration.value)));
  if (Number(elements.flipDuration.value) > Number(elements.flipDuration.max)) elements.flipDuration.value = elements.flipDuration.max;
  elements.flipDurationValue.value = `${Number(elements.flipDuration.value).toFixed(1)} 秒`;
  elements.settleSpanValue.value = `${elements.settleSpan.value}%`;
  [elements.panelColor, elements.textColor, elements.settledColor, elements.backgroundColor]
    .forEach((control) => { control.nextElementSibling.value = control.value.toUpperCase(); });
  updateOrderUI();
  const frontCount = state.panels.filter((panel) => flipAmount(panel, progress) >= 0.999).length;
  const fixedNote = state.blankPanels.length ? ` + 空白${state.blankPanels.length}固定` : "";
  if (!state.panels.length && !state.blankPanels.length) elements.stageStatus.textContent = "文章を入力してください";
  else if (!state.panels.length) elements.stageStatus.textContent = `空白 · ${state.blankPanels.length}パネル固定`;
  else if (frontCount === 0) elements.stageStatus.textContent = `裏面 · ${state.panels.length}パネル${fixedNote}`;
  else if (frontCount === state.panels.length) elements.stageStatus.textContent = `表面 · ${state.panels.length}パネル 完成${fixedNote}`;
  else elements.stageStatus.textContent = `${frontCount} / ${state.panels.length}パネル 表面${fixedNote}`;
}

function resetAndRender() {
  player.reset();
  player.update();
  updateLabels();
  saveSettings();
  render();
}

function resizeOutputCanvas() {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
}

const restoredSettings = restoreSettings();
resizeOutputCanvas();
sanitizeTextInput();
rebuildPanels();
updateFontUI();

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  isReady: () => state.panels.length + state.blankPanels.length > 0,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => `${state.lines.map((line) => line.join("")).join("-") || "panel"}-panel-reveal`,
});

elements.textInput.addEventListener("input", () => { sanitizeTextInput(); rebuildPanels(); resetAndRender(); });
elements.backMode.addEventListener("change", resetAndRender);
[elements.panelGap, elements.cornerRadius, elements.fontSize, elements.duration, elements.flipDuration, elements.settleSpan]
  .forEach((control) => control.addEventListener("input", resetAndRender));
[elements.orderMode, elements.easing].forEach((control) => control.addEventListener("change", resetAndRender));
elements.sequenceOrder.addEventListener("click", () => {
  state.specifiedOrder = state.panels.map((panel) => panel.index);
  rebuildSpecifiedGrid();
  resetAndRender();
});
elements.clearOrder.addEventListener("click", () => {
  state.specifiedOrder = [];
  rebuildSpecifiedGrid();
  resetAndRender();
});
elements.shuffle.addEventListener("click", () => {
  state.seed = Date.now();
  state.randomRanks = shuffleRanks(state.panels.length);
  resetAndRender();
  player.showToast("復帰順を再抽選しました");
});
elements.fontStyle.addEventListener("change", async () => {
  if (elements.fontStyle.value !== state.lastFontStyle) await clearLocalFont(false);
  state.lastFontStyle = elements.fontStyle.value;
  resetAndRender();
});
elements.fontFile.addEventListener("change", async () => {
  await loadLocalFont(elements.fontFile.files[0]);
  elements.fontFile.value = "";
});
elements.fontClear.addEventListener("click", () => clearLocalFont(true));
elements.outputSize.addEventListener("change", () => {
  resizeOutputCanvas();
  resetAndRender();
});
[elements.panelColor, elements.textColor, elements.settledColor, elements.backgroundColor]
  .forEach((control) => control.addEventListener("input", resetAndRender));

updateLabels();
render();
restoreLocalFont(restoredSettings);
