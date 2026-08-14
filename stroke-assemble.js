"use strict";

const ASSEMBLE_SETTINGS_KEY = "motion-lab:stroke-assemble-settings:v1";
const SETTLED_COLOR = "#e0041d";
const SOURCE_SIZE = 1024;
const SOURCE_BASELINE = 900;
const elements = {
  canvas: document.querySelector("#previewCanvas"),
  character: document.querySelector("#characterInput"),
  strokeCount: document.querySelector("#strokeCount"),
  dataStatus: document.querySelector("#dataStatus"),
  canvasMessage: document.querySelector("#canvasMessage"),
  regionSize: document.querySelector("#regionSize"),
  regionSizeValue: document.querySelector("#regionSizeValue"),
  rotation: document.querySelector("#rotation"),
  rotationValue: document.querySelector("#rotationValue"),
  scaleVariation: document.querySelector("#scaleVariation"),
  scaleVariationValue: document.querySelector("#scaleVariationValue"),
  shuffle: document.querySelector("#shuffleButton"),
  guideOpacity: document.querySelector("#guideOpacity"),
  guideOpacityValue: document.querySelector("#guideOpacityValue"),
  inkColor: document.querySelector("#inkColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  moveDuration: document.querySelector("#moveDuration"),
  moveDurationValue: document.querySelector("#moveDurationValue"),
  settleMode: document.querySelector("#settleMode"),
  overlapTimingControls: document.querySelector("#overlapTimingControls"),
  stagger: document.querySelector("#stagger"),
  staggerValue: document.querySelector("#staggerValue"),
  returnOrder: document.querySelector("#returnOrder"),
  orderEditor: document.querySelector("#orderPickerEditor"),
  orderGrid: document.querySelector("#orderPickerGrid"),
  orderCount: document.querySelector("#orderPickerCount"),
  orderAllButton: document.querySelector("#orderPickerAllButton"),
  orderClearButton: document.querySelector("#orderPickerClearButton"),
  easing: document.querySelector("#easing"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
  stageStatus: document.querySelector("#stageStatus"),
  previewSpeed: document.querySelector("#previewSpeed"),
  imageTime: document.querySelector("#imageTime"),
};
const context = elements.canvas.getContext("2d");

// "指定" mode: the strokes settle in the order they were clicked.
const orderPicker = MotionOrder.createOrderPicker({
  grid: elements.orderGrid,
  countLabel: elements.orderCount,
  editor: elements.orderEditor,
  onChange: () => rebuildPlacement(),
});

// The picker lists every stroke by its number in the writing order.
function syncOrderPicker() {
  orderPicker.setItems(state.strokes.map((_, index) => ({ id: index, label: index + 1 })));
  orderPicker.setVisible(elements.returnOrder.value === "specified");
}
const state = {
  character: "集",
  strokes: [],
  placements: [],
  seed: Date.now(),
  loading: false,
  requestId: 0,
  controller: null,
  loadTimer: 0,
  legacyStaggerPercent: null,
};

function saveSettings() {
  MotionStorage.write(ASSEMBLE_SETTINGS_KEY, {
    character: state.character,
    seed: state.seed,
    regionSize: elements.regionSize.value,
    rotation: elements.rotation.value,
    scaleVariation: elements.scaleVariation.value,
    guideOpacity: elements.guideOpacity.value,
    inkColor: elements.inkColor.value,
    backgroundColor: elements.backgroundColor.value,
    duration: elements.duration.value,
    moveDuration: elements.moveDuration.value,
    settleMode: elements.settleMode.value,
    startInterval: elements.stagger.value,
    returnOrder: elements.returnOrder.value,
    easing: elements.easing.value,
    outputSize: elements.outputSize.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    specifiedOrder: orderPicker.getOrder(),
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(ASSEMBLE_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (typeof settings.character === "string" && MotionToolkit.graphemes(settings.character).length) {
    state.character = MotionToolkit.graphemes(settings.character)[0];
    elements.character.value = state.character;
  }
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  const controls = ["regionSize", "rotation", "scaleVariation", "guideOpacity", "inkColor", "backgroundColor", "duration", "moveDuration", "settleMode", "returnOrder", "easing", "outputSize", "previewSpeed", "imageTime"];
  controls.forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Number.isFinite(Number(settings.startInterval))) {
    MotionStorage.restoreControl(elements.stagger, settings.startInterval);
  } else if (Number.isFinite(Number(settings.stagger))) {
    state.legacyStaggerPercent = Number(settings.stagger);
  }
  if (Array.isArray(settings.specifiedOrder)) {
    orderPicker.setOrder(settings.specifiedOrder.map(Number).filter(Number.isInteger));
  }
}

function setStatus(message, type = "loading") {
  elements.dataStatus.lastElementChild.textContent = message;
  elements.dataStatus.classList.toggle("is-ready", type === "ready");
  elements.dataStatus.classList.toggle("is-error", type === "error");
}

function setMessage(message = "") {
  elements.canvasMessage.textContent = message;
  elements.canvasMessage.hidden = !message;
}

function overlapScore(candidate, placedBoxes) {
  const candidateArea = Math.max(1, (candidate.right - candidate.left) * (candidate.bottom - candidate.top));
  let score = 0;
  let nearestGap = Infinity;
  placedBoxes.forEach((placed) => {
    const overlapWidth = Math.max(0, Math.min(candidate.right, placed.right) - Math.max(candidate.left, placed.left));
    const overlapHeight = Math.max(0, Math.min(candidate.bottom, placed.bottom) - Math.max(candidate.top, placed.top));
    if (overlapWidth > 0 && overlapHeight > 0) {
      const placedArea = Math.max(1, (placed.right - placed.left) * (placed.bottom - placed.top));
      const overlapArea = overlapWidth * overlapHeight;
      score += overlapArea / Math.min(candidateArea, placedArea) * 1_000_000;
      score += overlapArea;
      return;
    }
    const gapX = Math.max(0, Math.max(candidate.left, placed.left) - Math.min(candidate.right, placed.right));
    const gapY = Math.max(0, Math.max(candidate.top, placed.top) - Math.min(candidate.bottom, placed.bottom));
    nearestGap = Math.min(nearestGap, Math.hypot(gapX, gapY));
  });
  if (placedBoxes.length && Number.isFinite(nearestGap)) score += 2400 / (nearestGap + 12);
  return score;
}

function buildPlacements() {
  const random = MotionToolkit.seededRandom(state.seed + MotionToolkit.hashSeed(state.character));
  const region = SOURCE_SIZE * Number(elements.regionSize.value) / 100;
  const regionLeft = (SOURCE_SIZE - region) / 2;
  const regionRight = regionLeft + region;
  const maxRotation = Number(elements.rotation.value) * Math.PI / 180;
  const variation = Number(elements.scaleVariation.value) / 100;
  const ranks = state.strokes.map((_, index) => index);
  for (let index = ranks.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [ranks[index], ranks[swap]] = [ranks[swap], ranks[index]];
  }
  const strokeOrder = state.strokes
    .map((stroke, index) => ({
      index,
      area: Math.max(1, stroke.bounds.maxX - stroke.bounds.minX) * Math.max(1, stroke.bounds.maxY - stroke.bounds.minY),
    }))
    .sort((a, b) => b.area - a.area);
  const placements = new Array(state.strokes.length);
  const placedBoxes = [];

  strokeOrder.forEach(({ index }) => {
    const stroke = state.strokes[index];
    const strokeWidth = Math.max(1, stroke.bounds.maxX - stroke.bounds.minX);
    const strokeHeight = Math.max(1, stroke.bounds.maxY - stroke.bounds.minY);
    let best = null;
    const candidateCount = Math.max(180, state.strokes.length * 18);

    for (let attempt = 0; attempt < candidateCount; attempt += 1) {
      const angle = MotionToolkit.lerp(-maxRotation, maxRotation, random());
      const scale = 1 + MotionToolkit.lerp(-variation, variation, random());
      const cosine = Math.abs(Math.cos(angle));
      const sine = Math.abs(Math.sin(angle));
      const halfWidth = Math.min(region / 2, (strokeWidth * cosine + strokeHeight * sine) * scale / 2 + 10);
      const halfHeight = Math.min(region / 2, (strokeWidth * sine + strokeHeight * cosine) * scale / 2 + 10);
      const minX = regionLeft + halfWidth;
      const maxX = regionRight - halfWidth;
      const minY = regionLeft + halfHeight;
      const maxY = regionRight - halfHeight;
      const targetX = minX < maxX ? MotionToolkit.lerp(minX, maxX, random()) : SOURCE_SIZE / 2;
      const targetY = minY < maxY ? MotionToolkit.lerp(minY, maxY, random()) : SOURCE_SIZE / 2;
      const box = {
        left: targetX - halfWidth,
        right: targetX + halfWidth,
        top: targetY - halfHeight,
        bottom: targetY + halfHeight,
      };
      const score = overlapScore(box, placedBoxes) + random() * 0.001;
      if (!best || score < best.score) best = { targetX, targetY, angle, scale, box, score };
      if (score < 0.001) break;
    }

    placements[index] = {
      dx: best.targetX - stroke.bounds.cx,
      dy: best.targetY - stroke.bounds.cy,
      angle: best.angle,
      scale: best.scale,
      randomRank: ranks.indexOf(index),
    };
    placedBoxes.push(best.box);
  });
  state.placements = placements;
}

function applyCharacterTransform(ctx) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const size = Math.min(width, height);
  const padding = size * 0.045;
  const scale = (size - padding * 2) / SOURCE_SIZE;
  const x = width / 2 - SOURCE_SIZE * scale / 2;
  const y = height / 2 + SOURCE_BASELINE * scale / 2;
  ctx.setTransform(scale, 0, 0, -scale, x, y);
}

function strokeRank(index) {
  const mode = elements.returnOrder.value;
  if (mode === "random") return state.placements[index].randomRank;
  if (mode === "stroke") return index;
  if (mode === "reverse") return state.strokes.length - 1 - index;
  if (mode === "specified") return orderPicker.ranks().get(index) ?? index;
  return 0;
}

function strokeMoveTime() {
  const mode = elements.returnOrder.value;
  const total = Number(elements.duration.value);
  const maximum = elements.settleMode.value === "sequential" && mode !== "simultaneous"
    ? Math.max(0.02, Number(elements.stagger.value))
    : total;
  return MotionToolkit.clamp(Number(elements.moveDuration.value), 0.02, Math.max(0.02, maximum));
}

function strokeStartInterval() {
  if (elements.returnOrder.value === "simultaneous" || state.strokes.length <= 1) return 0;
  return Number(elements.stagger.value);
}

function syncStrokeStartIntervalLimit() {
  elements.stagger.max = "20";
  elements.stagger.value = String(MotionToolkit.clamp(Number(elements.stagger.value) || 0, 0, 20));
}

function migrateLegacyStartInterval() {
  if (state.legacyStaggerPercent === null || state.strokes.length <= 1) return;
  if (elements.settleMode.value === "sequential" && elements.returnOrder.value !== "simultaneous") {
    elements.stagger.value = String(strokeMoveTime());
    state.legacyStaggerPercent = null;
    return;
  }
  const total = Number(elements.duration.value);
  const moveTime = strokeMoveTime();
  const startWindow = Math.max(0, total - moveTime) * state.legacyStaggerPercent / 100;
  elements.stagger.value = String(startWindow / (state.strokes.length - 1));
  state.legacyStaggerPercent = null;
}

function strokeLocalProgress(index, progress) {
  const moveTime = strokeMoveTime();
  const delay = strokeStartInterval() * strokeRank(index);
  return MotionToolkit.clamp((progress * Number(elements.duration.value) - delay) / moveTime, 0, 1);
}

function strokeAmount(index, progress) {
  const local = strokeLocalProgress(index, progress);
  return MotionToolkit.ease(local, elements.easing.value);
}

function drawStroke(stroke, placement, amount, alpha = 1, color = elements.inkColor.value) {
  context.save();
  applyCharacterTransform(context);
  context.globalAlpha = alpha;
  context.fillStyle = color;
  const dx = MotionToolkit.lerp(placement.dx, 0, amount);
  const dy = MotionToolkit.lerp(placement.dy, 0, amount);
  const angle = MotionToolkit.lerp(placement.angle, 0, amount);
  const scale = MotionToolkit.lerp(placement.scale, 1, amount);
  context.translate(stroke.bounds.cx + dx, stroke.bounds.cy + dy);
  context.rotate(angle);
  context.scale(scale, scale);
  context.translate(-stroke.bounds.cx, -stroke.bounds.cy);
  context.fill(stroke.shape);
  context.restore();
}

let player = null;

function render(progress = player?.state.playhead || 0) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  if (state.strokes.length) {
    const guide = Number(elements.guideOpacity.value) / 100;
    if (guide > 0) state.strokes.forEach((stroke) => drawStroke(stroke, { dx: 0, dy: 0, angle: 0, scale: 1 }, 1, guide));
    state.strokes.forEach((stroke, index) => {
      const amount = strokeAmount(index, progress);
      drawStroke(stroke, state.placements[index], amount, 1, amount >= 0.999 ? SETTLED_COLOR : elements.inkColor.value);
    });
  }
  context.restore();
}

function updateLabels(progress = player?.state.playhead || 0) {
  elements.regionSizeValue.value = `${elements.regionSize.value}%`;
  elements.rotationValue.value = `${elements.rotation.value}°`;
  elements.scaleVariationValue.value = `${elements.scaleVariation.value}%`;
  elements.guideOpacityValue.value = `${elements.guideOpacity.value}%`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  const sequentialMaximum = Math.max(0.02, Number(elements.stagger.value));
  elements.moveDuration.max = String(elements.settleMode.value === "sequential" && elements.returnOrder.value !== "simultaneous" ? sequentialMaximum : elements.duration.value);
  if (Number(elements.moveDuration.value) > Number(elements.moveDuration.max)) elements.moveDuration.value = elements.moveDuration.max;
  syncStrokeStartIntervalLimit();
  const moveTime = strokeMoveTime();
  elements.moveDurationValue.value = `${moveTime.toFixed(moveTime < 0.1 ? 2 : 1)} 秒 / ${Math.round(moveTime * 60)}f`;
  const interval = strokeStartInterval();
  if (elements.returnOrder.value === "simultaneous") elements.staggerValue.value = "同時";
  else elements.staggerValue.value = `${interval.toFixed(2)}秒 / ${Math.round(interval * 60)}f`;
  elements.stagger.disabled = elements.returnOrder.value === "simultaneous";
  elements.overlapTimingControls.hidden = false;
  document.querySelectorAll('.color-control input[type="color"]').forEach((input) => { input.nextElementSibling.value = input.value.toUpperCase(); });
  const fixed = state.strokes.filter((_, index) => strokeAmount(index, progress) >= 0.999).length;
  elements.stageStatus.textContent = state.loading ? "画データを読み込み中" : state.strokes.length ? `${fixed} / ${state.strokes.length}画 確定` : "画データなし";
  elements.strokeCount.value = state.strokes.length ? `${state.strokes.length} 画` : "— 画";
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  isReady: () => state.strokes.length && !state.loading,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => `${state.character}-stroke-assemble`,
});

async function loadCharacter(character) {
  const requestId = ++state.requestId;
  state.controller?.abort();
  state.controller = new AbortController();
  state.loading = true;
  state.strokes = [];
  state.placements = [];
  player.reset();
  setStatus("日本語用の画データを読み込み中");
  setMessage("漢字の画データを読み込んでいます…");
  try {
    const parsed = KanjiMotionData.parse(await KanjiMotionData.fetchCharacter(character, state.controller.signal));
    if (requestId !== state.requestId) return;
    state.strokes = parsed.strokes;
    state.loading = false;
    buildPlacements();
    syncOrderPicker();
    migrateLegacyStartInterval();
    syncStrokeStartIntervalLimit();
    setStatus(`${state.strokes.length}画を重なり少なく配置`, "ready");
    setMessage();
    saveSettings();
    player.update();
    render();
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.requestId) return;
    state.loading = false;
    setStatus("画データを取得できません", "error");
    setMessage("この文字の画データを取得できませんでした。漢字1文字とネット接続を確認してください。");
    player.update();
    render();
  }
}

function rebuildPlacement(reset = true) {
  buildPlacements();
  syncOrderPicker();
  if (reset) player.reset();
  saveSettings();
  updateLabels();
  render();
}

elements.character.addEventListener("input", () => {
  const [character = ""] = MotionToolkit.graphemes(elements.character.value);
  elements.character.value = character;
  state.character = character;
  clearTimeout(state.loadTimer);
  state.controller?.abort();
  state.strokes = [];
  player.reset();
  saveSettings();
  if (!character) {
    state.loading = false;
    setStatus("漢字を1文字入力してください", "error");
    setMessage("左の欄に漢字を1文字入力してください。");
    player.update();
    return;
  }
  state.seed = Date.now();
  state.loadTimer = window.setTimeout(() => loadCharacter(character), 220);
});

[elements.regionSize, elements.rotation, elements.scaleVariation].forEach((control) => control.addEventListener("input", rebuildPlacement));
elements.shuffle.addEventListener("click", () => {
  state.seed = Date.now();
  rebuildPlacement();
  player.showToast("初期配置をシャッフルしました");
});
[elements.guideOpacity, elements.duration, elements.moveDuration, elements.stagger].forEach((control) => control.addEventListener("input", () => {
  player.reset();
  saveSettings();
  updateLabels();
  render();
}));
[elements.settleMode, elements.returnOrder, elements.easing].forEach((control) => control.addEventListener("change", () => {
  syncOrderPicker();
  player.reset();
  saveSettings();
  updateLabels();
  render();
}));
elements.orderAllButton.addEventListener("click", () => orderPicker.selectAll());
elements.orderClearButton.addEventListener("click", () => orderPicker.clear());
document.querySelectorAll('.color-control input[type="color"]').forEach((input) => input.addEventListener("input", () => { saveSettings(); updateLabels(); render(); }));
elements.outputSize.addEventListener("change", () => {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, 800, 800);
  saveSettings();
  render();
});

(async function init() {
  restoreSettings();
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, 800, 800);
  updateLabels();
  render();
  await loadCharacter(state.character);
})();
