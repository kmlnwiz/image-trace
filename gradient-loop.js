"use strict";

const GRADIENT_LOOP_SETTINGS_KEY = "motion-lab:gradient-loop-settings:v1";
const elements = {
  canvas: document.querySelector("#previewCanvas"),
  blobCount: document.querySelector("#blobCount"), blobCountValue: document.querySelector("#blobCountValue"), blobSummary: document.querySelector("#blobSummary"),
  blobSize: document.querySelector("#blobSize"), blobSizeValue: document.querySelector("#blobSizeValue"),
  softness: document.querySelector("#softness"), softnessValue: document.querySelector("#softnessValue"),
  density: document.querySelector("#density"), densityValue: document.querySelector("#densityValue"),
  colorCount: document.querySelector("#colorCount"), backgroundColor: document.querySelector("#backgroundColor"), blend: document.querySelector("#blend"),
  orbit: document.querySelector("#orbit"),
  spread: document.querySelector("#spread"), spreadValue: document.querySelector("#spreadValue"),
  cycles: document.querySelector("#cycles"), cyclesValue: document.querySelector("#cyclesValue"),
  jitter: document.querySelector("#jitter"), jitterValue: document.querySelector("#jitterValue"),
  grain: document.querySelector("#grain"), grainValue: document.querySelector("#grainValue"),
  duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"),
  seed: document.querySelector("#seedButton"),
  previewSpeed: document.querySelector("#previewSpeed"), imageTime: document.querySelector("#imageTime"),
  outputSize: document.querySelector("#outputSize"), stageStatus: document.querySelector("#stageStatus"), stageDimensions: document.querySelector("#stageDimensions"),
};
const colorInputs = [1, 2, 3, 4, 5].map((index) => document.querySelector(`#color${index}`));
const context = elements.canvas.getContext("2d");
const state = { seed: 20260814, blobs: [] };
let player = null;

const SETTING_CONTROLS = ["blobCount", "blobSize", "softness", "density", "colorCount", "backgroundColor", "blend", "orbit", "spread", "cycles", "jitter", "grain", "duration", "previewSpeed", "imageTime", "outputSize"];

function saveSettings() {
  const settings = { seed: state.seed, colors: colorInputs.map((input) => input.value) };
  SETTING_CONTROLS.forEach((name) => { settings[name] = elements[name].value; });
  MotionStorage.write(GRADIENT_LOOP_SETTINGS_KEY, settings);
}

function restoreSettings() {
  const settings = MotionStorage.read(GRADIENT_LOOP_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  SETTING_CONTROLS.forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Array.isArray(settings.colors)) settings.colors.forEach((value, index) => MotionStorage.restoreControl(colorInputs[index], value));
}

// At no jitter the blobs sit evenly on a ring and share one size, so the
// slider reads as a straight line from "arranged" to "scattered".
function rebuildBlobs() {
  const count = Number(elements.blobCount.value);
  const jitter = Number(elements.jitter.value) / 100;
  const random = MotionToolkit.seededRandom(state.seed);
  state.blobs = Array.from({ length: count }, (_, index) => {
    const angle = count > 1 ? (index / count) * Math.PI * 2 : 0;
    const orderedX = 0.5 + Math.cos(angle) * 0.26;
    const orderedY = 0.5 + Math.sin(angle) * 0.26;
    return {
      x: MotionToolkit.lerp(orderedX, 0.15 + random() * 0.7, jitter),
      y: MotionToolkit.lerp(orderedY, 0.15 + random() * 0.7, jitter),
      phase: MotionToolkit.lerp(count > 1 ? index / count : 0, random(), jitter),
      sizeScale: MotionToolkit.lerp(1, 0.6 + random() * 0.8, jitter),
      orbitScale: MotionToolkit.lerp(1, 0.35 + random() * 0.9, jitter),
      colorIndex: index,
    };
  });
}

function orbitOffset(shape, angle, radius) {
  if (shape === "figure8") return { x: Math.sin(angle) * radius, y: Math.sin(angle * 2) * radius / 2 };
  if (shape === "vertical") return { x: 0, y: Math.sin(angle) * radius };
  if (shape === "horizontal") return { x: Math.sin(angle) * radius, y: 0 };
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function render(playhead = player?.state.playhead || 0) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, width, height);

  const phase = MotionPattern.loopPhase(playhead, elements.duration.value);
  const colors = MotionPattern.readPalette(colorInputs, elements.colorCount.value);
  const reference = Math.min(width, height);
  const radius = reference * Number(elements.blobSize.value) / 100;
  const travel = reference * Number(elements.spread.value) / 100 * 0.5;
  const cycles = Number(elements.cycles.value);
  const core = (1 - Number(elements.softness.value) / 100) * 0.7;
  const peak = Number(elements.density.value) / 100;

  context.save();
  context.globalCompositeOperation = elements.blend.value;
  state.blobs.forEach((blob) => {
    const angle = (phase * cycles + blob.phase) * Math.PI * 2;
    const offset = orbitOffset(elements.orbit.value, angle, travel * blob.orbitScale);
    const centerX = blob.x * width + offset.x;
    const centerY = blob.y * height + offset.y;
    const size = Math.max(1, radius * blob.sizeScale);
    const rgb = MotionPattern.hexToRgb(colors[blob.colorIndex % colors.length]);
    const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, size);
    gradient.addColorStop(0, MotionPattern.rgbCss(rgb, peak));
    if (core > 0) gradient.addColorStop(core, MotionPattern.rgbCss(rgb, peak));
    gradient.addColorStop(1, MotionPattern.rgbCss(rgb, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(centerX, centerY, size, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();

  MotionPattern.paintGrain(context, width, height, Number(elements.grain.value) / 100, state.seed);
}

function updateLabels() {
  elements.blobCountValue.value = elements.blobCount.value;
  elements.blobSizeValue.value = `${elements.blobSize.value}%`;
  elements.softnessValue.value = `${elements.softness.value}%`;
  elements.densityValue.value = `${elements.density.value}%`;
  elements.spreadValue.value = `${elements.spread.value}%`;
  elements.cyclesValue.value = `${elements.cycles.value}周`;
  elements.jitterValue.value = `${elements.jitter.value}%`;
  elements.grainValue.value = `${elements.grain.value}%`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  MotionPattern.syncPaletteRows(colorInputs.map((input) => input.parentElement), elements.colorCount.value);
  elements.blobSummary.value = `${elements.blobCount.value}個`;
  const orbits = { circle: "円軌道", figure8: "8の字", vertical: "上下", horizontal: "左右" };
  elements.stageStatus.textContent = `${elements.blobCount.value}個 · ${orbits[elements.orbit.value]}`;
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => "gradient-loop",
  loop: true,
});

function refresh({ rebuild = false } = {}) {
  if (rebuild) rebuildBlobs();
  updateLabels();
  saveSettings();
  render();
}

[elements.blobCount, elements.jitter].forEach((control) => control.addEventListener("input", () => refresh({ rebuild: true })));
[elements.blobSize, elements.softness, elements.density, elements.spread, elements.cycles, elements.grain, elements.duration].forEach((control) => control.addEventListener("input", () => refresh()));
[elements.colorCount, elements.blend, elements.orbit].forEach((control) => control.addEventListener("change", () => refresh()));
[elements.backgroundColor, ...colorInputs].forEach((control) => control.addEventListener("input", () => refresh()));
elements.seed.addEventListener("click", () => { state.seed = Date.now() % 2147483647; refresh({ rebuild: true }); player.showToast("配置を変えました"); });
elements.outputSize.addEventListener("change", () => { MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions); refresh(); });

(function init() {
  restoreSettings();
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  rebuildBlobs();
  updateLabels();
  player.setProgress(Number(elements.imageTime.value) / Math.max(0.1, Number(elements.duration.value)));
})();
