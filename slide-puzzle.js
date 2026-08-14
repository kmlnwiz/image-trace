"use strict";

const PUZZLE_SETTINGS_KEY = "motion-lab:slide-puzzle-settings:v1";
const FONT_ASSET_KEY = "slide-puzzle-local-font";
const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 1000;

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  canvasMessage: document.querySelector("#canvasMessage"),
  sourceMode: document.querySelector("#sourceMode"),
  sourceMeta: document.querySelector("#sourceMeta"),
  textSource: document.querySelector("#textSource"),
  imageSource: document.querySelector("#imageSource"),
  textInput: document.querySelector("#textInput"),
  fontStyle: document.querySelector("#fontStyle"),
  fontFile: document.querySelector("#fontFile"),
  fontFileName: document.querySelector("#fontFileName"),
  fontClear: document.querySelector("#fontClearButton"),
  textColor: document.querySelector("#textColor"),
  fileInput: document.querySelector("#fileInput"),
  fileSummary: document.querySelector("#fileSummary"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
  imageFit: document.querySelector("#imageFit"),
  gridColumns: document.querySelector("#gridColumns"),
  gridColumnsValue: document.querySelector("#gridColumnsValue"),
  gridRows: document.querySelector("#gridRows"),
  gridRowsValue: document.querySelector("#gridRowsValue"),
  gridArea: document.querySelector("#gridArea"),
  tileGap: document.querySelector("#tileGap"),
  tileGapValue: document.querySelector("#tileGapValue"),
  cornerRadius: document.querySelector("#cornerRadius"),
  cornerRadiusValue: document.querySelector("#cornerRadiusValue"),
  backgroundColor: document.querySelector("#backgroundColor"),
  holeColor: document.querySelector("#holeColor"),
  showNumbers: document.querySelector("#showNumbers"),
  holePicker: document.querySelector("#holePicker"),
  holeLabel: document.querySelector("#holeLabel"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  moveCount: document.querySelector("#moveCount"),
  moveCountValue: document.querySelector("#moveCountValue"),
  moveDuration: document.querySelector("#moveDuration"),
  moveDurationValue: document.querySelector("#moveDurationValue"),
  moveInterval: document.querySelector("#moveInterval"),
  moveIntervalValue: document.querySelector("#moveIntervalValue"),
  requiredTime: document.querySelector("#requiredTime"),
  easing: document.querySelector("#easing"),
  matchDuration: document.querySelector("#matchDurationButton"),
  shuffle: document.querySelector("#shuffleButton"),
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
  holeIndex: -1,
  moves: [],
  startBoard: [],
  image: null,
  imageName: "",
  imageBytes: 0,
  localFontFamily: "",
  localFontName: "",
  lastFontStyle: "sans",
};

// The board is drawn once into this canvas and every tile then blits the slice
// of it that belongs to that tile, so a character and a photo take one path.
const sourceCanvas = document.createElement("canvas");
const sourceContext = sourceCanvas.getContext("2d");

function columns() {
  return Number(elements.gridColumns.value);
}

function rows() {
  return Number(elements.gridRows.value);
}

function cellCount() {
  return columns() * rows();
}

function defaultHoleIndex() {
  return cellCount() - 1;
}

function holeIndex() {
  const total = cellCount();
  return state.holeIndex >= 0 && state.holeIndex < total ? state.holeIndex : defaultHoleIndex();
}

function saveSettings() {
  MotionStorage.write(PUZZLE_SETTINGS_KEY, {
    sourceMode: elements.sourceMode.value,
    text: elements.textInput.value,
    fontStyle: elements.fontStyle.value,
    localFontName: state.localFontName,
    textColor: elements.textColor.value,
    imageFit: elements.imageFit.value,
    gridColumns: elements.gridColumns.value,
    gridRows: elements.gridRows.value,
    tileGap: elements.tileGap.value,
    cornerRadius: elements.cornerRadius.value,
    backgroundColor: elements.backgroundColor.value,
    holeColor: elements.holeColor.value,
    showNumbers: elements.showNumbers.checked,
    holeIndex: holeIndex(),
    duration: elements.duration.value,
    moveCount: elements.moveCount.value,
    moveDuration: elements.moveDuration.value,
    moveInterval: elements.moveInterval.value,
    easing: elements.easing.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
    seed: state.seed,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(PUZZLE_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.text === "string") elements.textInput.value = settings.text;
  ["sourceMode", "fontStyle", "textColor", "imageFit", "gridColumns", "gridRows", "tileGap", "cornerRadius",
    "backgroundColor", "holeColor", "duration", "moveCount", "moveDuration", "moveInterval", "easing",
    "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (typeof settings.showNumbers === "boolean") elements.showNumbers.checked = settings.showNumbers;
  if (Number.isInteger(settings.holeIndex)) state.holeIndex = settings.holeIndex;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  state.lastFontStyle = elements.fontStyle.value;
  return settings;
}

function clamp(value, min, max) {
  return MotionToolkit.clamp(value, min, max);
}

// --- puzzle construction ---------------------------------------------------

function neighboursOf(position) {
  const columnCount = columns();
  const column = position % columnCount;
  const row = Math.floor(position / columnCount);
  const result = [];
  if (column > 0) result.push(position - 1);
  if (column + 1 < columnCount) result.push(position + 1);
  if (row > 0) result.push(position - columnCount);
  if (row + 1 < rows()) result.push(position + columnCount);
  return result;
}

// Scrambling by walking the hole around the board guarantees the arrangement is
// solvable, and replaying that walk backwards is the animation.
function buildPuzzle() {
  const total = cellCount();
  const hole = holeIndex();
  const board = Array.from({ length: total }, (_, index) => (index === hole ? null : index));
  const random = MotionToolkit.seededRandom(state.seed + total * 31 + hole);
  const history = [];
  let blank = hole;
  let previousBlank = -1;

  const requested = Math.min(Number(elements.moveCount.value), Number(elements.moveCount.max));
  for (let step = 0; step < requested; step += 1) {
    const neighbours = neighboursOf(blank);
    // Undoing the move just made would leave the board visibly unshuffled.
    const candidates = neighbours.filter((position) => position !== previousBlank);
    const pool = candidates.length ? candidates : neighbours;
    const target = pool[Math.floor(random() * pool.length)];
    history.push({ from: target, to: blank });
    board[blank] = board[target];
    board[target] = null;
    previousBlank = blank;
    blank = target;
  }

  // Replay the scramble backwards: that is the run from shuffled to solved.
  state.startBoard = [...board];
  const working = [...board];
  const moves = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const { from, to } = history[index];
    moves.push({ tile: working[to], from: to, to: from });
    working[from] = working[to];
    working[to] = null;
  }
  state.moves = moves;
}

function moveTime() {
  return Math.max(0.02, Number(elements.moveDuration.value));
}

function moveInterval() {
  // Consecutive slides both need the hole, so a gap shorter than one slide
  // would put two tiles in the same cell. The interval never dips below it.
  return Math.max(moveTime(), Number(elements.moveInterval.value));
}

function requiredSeconds() {
  if (!state.moves.length) return 0;
  return (state.moves.length - 1) * moveInterval() + moveTime();
}

// Tile positions in grid coordinates at a given time. Moves are applied in
// order, so a tile that slides more than once ends on its latest position.
function tilePositions(seconds) {
  const columnCount = columns();
  const positions = new Map();
  state.startBoard.forEach((tile, position) => {
    if (tile === null) return;
    positions.set(tile, { column: position % columnCount, row: Math.floor(position / columnCount) });
  });
  state.moves.forEach((move, index) => {
    if (move.tile === null || move.tile === undefined) return;
    const start = index * moveInterval();
    const local = clamp((seconds - start) / moveTime(), 0, 1);
    if (local <= 0) return;
    const amount = MotionToolkit.ease(local, elements.easing.value);
    const fromColumn = move.from % columnCount;
    const fromRow = Math.floor(move.from / columnCount);
    const toColumn = move.to % columnCount;
    const toRow = Math.floor(move.to / columnCount);
    positions.set(move.tile, {
      column: MotionToolkit.lerp(fromColumn, toColumn, amount),
      row: MotionToolkit.lerp(fromRow, toRow, amount),
    });
  });
  return positions;
}

function completedMoves(seconds) {
  return state.moves.filter((_, index) => seconds >= index * moveInterval() + moveTime()).length;
}

// --- drawing ---------------------------------------------------------------

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "MS Gothic", monospace';
  return '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
}

function boardRect() {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const margin = Math.min(width, height) * 0.04;
  const cell = Math.min((width - margin * 2) / columns(), (height - margin * 2) / rows());
  const boardWidth = cell * columns();
  const boardHeight = cell * rows();
  return { x: (width - boardWidth) / 2, y: (height - boardHeight) / 2, cell, width: boardWidth, height: boardHeight };
}

// Redraws the picture the tiles are cut from at the board's current pixel size.
function refreshSource() {
  const board = boardRect();
  const width = Math.max(1, Math.round(board.width));
  const height = Math.max(1, Math.round(board.height));
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceContext.setTransform(1, 0, 0, 1, 0, 0);
  sourceContext.clearRect(0, 0, width, height);

  if (elements.sourceMode.value === "image") {
    if (!state.image) return;
    const scale = elements.imageFit.value === "contain"
      ? Math.min(width / state.image.naturalWidth, height / state.image.naturalHeight)
      : Math.max(width / state.image.naturalWidth, height / state.image.naturalHeight);
    const drawWidth = state.image.naturalWidth * scale;
    const drawHeight = state.image.naturalHeight * scale;
    sourceContext.drawImage(state.image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return;
  }

  const text = MotionToolkit.graphemes(elements.textInput.value)[0] || "";
  if (!text) return;
  sourceContext.fillStyle = elements.textColor.value;
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  // Grow the glyph until it fills the shorter side of the board.
  const target = Math.min(width, height) * 0.92;
  let size = target;
  sourceContext.font = `700 ${size}px ${fontFamily()}`;
  const measured = sourceContext.measureText(text);
  const glyphWidth = measured.width || size;
  if (glyphWidth > width * 0.96) {
    size = size * (width * 0.96) / glyphWidth;
    sourceContext.font = `700 ${size}px ${fontFamily()}`;
  }
  sourceContext.fillText(text, width / 2, height / 2);
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const limit = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + limit, y);
  ctx.arcTo(x + width, y, x + width, y + height, limit);
  ctx.arcTo(x + width, y + height, x, y + height, limit);
  ctx.arcTo(x, y + height, x, y, limit);
  ctx.arcTo(x, y, x + width, y, limit);
  ctx.closePath();
}

function render(playhead = 0) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, width, height);

  const board = boardRect();
  const gap = Number(elements.tileGap.value);
  const radius = Number(elements.cornerRadius.value);
  const columnCount = columns();
  const seconds = playhead * Number(elements.duration.value);

  // The hole is painted first so tiles always slide over it.
  const hole = holeIndex();
  context.fillStyle = elements.holeColor.value;
  roundedRectPath(
    context,
    board.x + (hole % columnCount) * board.cell + gap / 2,
    board.y + Math.floor(hole / columnCount) * board.cell + gap / 2,
    board.cell - gap,
    board.cell - gap,
    radius,
  );
  context.fill();

  const positions = tilePositions(seconds);
  const ready = elements.sourceMode.value !== "image" || Boolean(state.image);
  [...positions.entries()].forEach(([tile, position]) => {
    const x = board.x + position.column * board.cell + gap / 2;
    const y = board.y + position.row * board.cell + gap / 2;
    const size = board.cell - gap;
    if (size <= 0) return;
    context.save();
    roundedRectPath(context, x, y, size, size, radius);
    context.clip();
    if (ready) {
      // A tile shows the slice of the picture that belongs at its home cell.
      const sourceX = (tile % columnCount) * board.cell + gap / 2;
      const sourceY = Math.floor(tile / columnCount) * board.cell + gap / 2;
      context.drawImage(sourceCanvas, sourceX, sourceY, size, size, x, y, size, size);
    }
    context.restore();
    context.strokeStyle = "rgba(23, 36, 43, 0.16)";
    context.lineWidth = 1.5;
    roundedRectPath(context, x + 0.75, y + 0.75, size - 1.5, size - 1.5, Math.max(0, radius - 0.75));
    context.stroke();
    if (elements.showNumbers.checked) {
      context.fillStyle = "rgba(23, 36, 43, 0.55)";
      context.font = `700 ${Math.max(10, size * 0.17)}px ${fontFamily()}`;
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText(String(tile + 1), x + size * 0.08, y + size * 0.06);
    }
  });

  updateStatus(seconds);
}

function updateStatus(seconds) {
  const done = completedMoves(seconds);
  elements.stageStatus.textContent = done >= state.moves.length && state.moves.length
    ? `完成 · ${columns()} × ${rows()} · ${state.moves.length} 手`
    : `${done} / ${state.moves.length} 手`;
}

function holeName(index) {
  const columnCount = columns();
  return `${index % columnCount + 1}列 ${Math.floor(index / columnCount) + 1}行`;
}

function renderHolePicker() {
  const total = cellCount();
  elements.holePicker.replaceChildren();
  elements.holePicker.style.gridTemplateColumns = `repeat(${columns()}, minmax(0, 1fr))`;
  for (let index = 0; index < total; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-assigned", index === holeIndex());
    button.setAttribute("aria-label", `${holeName(index)} を欠けたマスにする`);
    const label = document.createElement("span");
    label.textContent = String(index + 1);
    button.append(label);
    button.addEventListener("click", () => {
      state.holeIndex = index;
      rebuildAndReset();
    });
    elements.holePicker.append(button);
  }
  elements.holeLabel.value = holeName(holeIndex());
}

function updateLabels() {
  elements.gridColumnsValue.value = `${columns()} マス`;
  elements.gridRowsValue.value = `${rows()} マス`;
  elements.gridArea.value = `${columns()} × ${rows()}`;
  elements.tileGapValue.value = `${elements.tileGap.value} px`;
  elements.cornerRadiusValue.value = `${elements.cornerRadius.value} px`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.moveCountValue.value = `${state.moves.length} 手`;
  elements.moveDurationValue.value = `${moveTime().toFixed(2)} 秒 / ${Math.round(moveTime() * 60)}f`;
  elements.moveIntervalValue.value = `${moveInterval().toFixed(2)} 秒 / ${Math.round(moveInterval() * 60)}f`;
  elements.requiredTime.value = `必要 ${requiredSeconds().toFixed(1)} 秒`;
  elements.sourceMeta.textContent = elements.sourceMode.value === "image" ? "画像" : "文字";
  [elements.textColor, elements.backgroundColor, elements.holeColor]
    .forEach((control) => { control.nextElementSibling.value = control.value.toUpperCase(); });
}

function setMessage(message) {
  elements.canvasMessage.hidden = !message;
  if (message) elements.canvasMessage.textContent = message;
}

const player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => Number(elements.duration.value),
  isReady: () => state.moves.length > 0 && (elements.sourceMode.value !== "image" || Boolean(state.image)),
  render,
  onControlChange: saveSettings,
  getFileBase: () => (elements.sourceMode.value === "image"
    ? `${state.imageName.replace(/\.[^.]+$/, "") || "image"}-puzzle`
    : `${elements.textInput.value.trim() || "puzzle"}-slide`),
});

function rebuildAndReset() {
  buildPuzzle();
  refreshSource();
  renderHolePicker();
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

// --- local fonts -----------------------------------------------------------

async function applyLocalFont(buffer, name) {
  const family = await MotionFonts.registerFontFile(buffer, "SlidePuzzleLocal");
  state.localFontFamily = family;
  state.localFontName = name;
  elements.fontFileName.textContent = name;
  elements.fontClear.hidden = false;
  saveSettings();
  refreshSource();
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
  refreshSource();
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

// --- image input -----------------------------------------------------------

async function loadImage(file) {
  try {
    const loaded = await MotionToolkit.loadImageFile(file);
    state.image = loaded.image;
    state.imageName = loaded.name;
    state.imageBytes = loaded.bytes;
    elements.fileName.textContent = loaded.name;
    elements.fileMeta.textContent = `${(loaded.bytes / 1024).toFixed(loaded.bytes > 1024 * 1024 ? 0 : 1)} KB`;
    setMessage();
    refreshSource();
    resetAndRender();
  } catch (error) {
    player.showToast(error?.message || "画像を読み込めませんでした");
  }
}

function updateSourceMode() {
  const isImage = elements.sourceMode.value === "image";
  elements.textSource.hidden = isImage;
  elements.imageSource.hidden = !isImage;
  setMessage(isImage && !state.image ? "画像を選択してください" : "");
}

// --- wiring ----------------------------------------------------------------

elements.sourceMode.addEventListener("change", () => {
  updateSourceMode();
  refreshSource();
  resetAndRender();
});
elements.textInput.addEventListener("input", () => {
  refreshSource();
  resetAndRender();
});
elements.imageFit.addEventListener("change", () => {
  refreshSource();
  resetAndRender();
});
[elements.gridColumns, elements.gridRows].forEach((control) => control.addEventListener("input", () => {
  // A different board size invalidates the hole and the scramble alike.
  state.holeIndex = -1;
  rebuildAndReset();
}));
[elements.tileGap, elements.cornerRadius].forEach((control) => control.addEventListener("input", () => {
  refreshSource();
  resetAndRender();
}));
elements.showNumbers.addEventListener("change", resetAndRender);
[elements.backgroundColor, elements.holeColor, elements.textColor].forEach((control) => control.addEventListener("input", () => {
  refreshSource();
  resetAndRender();
}));
elements.moveCount.addEventListener("input", rebuildAndReset);
[elements.duration, elements.moveDuration, elements.moveInterval].forEach((control) => control.addEventListener("input", resetAndRender));
elements.easing.addEventListener("change", resetAndRender);
elements.matchDuration.addEventListener("click", () => {
  const needed = clamp(Math.ceil(requiredSeconds() * 2) / 2, Number(elements.duration.min), Number(elements.duration.max));
  elements.duration.value = String(needed);
  elements.duration.dispatchEvent(new Event("input", { bubbles: true }));
  player.showToast(`全体時間を${needed.toFixed(1)}秒にしました`);
});
elements.shuffle.addEventListener("click", () => {
  state.seed = Date.now();
  rebuildAndReset();
  player.showToast("バラし方を再抽選しました");
});
elements.fontStyle.addEventListener("change", async () => {
  if (elements.fontStyle.value !== state.lastFontStyle) await clearLocalFont(false);
  state.lastFontStyle = elements.fontStyle.value;
  refreshSource();
  resetAndRender();
});
elements.fontFile.addEventListener("change", () => loadLocalFont(elements.fontFile.files?.[0]));
elements.fontClear.addEventListener("click", () => clearLocalFont());
elements.fileSummary.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files?.[0];
  if (file) loadImage(file);
});
["dragover", "dragleave", "drop"].forEach((type) => elements.fileSummary.addEventListener(type, (event) => {
  event.preventDefault();
  elements.fileSummary.classList.toggle("is-dragging", type === "dragover");
  if (type === "drop") {
    const file = event.dataTransfer?.files?.[0];
    if (file) loadImage(file);
  }
}));
elements.outputSize.addEventListener("change", () => {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  refreshSource();
  resetAndRender();
});

const restoredSettings = restoreSettings();
MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
updateSourceMode();
buildPuzzle();
refreshSource();
renderHolePicker();
updateLabels();
player.update();
render(0);
restoreLocalFont(restoredSettings);
