"use strict";

const POLYOMINO_SETTINGS_KEY = "motion-lab:polyomino-motion-settings:v1";
const FONT_DATABASE_NAME = "motion-lab-assets";
const FONT_STORE_NAME = "fonts";
const FONT_ASSET_KEY = "polyomino-motion-local-font";
const SETTLED_COLOR = "#e0041d";
const FONT_SIZE_RATIO = 0.58;
const INTERNAL_GRID_WIDTH = 2;
const PALETTES = {
  warm: ["#f4a38d", "#f5c36f", "#efda78", "#ee9287", "#f5b093", "#e5a17e", "#f6cf92"],
  ocean: ["#88c6d0", "#9bd6d8", "#a9ddd4", "#92b9d8", "#a5d0e2", "#8dc8c1", "#b9dce4"],
  candy: ["#efa5c1", "#bfb0df", "#f3ad9a", "#9dd5cf", "#f0cf8b", "#adb9e1", "#dfadd2"],
  mono: ["#aeb7bc", "#c0c7cb", "#d1d6d9", "#e0e4e6", "#b8c0c4", "#c8ced1", "#d7dcde"],
};

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  textHint: document.querySelector("#textHint"),
  gridColumns: document.querySelector("#gridColumns"),
  gridRows: document.querySelector("#gridRows"),
  gridArea: document.querySelector("#gridArea"),
  minoSize: document.querySelector("#minoSize"),
  minoSummary: document.querySelector("#minoSummary"),
  shuffle: document.querySelector("#shuffleButton"),
  palette: document.querySelector("#palette"),
  fontStyle: document.querySelector("#fontStyle"),
  fontFile: document.querySelector("#fontFile"),
  fontFileName: document.querySelector("#fontFileName"),
  fontClear: document.querySelector("#fontClearButton"),
  textColor: document.querySelector("#textColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  moveDuration: document.querySelector("#moveDuration"),
  moveDurationValue: document.querySelector("#moveDurationValue"),
  returnOrder: document.querySelector("#returnOrder"),
  stagger: document.querySelector("#stagger"),
  staggerValue: document.querySelector("#staggerValue"),
  easing: document.querySelector("#easing"),
  showGuide: document.querySelector("#showGuide"),
  imageTime: document.querySelector("#imageTime"),
  stageStatus: document.querySelector("#stageStatus"),
  previewSpeed: document.querySelector("#previewSpeed"),
};

const context = elements.canvas.getContext("2d");
const state = {
  seed: Date.now(),
  pieces: [],
  placements: [],
  packing: null,
  localFontFamily: "",
  localFontName: "",
  lastFontStyle: elements.fontStyle.value,
};
let player = null;

function openFontDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(FONT_DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(FONT_STORE_NAME)) request.result.createObjectStore(FONT_STORE_NAME);
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
    // The tool remains usable when browser storage is unavailable.
  }
}

function updateFontUI() {
  elements.fontFileName.textContent = state.localFontName || "端末内のフォント";
  elements.fontClear.hidden = !state.localFontName;
}

async function applyLocalFont(buffer, name) {
  const family = `PolyominoMotionLocal${Date.now()}`;
  const font = new FontFace(family, buffer);
  await font.load();
  document.fonts.add(font);
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
    await writeFontAsset({ buffer, name: file.name });
    player.showToast(`${file.name}を適用しました`);
  } catch {
    player.showToast("フォントを読み込めませんでした");
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
    updateFontUI();
    saveSettings();
  }
}

async function clearLocalFont(showMessage = false) {
  state.localFontFamily = "";
  state.localFontName = "";
  updateFontUI();
  await deleteFontAsset();
  saveSettings();
  render();
  if (showMessage) player.showToast("端末内フォントを解除しました");
}

function dimensions() {
  return {
    columns: Number(elements.gridColumns.value),
    rows: Number(elements.gridRows.value),
  };
}

function boardArea() {
  const { columns, rows } = dimensions();
  return columns * rows;
}

function minoSize() {
  return Number(elements.minoSize.value);
}

function boardCharacters() {
  return MotionToolkit.graphemes(elements.textInput.value).filter((character) => character !== "\n" && character !== "\r");
}

function saveSettings() {
  MotionStorage.write(POLYOMINO_SETTINGS_KEY, {
    text: elements.textInput.value,
    gridColumns: elements.gridColumns.value,
    gridRows: elements.gridRows.value,
    minoSize: elements.minoSize.value,
    seed: state.seed,
    palette: elements.palette.value,
    fontStyle: elements.fontStyle.value,
    localFontName: state.localFontName,
    textColor: elements.textColor.value,
    backgroundColor: elements.backgroundColor.value,
    duration: elements.duration.value,
    moveDuration: elements.moveDuration.value,
    returnOrder: elements.returnOrder.value,
    stagger: elements.stagger.value,
    easing: elements.easing.value,
    showGuide: elements.showGuide.checked,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(POLYOMINO_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.text === "string") elements.textInput.value = settings.text;
  ["gridColumns", "gridRows", "palette", "fontStyle", "textColor", "backgroundColor", "duration", "moveDuration", "returnOrder", "stagger", "easing", "previewSpeed", "imageTime"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (typeof settings.showGuide === "boolean") elements.showGuide.checked = settings.showGuide;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  state.lastFontStyle = elements.fontStyle.value;
  return settings;
}

function divisors(value) {
  const result = [];
  for (let candidate = 1; candidate <= value; candidate += 1) {
    if (value % candidate === 0) result.push(candidate);
  }
  return result;
}

function updateMinoOptions(preferredValue = Number(elements.minoSize.value)) {
  const area = boardArea();
  const values = divisors(area);
  let selected = Number(preferredValue);
  if (!values.includes(selected)) {
    selected = values.reduce((best, value) => Math.abs(value - preferredValue) < Math.abs(best - preferredValue) ? value : best, values[0]);
  }
  elements.minoSize.replaceChildren();
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} マス / ${area / value} ミノ`;
    elements.minoSize.append(option);
  });
  elements.minoSize.value = String(selected);
}

function neighborIndexes(index, columns, rows) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const result = [];
  if (column > 0) result.push(index - 1);
  if (column + 1 < columns) result.push(index + 1);
  if (row > 0) result.push(index - columns);
  if (row + 1 < rows) result.push(index + columns);
  return result;
}

function remainingComponentSizes(remaining, columns, rows) {
  const unseen = new Set(remaining);
  const sizes = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    const queue = [first];
    unseen.delete(first);
    let size = 0;
    while (queue.length) {
      const current = queue.pop();
      size += 1;
      neighborIndexes(current, columns, rows).forEach((neighbor) => {
        if (!unseen.has(neighbor)) return;
        unseen.delete(neighbor);
        queue.push(neighbor);
      });
    }
    sizes.push(size);
  }
  return sizes;
}

function growConnectedPiece(seed, remaining, size, columns, rows, random) {
  const piece = new Set([seed]);
  while (piece.size < size) {
    const frontier = new Set();
    piece.forEach((cell) => {
      neighborIndexes(cell, columns, rows).forEach((neighbor) => {
        if (remaining.has(neighbor) && !piece.has(neighbor)) frontier.add(neighbor);
      });
    });
    if (!frontier.size) return null;
    const candidates = [...frontier].map((cell) => {
      const openNeighbors = neighborIndexes(cell, columns, rows).filter((neighbor) => remaining.has(neighbor) && !piece.has(neighbor)).length;
      const touches = neighborIndexes(cell, columns, rows).filter((neighbor) => piece.has(neighbor)).length;
      return { cell, score: openNeighbors * 0.24 - touches * 0.4 + random() };
    }).sort((a, b) => a.score - b.score);
    const choiceWindow = Math.min(3, candidates.length);
    piece.add(candidates[Math.floor(random() * choiceWindow)].cell);
  }
  return [...piece];
}

function fallbackSnakePartition(columns, rows, size, random) {
  const path = [];
  const vertical = random() < 0.5;
  const flipPrimary = random() < 0.5;
  const flipSecondary = random() < 0.5;
  if (!vertical) {
    const rowOrder = Array.from({ length: rows }, (_, index) => flipPrimary ? rows - 1 - index : index);
    rowOrder.forEach((row, orderIndex) => {
      const reverse = (orderIndex % 2 === 1) !== flipSecondary;
      for (let step = 0; step < columns; step += 1) {
        const column = reverse ? columns - 1 - step : step;
        path.push(row * columns + column);
      }
    });
  } else {
    const columnOrder = Array.from({ length: columns }, (_, index) => flipPrimary ? columns - 1 - index : index);
    columnOrder.forEach((column, orderIndex) => {
      const reverse = (orderIndex % 2 === 1) !== flipSecondary;
      for (let step = 0; step < rows; step += 1) {
        const row = reverse ? rows - 1 - step : step;
        path.push(row * columns + column);
      }
    });
  }
  const pieces = [];
  for (let index = 0; index < path.length; index += size) pieces.push(path.slice(index, index + size));
  return pieces;
}

function randomPartition(columns, rows, size, random) {
  const total = columns * rows;
  if (size === 1) return Array.from({ length: total }, (_, index) => [index]);
  if (size === total) return [Array.from({ length: total }, (_, index) => index)];
  let budget = Math.max(3600, total * 46);

  function solve(remaining, pieces) {
    if (!remaining.size) return pieces;
    if (budget <= 0) return null;
    if (remaining.size === size) return [...pieces, [...remaining]];

    const seeds = [...remaining].map((cell) => ({
      cell,
      degree: neighborIndexes(cell, columns, rows).filter((neighbor) => remaining.has(neighbor)).length,
      jitter: random(),
    })).sort((a, b) => a.degree - b.degree || a.jitter - b.jitter);
    const seed = seeds[0].cell;
    const seen = new Set();
    const attempts = Math.min(72, 20 + size * 3);
    for (let attempt = 0; attempt < attempts && budget > 0; attempt += 1) {
      budget -= 1;
      const candidate = growConnectedPiece(seed, remaining, size, columns, rows, random);
      if (!candidate) continue;
      const key = [...candidate].sort((a, b) => a - b).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const next = new Set(remaining);
      candidate.forEach((cell) => next.delete(cell));
      if (remainingComponentSizes(next, columns, rows).some((componentSize) => componentSize % size !== 0)) continue;
      const solved = solve(next, [...pieces, candidate]);
      if (solved) return solved;
    }
    return null;
  }

  const remaining = new Set(Array.from({ length: total }, (_, index) => index));
  return solve(remaining, []) || fallbackSnakePartition(columns, rows, size, random);
}

function rotatedShape(piece, quarterTurns) {
  const { columns } = dimensions();
  const source = piece.cells.map((cell) => ({ x: cell % columns, y: Math.floor(cell / columns) }));
  const minX = Math.min(...source.map((cell) => cell.x));
  const minY = Math.min(...source.map((cell) => cell.y));
  let cells = source.map((cell) => ({ x: cell.x - minX, y: cell.y - minY }));
  let width = Math.max(...cells.map((cell) => cell.x)) + 1;
  let height = Math.max(...cells.map((cell) => cell.y)) + 1;
  for (let turn = 0; turn < quarterTurns; turn += 1) {
    cells = cells.map((cell) => ({ x: height - 1 - cell.y, y: cell.x }));
    [width, height] = [height, width];
  }
  return {
    cells,
    width,
    height,
    centerX: cells.reduce((sum, cell) => sum + cell.x + 0.5, 0) / cells.length,
    centerY: cells.reduce((sum, cell) => sum + cell.y + 0.5, 0) / cells.length,
  };
}

function shelfPack(items, maximumWidth, gap) {
  const shelves = [];
  const positions = new Array(items.length);
  const ordered = [...items].sort((a, b) => b.shape.height - a.shape.height || b.shape.width - a.shape.width || a.id - b.id);
  ordered.forEach((item) => {
    let shelf = shelves.find((candidate) => candidate.used + (candidate.used ? gap : 0) + item.shape.width <= maximumWidth + 0.001);
    if (!shelf) {
      const y = shelves.length ? shelves[shelves.length - 1].y + shelves[shelves.length - 1].height + gap : 0;
      shelf = { y, height: item.shape.height, used: 0 };
      shelves.push(shelf);
    }
    const x = shelf.used ? shelf.used + gap : 0;
    positions[item.id] = { x, y: shelf.y };
    shelf.used = x + item.shape.width;
  });
  return {
    positions,
    width: Math.max(0, ...shelves.map((shelf) => shelf.used)),
    height: shelves.length ? shelves[shelves.length - 1].y + shelves[shelves.length - 1].height : 0,
  };
}

function buildPlacements(random) {
  const gap = 0.42;
  const majorGap = 0.9;
  const items = state.pieces.map((piece) => {
    const quarterTurns = Math.floor(random() * 4);
    return { id: piece.id, quarterTurns, shape: rotatedShape(piece, quarterTurns) };
  });
  const widest = Math.max(...items.map((item) => item.shape.width));
  const totalWidth = items.reduce((sum, item) => sum + item.shape.width, 0) + gap * Math.max(0, items.length - 1);
  const { columns, rows } = dimensions();
  let best = null;
  for (let maximumWidth = widest; maximumWidth <= totalWidth + 0.001; maximumWidth += 0.5) {
    const packed = shelfPack(items, maximumWidth, gap);
    const sideWidth = columns + majorGap + packed.width;
    const sideHeight = Math.max(rows, packed.height);
    const sideCellSize = Math.min(elements.canvas.width * 0.88 / sideWidth, elements.canvas.height * 0.8 / sideHeight);
    const stackWidth = Math.max(columns, packed.width);
    const stackHeight = rows + majorGap + packed.height;
    const stackCellSize = Math.min(elements.canvas.width * 0.88 / stackWidth, elements.canvas.height * 0.8 / stackHeight);
    const orientation = sideCellSize >= stackCellSize ? "side" : "stack";
    const cellSize = Math.max(sideCellSize, stackCellSize);
    if (!best || cellSize > best.cellSize) best = { ...packed, orientation, cellSize, gap, majorGap };
  }
  state.packing = best;
  state.placements = items.map((item) => ({
    quarterTurns: item.quarterTurns,
    shape: item.shape,
    packX: best.positions[item.id].x,
    packY: best.positions[item.id].y,
  }));
}

function sceneLayout() {
  const { columns, rows } = dimensions();
  const packing = state.packing;
  const side = packing.orientation === "side";
  const totalWidth = side ? columns + packing.majorGap + packing.width : Math.max(columns, packing.width);
  const totalHeight = side ? Math.max(rows, packing.height) : rows + packing.majorGap + packing.height;
  const cellSize = Math.min(elements.canvas.width * 0.88 / totalWidth, elements.canvas.height * 0.8 / totalHeight);
  const originX = (elements.canvas.width - totalWidth * cellSize) / 2;
  const originY = (elements.canvas.height - totalHeight * cellSize) / 2;
  const boardX = side ? originX : originX + (totalWidth - columns) * cellSize / 2;
  const boardY = side ? originY + (totalHeight - rows) * cellSize / 2 : originY;
  const trayX = side ? originX + (columns + packing.majorGap) * cellSize : originX + (totalWidth - packing.width) * cellSize / 2;
  const trayY = side ? originY + (totalHeight - packing.height) * cellSize / 2 : originY + (rows + packing.majorGap) * cellSize;
  return {
    board: {
      columns,
      rows,
      cellSize,
      width: columns * cellSize,
      height: rows * cellSize,
      x: boardX,
      y: boardY,
    },
    tray: { x: trayX, y: trayY, width: packing.width * cellSize, height: packing.height * cellSize },
  };
}

function cellPosition(index, layout) {
  return {
    column: index % layout.columns,
    row: Math.floor(index / layout.columns),
    x: layout.x + index % layout.columns * layout.cellSize,
    y: layout.y + Math.floor(index / layout.columns) * layout.cellSize,
  };
}

function pieceCenter(piece, layout) {
  let x = 0;
  let y = 0;
  piece.cells.forEach((cell) => {
    const position = cellPosition(cell, layout);
    x += position.x + layout.cellSize / 2;
    y += position.y + layout.cellSize / 2;
  });
  return { x: x / piece.cells.length, y: y / piece.cells.length };
}

function rebuildPieces() {
  const { columns, rows } = dimensions();
  const random = MotionToolkit.seededRandom(state.seed + columns * 1009 + rows * 917 + minoSize() * 613);
  const groups = randomPartition(columns, rows, minoSize(), random);
  const randomOrder = groups.map((_, index) => index);
  for (let index = randomOrder.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [randomOrder[index], randomOrder[swap]] = [randomOrder[swap], randomOrder[index]];
  }
  state.pieces = groups.map((cells, id) => ({
    id,
    cells: [...cells].sort((a, b) => a - b),
    readingIndex: Math.min(...cells),
    randomRank: randomOrder.indexOf(id),
  }));
  buildPlacements(random);
}

function readingRanks() {
  const sorted = [...state.pieces].sort((a, b) => a.readingIndex - b.readingIndex);
  return new Map(sorted.map((piece, rank) => [piece.id, rank]));
}

function pieceRank(piece) {
  const mode = elements.returnOrder.value;
  if (mode === "simultaneous") return 0;
  const readingRank = readingRanks().get(piece.id);
  if (mode === "reading") return readingRank;
  if (mode === "reverse") return state.pieces.length - 1 - readingRank;
  return piece.randomRank;
}

function pieceLocalProgress(piece, progress) {
  const simultaneous = elements.returnOrder.value === "simultaneous";
  const maxRank = Math.max(1, state.pieces.length - 1);
  const total = Number(elements.duration.value);
  const moveTime = Math.min(total, Math.max(0.1, Number(elements.moveDuration.value)));
  const startWindow = Math.max(0, total - moveTime) * Number(elements.stagger.value) / 100;
  const delay = simultaneous ? 0 : startWindow * pieceRank(piece) / maxRank;
  return MotionToolkit.clamp((progress * total - delay) / moveTime, 0, 1);
}

function pieceStartInterval() {
  if (elements.returnOrder.value === "simultaneous" || state.pieces.length <= 1) return 0;
  const total = Number(elements.duration.value);
  const moveTime = Math.min(total, Math.max(0.1, Number(elements.moveDuration.value)));
  return Math.max(0, total - moveTime) * Number(elements.stagger.value) / 100 / (state.pieces.length - 1);
}

function pieceAmount(piece, progress) {
  return MotionToolkit.ease(pieceLocalProgress(piece, progress), elements.easing.value);
}

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Noto Serif JP", serif';
  if (elements.fontStyle.value === "mono") return '"SFMono-Regular", Consolas, "Noto Sans Mono", monospace';
  return 'Inter, "Segoe UI", "Noto Sans JP", sans-serif';
}

function mixHexColor(from, to, amount) {
  const read = (color, offset) => Number.parseInt(color.slice(offset, offset + 2), 16);
  const channel = (start, end) => Math.round(MotionToolkit.lerp(start, end, amount)).toString(16).padStart(2, "0");
  return `#${channel(read(from, 1), read(to, 1))}${channel(read(from, 3), read(to, 3))}${channel(read(from, 5), read(to, 5))}`;
}

function cellColor(cell) {
  const colors = PALETTES[elements.palette.value] || PALETTES.warm;
  const { columns, rows } = dimensions();
  const column = cell % columns;
  const row = Math.floor(cell / columns);
  const horizontal = column / Math.max(1, columns - 1);
  const vertical = row / Math.max(1, rows - 1);
  const position = (horizontal + vertical) / 2 * (colors.length - 1);
  const start = Math.min(colors.length - 1, Math.floor(position));
  const end = Math.min(colors.length - 1, start + 1);
  return mixHexColor(colors[start], colors[end], position - start);
}

function drawGuide(layout, progress) {
  const visible = elements.showGuide.checked ? 0.28 + progress * 0.06 : progress >= 0.999 ? 0.16 : 0;
  if (visible <= 0) return;
  context.save();
  context.fillStyle = `rgba(255,255,255,${0.36 + progress * 0.22})`;
  context.fillRect(layout.x, layout.y, layout.width, layout.height);
  context.lineWidth = Math.max(1.25, elements.canvas.width * 1.25 / 1000);
  context.strokeStyle = `rgba(23,33,40,${visible})`;
  for (let column = 0; column <= layout.columns; column += 1) {
    const x = layout.x + column * layout.cellSize;
    context.beginPath();
    context.moveTo(x, layout.y);
    context.lineTo(x, layout.y + layout.height);
    context.stroke();
  }
  for (let row = 0; row <= layout.rows; row += 1) {
    const y = layout.y + row * layout.cellSize;
    context.beginPath();
    context.moveTo(layout.x, y);
    context.lineTo(layout.x + layout.width, y);
    context.stroke();
  }
  context.lineWidth = Math.max(2, elements.canvas.width * 2 / 1000);
  context.strokeStyle = `rgba(23,33,40,${Math.min(0.58, visible + 0.16)})`;
  context.strokeRect(layout.x, layout.y, layout.width, layout.height);
  context.restore();
}

function drawCellText(character, x, y, cellSize) {
  if (!character || /^\s$/u.test(character)) return;
  let fontSize = cellSize * FONT_SIZE_RATIO;
  context.font = `800 ${fontSize}px ${fontFamily()}`;
  const width = context.measureText(character).width;
  if (width > cellSize * 0.76) {
    fontSize *= cellSize * 0.76 / width;
    context.font = `800 ${fontSize}px ${fontFamily()}`;
  }
  context.fillStyle = elements.textColor.value;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(character, x + cellSize / 2, y + cellSize / 2 + fontSize * 0.025);
}

function drawPiece(piece, scene, progress, characters) {
  const layout = scene.board;
  const amount = pieceAmount(piece, progress);
  const settled = pieceLocalProgress(piece, progress) >= 0.999;
  const target = pieceCenter(piece, layout);
  const placement = state.placements[piece.id];
  const startX = scene.tray.x + (placement.packX + placement.shape.centerX) * layout.cellSize;
  const startY = scene.tray.y + (placement.packY + placement.shape.centerY) * layout.cellSize;
  const currentX = MotionToolkit.lerp(startX, target.x, amount);
  const currentY = MotionToolkit.lerp(startY, target.y, amount);
  const signedTurns = [0, 1, 2, -1][placement.quarterTurns];
  const angle = signedTurns * Math.PI / 2 * (1 - amount);
  const cellSet = new Set(piece.cells);

  context.save();
  context.translate(currentX, currentY);
  context.rotate(angle);
  context.translate(-target.x, -target.y);

  context.beginPath();
  piece.cells.forEach((cell) => {
    const position = cellPosition(cell, layout);
    context.rect(position.x, position.y, layout.cellSize + 0.25, layout.cellSize + 0.25);
  });
  context.shadowColor = `rgba(25,31,34,${0.2 * (1 - Math.min(1, amount)) + 0.06})`;
  context.shadowBlur = layout.cellSize * (0.1 * (1 - Math.min(1, amount)) + 0.02);
  context.shadowOffsetY = layout.cellSize * (0.045 * (1 - Math.min(1, amount)) + 0.01);
  context.fillStyle = cellColor(piece.readingIndex);
  context.fill();
  context.shadowColor = "transparent";
  piece.cells.forEach((cell) => {
    const position = cellPosition(cell, layout);
    context.fillStyle = cellColor(cell);
    context.fillRect(position.x, position.y, layout.cellSize + 0.25, layout.cellSize + 0.25);
  });

  const internalLine = Math.max(1, INTERNAL_GRID_WIDTH * elements.canvas.width / 1000);
  context.lineWidth = internalLine;
  context.strokeStyle = "#f7f3eb";
  context.beginPath();
  piece.cells.forEach((cell) => {
    const position = cellPosition(cell, layout);
    if (cellSet.has(cell + 1) && cell % layout.columns !== layout.columns - 1) {
      context.moveTo(position.x + layout.cellSize, position.y);
      context.lineTo(position.x + layout.cellSize, position.y + layout.cellSize);
    }
    if (cellSet.has(cell + layout.columns)) {
      context.moveTo(position.x, position.y + layout.cellSize);
      context.lineTo(position.x + layout.cellSize, position.y + layout.cellSize);
    }
  });
  context.stroke();

  context.beginPath();
  piece.cells.forEach((cell) => {
    const position = cellPosition(cell, layout);
    const left = position.x;
    const right = position.x + layout.cellSize;
    const top = position.y;
    const bottom = position.y + layout.cellSize;
    if (!cellSet.has(cell - 1) || cell % layout.columns === 0) { context.moveTo(left, top); context.lineTo(left, bottom); }
    if (!cellSet.has(cell + 1) || cell % layout.columns === layout.columns - 1) { context.moveTo(right, top); context.lineTo(right, bottom); }
    if (!cellSet.has(cell - layout.columns)) { context.moveTo(left, top); context.lineTo(right, top); }
    if (!cellSet.has(cell + layout.columns)) { context.moveTo(left, bottom); context.lineTo(right, bottom); }
  });
  context.lineWidth = Math.max(1.8, layout.cellSize * 0.028);
  context.lineJoin = "round";
  context.strokeStyle = settled ? SETTLED_COLOR : "rgba(23,33,40,.56)";
  context.stroke();

  piece.cells.forEach((cell) => {
    const position = cellPosition(cell, layout);
    drawCellText(characters[cell], position.x, position.y, layout.cellSize);
  });
  context.restore();
}

function render(progress = player?.state.playhead || 0) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  const scene = sceneLayout();
  drawGuide(scene.board, progress);
  const characters = boardCharacters().slice(0, boardArea());
  state.pieces.forEach((piece) => drawPiece(piece, scene, progress, characters));
  context.restore();
}

function updateLabels(progress = player?.state.playhead || 0) {
  const area = boardArea();
  const size = minoSize();
  const pieceCount = area / size;
  const characterCount = boardCharacters().length;
  elements.gridArea.value = `${area} マス`;
  elements.characterCount.value = `${Math.min(characterCount, area)} / ${area}`;
  if (characterCount > area) elements.textHint.textContent = `先頭から${area}文字を配置します。残り${characterCount - area}文字は盤面には表示されません。`;
  else if (characterCount < area) elements.textHint.textContent = `完成すると左上から右へ読めます。残り${area - characterCount}マスは空白になります。`;
  else elements.textHint.textContent = "完成すると、左上から右へ正しい順番で読めます。改行は詰めて配置します。";
  const summaryValues = elements.minoSummary.querySelectorAll("b");
  summaryValues[0].textContent = size;
  summaryValues[1].textContent = pieceCount;
  summaryValues[2].textContent = area;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.moveDuration.max = elements.duration.value;
  if (Number(elements.moveDuration.value) > Number(elements.duration.value)) elements.moveDuration.value = elements.duration.value;
  const moveTime = Number(elements.moveDuration.value);
  elements.moveDurationValue.value = `${moveTime.toFixed(1)} 秒 / ${Math.round(moveTime * 60)}f`;
  const interval = pieceStartInterval();
  elements.staggerValue.value = elements.returnOrder.value === "simultaneous" ? "同時" : `${elements.stagger.value}% · ${interval.toFixed(2)}秒 / ${Math.round(interval * 60)}f`;
  elements.stagger.disabled = elements.returnOrder.value === "simultaneous";
  [elements.textColor, elements.backgroundColor].forEach((control) => { control.nextElementSibling.value = control.value.toUpperCase(); });
  const settled = state.pieces.filter((piece) => pieceLocalProgress(piece, progress) >= 0.999).length;
  if (settled === state.pieces.length && state.pieces.length) elements.stageStatus.textContent = `完成 · ${dimensions().columns} × ${dimensions().rows} · ${pieceCount} ミノ`;
  else elements.stageStatus.textContent = `${settled} / ${pieceCount} ミノ 確定`;
}

function resetAndRender() {
  player.reset();
  player.update();
  updateLabels();
  saveSettings();
  render();
}

function rebuildAndReset() {
  rebuildPieces();
  resetAndRender();
}

const restoredSettings = restoreSettings();
updateMinoOptions(Number(restoredSettings?.minoSize || 5));
rebuildPieces();
updateFontUI();

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  isReady: () => state.pieces.length > 0,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => `${dimensions().columns}x${dimensions().rows}-${minoSize()}cell-polyomino-type`,
});

elements.textInput.addEventListener("input", resetAndRender);
[elements.gridColumns, elements.gridRows].forEach((control) => control.addEventListener("change", () => {
  const previousSize = minoSize();
  updateMinoOptions(previousSize);
  state.seed = Date.now();
  rebuildAndReset();
}));
elements.minoSize.addEventListener("change", () => {
  state.seed = Date.now();
  rebuildAndReset();
});
elements.shuffle.addEventListener("click", () => {
  state.seed = Date.now();
  rebuildAndReset();
  player.showToast("ミノの形と初期配置を再抽選しました");
});
[elements.duration, elements.moveDuration, elements.stagger]
  .forEach((control) => control.addEventListener("input", resetAndRender));
[elements.returnOrder, elements.easing]
  .forEach((control) => control.addEventListener("change", resetAndRender));
elements.palette.addEventListener("change", () => { saveSettings(); updateLabels(); render(); });
elements.fontStyle.addEventListener("change", async () => {
  if (elements.fontStyle.value !== state.lastFontStyle) await clearLocalFont(false);
  state.lastFontStyle = elements.fontStyle.value;
  saveSettings();
  render();
});
elements.fontFile.addEventListener("change", async () => {
  await loadLocalFont(elements.fontFile.files[0]);
  elements.fontFile.value = "";
});
elements.fontClear.addEventListener("click", () => clearLocalFont(true));
[elements.textColor, elements.backgroundColor]
  .forEach((control) => control.addEventListener("input", () => { saveSettings(); updateLabels(); render(); }));
elements.showGuide.addEventListener("change", () => { saveSettings(); render(); });
updateLabels();
render();
restoreLocalFont(restoredSettings);
