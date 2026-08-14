"use strict";

const SLICE_SETTINGS_KEY = "motion-lab:slice-motion-settings:v1";
const elements = {
  canvas: document.querySelector("#previewCanvas"), fileInput: document.querySelector("#fileInput"), sample: document.querySelector("#sampleButton"),
  fileName: document.querySelector("#fileName"), fileMeta: document.querySelector("#fileMeta"), fileSummary: document.querySelector("#fileSummary"), imageDimensions: document.querySelector("#imageDimensions"),
  imageFit: document.querySelector("#imageFit"), layoutButtons: [...document.querySelectorAll("[data-layout]")], columns: document.querySelector("#columns"), columnsLabel: document.querySelector("#columnsLabel"), columnsValue: document.querySelector("#columnsValue"),
  rows: document.querySelector("#rows"), rowsValue: document.querySelector("#rowsValue"), rowsControl: document.querySelector("#rowsControl"), pieceCount: document.querySelector("#pieceCount"),
  gap: document.querySelector("#gap"), gapValue: document.querySelector("#gapValue"), backgroundColor: document.querySelector("#backgroundColor"), fade: document.querySelector("#fade"),
  direction: document.querySelector("#direction"), order: document.querySelector("#order"), distance: document.querySelector("#distance"), distanceValue: document.querySelector("#distanceValue"),
  stagger: document.querySelector("#stagger"), staggerValue: document.querySelector("#staggerValue"), duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"),
  moveDuration: document.querySelector("#moveDuration"), moveDurationValue: document.querySelector("#moveDurationValue"),
  easing: document.querySelector("#easing"), shuffle: document.querySelector("#shuffleButton"), stageStatus: document.querySelector("#stageStatus"), canvasMessage: document.querySelector("#canvasMessage"),
  previewSpeed: document.querySelector("#previewSpeed"), imageTime: document.querySelector("#imageTime"), outputSize: document.querySelector("#outputSize"), stageDimensions: document.querySelector("#stageDimensions"),
};
const context = elements.canvas.getContext("2d");
const state = { image: null, imageName: "sample-slices.png", imageBytes: 0, imageUrl: "", layout: "vertical", seed: Date.now(), pieces: [] };
let player = null;

function saveSettings() {
  MotionStorage.write(SLICE_SETTINGS_KEY, { layout: state.layout, seed: state.seed, imageFit: elements.imageFit.value, columns: elements.columns.value, rows: elements.rows.value, gap: elements.gap.value, backgroundColor: elements.backgroundColor.value, fade: elements.fade.checked, direction: elements.direction.value, order: elements.order.value, distance: elements.distance.value, stagger: elements.stagger.value, duration: elements.duration.value, moveDuration: elements.moveDuration.value, easing: elements.easing.value, previewSpeed: elements.previewSpeed.value, imageTime: elements.imageTime.value, outputSize: elements.outputSize.value });
}

function restoreSettings() {
  const settings = MotionStorage.read(SLICE_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (["vertical", "horizontal", "grid"].includes(settings.layout)) state.layout = settings.layout;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  ["imageFit", "columns", "rows", "gap", "backgroundColor", "direction", "order", "distance", "stagger", "duration", "moveDuration", "easing", "previewSpeed", "imageTime", "outputSize"].forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (typeof settings.fade === "boolean") elements.fade.checked = settings.fade;
}

function shuffleRanks(length, random) {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [values[index], values[swap]] = [values[swap], values[index]]; }
  return values;
}

function rebuildPieces() {
  const columns = Number(elements.columns.value);
  const rows = state.layout === "grid" ? Number(elements.rows.value) : state.layout === "horizontal" ? columns : 1;
  const actualColumns = state.layout === "horizontal" ? 1 : columns;
  const count = actualColumns * rows;
  const random = MotionToolkit.seededRandom(state.seed);
  const randomRanks = shuffleRanks(count, random);
  const pieces = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < actualColumns; column += 1) {
      const index = row * actualColumns + column;
      pieces.push({ index, row, column, columns: actualColumns, rows, randomRank: randomRanks.indexOf(index), randomSign: random() < 0.5 ? -1 : 1 });
    }
  }
  state.pieces = pieces;
  updateLabels();
}

function rankFor(piece) {
  const mode = elements.order.value;
  const count = state.pieces.length;
  if (mode === "simultaneous") return 0;
  if (mode === "random") return piece.randomRank;
  const linear = piece.index;
  if (mode === "center") return Math.floor(Math.abs(linear - (count - 1) / 2));
  if (mode === "edges") return Math.min(linear, count - 1 - linear);
  return linear;
}

function sliceMoveTime() {
  return MotionToolkit.clamp(Number(elements.moveDuration.value), 0.1, Number(elements.duration.value));
}

function sliceStartInterval() {
  if (elements.order.value === "simultaneous" || state.pieces.length <= 1) return 0;
  const maxRank = Math.max(1, ...state.pieces.map(rankFor));
  return Math.max(0, Number(elements.duration.value) - sliceMoveTime()) * Number(elements.stagger.value) / 100 / maxRank;
}

function amountFor(piece, progress) {
  const delay = sliceStartInterval() * rankFor(piece);
  const local = MotionToolkit.clamp((progress * Number(elements.duration.value) - delay) / sliceMoveTime(), 0, 1);
  return MotionToolkit.ease(local, elements.easing.value);
}

function directionSign(piece) {
  const mode = elements.direction.value;
  if (mode === "positive") return 1;
  if (mode === "negative") return -1;
  if (mode === "random") return piece.randomSign;
  if (mode === "center") {
    const position = state.layout === "vertical" ? piece.column / Math.max(1, piece.columns - 1) : piece.row / Math.max(1, piece.rows - 1);
    return position < 0.5 ? -1 : 1;
  }
  return piece.index % 2 ? 1 : -1;
}

function imageRect() {
  const width = state.image.naturalWidth;
  const height = state.image.naturalHeight;
  if (elements.imageFit.value === "contain") return MotionToolkit.containRect(width, height, elements.canvas.width, elements.canvas.height, 0);
  const scale = Math.max(elements.canvas.width / width, elements.canvas.height / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return { x: (elements.canvas.width - drawWidth) / 2, y: (elements.canvas.height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

function drawImageAt(rect) { context.drawImage(state.image, rect.x, rect.y, rect.width, rect.height); }

function render(progress = player?.state.playhead || 0) {
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.fillStyle = elements.backgroundColor.value; context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  if (!state.image) { context.restore(); return; }
  const rect = imageRect();
  if (progress >= 1 && Number(elements.gap.value) === 0) { drawImageAt(rect); context.restore(); return; }
  const gap = Number(elements.gap.value);
  const distance = Number(elements.distance.value) / 100;
  state.pieces.forEach((piece) => {
    const cellWidth = elements.canvas.width / piece.columns;
    const cellHeight = elements.canvas.height / piece.rows;
    const x = piece.column * cellWidth + gap / 2;
    const y = piece.row * cellHeight + gap / 2;
    const width = Math.max(0, cellWidth - gap);
    const height = Math.max(0, cellHeight - gap);
    const amount = amountFor(piece, progress);
    const sign = directionSign(piece);
    let dx = 0; let dy = 0;
    if (state.layout === "vertical") dy = sign * elements.canvas.height * distance * (1 - amount);
    else if (state.layout === "horizontal") dx = sign * elements.canvas.width * distance * (1 - amount);
    else {
      const centerX = piece.column + 0.5 - piece.columns / 2;
      const centerY = piece.row + 0.5 - piece.rows / 2;
      const length = Math.hypot(centerX, centerY) || 1;
      dx = centerX / length * elements.canvas.width * distance * 0.55 * (1 - amount) * sign;
      dy = centerY / length * elements.canvas.height * distance * 0.55 * (1 - amount) * sign;
    }
    context.save(); context.beginPath(); context.rect(x + dx, y + dy, width, height); context.clip(); context.translate(dx, dy); context.globalAlpha = elements.fade.checked ? MotionToolkit.clamp(amount * 1.35, 0, 1) : 1; drawImageAt(rect); context.restore();
  });
  context.restore();
}

function updateLabels(progress = player?.state.playhead || 0) {
  elements.layoutButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.layout === state.layout));
  elements.rowsControl.hidden = state.layout !== "grid";
  elements.columnsLabel.textContent = state.layout === "grid" ? "列数" : "分割数";
  elements.columnsValue.value = elements.columns.value; elements.rowsValue.value = elements.rows.value; elements.gapValue.value = `${elements.gap.value} px`;
  elements.distanceValue.value = `${elements.distance.value}%`; elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.moveDuration.max = elements.duration.value;
  if (Number(elements.moveDuration.value) > Number(elements.duration.value)) elements.moveDuration.value = elements.duration.value;
  const moveTime = sliceMoveTime(); const interval = sliceStartInterval();
  elements.moveDurationValue.value = `${moveTime.toFixed(1)} 秒 / ${Math.round(moveTime * 60)}f`;
  elements.staggerValue.value = elements.order.value === "simultaneous" ? "同時" : `${elements.stagger.value}% · ${interval.toFixed(2)}秒 / ${Math.round(interval * 60)}f`;
  elements.stagger.disabled = elements.order.value === "simultaneous";
  elements.pieceCount.value = `${state.pieces.length}枚`; elements.backgroundColor.nextElementSibling.value = elements.backgroundColor.value.toUpperCase();
  const names = { vertical: "縦分割", horizontal: "横分割", grid: "グリッド" };
  const fixed = state.pieces.filter((piece) => amountFor(piece, progress) >= 0.999).length;
  elements.stageStatus.textContent = `${fixed} / ${state.pieces.length}枚 確定 · ${names[state.layout]}`;
}

player = MotionToolkit.createPlayer({ canvas: elements.canvas, getDuration: () => elements.duration.value, isReady: () => Boolean(state.image), render, onUpdate: updateLabels, onControlChange: saveSettings, getFileBase: () => `${state.imageName.replace(/\.[^.]+$/, "")}-slice-motion` });

function makeSample() {
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 750; const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1200, 750); gradient.addColorStop(0, "#12384c"); gradient.addColorStop(0.52, "#1a9aae"); gradient.addColorStop(1, "#f3b64f"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 750);
  ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.beginPath(); ctx.arc(885, 205, 118, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0e2533"; ctx.beginPath(); ctx.moveTo(0, 665); ctx.lineTo(300, 330); ctx.lineTo(535, 610); ctx.lineTo(755, 390); ctx.lineTo(1200, 750); ctx.lineTo(0, 750); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.font = "800 96px sans-serif"; ctx.fillText("SLICE", 74, 170);
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = canvas.toDataURL("image/png"); });
}

function updateImageUI() {
  elements.fileName.textContent = state.imageName; elements.fileMeta.textContent = state.imageBytes ? `${(state.imageBytes / 1024 / 1024).toFixed(1)} MB` : "内蔵サンプル"; elements.imageDimensions.textContent = `${state.image.naturalWidth} × ${state.image.naturalHeight}`;
  const holder = elements.fileSummary.querySelector(".file-thumbnail"); holder.replaceChildren(); const thumb = new Image(); thumb.src = state.image.src; thumb.alt = ""; holder.append(thumb);
}

async function setImage(image, name, bytes = 0, url = "") {
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl); state.image = image; state.imageName = name; state.imageBytes = bytes; state.imageUrl = url; updateImageUI(); player.reset(); player.update(); render();
}

async function handleImageFile(file) {
  if (!file) return;
  try {
    const loaded = await MotionToolkit.loadImageFile(file);
    await setImage(loaded.image, loaded.name, loaded.bytes, loaded.url);
    player.showToast("画像を読み込みました");
  } catch (error) {
    player.showToast(error.message);
  } finally {
    elements.fileInput.value = "";
  }
}

elements.fileInput.addEventListener("change", () => handleImageFile(elements.fileInput.files?.[0]));
elements.fileSummary.addEventListener("click", () => elements.fileInput.click());
["dragenter", "dragover"].forEach((eventName) => {
  elements.fileSummary.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.fileSummary.classList.add("is-dragging");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
});
["dragleave", "drop"].forEach((eventName) => {
  elements.fileSummary.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.fileSummary.classList.remove("is-dragging");
  });
});
elements.fileSummary.addEventListener("drop", (event) => handleImageFile(event.dataTransfer?.files?.[0]));
elements.sample.addEventListener("click", async () => setImage(await makeSample(), "sample-slices.png"));
elements.layoutButtons.forEach((button) => button.addEventListener("click", () => { state.layout = button.dataset.layout; state.seed = Date.now(); rebuildPieces(); player.reset(); saveSettings(); render(); }));
[elements.columns, elements.rows].forEach((control) => control.addEventListener("input", () => { rebuildPieces(); player.reset(); saveSettings(); render(); }));
[elements.gap, elements.distance, elements.stagger, elements.duration, elements.moveDuration].forEach((control) => control.addEventListener("input", () => { player.reset(); updateLabels(); saveSettings(); render(); }));
[elements.imageFit, elements.direction, elements.order, elements.easing].forEach((control) => control.addEventListener("change", () => { if (control === elements.order) rebuildPieces(); player.reset(); saveSettings(); render(); }));
[elements.backgroundColor, elements.fade].forEach((control) => control.addEventListener("input", () => { updateLabels(); saveSettings(); render(); }));
elements.shuffle.addEventListener("click", () => { state.seed = Date.now(); rebuildPieces(); player.reset(); saveSettings(); render(); player.showToast("確定順と方向をシャッフルしました"); });
elements.outputSize.addEventListener("change", () => { MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions); player.reset(); saveSettings(); render(); });

(async function init() { restoreSettings(); MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions); rebuildPieces(); updateLabels(); render(); await setImage(await makeSample(), "sample-slices.png"); })();
