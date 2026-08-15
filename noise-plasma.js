"use strict";

const NOISE_PLASMA_SETTINGS_KEY = "motion-lab:noise-plasma-settings:v1";
const elements = {
  canvas: document.querySelector("#previewCanvas"),
  layers: document.querySelector("#layers"), layersValue: document.querySelector("#layersValue"),
  scale: document.querySelector("#scale"), scaleValue: document.querySelector("#scaleValue"),
  warp: document.querySelector("#warp"), warpValue: document.querySelector("#warpValue"),
  contrast: document.querySelector("#contrast"), contrastValue: document.querySelector("#contrastValue"),
  resolution: document.querySelector("#resolution"), resolutionValue: document.querySelector("#resolutionValue"), resolutionSummary: document.querySelector("#resolutionSummary"),
  colorCount: document.querySelector("#colorCount"), blend: document.querySelector("#blend"),
  repeat: document.querySelector("#repeat"), repeatValue: document.querySelector("#repeatValue"),
  cycles: document.querySelector("#cycles"), cyclesValue: document.querySelector("#cyclesValue"),
  grain: document.querySelector("#grain"), grainValue: document.querySelector("#grainValue"),
  duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"),
  seed: document.querySelector("#seedButton"),
  previewSpeed: document.querySelector("#previewSpeed"), imageTime: document.querySelector("#imageTime"),
  outputSize: document.querySelector("#outputSize"), stageStatus: document.querySelector("#stageStatus"), stageDimensions: document.querySelector("#stageDimensions"),
};
const colorInputs = [1, 2, 3, 4, 5].map((index) => document.querySelector(`#color${index}`));
const context = elements.canvas.getContext("2d");
const buffer = { canvas: document.createElement("canvas"), context: null, image: null };
buffer.context = buffer.canvas.getContext("2d");
const state = { seed: 20260814, waves: [] };
let player = null;

const TAU = Math.PI * 2;
const SETTING_CONTROLS = ["layers", "scale", "warp", "contrast", "resolution", "colorCount", "blend", "repeat", "cycles", "grain", "duration", "previewSpeed", "imageTime", "outputSize"];

function saveSettings() {
  const settings = { seed: state.seed, colors: colorInputs.map((input) => input.value) };
  SETTING_CONTROLS.forEach((name) => { settings[name] = elements[name].value; });
  MotionStorage.write(NOISE_PLASMA_SETTINGS_KEY, settings);
}

function restoreSettings() {
  const settings = MotionStorage.read(NOISE_PLASMA_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  SETTING_CONTROLS.forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Array.isArray(settings.colors)) settings.colors.forEach((value, index) => MotionStorage.restoreControl(colorInputs[index], value));
}

// Directions are unit length and the frequency is applied at draw time, so the
// 細かさ slider zooms the same pattern instead of drawing a new one. Each wave
// advances a whole number of turns per loop, which is what keeps it seamless.
function rebuildWaves() {
  const random = MotionToolkit.seededRandom(state.seed);
  state.waves = Array.from({ length: Number(elements.layers.value) }, () => {
    const angle = random() * TAU;
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
      stretch: 0.55 + random() * 1.1,
      turns: (random() < 0.5 ? -1 : 1) * (1 + Math.floor(random() * 2)),
      offset: random() * TAU,
    };
  });
}

function ensureBuffer(width, height) {
  if (buffer.canvas.width !== width || buffer.canvas.height !== height || !buffer.image) {
    buffer.canvas.width = width;
    buffer.canvas.height = height;
    buffer.image = buffer.context.createImageData(width, height);
    const data = buffer.image.data;
    for (let index = 3; index < data.length; index += 4) data[index] = 255;
  }
  return buffer.image;
}

function render(playhead = player?.state.playhead || 0) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const step = Number(elements.resolution.value);
  const bufferWidth = Math.max(2, Math.round(width / step));
  const bufferHeight = Math.max(2, Math.round(height / step));
  const image = ensureBuffer(bufferWidth, bufferHeight);
  const data = image.data;

  const phase = MotionPattern.loopPhase(playhead, elements.duration.value);
  const cycles = Number(elements.cycles.value);
  const frequency = Number(elements.scale.value) * TAU;
  const warp = Number(elements.warp.value) / 100;
  const contrast = Number(elements.contrast.value) / 100;
  const waves = state.waves;
  const table = MotionPattern.paletteTable(MotionPattern.readPalette(colorInputs, elements.colorCount.value), Number(elements.repeat.value), elements.blend.value === "smooth");
  const warpPhase = phase * cycles * TAU;
  const aspect = bufferWidth / bufferHeight;

  for (let row = 0; row < bufferHeight; row += 1) {
    const y = row / bufferHeight;
    for (let column = 0; column < bufferWidth; column += 1) {
      const x = column / bufferWidth * aspect;
      let sampleX = x;
      let sampleY = y;
      if (warp > 0) {
        sampleX += Math.sin(y * 6.2 + warpPhase) * warp * 0.5;
        sampleY += Math.cos(x * 5.4 - warpPhase) * warp * 0.5;
      }
      let value = 0;
      for (let index = 0; index < waves.length; index += 1) {
        const wave = waves[index];
        value += Math.sin((sampleX * wave.x + sampleY * wave.y * wave.stretch) * frequency + wave.turns * warpPhase + wave.offset);
      }
      const level = (value / Math.max(1, waves.length)) * contrast * 0.5 + 0.5;
      const slot = level <= 0 ? 0 : level >= 1 ? 255 : Math.round(level * 255);
      const target = (row * bufferWidth + column) * 4;
      const source = slot * 3;
      data[target] = table[source];
      data[target + 1] = table[source + 1];
      data[target + 2] = table[source + 2];
    }
  }

  buffer.context.putImageData(image, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(buffer.canvas, 0, 0, width, height);
  MotionPattern.paintGrain(context, width, height, Number(elements.grain.value) / 100, state.seed);
}

function updateLabels() {
  elements.layersValue.value = elements.layers.value;
  elements.scaleValue.value = elements.scale.value;
  elements.warpValue.value = `${elements.warp.value}%`;
  elements.contrastValue.value = `${elements.contrast.value}%`;
  elements.resolutionValue.value = `${elements.resolution.value} 倍`;
  elements.repeatValue.value = `${elements.repeat.value}回`;
  elements.cyclesValue.value = `${elements.cycles.value}周`;
  elements.grainValue.value = `${elements.grain.value}%`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  MotionPattern.syncPaletteRows(colorInputs.map((input) => input.parentElement), elements.colorCount.value);
  const step = Number(elements.resolution.value);
  elements.resolutionSummary.value = `${Math.max(2, Math.round(elements.canvas.width / step))} × ${Math.max(2, Math.round(elements.canvas.height / step))}`;
  elements.stageStatus.textContent = `${elements.layers.value}波 · ${elements.colorCount.value}色`;
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => "noise-plasma",
  loop: true,
});

function refresh({ rebuild = false } = {}) {
  if (rebuild) rebuildWaves();
  updateLabels();
  saveSettings();
  render();
}

elements.layers.addEventListener("input", () => refresh({ rebuild: true }));
[elements.scale, elements.warp, elements.contrast, elements.resolution, elements.repeat, elements.cycles, elements.grain, elements.duration].forEach((control) => control.addEventListener("input", () => refresh()));
[elements.colorCount, elements.blend].forEach((control) => control.addEventListener("change", () => refresh()));
colorInputs.forEach((control) => control.addEventListener("input", () => refresh()));
elements.seed.addEventListener("click", () => { state.seed = Date.now() % 2147483647; refresh({ rebuild: true }); player.showToast("模様を変えました"); });
elements.outputSize.addEventListener("change", () => { MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions); refresh(); });

(function init() {
  restoreSettings();
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  rebuildWaves();
  updateLabels();
  player.setProgress(Number(elements.imageTime.value) / Math.max(0.1, Number(elements.duration.value)));
})();
