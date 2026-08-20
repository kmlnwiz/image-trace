"use strict";

const POLYOMINO_SETTINGS_KEY = "motion-lab:polyomino-motion-settings:v1";
const FONT_ASSET_KEY = "polyomino-motion-local-font";
const SETTLED_COLOR = "#e0041d";
const FONT_SIZE_RATIO = 0.58;
const TRIANGLE_FONT_SIZE_RATIO = 0.32;
const INTERNAL_GRID_WIDTH = 2;
const TRIANGLE_HEIGHT = Math.sqrt(3) / 2;
const PALETTES = {
  warm: ["#ef918b", "#f3ad82", "#f5c97c", "#f1df93"],
  ocean: ["#91b9df", "#8fcbdc", "#92d8cd", "#b8e1c1"],
  candy: ["#efa5c6", "#d3addd", "#b7bce4", "#9bd8d1"],
  mono: ["#aeb7bc", "#c1c8cc", "#d2d7da", "#e1e5e7"],
  forest: ["#7fa981", "#9cbd82", "#bcd191", "#d9e2ac"],
  sunset: ["#f08a7c", "#f0a191", "#dfa0b2", "#b79ac8"],
  berry: ["#c98098", "#d894ac", "#b78ec4", "#8f8dc6"],
  citrus: ["#f2d072", "#e9c05f", "#c8cc6c", "#a4c98a"],
  slate: ["#8fa3b4", "#a5b6c3", "#b9c6cf", "#ccd5db"],
  sand: ["#d8b892", "#e2c8a5", "#e8d6ba", "#efe4d2"],
  sakura: ["#f2b8c6", "#f6c9d4", "#f0d3d8", "#e8dde4"],
  neon: ["#5fd0d8", "#7ad3a8", "#e8d566", "#f0908f"],
  night: ["#4d5f78", "#5f7590", "#7c8fa8", "#9aa9bd"],
  earth: ["#b08968", "#c19a76", "#a9a380", "#93a58c"],
};

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  textHint: document.querySelector("#textHint"),
  gridType: document.querySelector("#gridType"),
  rectangleGridControls: document.querySelector("#rectangleGridControls"),
  triangleGridControls: document.querySelector("#triangleGridControls"),
  gridColumns: document.querySelector("#gridColumns"),
  gridRows: document.querySelector("#gridRows"),
  hexSide: document.querySelector("#hexSide"),
  gridArea: document.querySelector("#gridArea"),
  gridHint: document.querySelector("#gridHint"),
  minoSize: document.querySelector("#minoSize"),
  minoSummary: document.querySelector("#minoSummary"),
  shuffle: document.querySelector("#shuffleButton"),
  palette: document.querySelector("#palette"),
  colorOrder: document.querySelector("#colorOrder"),
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
  orderEditor: document.querySelector("#orderPickerEditor"),
  orderGrid: document.querySelector("#orderPickerGrid"),
  orderCount: document.querySelector("#orderPickerCount"),
  orderAllButton: document.querySelector("#orderPickerAllButton"),
  orderClearButton: document.querySelector("#orderPickerClearButton"),
  stagger: document.querySelector("#stagger"),
  staggerValue: document.querySelector("#staggerValue"),
  easing: document.querySelector("#easing"),
  showGuide: document.querySelector("#showGuide"),
  imageTime: document.querySelector("#imageTime"),
  stageStatus: document.querySelector("#stageStatus"),
  previewSpeed: document.querySelector("#previewSpeed"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
  fixedPiecePicker: document.querySelector("#fixedPiecePicker"),
  fixedPieceCount: document.querySelector("#fixedPieceCount"),
  clearFixedPieces: document.querySelector("#clearFixedPiecesButton"),
  selectAllFixedPieces: document.querySelector("#selectAllFixedPiecesButton"),
  rotationNote: document.querySelector("#rotationNote"),
};

const context = elements.canvas.getContext("2d");
const state = {
  seed: Date.now(),
  pieces: [],
  placements: [],
  packing: null,
  board: null,
  localFontFamily: "",
  localFontName: "",
  lastFontStyle: elements.fontStyle.value,
  legacyStaggerPercent: null,
  fixedPieceIds: new Set(),
};
let player = null;

const fontStore = MotionFonts.createFontStore(FONT_ASSET_KEY);

// "指定" mode: the pieces are returned in the order they were clicked.
const orderPicker = MotionOrder.createOrderPicker({
  grid: elements.orderGrid,
  countLabel: elements.orderCount,
  editor: elements.orderEditor,
  onChange: () => resetAndRender(),
});

function updateFontUI() {
  elements.fontFileName.textContent = state.localFontName || "端末内のフォント";
  elements.fontClear.hidden = !state.localFontName;
}

async function applyLocalFont(buffer, name) {
  const family = await MotionFonts.registerFontFile(buffer, "PolyominoMotionLocal");
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

function dimensions() {
  return {
    columns: Number(elements.gridColumns.value),
    rows: Number(elements.gridRows.value),
  };
}

function boardType() {
  return elements.gridType.value === "triangleHex" ? "triangleHex" : "rectangle";
}

function vertexKey(vertex) {
  return `${vertex.q},${vertex.r}`;
}

function edgeKey(first, second) {
  const a = vertexKey(first);
  const b = vertexKey(second);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function finishBoardModel(type, cells, metadata) {
  const edgeOwners = new Map();
  cells.forEach((cell, cellIndex) => {
    cell.neighbors = new Array(cell.vertices.length).fill(null);
    cell.edgeKeys = cell.latticeVertices.map((vertex, edgeIndex) => edgeKey(vertex, cell.latticeVertices[(edgeIndex + 1) % cell.latticeVertices.length]));
    cell.edgeKeys.forEach((key, edgeIndex) => {
      const owner = edgeOwners.get(key);
      if (!owner) {
        edgeOwners.set(key, { cellIndex, edgeIndex });
        return;
      }
      cell.neighbors[edgeIndex] = owner.cellIndex;
      cells[owner.cellIndex].neighbors[owner.edgeIndex] = cellIndex;
    });
  });
  const points = cells.flatMap((cell) => cell.vertices);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    type,
    cells,
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
    ...metadata,
  };
}

function createRectangleBoard(columns, rows) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const latticeVertices = [
        { q: column, r: row },
        { q: column + 1, r: row },
        { q: column + 1, r: row + 1 },
        { q: column, r: row + 1 },
      ];
      cells.push({
        column,
        row,
        latticeVertices,
        vertices: latticeVertices.map((vertex) => ({ x: vertex.q, y: vertex.r })),
        center: { x: column + 0.5, y: row + 0.5 },
      });
    }
  }
  return finishBoardModel("rectangle", cells, {
    key: `rectangle:${columns}:${rows}`,
    columns,
    rows,
    rotationCount: 4,
    rotationAngle: Math.PI / 2,
  });
}

function createTriangleHexBoard(side) {
  const rawCells = [];
  const insideHexagon = (vertex) => Math.max(Math.abs(vertex.q), Math.abs(vertex.r), Math.abs(vertex.q + vertex.r)) <= side;
  const point = (vertex) => ({ x: vertex.q + vertex.r / 2, y: vertex.r * TRIANGLE_HEIGHT });
  const addTriangle = (latticeVertices) => {
    if (!latticeVertices.every(insideHexagon)) return;
    const vertices = latticeVertices.map(point);
    rawCells.push({
      latticeVertices,
      vertices,
      center: {
        x: vertices.reduce((sum, vertex) => sum + vertex.x, 0) / 3,
        y: vertices.reduce((sum, vertex) => sum + vertex.y, 0) / 3,
      },
    });
  };
  for (let q = -side - 1; q <= side; q += 1) {
    for (let r = -side - 1; r <= side; r += 1) {
      addTriangle([{ q, r }, { q: q + 1, r }, { q, r: r + 1 }]);
      addTriangle([{ q: q + 1, r }, { q: q + 1, r: r + 1 }, { q, r: r + 1 }]);
    }
  }
  rawCells.sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
  rawCells.forEach((cell, index) => { cell.readingPosition = index + 1; });
  return finishBoardModel("triangleHex", rawCells, {
    key: `triangleHex:${side}`,
    side,
    rotationCount: 6,
    rotationAngle: Math.PI / 3,
  });
}

function currentBoardModel() {
  const type = boardType();
  const { columns, rows } = dimensions();
  const side = Number(elements.hexSide.value);
  const key = type === "triangleHex" ? `triangleHex:${side}` : `rectangle:${columns}:${rows}`;
  if (state.board?.key === key) return state.board;
  state.board = type === "triangleHex" ? createTriangleHexBoard(side) : createRectangleBoard(columns, rows);
  return state.board;
}

function boardArea() {
  return currentBoardModel().cells.length;
}

function boardDescription() {
  const board = currentBoardModel();
  if (board.type === "triangleHex") return `△六角形 · 一辺${board.side} · ${board.cells.length} △`;
  return `${board.columns} × ${board.rows}`;
}

function boardFilePart() {
  const board = currentBoardModel();
  return board.type === "triangleHex" ? `triangle-hex-${board.side}side` : `${board.columns}x${board.rows}`;
}

function syncGridControls() {
  const triangular = boardType() === "triangleHex";
  elements.rectangleGridControls.hidden = triangular;
  elements.triangleGridControls.hidden = !triangular;
  elements.rotationNote.textContent = triangular ? "60°単位でランダム回転" : "90°単位でランダム回転";
  elements.gridHint.textContent = triangular
    ? "正三角形を六角形に敷き詰めます。各ミノは辺でつながった同じ△数の形です。"
    : "盤面を割り切れるセル数だけ選べます。各ミノは辺でつながった同じセル数の形です。";
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
    gridType: elements.gridType.value,
    gridColumns: elements.gridColumns.value,
    gridRows: elements.gridRows.value,
    hexSide: elements.hexSide.value,
    minoSize: elements.minoSize.value,
    seed: state.seed,
    palette: elements.palette.value,
    colorOrder: elements.colorOrder?.value,
    fontStyle: elements.fontStyle.value,
    localFontName: state.localFontName,
    textColor: elements.textColor.value,
    backgroundColor: elements.backgroundColor.value,
    duration: elements.duration.value,
    moveDuration: elements.moveDuration.value,
    returnOrder: elements.returnOrder.value,
    startInterval: elements.stagger.value,
    easing: elements.easing.value,
    showGuide: elements.showGuide.checked,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
    fixedPieceIds: [...state.fixedPieceIds],
    specifiedOrder: orderPicker.getOrder(),
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(POLYOMINO_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.text === "string") elements.textInput.value = settings.text;
  ["gridType", "gridColumns", "gridRows", "hexSide", "palette", "colorOrder", "fontStyle", "textColor", "backgroundColor", "duration", "moveDuration", "returnOrder", "easing", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => { if (elements[name]) MotionStorage.restoreControl(elements[name], settings[name]); });
  if (Number.isFinite(Number(settings.startInterval))) {
    MotionStorage.restoreControl(elements.stagger, settings.startInterval);
  } else if (Number.isFinite(Number(settings.stagger))) {
    state.legacyStaggerPercent = Number(settings.stagger);
  }
  if (typeof settings.showGuide === "boolean") elements.showGuide.checked = settings.showGuide;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  if (Array.isArray(settings.fixedPieceIds)) {
    state.fixedPieceIds = new Set(settings.fixedPieceIds.map(Number).filter(Number.isInteger));
  }
  if (Array.isArray(settings.specifiedOrder)) {
    orderPicker.setOrder(settings.specifiedOrder.map(Number).filter(Number.isInteger));
  }
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
    option.textContent = `${value} セル / ${area / value} ミノ`;
    elements.minoSize.append(option);
  });
  elements.minoSize.value = String(selected);
}

function neighborIndexes(index) {
  return currentBoardModel().cells[index]?.neighbors.filter((neighbor) => neighbor !== null) || [];
}

function remainingComponentSizes(remaining) {
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
      neighborIndexes(current).forEach((neighbor) => {
        if (!unseen.has(neighbor)) return;
        unseen.delete(neighbor);
        queue.push(neighbor);
      });
    }
    sizes.push(size);
  }
  return sizes;
}

function growConnectedPiece(seed, remaining, size, random) {
  const piece = new Set([seed]);
  while (piece.size < size) {
    const frontier = new Set();
    piece.forEach((cell) => {
      neighborIndexes(cell).forEach((neighbor) => {
        if (remaining.has(neighbor) && !piece.has(neighbor)) frontier.add(neighbor);
      });
    });
    if (!frontier.size) return null;
    const candidates = [...frontier].map((cell) => {
      const openNeighbors = neighborIndexes(cell).filter((neighbor) => remaining.has(neighbor) && !piece.has(neighbor)).length;
      const touches = neighborIndexes(cell).filter((neighbor) => piece.has(neighbor)).length;
      return { cell, score: openNeighbors * 0.24 - touches * 0.4 + random() };
    }).sort((a, b) => a.score - b.score);
    const choiceWindow = Math.min(3, candidates.length);
    piece.add(candidates[Math.floor(random() * choiceWindow)].cell);
  }
  return [...piece];
}

function fallbackSnakePartition(size, random) {
  const { columns, rows } = currentBoardModel();
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

function hamiltonianPartition(size, random) {
  const board = currentBoardModel();
  const total = board.cells.length;
  const starts = Array.from({ length: total }, (_, index) => index)
    .sort((a, b) => neighborIndexes(a).length - neighborIndexes(b).length || random() - 0.5);
  const maximumStarts = Math.min(starts.length, 18);
  for (let startIndex = 0; startIndex < maximumStarts; startIndex += 1) {
    const visited = new Uint8Array(total);
    const path = [starts[startIndex]];
    visited[starts[startIndex]] = 1;
    let budget = Math.max(120000, total * 9000);
    const visit = (cell) => {
      if (path.length === total) return true;
      if (budget <= 0) return false;
      budget -= 1;
      const candidates = neighborIndexes(cell)
        .filter((neighbor) => !visited[neighbor])
        .map((neighbor) => ({
          neighbor,
          onward: neighborIndexes(neighbor).filter((next) => !visited[next]).length,
          jitter: random(),
        }))
        .sort((a, b) => a.onward - b.onward || a.jitter - b.jitter);
      for (const candidate of candidates) {
        if (candidate.onward === 0 && path.length + 1 < total) continue;
        visited[candidate.neighbor] = 1;
        path.push(candidate.neighbor);
        if (visit(candidate.neighbor)) return true;
        path.pop();
        visited[candidate.neighbor] = 0;
      }
      return false;
    };
    if (visit(starts[startIndex])) {
      const pieces = [];
      for (let index = 0; index < path.length; index += size) pieces.push(path.slice(index, index + size));
      return pieces;
    }
  }
  return null;
}

function randomPartition(size, random) {
  const board = currentBoardModel();
  const total = board.cells.length;
  if (size === 1) return Array.from({ length: total }, (_, index) => [index]);
  if (size === total) return [Array.from({ length: total }, (_, index) => index)];
  let budget = 0;

  function solve(remaining, pieces) {
    if (!remaining.size) return pieces;
    if (budget <= 0) return null;
    if (remaining.size === size) return [...pieces, [...remaining]];

    const seeds = [...remaining].map((cell) => ({
      cell,
      degree: neighborIndexes(cell).filter((neighbor) => remaining.has(neighbor)).length,
      jitter: random(),
    })).sort((a, b) => a.degree - b.degree || a.jitter - b.jitter);
    const seed = seeds[0].cell;
    const seen = new Set();
    const attempts = Math.min(72, 20 + size * 3);
    for (let attempt = 0; attempt < attempts && budget > 0; attempt += 1) {
      budget -= 1;
      const candidate = growConnectedPiece(seed, remaining, size, random);
      if (!candidate) continue;
      const key = [...candidate].sort((a, b) => a - b).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const next = new Set(remaining);
      candidate.forEach((cell) => next.delete(cell));
      if (remainingComponentSizes(next).some((componentSize) => componentSize % size !== 0)) continue;
      const solved = solve(next, [...pieces, candidate]);
      if (solved) return solved;
    }
    return null;
  }

  for (let pass = 0; pass < 6; pass += 1) {
    budget = Math.max(8000, total * 90);
    const remaining = new Set(Array.from({ length: total }, (_, index) => index));
    const solved = solve(remaining, []);
    if (solved) return solved;
  }
  if (board.type === "rectangle") return fallbackSnakePartition(size, random);
  const fallback = hamiltonianPartition(size, random);
  if (!fallback) throw new Error("The triangular board could not be partitioned into connected pieces");
  return fallback;
}

function rotatedShape(piece, rotationSteps) {
  const board = currentBoardModel();
  const center = pieceModelCenter(piece);
  const angle = rotationSteps * board.rotationAngle;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const points = piece.cells.flatMap((cellIndex) => board.cells[cellIndex].vertices).map((point) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return { x: x * cosine - y * sine, y: x * sine + y * cosine };
  });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    width: maxX - minX,
    height: maxY - minY,
    centerX: -minX,
    centerY: -minY,
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
  const board = currentBoardModel();
  const items = state.pieces.map((piece) => {
    const rotationSteps = Math.floor(random() * board.rotationCount);
    return { id: piece.id, rotationSteps, shape: rotatedShape(piece, rotationSteps) };
  });
  const widest = Math.max(...items.map((item) => item.shape.width));
  const totalWidth = items.reduce((sum, item) => sum + item.shape.width, 0) + gap * Math.max(0, items.length - 1);
  const { width: boardWidth, height: boardHeight } = board;
  let best = null;
  for (let maximumWidth = widest; maximumWidth <= totalWidth + 0.001; maximumWidth += 0.5) {
    const packed = shelfPack(items, maximumWidth, gap);
    const sideWidth = boardWidth + majorGap + packed.width;
    const sideHeight = Math.max(boardHeight, packed.height);
    const sideCellSize = Math.min(elements.canvas.width * 0.88 / sideWidth, elements.canvas.height * 0.8 / sideHeight);
    const stackWidth = Math.max(boardWidth, packed.width);
    const stackHeight = boardHeight + majorGap + packed.height;
    const stackCellSize = Math.min(elements.canvas.width * 0.88 / stackWidth, elements.canvas.height * 0.8 / stackHeight);
    const orientation = sideCellSize >= stackCellSize ? "side" : "stack";
    const cellSize = Math.max(sideCellSize, stackCellSize);
    if (!best || cellSize > best.cellSize) best = { ...packed, orientation, cellSize, gap, majorGap };
  }
  state.packing = best;
  state.placements = items.map((item) => ({
    rotationSteps: item.rotationSteps,
    shape: item.shape,
    packX: best.positions[item.id].x,
    packY: best.positions[item.id].y,
  }));
}

function renderFixedPiecePicker() {
  elements.fixedPiecePicker.replaceChildren();
  const board = currentBoardModel();
  state.pieces.forEach((piece, index) => {
    const points = piece.cells.flatMap((cell) => board.cells[cell].vertices);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const padding = 0.08;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fixed-piece-button";
    button.classList.toggle("is-active", state.fixedPieceIds.has(piece.id));
    button.setAttribute("aria-pressed", String(state.fixedPieceIds.has(piece.id)));
    button.setAttribute("aria-label", `${index + 1}番のミノを最初から確定`);
    const number = document.createElement("small");
    number.textContent = String(index + 1);
    const shape = document.createElement("span");
    shape.className = "fixed-piece-shape";
    shape.style.color = cellColor(piece.readingIndex);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `${minX - padding} ${minY - padding} ${Math.max(0.1, maxX - minX + padding * 2)} ${Math.max(0.1, maxY - minY + padding * 2)}`);
    svg.setAttribute("aria-hidden", "true");
    piece.cells.forEach((cellIndex) => {
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.setAttribute("points", board.cells[cellIndex].vertices.map((point) => `${point.x},${point.y}`).join(" "));
      polygon.setAttribute("fill", "currentColor");
      polygon.setAttribute("stroke", "#f7f3eb");
      polygon.setAttribute("stroke-width", "0.06");
      polygon.setAttribute("stroke-linejoin", "round");
      svg.append(polygon);
    });
    shape.append(svg);
    button.append(number, shape);
    button.addEventListener("click", () => {
      if (state.fixedPieceIds.has(piece.id)) state.fixedPieceIds.delete(piece.id);
      else state.fixedPieceIds.add(piece.id);
      renderFixedPiecePicker();
      syncOrderPicker();
      resetAndRender();
    });
    elements.fixedPiecePicker.append(button);
  });
}

function sceneLayout() {
  const board = currentBoardModel();
  const packing = state.packing;
  const side = packing.orientation === "side";
  const totalWidth = side ? board.width + packing.majorGap + packing.width : Math.max(board.width, packing.width);
  const totalHeight = side ? Math.max(board.height, packing.height) : board.height + packing.majorGap + packing.height;
  const cellSize = Math.min(elements.canvas.width * 0.965 / totalWidth, elements.canvas.height * 0.945 / totalHeight);
  const originX = (elements.canvas.width - totalWidth * cellSize) / 2;
  const originY = (elements.canvas.height - totalHeight * cellSize) / 2;
  const boardX = side ? originX : originX + (totalWidth - board.width) * cellSize / 2;
  const boardY = side ? originY + (totalHeight - board.height) * cellSize / 2 : originY;
  const trayX = side ? originX + (board.width + packing.majorGap) * cellSize : originX + (totalWidth - packing.width) * cellSize / 2;
  const trayY = side ? originY + (totalHeight - packing.height) * cellSize / 2 : originY + (board.height + packing.majorGap) * cellSize;
  return {
    board: {
      model: board,
      cellSize,
      width: board.width * cellSize,
      height: board.height * cellSize,
      x: boardX,
      y: boardY,
    },
    tray: { x: trayX, y: trayY, width: packing.width * cellSize, height: packing.height * cellSize },
  };
}

function canvasPoint(point, layout) {
  return {
    x: layout.x + (point.x - layout.model.minX) * layout.cellSize,
    y: layout.y + (point.y - layout.model.minY) * layout.cellSize,
  };
}

function cellGeometry(index, layout) {
  const cell = layout.model.cells[index];
  return {
    vertices: cell.vertices.map((point) => canvasPoint(point, layout)),
    center: canvasPoint(cell.center, layout),
    neighbors: cell.neighbors,
  };
}

function pieceModelCenter(piece) {
  const board = currentBoardModel();
  return {
    x: piece.cells.reduce((sum, cell) => sum + board.cells[cell].center.x, 0) / piece.cells.length,
    y: piece.cells.reduce((sum, cell) => sum + board.cells[cell].center.y, 0) / piece.cells.length,
  };
}

function pieceCenter(piece, layout) {
  return canvasPoint(pieceModelCenter(piece), layout);
}

function rebuildPieces() {
  const board = currentBoardModel();
  const boardSalt = board.type === "triangleHex" ? 7001 + board.side * 1879 : board.columns * 1009 + board.rows * 917;
  const random = MotionToolkit.seededRandom(state.seed + boardSalt + minoSize() * 613);
  const groups = randomPartition(minoSize(), random);
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
  state.fixedPieceIds = new Set([...state.fixedPieceIds].filter((id) => state.pieces.some((piece) => piece.id === id)));
  buildPlacements(random);
  renderFixedPiecePicker();
  syncOrderPicker();
}

// The picker lists the pieces that actually move, labelled by their first cell
// so a mino can be told apart on the board.
function syncOrderPicker() {
  const board = currentBoardModel();
  const moving = state.pieces.filter((piece) => !state.fixedPieceIds.has(piece.id));
  const sorted = [...moving].sort((a, b) => a.readingIndex - b.readingIndex);
  orderPicker.setItems(sorted.map((piece) => ({
    id: piece.id,
    label: board.type === "triangleHex"
      ? `△${piece.readingIndex + 1}`
      : `${board.cells[piece.readingIndex].column + 1},${board.cells[piece.readingIndex].row + 1}`,
  })));
  orderPicker.setVisible(elements.returnOrder.value === "specified");
}

function readingRanks() {
  const sorted = state.pieces.filter((piece) => !state.fixedPieceIds.has(piece.id)).sort((a, b) => a.readingIndex - b.readingIndex);
  return new Map(sorted.map((piece, rank) => [piece.id, rank]));
}

function pieceRank(piece) {
  if (state.fixedPieceIds.has(piece.id)) return 0;
  const mode = elements.returnOrder.value;
  if (mode === "simultaneous") return 0;
  const movingPieces = state.pieces.filter((item) => !state.fixedPieceIds.has(item.id));
  const readingRank = readingRanks().get(piece.id) || 0;
  if (mode === "reading") return readingRank;
  if (mode === "reverse") return movingPieces.length - 1 - readingRank;
  if (mode === "specified") {
    // Only the moving pieces are ranked, so a fixed piece never leaves a gap.
    const picked = orderPicker.ranks();
    return movingPieces
      .slice()
      .sort((a, b) => (picked.get(a.id) ?? 0) - (picked.get(b.id) ?? 0))
      .findIndex((item) => item.id === piece.id);
  }
  return [...movingPieces].sort((a, b) => a.randomRank - b.randomRank).findIndex((item) => item.id === piece.id);
}

function pieceLocalProgress(piece, progress) {
  if (state.fixedPieceIds.has(piece.id)) return 1;
  const simultaneous = elements.returnOrder.value === "simultaneous";
  const total = Number(elements.duration.value);
  const moveTime = Math.min(total, Math.max(0.1, Number(elements.moveDuration.value)));
  const delay = simultaneous ? 0 : pieceStartInterval() * pieceRank(piece);
  return MotionToolkit.clamp((progress * total - delay) / moveTime, 0, 1);
}

function pieceStartInterval() {
  const movingCount = state.pieces.length - state.fixedPieceIds.size;
  if (elements.returnOrder.value === "simultaneous" || movingCount <= 1) return 0;
  return Number(elements.stagger.value);
}

function syncStartIntervalLimit() {
  elements.stagger.max = "20";
  elements.stagger.value = String(MotionToolkit.clamp(Number(elements.stagger.value) || 0, 0, 20));
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

// A color that follows the finished position gives the answer away: every mino
// can be read off the grid before it moves. The random order keeps the palette
// but ties the tint to the seed instead, so the color says nothing about where
// a cell belongs.
function paletteStop(cell, span) {
  if (elements.colorOrder?.value === "gradient") {
    const board = currentBoardModel();
    const center = board.cells[cell].center;
    const horizontal = (center.x - board.minX) / Math.max(0.001, board.width);
    const vertical = (center.y - board.minY) / Math.max(0.001, board.height);
    return (horizontal + vertical) / 2 * span;
  }
  return MotionToolkit.seededRandom(state.seed + cell * 7919 + 13)() * span;
}

function cellColor(cell) {
  const colors = PALETTES[elements.palette.value] || PALETTES.warm;
  const position = paletteStop(cell, colors.length - 1);
  const start = Math.min(colors.length - 1, Math.floor(position));
  const end = Math.min(colors.length - 1, start + 1);
  return mixHexColor(colors[start], colors[end], position - start);
}

function addPolygonToPath(vertices) {
  if (!vertices.length) return;
  context.moveTo(vertices[0].x, vertices[0].y);
  for (let index = 1; index < vertices.length; index += 1) context.lineTo(vertices[index].x, vertices[index].y);
  context.closePath();
}

function drawGuide(layout, progress) {
  const visible = elements.showGuide.checked ? 0.28 + progress * 0.06 : progress >= 0.999 ? 0.16 : 0;
  if (visible <= 0) return;
  context.save();
  context.beginPath();
  layout.model.cells.forEach((_, index) => addPolygonToPath(cellGeometry(index, layout).vertices));
  context.fillStyle = `rgba(255,255,255,${0.36 + progress * 0.22})`;
  context.fill();

  const seenEdges = new Set();
  context.beginPath();
  layout.model.cells.forEach((cell, cellIndex) => {
    const geometry = cellGeometry(cellIndex, layout);
    cell.edgeKeys.forEach((key, edgeIndex) => {
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      const from = geometry.vertices[edgeIndex];
      const to = geometry.vertices[(edgeIndex + 1) % geometry.vertices.length];
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    });
  });
  context.lineWidth = Math.max(1.25, elements.canvas.width * 1.25 / 1000);
  context.strokeStyle = `rgba(23,33,40,${visible})`;
  context.stroke();

  context.beginPath();
  layout.model.cells.forEach((cell, cellIndex) => {
    const geometry = cellGeometry(cellIndex, layout);
    cell.neighbors.forEach((neighbor, edgeIndex) => {
      if (neighbor !== null) return;
      const from = geometry.vertices[edgeIndex];
      const to = geometry.vertices[(edgeIndex + 1) % geometry.vertices.length];
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    });
  });
  context.lineWidth = Math.max(2, elements.canvas.width * 2 / 1000);
  context.lineJoin = "round";
  context.strokeStyle = `rgba(23,33,40,${Math.min(0.58, visible + 0.16)})`;
  context.stroke();
  context.restore();
}

function drawCellText(character, center, cellSize, triangular) {
  if (!character || /^\s$/u.test(character)) return;
  let fontSize = cellSize * (triangular ? TRIANGLE_FONT_SIZE_RATIO : FONT_SIZE_RATIO);
  context.font = `800 ${fontSize}px ${fontFamily()}`;
  const width = context.measureText(character).width;
  const maximumWidth = cellSize * (triangular ? 0.42 : 0.76);
  if (width > maximumWidth) {
    fontSize *= maximumWidth / width;
    context.font = `800 ${fontSize}px ${fontFamily()}`;
  }
  context.fillStyle = elements.textColor.value;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(character, center.x, center.y + fontSize * 0.025);
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
  const rotationCount = layout.model.rotationCount;
  const signedTurns = placement.rotationSteps > rotationCount / 2 ? placement.rotationSteps - rotationCount : placement.rotationSteps;
  const angle = signedTurns * layout.model.rotationAngle * (1 - amount);
  const cellSet = new Set(piece.cells);

  context.save();
  context.translate(currentX, currentY);
  context.rotate(angle);
  context.translate(-target.x, -target.y);

  context.beginPath();
  piece.cells.forEach((cell) => {
    addPolygonToPath(cellGeometry(cell, layout).vertices);
  });
  context.shadowColor = `rgba(25,31,34,${0.2 * (1 - Math.min(1, amount)) + 0.06})`;
  context.shadowBlur = layout.cellSize * (0.1 * (1 - Math.min(1, amount)) + 0.02);
  context.shadowOffsetY = layout.cellSize * (0.045 * (1 - Math.min(1, amount)) + 0.01);
  context.fillStyle = cellColor(piece.readingIndex);
  context.fill();
  context.shadowColor = "transparent";
  piece.cells.forEach((cell) => {
    const geometry = cellGeometry(cell, layout);
    context.beginPath();
    addPolygonToPath(geometry.vertices);
    context.fillStyle = cellColor(cell);
    context.fill();
  });

  const internalLine = INTERNAL_GRID_WIDTH;
  context.lineWidth = internalLine;
  context.strokeStyle = "#f7f3eb";
  context.beginPath();
  piece.cells.forEach((cell) => {
    const geometry = cellGeometry(cell, layout);
    geometry.neighbors.forEach((neighbor, edgeIndex) => {
      if (neighbor === null || !cellSet.has(neighbor) || cell > neighbor) return;
      const from = geometry.vertices[edgeIndex];
      const to = geometry.vertices[(edgeIndex + 1) % geometry.vertices.length];
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    });
  });
  context.stroke();

  context.beginPath();
  piece.cells.forEach((cell) => {
    const geometry = cellGeometry(cell, layout);
    geometry.neighbors.forEach((neighbor, edgeIndex) => {
      if (neighbor !== null && cellSet.has(neighbor)) return;
      const from = geometry.vertices[edgeIndex];
      const to = geometry.vertices[(edgeIndex + 1) % geometry.vertices.length];
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    });
  });
  context.lineWidth = Math.max(1.8, layout.cellSize * 0.028);
  context.lineJoin = "round";
  context.strokeStyle = settled ? SETTLED_COLOR : "rgba(23,33,40,.56)";
  context.stroke();

  piece.cells.forEach((cell) => {
    const geometry = cellGeometry(cell, layout);
    drawCellText(characters[cell], geometry.center, layout.cellSize, layout.model.type === "triangleHex");
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
  const triangular = currentBoardModel().type === "triangleHex";
  elements.gridArea.value = triangular ? `${area} △` : `${area} マス`;
  elements.characterCount.value = `${Math.min(characterCount, area)} / ${area}`;
  if (characterCount > area) elements.textHint.textContent = `先頭から${area}文字を配置します。残り${characterCount - area}文字は盤面には表示されません。`;
  else if (characterCount < area) elements.textHint.textContent = `完成すると左上から右へ読めます。残り${area - characterCount}セルは空白になります。`;
  else elements.textHint.textContent = "完成すると、左上から右へ正しい順番で読めます。改行は詰めて配置します。";
  const summaryValues = elements.minoSummary.querySelectorAll("b");
  summaryValues[0].textContent = size;
  summaryValues[1].textContent = pieceCount;
  summaryValues[2].textContent = area;
  elements.fixedPieceCount.value = `${state.fixedPieceIds.size} / ${pieceCount} 固定`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.moveDuration.max = elements.duration.value;
  if (Number(elements.moveDuration.value) > Number(elements.duration.value)) elements.moveDuration.value = elements.duration.value;
  syncStartIntervalLimit();
  const moveTime = Number(elements.moveDuration.value);
  elements.moveDurationValue.value = `${moveTime.toFixed(1)} 秒 / ${Math.round(moveTime * 60)}f`;
  const interval = pieceStartInterval();
  elements.staggerValue.value = elements.returnOrder.value === "simultaneous" ? "同時" : `${interval.toFixed(2)}秒 / ${Math.round(interval * 60)}f`;
  elements.stagger.disabled = elements.returnOrder.value === "simultaneous";
  [elements.textColor, elements.backgroundColor].forEach((control) => { control.nextElementSibling.value = control.value.toUpperCase(); });
  const settled = state.pieces.filter((piece) => pieceLocalProgress(piece, progress) >= 0.999).length;
  if (settled === state.pieces.length && state.pieces.length) elements.stageStatus.textContent = `完成 · ${boardDescription()} · ${pieceCount} ミノ`;
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
syncGridControls();
MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
updateMinoOptions(Number(restoredSettings?.minoSize || 5));
rebuildPieces();
if (state.legacyStaggerPercent !== null) {
  const total = Number(elements.duration.value);
  const moveTime = Math.min(total, Math.max(0.1, Number(elements.moveDuration.value)));
  const legacyWindow = Math.max(0, total - moveTime) * state.legacyStaggerPercent / 100;
  elements.stagger.value = String(legacyWindow / Math.max(1, state.pieces.length - 1));
  state.legacyStaggerPercent = null;
}
syncStartIntervalLimit();
updateFontUI();

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  isReady: () => state.pieces.length > 0,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => `${boardFilePart()}-${minoSize()}cell-polyomino-type`,
});

elements.textInput.addEventListener("input", resetAndRender);
[elements.gridType, elements.gridColumns, elements.gridRows, elements.hexSide].forEach((control) => control.addEventListener("change", () => {
  syncGridControls();
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
  .forEach((control) => control.addEventListener("change", () => {
    syncOrderPicker();
    resetAndRender();
  }));
elements.orderAllButton.addEventListener("click", () => orderPicker.selectAll());
elements.orderClearButton.addEventListener("click", () => orderPicker.clear());
[elements.palette, elements.colorOrder].filter(Boolean).forEach((control) => control.addEventListener("change", () => { renderFixedPiecePicker(); saveSettings(); updateLabels(); render(); }));
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
elements.outputSize.addEventListener("change", () => {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  rebuildAndReset();
});
elements.clearFixedPieces.addEventListener("click", () => {
  state.fixedPieceIds.clear();
  renderFixedPiecePicker();
  syncOrderPicker();
  resetAndRender();
});
elements.selectAllFixedPieces.addEventListener("click", () => {
  state.fixedPieceIds = new Set(state.pieces.map((piece) => piece.id));
  renderFixedPiecePicker();
  syncOrderPicker();
  resetAndRender();
});
updateLabels();
render();
restoreLocalFont(restoredSettings);
