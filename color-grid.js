"use strict";

const COLOR_GRID_SETTINGS_KEY = "motion-lab:color-grid-settings:v1";
const elements = {
  canvas: document.querySelector("#previewCanvas"),
  columns: document.querySelector("#columns"), columnsValue: document.querySelector("#columnsValue"),
  rows: document.querySelector("#rows"), rowsValue: document.querySelector("#rowsValue"),
  shape: document.querySelector("#shape"),
  gap: document.querySelector("#gap"), gapValue: document.querySelector("#gapValue"),
  cornerRadius: document.querySelector("#cornerRadius"), cornerRadiusValue: document.querySelector("#cornerRadiusValue"),
  emboss: document.querySelector("#emboss"), embossValue: document.querySelector("#embossValue"),
  embossAngle: document.querySelector("#embossAngle"), embossAngleValue: document.querySelector("#embossAngleValue"),
  cellCount: document.querySelector("#cellCount"),
  colorCount: document.querySelector("#colorCount"), backgroundColor: document.querySelector("#backgroundColor"),
  orderMode: document.querySelector("#orderMode"), blend: document.querySelector("#blend"),
  angle: document.querySelector("#angle"), angleValue: document.querySelector("#angleValue"),
  spread: document.querySelector("#spread"), spreadValue: document.querySelector("#spreadValue"),
  cycles: document.querySelector("#cycles"), cyclesValue: document.querySelector("#cyclesValue"),
  duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"),
  seed: document.querySelector("#seedButton"),
  previewSpeed: document.querySelector("#previewSpeed"), imageTime: document.querySelector("#imageTime"),
  outputSize: document.querySelector("#outputSize"), stageStatus: document.querySelector("#stageStatus"), stageDimensions: document.querySelector("#stageDimensions"),
};
const colorInputs = [1, 2, 3, 4, 5, 6].map((index) => document.querySelector(`#color${index}`));
const context = elements.canvas.getContext("2d");
const state = { seed: 20260814, cells: [] };
let player = null;

const SETTING_CONTROLS = ["columns", "rows", "shape", "gap", "cornerRadius", "emboss", "embossAngle", "colorCount", "backgroundColor", "orderMode", "blend", "angle", "spread", "cycles", "duration", "previewSpeed", "imageTime", "outputSize"];

function saveSettings() {
  const settings = { seed: state.seed, colors: colorInputs.map((input) => input.value) };
  SETTING_CONTROLS.forEach((name) => { settings[name] = elements[name].value; });
  MotionStorage.write(COLOR_GRID_SETTINGS_KEY, settings);
}

function restoreSettings() {
  const settings = MotionStorage.read(COLOR_GRID_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  SETTING_CONTROLS.forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Array.isArray(settings.colors)) settings.colors.forEach((value, index) => MotionStorage.restoreControl(colorInputs[index], value));
}

function rebuildCells() {
  const columns = Number(elements.columns.value);
  const rows = Number(elements.rows.value);
  const random = MotionToolkit.seededRandom(state.seed);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({ column, row, columns, rows, randomValue: random() });
    }
  }
  state.cells = cells;
}

function drawCell(x, y, width, height, shape, radius) {
  if (width <= 0 || height <= 0) return;
  if (shape === "circle") {
    context.beginPath();
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fill();
    return;
  }
  if (shape === "diamond") {
    context.beginPath();
    context.moveTo(x + width / 2, y);
    context.lineTo(x + width, y + height / 2);
    context.lineTo(x + width / 2, y + height);
    context.lineTo(x, y + height / 2);
    context.closePath();
    context.fill();
    return;
  }
  MotionToolkit.roundedRectPath(context, x, y, width, height, Math.min(width, height) * radius / 100);
  context.fill();
}

function render(playhead = player?.state.playhead || 0) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, width, height);

  const phase = MotionPattern.loopPhase(playhead, elements.duration.value);
  const colors = MotionPattern.readPalette(colorInputs, elements.colorCount.value);
  const columns = Number(elements.columns.value);
  const rows = Number(elements.rows.value);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const gap = Number(elements.gap.value);
  const radius = Number(elements.cornerRadius.value);
  const shape = elements.shape.value;
  const spread = Number(elements.spread.value) / 100;
  const cycles = Number(elements.cycles.value);
  const smooth = elements.blend.value === "smooth";
  // The relief is a share of the cell itself, so it keeps its proportion when
  // the grid gets denser or the canvas changes size.
  const embossRatio = Number(elements.emboss.value) / 100;
  const embossDepth = Math.max(0, Math.min(cellWidth - gap, cellHeight - gap)) * embossRatio * 0.12;
  const embossAngle = Number(elements.embossAngle.value);
  const embossStrength = 0.25 + embossRatio * 0.35;

  state.cells.forEach((cell) => {
    const field = MotionPattern.gridField(elements.orderMode.value, cell, elements.angle.value);
    const color = MotionPattern.paletteAt(colors, phase * cycles + field * spread, smooth);
    const fill = MotionPattern.rgbCss(color);
    context.fillStyle = fill;
    const x = cell.column * cellWidth + gap / 2;
    const y = cell.row * cellHeight + gap / 2;
    MotionPattern.paintEmboss(
      context,
      { depth: embossDepth, angle: embossAngle, strength: embossStrength, base: fill },
      () => drawCell(x, y, cellWidth - gap, cellHeight - gap, shape, radius),
      (depth) => drawCell(x + depth, y + depth, cellWidth - gap - depth * 2, cellHeight - gap - depth * 2, shape, radius),
    );
  });
}

function updateLabels() {
  elements.columnsValue.value = elements.columns.value;
  elements.rowsValue.value = elements.rows.value;
  elements.gapValue.value = `${elements.gap.value} px`;
  elements.cornerRadiusValue.value = `${elements.cornerRadius.value}%`;
  elements.embossValue.value = `${elements.emboss.value}%`;
  elements.embossAngleValue.value = `${elements.embossAngle.value}°（${MotionPattern.lightDirectionName(elements.embossAngle.value)}）`;
  elements.embossAngle.disabled = Number(elements.emboss.value) === 0;
  elements.angleValue.value = `${elements.angle.value}°`;
  elements.spreadValue.value = `${elements.spread.value}%`;
  elements.cyclesValue.value = `${elements.cycles.value}周`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.cornerRadius.disabled = elements.shape.value !== "square";
  elements.angle.disabled = elements.orderMode.value !== "linear";
  elements.spread.disabled = elements.orderMode.value === "uniform";
  MotionPattern.syncPaletteRows(colorInputs.map((input) => input.parentElement), elements.colorCount.value);
  elements.cellCount.value = `${Number(elements.columns.value) * Number(elements.rows.value)}個`;
  elements.stageStatus.textContent = `${elements.columns.value} × ${elements.rows.value} · ${elements.colorCount.value}色`;
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => "color-grid",
  loop: true,
});

function refresh({ rebuild = false } = {}) {
  if (rebuild) rebuildCells();
  updateLabels();
  saveSettings();
  render();
}

[elements.columns, elements.rows].forEach((control) => control.addEventListener("input", () => refresh({ rebuild: true })));
[elements.gap, elements.cornerRadius, elements.emboss, elements.embossAngle, elements.angle, elements.spread, elements.cycles, elements.duration].forEach((control) => control.addEventListener("input", () => refresh()));
[elements.shape, elements.colorCount, elements.orderMode, elements.blend].forEach((control) => control.addEventListener("change", () => refresh()));
[elements.backgroundColor, ...colorInputs].forEach((control) => control.addEventListener("input", () => refresh()));
elements.seed.addEventListener("click", () => { state.seed = Date.now() % 2147483647; refresh({ rebuild: true }); player.showToast("ばらつきを変えました"); });
elements.outputSize.addEventListener("change", () => { MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions); refresh(); });

(function init() {
  restoreSettings();
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  rebuildCells();
  updateLabels();
  player.setProgress(Number(elements.imageTime.value) / Math.max(0.1, Number(elements.duration.value)));
})();
