"use strict";

const GRID_PULSE_SETTINGS_KEY = "motion-lab:grid-pulse-settings:v1";
const elements = {
  canvas: document.querySelector("#previewCanvas"),
  layoutButtons: [...document.querySelectorAll("[data-layout]")],
  columns: document.querySelector("#columns"), columnsValue: document.querySelector("#columnsValue"),
  rows: document.querySelector("#rows"), rowsValue: document.querySelector("#rowsValue"),
  cellSize: document.querySelector("#cellSize"), cellSizeValue: document.querySelector("#cellSizeValue"),
  cellCount: document.querySelector("#cellCount"),
  shape: document.querySelector("#shape"),
  cornerRadius: document.querySelector("#cornerRadius"), cornerRadiusValue: document.querySelector("#cornerRadiusValue"), cornerRadiusControl: document.querySelector("#cornerRadiusControl"),
  thickness: document.querySelector("#thickness"), thicknessValue: document.querySelector("#thicknessValue"), thicknessControl: document.querySelector("#thicknessControl"),
  tilt: document.querySelector("#tilt"), tiltValue: document.querySelector("#tiltValue"),
  emboss: document.querySelector("#emboss"), embossValue: document.querySelector("#embossValue"),
  embossAngle: document.querySelector("#embossAngle"), embossAngleValue: document.querySelector("#embossAngleValue"),
  backgroundColor: document.querySelector("#backgroundColor"), shapeColor: document.querySelector("#shapeColor"), shapeColorAlt: document.querySelector("#shapeColorAlt"),
  waveMode: document.querySelector("#waveMode"), waveShape: document.querySelector("#waveShape"),
  waveAngle: document.querySelector("#waveAngle"), waveAngleValue: document.querySelector("#waveAngleValue"),
  wavelength: document.querySelector("#wavelength"), wavelengthValue: document.querySelector("#wavelengthValue"),
  cycles: document.querySelector("#cycles"), cyclesValue: document.querySelector("#cyclesValue"),
  jitter: document.querySelector("#jitter"), jitterValue: document.querySelector("#jitterValue"),
  duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"),
  linkSize: document.querySelector("#linkSize"), sizeMin: document.querySelector("#sizeMin"), sizeMinValue: document.querySelector("#sizeMinValue"),
  linkOpacity: document.querySelector("#linkOpacity"), opacityMin: document.querySelector("#opacityMin"), opacityMinValue: document.querySelector("#opacityMinValue"),
  linkRotation: document.querySelector("#linkRotation"), rotationAmount: document.querySelector("#rotationAmount"), rotationAmountValue: document.querySelector("#rotationAmountValue"),
  linkColor: document.querySelector("#linkColor"),
  seed: document.querySelector("#seedButton"),
  previewSpeed: document.querySelector("#previewSpeed"), imageTime: document.querySelector("#imageTime"),
  outputSize: document.querySelector("#outputSize"), stageStatus: document.querySelector("#stageStatus"), stageDimensions: document.querySelector("#stageDimensions"),
};
const context = elements.canvas.getContext("2d");
const state = { layout: "square", seed: 20260814, cells: [] };
let player = null;

const SETTING_CONTROLS = ["columns", "rows", "cellSize", "shape", "cornerRadius", "thickness", "tilt", "emboss", "embossAngle", "backgroundColor", "shapeColor", "shapeColorAlt", "waveMode", "waveShape", "waveAngle", "wavelength", "cycles", "jitter", "duration", "sizeMin", "opacityMin", "rotationAmount", "previewSpeed", "imageTime", "outputSize"];
const SETTING_CHECKS = ["linkSize", "linkOpacity", "linkRotation", "linkColor"];

function saveSettings() {
  const settings = { layout: state.layout, seed: state.seed };
  SETTING_CONTROLS.forEach((name) => { settings[name] = elements[name].value; });
  SETTING_CHECKS.forEach((name) => { settings[name] = elements[name].checked; });
  MotionStorage.write(GRID_PULSE_SETTINGS_KEY, settings);
}

function restoreSettings() {
  const settings = MotionStorage.read(GRID_PULSE_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (["square", "stagger", "diagonal"].includes(settings.layout)) state.layout = settings.layout;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  SETTING_CONTROLS.forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  SETTING_CHECKS.forEach((name) => { if (typeof settings[name] === "boolean") elements[name].checked = settings[name]; });
}

// Staggered and diagonal lattices push cells past the canvas edge, so a spare
// column on each side keeps the border filled instead of showing a bald strip.
function rowOffset(row) {
  if (state.layout === "stagger") return row % 2 ? 0.5 : 0;
  if (state.layout === "diagonal") return MotionPattern.frac(row / 3);
  return 0;
}

function rebuildCells() {
  const columns = Number(elements.columns.value);
  const rows = Number(elements.rows.value);
  const edge = state.layout === "square" ? 0 : 1;
  const random = MotionToolkit.seededRandom(state.seed);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = -edge; column < columns + edge; column += 1) {
      cells.push({ column, row, columns, rows, offset: rowOffset(row), randomValue: random(), jitter: random() });
    }
  }
  state.cells = cells;
}

function shapeFill(size, weight, shape) {
  const half = size / 2;
  if (shape === "circle") {
    context.beginPath();
    context.arc(0, 0, half, 0, Math.PI * 2);
    context.fill();
    return;
  }
  if (shape === "square") {
    MotionToolkit.roundedRectPath(context, -half, -half, size, size, size * Number(elements.cornerRadius.value) / 100);
    context.fill();
    return;
  }
  if (shape === "ring") {
    const radius = Math.max(0.4, half - weight / 2);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.lineWidth = weight;
    context.stroke();
    return;
  }
  if (shape === "cross") {
    context.fillRect(-half, -weight / 2, size, weight);
    context.fillRect(-weight / 2, -half, weight, size);
    return;
  }
  if (shape === "line") {
    context.fillRect(-half, -weight / 2, size, weight);
    return;
  }
  context.beginPath();
  context.moveTo(0, -half);
  context.lineTo(half, 0);
  context.lineTo(0, half);
  context.lineTo(-half, 0);
  context.closePath();
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
  const columns = Number(elements.columns.value);
  const rows = Number(elements.rows.value);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const baseSize = Math.min(cellWidth, cellHeight) * Number(elements.cellSize.value) / 100;
  const wavelength = Math.max(0.01, Number(elements.wavelength.value) / 100);
  const cycles = Number(elements.cycles.value);
  const jitterAmount = Number(elements.jitter.value) / 100;
  const shape = elements.shape.value;
  const tilt = Number(elements.tilt.value) * Math.PI / 180;
  const sizeFloor = Number(elements.sizeMin.value) / 100;
  const opacityFloor = Number(elements.opacityMin.value) / 100;
  const rotationAmount = Number(elements.rotationAmount.value) * Math.PI / 180;
  const thickness = Number(elements.thickness.value) / 100;
  // The relief is a share of the shape itself, so it keeps its proportion when
  // the cells grow or the canvas changes size. Thin shapes are capped against
  // their own line weight instead, or the lit face would eat the whole stroke.
  const embossRatio = Number(elements.emboss.value) / 100;
  const embossAngle = Number(elements.embossAngle.value);
  const thinShape = ["ring", "cross", "line"].includes(shape);

  state.cells.forEach((cell) => {
    const field = MotionPattern.gridField(elements.waveMode.value, cell, elements.waveAngle.value);
    const amount = MotionPattern.wave01(elements.waveShape.value, field / wavelength - phase * cycles + cell.jitter * jitterAmount);
    const size = baseSize * (elements.linkSize.checked ? MotionToolkit.lerp(sizeFloor, 1, amount) : 1);
    const alpha = elements.linkOpacity.checked ? MotionToolkit.lerp(opacityFloor, 1, amount) : 1;
    if (size < 0.4 || alpha < 0.004) return;
    const color = elements.linkColor.checked
      ? MotionPattern.mixHex(elements.shapeColor.value, elements.shapeColorAlt.value, amount)
      : elements.shapeColor.value;
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.strokeStyle = color;
    context.translate((cell.column + 0.5 + cell.offset) * cellWidth, (cell.row + 0.5) * cellHeight);
    const rotation = tilt + (elements.linkRotation.checked ? amount * rotationAmount : 0);
    if (rotation) context.rotate(rotation);
    const weight = Math.max(0.4, size * thickness);
    const relief = embossRatio * (thinShape ? Math.min(size * 0.12, weight / 3) : size * 0.12);
    MotionPattern.paintEmboss(
      context,
      { depth: relief, angle: embossAngle, strength: 0.25 + embossRatio * 0.35, base: color },
      () => shapeFill(size, weight, shape),
      (depth) => shapeFill(Math.max(0.2, size - depth * 2), Math.max(0.2, weight - depth * 2), shape),
    );
    context.restore();
  });
}

function updateLabels() {
  elements.layoutButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.layout === state.layout));
  elements.columnsValue.value = elements.columns.value;
  elements.rowsValue.value = elements.rows.value;
  elements.cellSizeValue.value = `${elements.cellSize.value}%`;
  elements.cornerRadiusValue.value = `${elements.cornerRadius.value}%`;
  elements.thicknessValue.value = `${elements.thickness.value}%`;
  elements.tiltValue.value = `${elements.tilt.value}°`;
  elements.embossValue.value = `${elements.emboss.value}%`;
  elements.embossAngleValue.value = `${elements.embossAngle.value}°（${MotionPattern.lightDirectionName(elements.embossAngle.value)}）`;
  elements.embossAngle.disabled = Number(elements.emboss.value) === 0;
  elements.waveAngleValue.value = `${elements.waveAngle.value}°`;
  elements.wavelengthValue.value = `${elements.wavelength.value}%`;
  elements.cyclesValue.value = `${elements.cycles.value}周`;
  elements.jitterValue.value = `${elements.jitter.value}%`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.sizeMinValue.value = `${elements.sizeMin.value}%`;
  elements.opacityMinValue.value = `${elements.opacityMin.value}%`;
  elements.rotationAmountValue.value = `${elements.rotationAmount.value}°`;
  elements.cornerRadiusControl.hidden = elements.shape.value !== "square";
  elements.thicknessControl.hidden = !["ring", "cross", "line"].includes(elements.shape.value);
  elements.sizeMin.disabled = !elements.linkSize.checked;
  elements.opacityMin.disabled = !elements.linkOpacity.checked;
  elements.rotationAmount.disabled = !elements.linkRotation.checked;
  elements.waveAngle.disabled = !["linear"].includes(elements.waveMode.value);
  elements.cellCount.value = `${Number(elements.columns.value) * Number(elements.rows.value)}個`;
  const modes = { linear: "直線波", radial: "同心円", spiral: "渦", random: "ランダム", uniform: "一斉" };
  elements.stageStatus.textContent = `${elements.columns.value} × ${elements.rows.value} · ${modes[elements.waveMode.value]}`;
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => "grid-pulse",
  loop: true,
});

function refresh({ rebuild = false } = {}) {
  if (rebuild) rebuildCells();
  updateLabels();
  saveSettings();
  render();
}

[elements.columns, elements.rows].forEach((control) => control.addEventListener("input", () => refresh({ rebuild: true })));
[elements.cellSize, elements.cornerRadius, elements.thickness, elements.tilt, elements.emboss, elements.embossAngle, elements.waveAngle, elements.wavelength, elements.cycles, elements.jitter, elements.duration, elements.sizeMin, elements.opacityMin, elements.rotationAmount].forEach((control) => control.addEventListener("input", () => refresh()));
[elements.shape, elements.waveMode, elements.waveShape].forEach((control) => control.addEventListener("change", () => refresh()));
[elements.backgroundColor, elements.shapeColor, elements.shapeColorAlt, elements.linkSize, elements.linkOpacity, elements.linkRotation, elements.linkColor].forEach((control) => control.addEventListener("input", () => refresh()));
elements.layoutButtons.forEach((button) => button.addEventListener("click", () => { state.layout = button.dataset.layout; refresh({ rebuild: true }); }));
elements.seed.addEventListener("click", () => { state.seed = Date.now() % 2147483647; refresh({ rebuild: true }); player.showToast("ばらつきを変えました"); });
elements.outputSize.addEventListener("change", () => { MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions); refresh(); });

(function init() {
  restoreSettings();
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  rebuildCells();
  updateLabels();
  // The stored still frame time is only meaningful once the grid exists.
  player.setProgress(Number(elements.imageTime.value) / Math.max(0.1, Number(elements.duration.value)));
})();
