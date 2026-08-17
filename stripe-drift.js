"use strict";

const STRIPE_DRIFT_SETTINGS_KEY = "motion-lab:stripe-drift-settings:v1";
const elements = {
  canvas: document.querySelector("#previewCanvas"),
  patternButtons: [...document.querySelectorAll("[data-pattern]")],
  count: document.querySelector("#count"), countValue: document.querySelector("#countValue"), patternSummary: document.querySelector("#patternSummary"),
  duty: document.querySelector("#duty"), dutyValue: document.querySelector("#dutyValue"),
  angle: document.querySelector("#angle"), angleValue: document.querySelector("#angleValue"), angleControl: document.querySelector("#angleControl"),
  emboss: document.querySelector("#emboss"), embossValue: document.querySelector("#embossValue"),
  embossAngle: document.querySelector("#embossAngle"), embossAngleValue: document.querySelector("#embossAngleValue"),
  amplitude: document.querySelector("#amplitude"), amplitudeValue: document.querySelector("#amplitudeValue"),
  waveCount: document.querySelector("#waveCount"), waveCountValue: document.querySelector("#waveCountValue"),
  lineShift: document.querySelector("#lineShift"), lineShiftValue: document.querySelector("#lineShiftValue"), lineShiftControl: document.querySelector("#lineShiftControl"),
  colorCount: document.querySelector("#colorCount"), arrangement: document.querySelector("#arrangement"), backgroundColor: document.querySelector("#backgroundColor"),
  direction: document.querySelector("#direction"),
  cycles: document.querySelector("#cycles"), cyclesValue: document.querySelector("#cyclesValue"),
  duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"),
  travelSummary: document.querySelector("#travelSummary"),
  previewSpeed: document.querySelector("#previewSpeed"), imageTime: document.querySelector("#imageTime"),
  outputSize: document.querySelector("#outputSize"), stageStatus: document.querySelector("#stageStatus"), stageDimensions: document.querySelector("#stageDimensions"),
};
const colorInputs = [1, 2, 3, 4].map((index) => document.querySelector(`#color${index}`));
const context = elements.canvas.getContext("2d");
const state = { pattern: "stripe" };
let player = null;

const SETTING_CONTROLS = ["count", "duty", "angle", "emboss", "embossAngle", "amplitude", "waveCount", "lineShift", "colorCount", "arrangement", "backgroundColor", "direction", "cycles", "duration", "previewSpeed", "imageTime", "outputSize"];

function saveSettings() {
  const settings = { pattern: state.pattern, colors: colorInputs.map((input) => input.value) };
  SETTING_CONTROLS.forEach((name) => { settings[name] = elements[name].value; });
  MotionStorage.write(STRIPE_DRIFT_SETTINGS_KEY, settings);
}

function restoreSettings() {
  const settings = MotionStorage.read(STRIPE_DRIFT_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (["stripe", "rings", "wave"].includes(settings.pattern)) state.pattern = settings.pattern;
  SETTING_CONTROLS.forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Array.isArray(settings.colors)) settings.colors.forEach((value, index) => MotionStorage.restoreControl(colorInputs[index], value));
}

function palette() {
  return MotionPattern.readPalette(colorInputs, elements.colorCount.value);
}

// How many bands the pattern has to travel before the colour sequence lines up
// with itself again. Moving by anything else would jump at the loop point.
function colorSpan() {
  if (state.pattern === "wave") return 1;
  return elements.arrangement.value === "gradient" ? Number(elements.count.value) : palette().length;
}

function colorFor(index, colors) {
  if (elements.arrangement.value === "gradient") return MotionPattern.rgbCss(MotionPattern.paletteAt(colors, index / Number(elements.count.value), true));
  const length = colors.length;
  return colors[((index % length) + length) % length];
}

// The relief scales with the band itself, and the rotation of the stripe layer
// is taken back out of the light angle so the light keeps pointing the same way
// on screen whatever the pattern angle is.
function embossOptions(bandWidth, rotationDegrees = 0) {
  const ratio = Number(elements.emboss.value) / 100;
  return {
    depth: Math.max(0, bandWidth) * ratio * 0.2,
    angle: Number(elements.embossAngle.value) - rotationDegrees,
    strength: 0.25 + ratio * 0.35,
  };
}

function wavyBandPath(x, bandWidth, extent, amplitude, waveCount, wavePhase) {
  const steps = 48;
  context.beginPath();
  for (let step = 0; step <= steps; step += 1) {
    const position = step / steps;
    const offset = Math.sin(position * waveCount * Math.PI * 2 + wavePhase) * amplitude;
    const y = -extent / 2 + position * extent;
    if (step === 0) context.moveTo(x + offset, y);
    else context.lineTo(x + offset, y);
  }
  for (let step = steps; step >= 0; step -= 1) {
    const position = step / steps;
    const offset = Math.sin(position * waveCount * Math.PI * 2 + wavePhase) * amplitude;
    context.lineTo(x + bandWidth + offset, -extent / 2 + position * extent);
  }
  context.closePath();
}

function renderStripes(width, height, travel, colors) {
  const count = Number(elements.count.value);
  const extent = Math.hypot(width, height);
  const period = extent / count;
  const bandWidth = period * Number(elements.duty.value) / 100;
  const amplitude = Number(elements.amplitude.value);
  const waveCount = Number(elements.waveCount.value);
  const shift = MotionPattern.frac(travel) * period * colorSpan();
  const wavePhase = MotionPattern.frac(travel) * Math.PI * 2;
  const margin = Math.ceil(colorSpan()) + 2;
  const emboss = embossOptions(bandWidth, Number(elements.angle.value));
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(Number(elements.angle.value) * Math.PI / 180);
  for (let index = -margin; index <= count + margin; index += 1) {
    const x = -extent / 2 + index * period + shift;
    if (x - amplitude > extent / 2 || x + bandWidth + amplitude < -extent / 2) continue;
    const fill = colorFor(index, colors);
    context.fillStyle = fill;
    // The inset band keeps its full length: shortening it would open a gap at
    // the corners once the lit face slides toward the light.
    const band = (offset, width) => {
      if (amplitude <= 0) {
        context.fillRect(x + offset, -extent / 2 - offset, width, extent + offset * 2);
        return;
      }
      wavyBandPath(x + offset, width, extent + offset * 2, amplitude, waveCount, wavePhase);
      context.fill();
    };
    MotionPattern.paintEmboss(
      context,
      { ...emboss, base: fill },
      () => band(0, bandWidth),
      (depth) => band(depth, Math.max(0.2, bandWidth - depth * 2)),
    );
  }
  context.restore();
}

function renderRings(width, height, travel, colors) {
  const count = Number(elements.count.value);
  const amplitude = Number(elements.amplitude.value);
  const waveCount = Number(elements.waveCount.value);
  const reach = Math.hypot(width, height) / 2;
  const period = reach / count;
  const lineWidth = period * Number(elements.duty.value) / 100;
  const shift = MotionPattern.frac(travel) * period * colorSpan();
  const wavePhase = MotionPattern.frac(travel) * Math.PI * 2;
  const centerX = width / 2;
  const centerY = height / 2;
  const margin = Math.ceil(colorSpan()) + 2;
  const emboss = embossOptions(lineWidth);
  for (let index = -margin; index <= count + margin; index += 1) {
    const radius = index * period + shift;
    if (radius <= 0 || radius - amplitude - lineWidth > reach) continue;
    const stroke = colorFor(index, colors);
    context.strokeStyle = stroke;
    // A thinner stroke on the same path is the inset shape here: the ring keeps
    // its radius and loses the relief depth from each side of the line.
    const ring = (lineInset) => {
      context.lineWidth = Math.max(0.2, lineWidth - lineInset * 2);
      if (amplitude <= 0) {
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.stroke();
        return;
      }
      const steps = 180;
      context.beginPath();
      for (let step = 0; step <= steps; step += 1) {
        const theta = step / steps * Math.PI * 2;
        const distance = Math.max(0, radius + Math.sin(theta * waveCount + wavePhase) * amplitude);
        const x = centerX + Math.cos(theta) * distance;
        const y = centerY + Math.sin(theta) * distance;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.stroke();
    };
    MotionPattern.paintEmboss(context, { ...emboss, base: stroke }, () => ring(0), (depth) => ring(depth));
  }
}

function renderWaveLines(width, height, travel, colors) {
  const count = Number(elements.count.value);
  const period = height / count;
  const amplitude = Number(elements.amplitude.value);
  const waveCount = Number(elements.waveCount.value);
  const wavePhase = MotionPattern.frac(travel) * Math.PI * 2;
  const lineShift = Number(elements.lineShift.value) / 100 * Math.PI * 2;
  const lineWidth = period * Number(elements.duty.value) / 100;
  const emboss = embossOptions(lineWidth);
  context.lineCap = "butt";
  const steps = 96;
  for (let index = 0; index < count; index += 1) {
    const base = (index + 0.5) * period;
    const stroke = colorFor(index, colors);
    context.strokeStyle = stroke;
    const line = (lineInset) => {
      context.lineWidth = Math.max(0.2, lineWidth - lineInset * 2);
      context.beginPath();
      for (let step = 0; step <= steps; step += 1) {
        const position = step / steps;
        const y = base + Math.sin(position * waveCount * Math.PI * 2 + wavePhase + index * lineShift) * amplitude;
        if (step === 0) context.moveTo(0, y);
        else context.lineTo(position * width, y);
      }
      context.stroke();
    };
    MotionPattern.paintEmboss(context, { ...emboss, base: stroke }, () => line(0), (depth) => line(depth));
  }
}

function render(playhead = player?.state.playhead || 0) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, width, height);

  const phase = MotionPattern.loopPhase(playhead, elements.duration.value);
  const direction = elements.direction.value === "reverse" ? -1 : 1;
  const travel = phase * Number(elements.cycles.value) * direction;
  const colors = palette();
  if (state.pattern === "rings") renderRings(width, height, travel, colors);
  else if (state.pattern === "wave") renderWaveLines(width, height, travel, colors);
  else renderStripes(width, height, travel, colors);
}

function updateLabels() {
  elements.patternButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.pattern === state.pattern));
  elements.countValue.value = elements.count.value;
  elements.dutyValue.value = `${elements.duty.value}%`;
  elements.angleValue.value = `${elements.angle.value}°`;
  elements.embossValue.value = `${elements.emboss.value}%`;
  elements.embossAngleValue.value = `${elements.embossAngle.value}°（${MotionPattern.lightDirectionName(elements.embossAngle.value)}）`;
  elements.embossAngle.disabled = Number(elements.emboss.value) === 0;
  elements.amplitudeValue.value = `${elements.amplitude.value} px`;
  elements.waveCountValue.value = elements.waveCount.value;
  elements.lineShiftValue.value = `${elements.lineShift.value}%`;
  elements.cyclesValue.value = `${elements.cycles.value}周`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.angleControl.hidden = state.pattern !== "stripe";
  elements.lineShiftControl.hidden = state.pattern !== "wave";
  MotionPattern.syncPaletteRows(colorInputs.map((input) => input.parentElement), elements.colorCount.value);
  const names = { stripe: "ストライプ", rings: "同心円", wave: "波線" };
  elements.patternSummary.value = `${elements.count.value}本`;
  elements.travelSummary.value = state.pattern === "wave" ? "1周でうねり1つぶん" : `1周で${colorSpan()}本ぶん`;
  elements.stageStatus.textContent = `${elements.count.value}本 · ${names[state.pattern]}`;
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => "stripe-drift",
  loop: true,
});

function refresh() {
  updateLabels();
  saveSettings();
  render();
}

[elements.count, elements.duty, elements.angle, elements.emboss, elements.embossAngle, elements.amplitude, elements.waveCount, elements.lineShift, elements.cycles, elements.duration].forEach((control) => control.addEventListener("input", refresh));
[elements.colorCount, elements.arrangement, elements.direction].forEach((control) => control.addEventListener("change", refresh));
[elements.backgroundColor, ...colorInputs].forEach((control) => control.addEventListener("input", refresh));
elements.patternButtons.forEach((button) => button.addEventListener("click", () => { state.pattern = button.dataset.pattern; refresh(); }));
elements.outputSize.addEventListener("change", () => { MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions); refresh(); });

(function init() {
  restoreSettings();
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  updateLabels();
  player.setProgress(Number(elements.imageTime.value) / Math.max(0.1, Number(elements.duration.value)));
})();
