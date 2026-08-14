"use strict";

const MEMORY_SETTINGS_KEY = "motion-lab:memory-flip-settings:v1";
const FONT_ASSET_KEY = "memory-flip-local-font";
const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 1000;
const MAX_COLUMNS = 8;
const MAX_ROWS = 4;
const SETTLED_TEXT_COLOR = "#ffffff";

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  shuffle: document.querySelector("#shuffleButton"),
  gridColumns: document.querySelector("#gridColumns"),
  gridColumnsValue: document.querySelector("#gridColumnsValue"),
  gridRows: document.querySelector("#gridRows"),
  gridRowsValue: document.querySelector("#gridRowsValue"),
  boardSummary: document.querySelector("#boardSummary"),
  backMode: document.querySelector("#backMode"),
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
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  tickInterval: document.querySelector("#tickInterval"),
  tickIntervalValue: document.querySelector("#tickIntervalValue"),
  flipDuration: document.querySelector("#flipDuration"),
  flipDurationValue: document.querySelector("#flipDurationValue"),
  openLimit: document.querySelector("#openLimit"),
  openLimitValue: document.querySelector("#openLimitValue"),
  matchChance: document.querySelector("#matchChance"),
  matchChanceValue: document.querySelector("#matchChanceValue"),
  closeChance: document.querySelector("#closeChance"),
  closeChanceValue: document.querySelector("#closeChanceValue"),
  requiredTime: document.querySelector("#requiredTime"),
  easing: document.querySelector("#easing"),
  matchDuration: document.querySelector("#matchDurationButton"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
  stageStatus: document.querySelector("#stageStatus"),
  imageTime: document.querySelector("#imageTime"),
  previewSpeed: document.querySelector("#previewSpeed"),
};

const context = elements.canvas.getContext("2d");
const fontStore = MotionFonts.createFontStore(FONT_ASSET_KEY);

const state = {
  seed: 20260814,
  panels: [],
  pairCount: 0,
  tickCount: 0,
  localFontFamily: "",
  localFontName: "",
  lastFontStyle: "sans",
};

function columns() {
  return Math.min(MAX_COLUMNS, Number(elements.gridColumns.value));
}

function rows() {
  return Math.min(MAX_ROWS, Number(elements.gridRows.value));
}

// An odd board cannot be paired up, so the last cell is left out.
function panelCount() {
  return Math.floor(columns() * rows() / 2) * 2;
}

function tickInterval() {
  return Math.max(0.1, Number(elements.tickInterval.value));
}

function flipTime() {
  return Math.max(0.1, Number(elements.flipDuration.value));
}

function saveSettings() {
  MotionStorage.write(MEMORY_SETTINGS_KEY, {
    text: elements.textInput.value,
    gridColumns: elements.gridColumns.value,
    gridRows: elements.gridRows.value,
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
    duration: elements.duration.value,
    tickInterval: elements.tickInterval.value,
    flipDuration: elements.flipDuration.value,
    openLimit: elements.openLimit.value,
    matchChance: elements.matchChance.value,
    closeChance: elements.closeChance.value,
    easing: elements.easing.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
    seed: state.seed,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(MEMORY_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.text === "string") elements.textInput.value = settings.text;
  ["gridColumns", "gridRows", "backMode", "panelGap", "cornerRadius", "fontStyle", "fontSize", "panelColor",
    "textColor", "settledColor", "backgroundColor", "duration", "tickInterval", "flipDuration", "openLimit",
    "matchChance", "closeChance", "easing", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  state.lastFontStyle = elements.fontStyle.value;
  return settings;
}

// --- board and schedule -----------------------------------------------------

function sourceCharacters() {
  return MotionToolkit.graphemes(elements.textInput.value)
    .filter((character) => character.trim().length > 0);
}

// Builds the board, then plays a whole game of 神経衰弱 ahead of time. The
// schedule is what the renderer reads, so a frame only ever looks up state.
function buildBoard() {
  const total = panelCount();
  const pairs = total / 2;
  const characters = sourceCharacters();
  const random = MotionToolkit.seededRandom(state.seed + total * 17 + MotionToolkit.hashSeed(elements.textInput.value));

  state.pairCount = pairs;
  if (!pairs || !characters.length) {
    state.panels = [];
    state.tickCount = 0;
    return;
  }

  // Two panels per character, cycling the input when it is shorter than the board.
  const deck = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    const character = characters[pair % characters.length];
    deck.push({ pair, character }, { pair, character });
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }

  const columnCount = columns();
  state.panels = deck.map((card, index) => ({
    index,
    pair: card.pair,
    character: card.character,
    column: index % columnCount,
    row: Math.floor(index / columnCount),
    events: [],
    matchedAtTick: Infinity,
  }));

  simulateGame(random);
}

function simulateGame(random) {
  const panels = state.panels;
  const byPair = new Map();
  panels.forEach((panel) => {
    const group = byPair.get(panel.pair) || [];
    group.push(panel);
    byPair.set(panel.pair, group);
  });

  const faceUp = new Set();
  const matched = new Set();
  const openLimit = Math.max(1, Number(elements.openLimit.value));
  const matchChance = Number(elements.matchChance.value) / 100;
  const closeChance = Number(elements.closeChance.value) / 100;
  const partnerOf = (panel) => byPair.get(panel.pair).find((item) => item !== panel);

  let tick = 0;
  // Every tick either settles a pair or shuffles the face-up set; the cap only
  // exists so a pathological setting cannot spin forever.
  const limit = state.pairCount * 40 + 80;
  while (matched.size < panels.length && tick < limit) {
    const open = panels.filter((panel) => faceUp.has(panel.index));
    // A pair can be closed out when one of it is already showing.
    const closable = open.filter((panel) => !faceUp.has(partnerOf(panel).index));
    // Force progress if the run is dragging, so the board always completes.
    const overdue = tick > state.pairCount * 6;
    const settle = closable.length > 0 && (overdue || random() < matchChance);

    if (settle) {
      const chosen = closable[Math.floor(random() * closable.length)];
      const partner = partnerOf(chosen);
      // Turning the partner up is the only moment two of a character show at
      // once, and it is exactly the moment the pair is settled.
      partner.events.push({ tick, up: true });
      faceUp.add(partner.index);
      [chosen, partner].forEach((panel) => {
        matched.add(panel.index);
        panel.matchedAtTick = tick;
        faceUp.delete(panel.index);
      });
    } else {
      let moved = false;
      // Some of what is showing goes back down, some simply stays.
      open.forEach((panel) => {
        if (random() < closeChance) {
          panel.events.push({ tick, up: false });
          faceUp.delete(panel.index);
          moved = true;
        }
      });
      // Then turn a few more up, never a character that is already showing.
      const hidden = panels.filter((panel) => !faceUp.has(panel.index)
        && !matched.has(panel.index)
        && !faceUp.has(partnerOf(panel).index));
      for (let index = hidden.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [hidden[index], hidden[swap]] = [hidden[swap], hidden[index]];
      }
      const room = Math.max(0, openLimit - faceUp.size);
      // With nothing showing at all a turn must be taken, otherwise the game stalls.
      const wanted = faceUp.size === 0 ? Math.max(1, Math.min(room, 2)) : Math.min(room, 1 + Math.floor(random() * room));
      let opened = 0;
      for (const panel of hidden) {
        if (opened >= wanted) break;
        // Re-checked here because a partner may have been turned up earlier in
        // this very tick; the list was filtered before any of them moved.
        if (faceUp.has(partnerOf(panel).index)) continue;
        panel.events.push({ tick, up: true });
        faceUp.add(panel.index);
        opened += 1;
        moved = true;
      }
      if (!moved && !hidden.length && !closable.length) break;
    }
    tick += 1;
  }
  state.tickCount = tick;
}

function requiredSeconds() {
  if (!state.tickCount) return 0;
  return (state.tickCount - 1) * tickInterval() + flipTime();
}

// How far a panel is through its flip at `seconds`, and which face it shows.
function panelFlip(panel, seconds) {
  // Each flip eases from wherever the panel currently is toward its target, so
  // a flip that starts before the previous one lands still composes cleanly.
  let amount = 0;
  panel.events.forEach((event) => {
    const start = event.tick * tickInterval();
    if (seconds <= start) return;
    const local = MotionToolkit.clamp((seconds - start) / flipTime(), 0, 1);
    const eased = MotionToolkit.ease(local, elements.easing.value);
    amount = MotionToolkit.lerp(amount, event.up ? 1 : 0, eased);
  });
  return amount;
}

function isSettled(panel, seconds) {
  if (panel.matchedAtTick === Infinity) return false;
  return seconds >= panel.matchedAtTick * tickInterval() + flipTime();
}

function settledPairs(seconds) {
  const settled = new Set();
  state.panels.forEach((panel) => {
    if (isSettled(panel, seconds)) settled.add(panel.pair);
  });
  return settled.size;
}

// --- drawing ----------------------------------------------------------------

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "MS Gothic", monospace';
  return '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
}

function panelLayout() {
  const gap = Number(elements.panelGap.value);
  const columnCount = columns();
  const rowCount = Math.max(1, Math.ceil(panelCount() / columnCount));
  const availableWidth = elements.canvas.width * 0.92;
  const availableHeight = elements.canvas.height * 0.88;
  const width = Math.min(220, (availableWidth - gap * (columnCount - 1)) / columnCount);
  const height = Math.min(240, width * 1.24, (availableHeight - gap * Math.max(0, rowCount - 1)) / rowCount);
  const blockWidth = columnCount * width + (columnCount - 1) * gap;
  const blockHeight = rowCount * height + (rowCount - 1) * gap;
  return {
    width,
    height,
    gap,
    left: (elements.canvas.width - blockWidth) / 2,
    top: (elements.canvas.height - blockHeight) / 2,
  };
}

const roundedRect = MotionToolkit.roundedRectPath;

function drawPanel(panel, layout, seconds) {
  const amount = panelFlip(panel, seconds);
  const angle = amount * Math.PI;
  const scaleX = Math.max(0.035, Math.abs(Math.cos(angle)));
  const isFront = amount >= 0.5;
  const settled = isSettled(panel, seconds);
  const centerX = layout.left + panel.column * (layout.width + layout.gap) + layout.width / 2;
  const centerY = layout.top + panel.row * (layout.height + layout.gap) + layout.height / 2;
  const back = elements.backMode.value === "blank" ? "" : "?";
  const label = isFront ? panel.character : back;
  const drawSize = Math.min(Number(elements.fontSize.value), layout.width * 0.6, layout.height * 0.5);
  const visibleWidth = layout.width * scaleX;
  const faceX = -visibleWidth / 2;

  context.save();
  context.translate(centerX, centerY);
  context.shadowColor = `rgba(0, 0, 0, ${0.12 + 0.16 * scaleX})`;
  context.shadowBlur = 6 + 10 * scaleX;
  context.shadowOffsetY = 3 + 3 * scaleX;
  roundedRect(context, faceX, -layout.height / 2, visibleWidth, layout.height, Number(elements.cornerRadius.value) * scaleX);
  context.fillStyle = settled ? elements.settledColor.value : elements.panelColor.value;
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = 5;
  context.strokeStyle = settled ? elements.settledColor.value : "rgba(12, 24, 30, 0.42)";
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

  context.fillStyle = "rgba(255, 255, 255, 0.10)";
  context.fillRect(faceX, -layout.height / 2, Math.max(1, visibleWidth * 0.5), layout.height);
  context.restore();
}

function render(playhead = 0) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  const seconds = playhead * Number(elements.duration.value);
  if (!state.panels.length) {
    context.fillStyle = elements.textColor.value;
    context.globalAlpha = 0.35;
    context.font = `700 44px ${fontFamily()}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("文字を入力", elements.canvas.width / 2, elements.canvas.height / 2);
    context.globalAlpha = 1;
    updateStatus(seconds);
    return;
  }

  const layout = panelLayout();
  state.panels.forEach((panel) => drawPanel(panel, layout, seconds));
  updateStatus(seconds);
}

function updateStatus(seconds) {
  const settled = settledPairs(seconds);
  elements.stageStatus.textContent = settled === state.pairCount && state.pairCount
    ? `全${state.pairCount}組 確定`
    : `${settled} / ${state.pairCount} 組 確定`;
}

function updateLabels() {
  const characters = sourceCharacters();
  elements.characterCount.value = `${characters.length} / ${panelCount() / 2 || 0}`;
  elements.gridColumnsValue.value = `${columns()} 枚`;
  elements.gridRowsValue.value = `${rows()} 枚`;
  elements.boardSummary.value = `${columns()} × ${rows()} · ${state.pairCount}組`;
  elements.panelGapValue.value = `${elements.panelGap.value} px`;
  elements.cornerRadiusValue.value = `${elements.cornerRadius.value} px`;
  elements.fontSizeValue.value = `${elements.fontSize.value} px`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.tickIntervalValue.value = `${tickInterval().toFixed(2)} 秒 / ${Math.round(tickInterval() * 60)}f`;
  elements.flipDurationValue.value = `${flipTime().toFixed(2)} 秒 / ${Math.round(flipTime() * 60)}f`;
  elements.openLimitValue.value = `${elements.openLimit.value} 枚`;
  elements.matchChanceValue.value = `${elements.matchChance.value}%`;
  elements.closeChanceValue.value = `${elements.closeChance.value}%`;
  elements.requiredTime.value = `必要 ${requiredSeconds().toFixed(1)} 秒`;
  [elements.panelColor, elements.textColor, elements.settledColor, elements.backgroundColor]
    .forEach((control) => { control.nextElementSibling.value = control.value.toUpperCase(); });
}

const player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => Number(elements.duration.value),
  isReady: () => state.panels.length > 0,
  render,
  onControlChange: saveSettings,
  getFileBase: () => `${elements.textInput.value.trim().slice(0, 8) || "memory"}-flip`,
});

function rebuildAndReset() {
  buildBoard();
  player.reset();
  player.update();
  updateLabels();
  saveSettings();
  render(0);
}

function resetAndRender() {
  player.reset();
  player.update();
  updateLabels();
  saveSettings();
  render(0);
}

// --- local fonts ------------------------------------------------------------

async function applyLocalFont(buffer, name) {
  const family = await MotionFonts.registerFontFile(buffer, "MemoryFlipLocal");
  state.localFontFamily = family;
  state.localFontName = name;
  elements.fontFileName.textContent = name;
  elements.fontClear.hidden = false;
  saveSettings();
  render(player.state.playhead);
}

async function loadLocalFont(file) {
  if (!file) return;
  if (file.size > MotionFonts.MAX_FONT_BYTES) {
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

async function clearLocalFont(notify = true) {
  state.localFontFamily = "";
  state.localFontName = "";
  elements.fontFileName.textContent = "端末内のフォント";
  elements.fontClear.hidden = true;
  elements.fontFile.value = "";
  await fontStore.remove();
  saveSettings();
  render(player.state.playhead);
  if (notify) player.showToast("端末内のフォントを解除しました");
}

async function restoreLocalFont(settings) {
  if (!settings?.localFontName) return;
  try {
    const asset = await fontStore.read();
    if (!asset?.buffer) throw new Error("Stored font was not found");
    await applyLocalFont(asset.buffer, asset.name || settings.localFontName);
  } catch {
    await clearLocalFont(false);
  }
}

// --- wiring -----------------------------------------------------------------

elements.textInput.addEventListener("input", rebuildAndReset);
[elements.gridColumns, elements.gridRows].forEach((control) => control.addEventListener("input", rebuildAndReset));
[elements.openLimit, elements.matchChance, elements.closeChance].forEach((control) => control.addEventListener("input", rebuildAndReset));
[elements.duration, elements.tickInterval, elements.flipDuration, elements.panelGap, elements.cornerRadius, elements.fontSize]
  .forEach((control) => control.addEventListener("input", resetAndRender));
[elements.backMode, elements.easing].forEach((control) => control.addEventListener("change", resetAndRender));
[elements.panelColor, elements.textColor, elements.settledColor, elements.backgroundColor]
  .forEach((control) => control.addEventListener("input", () => {
    saveSettings();
    updateLabels();
    render(player.state.playhead);
  }));
elements.shuffle.addEventListener("click", () => {
  state.seed = Date.now();
  rebuildAndReset();
  player.showToast("配置とめくり方を再抽選しました");
});
elements.matchDuration.addEventListener("click", () => {
  const needed = MotionToolkit.clamp(
    Math.ceil(requiredSeconds() * 2) / 2,
    Number(elements.duration.min),
    Number(elements.duration.max),
  );
  elements.duration.value = String(needed);
  elements.duration.dispatchEvent(new Event("input", { bubbles: true }));
  player.showToast(`全体時間を${needed.toFixed(1)}秒にしました`);
});
elements.fontStyle.addEventListener("change", async () => {
  if (elements.fontStyle.value !== state.lastFontStyle) await clearLocalFont(false);
  state.lastFontStyle = elements.fontStyle.value;
  saveSettings();
  render(player.state.playhead);
});
elements.fontFile.addEventListener("change", () => loadLocalFont(elements.fontFile.files?.[0]));
elements.fontClear.addEventListener("click", () => clearLocalFont());
elements.outputSize.addEventListener("change", () => {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  resetAndRender();
});

const restoredSettings = restoreSettings();
MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
buildBoard();
updateLabels();
player.update();
render(0);
restoreLocalFont(restoredSettings);
