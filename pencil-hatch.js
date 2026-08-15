"use strict";

const PENCIL_HATCH_SETTINGS_KEY = "motion-lab:pencil-hatch-settings:v1";
// The stroke layout is decided on a small copy of the picture, and each layer is
// also test painted at this size so the next one can read back what really
// landed. Big enough that a thin line still leaves the right amount of ink.
const ANALYSIS_LONG_EDGE = 480;
const MAX_STROKES = 12000;
// Roughness maps onto this much mean colour error per channel. Measured errors
// after the base coat sit well under it, so the slider spans from "revisit every
// cell" to "leave all but the worst alone".
const ROUGHNESS_RANGE = 42;
// A layer up to this many strokes is test painted with the real multiply blend.
const PROOF_EXACT_LIMIT = 600;
const MAX_PASSES = 48;
// A scribble spans its own cell and no more. It used to be given a fifth again
// on top, which is what made strokes wash across their neighbours; the wander is
// now the only thing that crosses the edge, and it is small.
const STROKE_REACH = 1;
// Each patch takes its own size about that span, so a layer stops reading as a
// grid of equal blocks. Centred on 1 so the cells still tile.
const SIZE_MIN = 0.9;
const SIZE_MAX = 1.26;
const ANGLE_JITTER = 0.2;
const CENTER_JITTER = 0.12;
// A pass is sampled about this often so the wobble along it has room to bend.
const SEGMENT_LENGTH = 13;
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 11;
// Layer angles walk this table so each pass crosses the ones below it.
const CROSS_ANGLES = [0, 90, 45, 135, 22.5];

const elements = {
  canvas: document.querySelector("#previewCanvas"), fileInput: document.querySelector("#fileInput"), sample: document.querySelector("#sampleButton"),
  fileName: document.querySelector("#fileName"), fileMeta: document.querySelector("#fileMeta"), fileSummary: document.querySelector("#fileSummary"), imageDimensions: document.querySelector("#imageDimensions"),
  imageFit: document.querySelector("#imageFit"), strokeCount: document.querySelector("#strokeCount"),
  brushSize: document.querySelector("#brushSize"), brushSizeValue: document.querySelector("#brushSizeValue"),
  layers: document.querySelector("#layers"), layersValue: document.querySelector("#layersValue"),
  roughness: document.querySelector("#roughness"), roughnessValue: document.querySelector("#roughnessValue"),
  pitch: document.querySelector("#pitch"), pitchValue: document.querySelector("#pitchValue"),
  lineWidth: document.querySelector("#lineWidth"), lineWidthValue: document.querySelector("#lineWidthValue"),
  pressure: document.querySelector("#pressure"), pressureValue: document.querySelector("#pressureValue"),
  jitter: document.querySelector("#jitter"), jitterValue: document.querySelector("#jitterValue"),
  blendMode: document.querySelector("#blendMode"), angleMode: document.querySelector("#angleMode"),
  baseAngle: document.querySelector("#baseAngle"), baseAngleValue: document.querySelector("#baseAngleValue"),
  paperColor: document.querySelector("#paperColor"), overlay: document.querySelector("#overlay"), overlayValue: document.querySelector("#overlayValue"),
  order: document.querySelector("#order"), allocation: document.querySelector("#allocation"),
  duration: document.querySelector("#duration"), durationValue: document.querySelector("#durationValue"),
  simultaneous: document.querySelector("#simultaneous"), simultaneousValue: document.querySelector("#simultaneousValue"),
  easing: document.querySelector("#easing"), shuffle: document.querySelector("#shuffleButton"),
  stageStatus: document.querySelector("#stageStatus"), previewSpeed: document.querySelector("#previewSpeed"),
  imageTime: document.querySelector("#imageTime"), outputSize: document.querySelector("#outputSize"), stageDimensions: document.querySelector("#stageDimensions"),
};

const context = elements.canvas.getContext("2d");
// Finished strokes live here so a frame only pays for what appeared since the
// previous one. Only a backwards scrub repaints from the first stroke.
const paintCanvas = document.createElement("canvas");
const paintContext = paintCanvas.getContext("2d");
const analysisCanvas = document.createElement("canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
// Each layer is painted here during a rebuild. Reading this back is what tells
// the next layer how far off the picture still is.
const proofCanvas = document.createElement("canvas");
const proofContext = proofCanvas.getContext("2d", { willReadFrequently: true });
const state = { image: null, imageName: "sample-pencil.png", imageBytes: 0, imageUrl: "", seed: Date.now(), strokes: [], bakedCount: 0, layerCount: 0 };
let player = null;

function saveSettings() {
  MotionStorage.write(PENCIL_HATCH_SETTINGS_KEY, {
    seed: state.seed, imageFit: elements.imageFit.value, brushSize: elements.brushSize.value, layers: elements.layers.value,
    roughness: elements.roughness.value, pitch: elements.pitch.value, lineWidth: elements.lineWidth.value, pressure: elements.pressure.value,
    jitter: elements.jitter.value, blendMode: elements.blendMode.value, angleMode: elements.angleMode.value, baseAngle: elements.baseAngle.value,
    paperColor: elements.paperColor.value, overlay: elements.overlay.value, order: elements.order.value,
    allocation: elements.allocation.value, duration: elements.duration.value,
    simultaneous: elements.simultaneous.value, easing: elements.easing.value, previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value, outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(PENCIL_HATCH_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  ["imageFit", "brushSize", "layers", "roughness", "pitch", "lineWidth", "pressure", "jitter", "blendMode", "angleMode", "baseAngle", "paperColor", "overlay", "order", "allocation", "duration", "simultaneous", "easing", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
}

function hexToRgb(hex) {
  const value = String(hex || "#ffffff").replace("#", "");
  const full = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return [255, 255, 255];
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
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

function buildAnalysis() {
  const scale = ANALYSIS_LONG_EDGE / Math.max(elements.canvas.width, elements.canvas.height);
  const width = Math.max(8, Math.round(elements.canvas.width * scale));
  const height = Math.max(8, Math.round(elements.canvas.height * scale));
  analysisCanvas.width = width;
  analysisCanvas.height = height;
  analysisContext.setTransform(1, 0, 0, 1, 0, 0);
  analysisContext.fillStyle = elements.paperColor.value;
  analysisContext.fillRect(0, 0, width, height);
  const rect = imageRect();
  analysisContext.drawImage(state.image, rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
  return analysisContext.getImageData(0, 0, width, height);
}

function luminanceField(source) {
  const field = new Float32Array(source.width * source.height);
  for (let index = 0; index < field.length; index += 1) {
    const offset = index * 4;
    field[index] = source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
  }
  return field;
}

// Strokes run along the form rather than across it, so the angle follows the
// luminance edge, not the gradient itself.
function contourAngle(field, width, height, x, y, fallback) {
  const at = (sampleX, sampleY) => field[MotionToolkit.clamp(sampleY, 0, height - 1) * width + MotionToolkit.clamp(sampleX, 0, width - 1)];
  const gradientX = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
  const gradientY = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
  if (Math.hypot(gradientX, gradientY) < 24) return fallback;
  return Math.atan2(gradientY, gradientX) + Math.PI / 2;
}

// One stroke is a single back and forth scribble that covers the cell. The pass
// endpoints are jittered so the turns land off the grid and read as a hand
// rather than as hatching drawn with a ruler.
function buildZigzag(centerX, centerY, halfWidth, halfHeight, angle, pitch, jitter, random) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // How far the scribble is allowed to get from its centre, before deciding how
  // much of that budget the wander is going to spend.
  const limitAlong = (halfWidth * Math.abs(cos) + halfHeight * Math.abs(sin)) * STROKE_REACH;
  const limitAcross = (halfWidth * Math.abs(sin) + halfHeight * Math.abs(cos)) * STROKE_REACH;
  // A hand wanders slowly. Noise on every point reads as static, so the drift
  // along a pass is two slow waves given their own rate and phase per stroke,
  // and only a trace of per point noise rides on top.
  const slowRate = 0.8 + random() * 1.5;
  const fastRate = 2.4 + random() * 2.8;
  const slowPhase = random() * Math.PI * 2;
  const fastPhase = random() * Math.PI * 2;
  const drift = jitter * 1.7;
  // The hand travels while it scribbles, so the run of passes leans sideways as
  // it goes instead of stacking inside a rectangle.
  const spineRate = 0.35 + random() * 0.85;
  const spinePhase = random() * Math.PI * 2;
  // The lean and the ragged ends come out of the span rather than being added to
  // it, so a stroke covers its cell without washing over the next one.
  const spineReach = limitAlong * (0.08 + random() * 0.16);
  const extentAlong = Math.max(limitAlong * 0.45, limitAlong - spineReach);
  const extentAcross = limitAcross;
  const passes = MotionToolkit.clamp(Math.round(extentAcross * 2 / Math.max(1, pitch)), 2, MAX_PASSES);
  const step = extentAcross * 2 / passes;
  // Without a phase of its own every cell starts its passes at the same place,
  // and the hatching of neighbouring cells lines up into long straight runs.
  const phase = (random() - 0.5) * step;
  const segments = MotionToolkit.clamp(Math.round(extentAlong * 2 / SEGMENT_LENGTH), MIN_SEGMENTS, MAX_SEGMENTS);
  const points = [];

  for (let pass = 0; pass <= passes; pass += 1) {
    const forward = pass % 2 === 0;
    // Ragged ends and uneven spacing: no two passes reach the same place or sit
    // exactly one pitch from the last. Ends only fall short, never overrun.
    const reach = extentAlong * (0.82 + random() * 0.18);
    const spine = Math.sin(pass / passes * spineRate * Math.PI * 2 + spinePhase) * spineReach;
    const from = (forward ? -reach : reach) + spine;
    const to = (forward ? reach : -reach) + spine;
    const across = -extentAcross + step * pass + phase + (random() - 0.5) * step * 0.55;
    for (let part = 0; part <= segments; part += 1) {
      const travel = part / segments;
      const wave = Math.sin(travel * slowRate * Math.PI * 2 + slowPhase) * 0.64
        + Math.sin(travel * fastRate * Math.PI * 2 + fastPhase) * 0.36;
      const along = from + (to - from) * travel + (random() - 0.5) * jitter * 0.5;
      const offset = across + wave * drift + (random() - 0.5) * jitter * 0.3;
      points.push(centerX + along * cos - offset * sin, centerY + along * sin + offset * cos);
    }
  }
  return points;
}

// Distances are stored as fractions of the stroke so a partial draw advances at
// an even speed no matter how many turns the scribble has.
function measureStroke(points) {
  const count = points.length / 2;
  const progress = new Float32Array(count);
  let total = 0;
  for (let index = 1; index < count; index += 1) {
    total += Math.hypot(points[index * 2] - points[index * 2 - 2], points[index * 2 + 1] - points[index * 2 - 1]);
    progress[index] = total;
  }
  if (total > 0) for (let index = 0; index < count; index += 1) progress[index] /= total;
  else for (let index = 0; index < count; index += 1) progress[index] = index / Math.max(1, count - 1);
  return progress;
}

// The colour to lay down so that one stroke at this opacity carries what is
// already on the paper to what the picture wants. Solving for the opacity
// matters: assuming a solid stroke leaves every layer short of the target, and
// the drawing ends up whatever colour the pressure slider happens to give.
function solveColor(target, current, alpha, multiply) {
  const kept = current * (1 - alpha);
  if (multiply) {
    if (current <= 1) return 255;
    return MotionToolkit.clamp(Math.round((target - kept) / (current * alpha) * 255), 0, 255);
  }
  return MotionToolkit.clamp(Math.round((target - kept) / alpha), 0, 255);
}

function rebuildStrokes(accurate = true) {
  state.strokes = [];
  state.bakedCount = 0;
  state.layerCount = 0;
  if (!state.image) return;
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const source = buildAnalysis();
  const analysisWidth = source.width;
  const analysisHeight = source.height;
  const luminance = luminanceField(source);
  // The layers are test painted here at analysis size. Every later layer works
  // from a readback of this canvas, so overshoot, wobble and the scatter in width
  // and pressure are all accounted for by having actually happened.
  proofCanvas.width = analysisWidth;
  proofCanvas.height = analysisHeight;
  proofContext.setTransform(1, 0, 0, 1, 0, 0);
  proofContext.globalCompositeOperation = "source-over";
  proofContext.globalAlpha = 1;
  proofContext.fillStyle = elements.paperColor.value;
  proofContext.fillRect(0, 0, analysisWidth, analysisHeight);
  proofContext.lineCap = "round";
  proofContext.lineJoin = "round";
  let proof = proofContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  // A scribble leaves paper showing between its passes, so a cell only travels
  // part of the way to the colour its stroke carries. Each layer measures what
  // share of the aimed move actually happened and hands it to the next one,
  // which then aims past the target by exactly that much. Without this the
  // drawing lands short of the picture and reads washed out.
  let coverage = 0.8;

  const random = MotionToolkit.seededRandom(state.seed);
  const layers = Number(elements.layers.value);
  const baseCell = Math.max(8, Number(elements.brushSize.value) / 100 * Math.min(width, height));
  const pitch = Number(elements.pitch.value);
  const lineWidth = Number(elements.lineWidth.value);
  const jitter = Number(elements.jitter.value) / 100 * pitch * 0.9;
  const multiply = elements.blendMode.value === "multiply";
  const threshold = Number(elements.roughness.value) / 100 * ROUGHNESS_RANGE;
  const baseAngle = Number(elements.baseAngle.value) * Math.PI / 180;
  const angleMode = elements.angleMode.value;
  const pressure = Number(elements.pressure.value) / 100;
  const proofScale = analysisWidth / width;
  const scaleX = analysisWidth / width;
  const scaleY = analysisHeight / height;

  for (let layer = 0; layer < layers; layer += 1) {
    const cell = baseCell / Math.pow(2, layer);
    // Past the base coat, a cell narrower than the hatch spacing has no room for
    // a scribble, and a layer that would run past the stroke budget is dropped
    // whole rather than left covering part of the picture. The first layer always
    // runs, so a wide spacing under a small brush still lays colour down.
    if (layer > 0 && cell < pitch * 1.5) break;
    const columns = Math.max(1, Math.ceil(width / cell));
    const rows = Math.max(1, Math.ceil(height / cell));
    if (state.strokes.length + columns * rows > MAX_STROKES) break;
    state.layerCount = layer + 1;
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const layerAngle = baseAngle + CROSS_ANGLES[layer % CROSS_ANGLES.length] * Math.PI / 180;
    const layerStart = state.strokes.length;
    const before = proof;
    let aimedMove = 0;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const left = MotionToolkit.clamp(Math.floor(column * cellWidth * scaleX), 0, analysisWidth - 1);
        const top = MotionToolkit.clamp(Math.floor(row * cellHeight * scaleY), 0, analysisHeight - 1);
        const right = MotionToolkit.clamp(Math.ceil((column + 1) * cellWidth * scaleX), left + 1, analysisWidth);
        const bottom = MotionToolkit.clamp(Math.ceil((row + 1) * cellHeight * scaleY), top + 1, analysisHeight);
        let targetRed = 0; let targetGreen = 0; let targetBlue = 0;
        let currentRed = 0; let currentGreen = 0; let currentBlue = 0;
        let samples = 0;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const index = y * analysisWidth + x;
            targetRed += source.data[index * 4];
            targetGreen += source.data[index * 4 + 1];
            targetBlue += source.data[index * 4 + 2];
            currentRed += proof[index * 4];
            currentGreen += proof[index * 4 + 1];
            currentBlue += proof[index * 4 + 2];
            samples += 1;
          }
        }
        if (!samples) continue;
        targetRed /= samples; targetGreen /= samples; targetBlue /= samples;
        currentRed /= samples; currentGreen /= samples; currentBlue /= samples;
        const error = (Math.abs(targetRed - currentRed) + Math.abs(targetGreen - currentGreen) + Math.abs(targetBlue - currentBlue)) / 3;
        // The first layer always covers the paper; later layers only visit what
        // the coarse passes left wrong, so flat areas stay roughly blocked in.
        if (layer > 0 && error < threshold) continue;

        // No two strokes are pressed the same, and the colour has to be solved
        // for the opacity this one will actually carry. Aim past the target by
        // the share of the move the last layer failed to deliver.
        const alpha = MotionToolkit.clamp(pressure * (0.72 + random() * 0.56), 0.02, 1);
        // Reach past the target along the line from where the paper is now. The
        // three channels are pulled back together rather than each clipping on
        // its own, which is what would turn a dark colour into flat black.
        const stepRed = targetRed - currentRed;
        const stepGreen = targetGreen - currentGreen;
        const stepBlue = targetBlue - currentBlue;
        let boost = 1 / coverage;
        if (stepRed < 0) boost = Math.min(boost, currentRed / -stepRed);
        if (stepGreen < 0) boost = Math.min(boost, currentGreen / -stepGreen);
        if (stepBlue < 0) boost = Math.min(boost, currentBlue / -stepBlue);
        boost = Math.max(1, boost);
        const aimRed = MotionToolkit.clamp(currentRed + stepRed * boost, 0, 255);
        const aimGreen = MotionToolkit.clamp(currentGreen + stepGreen * boost, 0, 255);
        const aimBlue = MotionToolkit.clamp(currentBlue + stepBlue * boost, 0, 255);
        aimedMove += (Math.abs(aimRed - currentRed) + Math.abs(aimGreen - currentGreen) + Math.abs(aimBlue - currentBlue)) / 3 * samples;
        const color = [
          solveColor(aimRed, currentRed, alpha, multiply),
          solveColor(aimGreen, currentGreen, alpha, multiply),
          solveColor(aimBlue, currentBlue, alpha, multiply),
        ];
        // What this stroke leaves behind over the backdrop it was solved for, so
        // the test paint can lay it down without asking the canvas to multiply.
        const proofColor = multiply
          ? [currentRed * color[0] / 255, currentGreen * color[1] / 255, currentBlue * color[2] / 255].map(Math.round)
          : color;
        const angle = angleMode === "fixed"
          ? baseAngle
          : angleMode === "gradient"
            ? contourAngle(luminance, analysisWidth, analysisHeight, Math.floor((left + right) / 2), Math.floor((top + bottom) / 2), baseAngle)
            : layerAngle;
        const centerX = (column + 0.5) * cellWidth + (random() - 0.5) * cellWidth * CENTER_JITTER;
        const centerY = (row + 0.5) * cellHeight + (random() - 0.5) * cellHeight * CENTER_JITTER;
        // Each patch is its own size, so the layer stops looking like a grid of
        // equal blocks even before the wander is applied.
        const size = SIZE_MIN + random() * (SIZE_MAX - SIZE_MIN);
        const points = buildZigzag(centerX, centerY, cellWidth / 2 * size, cellHeight / 2 * size, angle + (random() - 0.5) * ANGLE_JITTER, pitch, jitter, random);
        const normalized = new Float32Array(points.length);
        for (let index = 0; index < points.length; index += 2) {
          normalized[index] = points[index] / width;
          normalized[index + 1] = points[index + 1] / height;
        }
        state.strokes.push({
          points: normalized,
          progress: measureStroke(points),
          color,
          proofColor,
          // No two pencils are sharpened the same.
          width: lineWidth * (0.78 + random() * 0.5),
          alpha,
          layer,
          // Row by row, reversing every other row, so consecutive strokes are
          // neighbours and the hand walks the page instead of hopping about.
          scan: row * columns + (row % 2 ? columns - 1 - column : column),
          center: centerY / height,
          luminance: targetRed * 0.299 + targetGreen * 0.587 + targetBlue * 0.114,
          error,
          rank: random(),
        });
      }
    }

    // Paint the finished layer for real, then read it back. Cells inside one
    // layer all work from the same picture, so their order never matters. The
    // last layer is skipped: nothing reads it, and it is much the largest.
    const another = layer + 1 < layers && cell / 2 >= pitch * 1.5;
    if (!another) break;
    // Asking the canvas to multiply is worth about 170ms a rebuild here, whatever
    // the stroke count, so a moving slider never does it: the test paint lays
    // down each stroke's product directly, which matches inside the cell the
    // stroke was solved for and only drifts where strokes overlap. Settling on
    // release does the real blend, and only for the coarse layers, which set the
    // colour everything later is measured against.
    const trueBlend = multiply && accurate && state.strokes.length - layerStart <= PROOF_EXACT_LIMIT;
    proofContext.globalCompositeOperation = trueBlend ? "multiply" : "source-over";
    for (let index = layerStart; index < state.strokes.length; index += 1) {
      const stroke = state.strokes[index];
      paintStroke(proofContext, stroke, 1, analysisWidth, analysisHeight, proofScale, trueBlend ? stroke.color : stroke.proofColor);
    }
    proof = proofContext.getImageData(0, 0, analysisWidth, analysisHeight).data;

    // How much of the aimed move the paper actually took. The next layer aims
    // past its target by the reciprocal, which is what closes the gap the gaps
    // between passes would otherwise leave.
    let actualMove = 0;
    for (let index = 0; index < proof.length; index += 4) {
      actualMove += (Math.abs(proof[index] - before[index])
        + Math.abs(proof[index + 1] - before[index + 1])
        + Math.abs(proof[index + 2] - before[index + 2])) / 3;
    }
    // Held well off zero on purpose. A small measured coverage would ask the next
    // layer to aim far past the target, and in the dark parts that overshoot
    // clamps at black and takes the colour with it.
    if (aimedMove > 0) coverage = MotionToolkit.clamp(actualMove / aimedMove, 0.62, 1);
  }

  sortStrokes();
  assignTiming();
}

function orderKey(stroke) {
  const mode = elements.order.value;
  if (mode === "serpentine") return stroke.scan;
  if (mode === "top") return stroke.center;
  if (mode === "dark") return stroke.luminance;
  if (mode === "light") return -stroke.luminance;
  if (mode === "error") return -stroke.error;
  return stroke.rank;
}

function sortStrokes() {
  // Array.prototype.sort is stable, so the coarse to fine layer order survives
  // whichever order the strokes inside a layer are asked to take.
  state.strokes.sort((first, second) => (first.layer - second.layer) || (orderKey(first) - orderKey(second)));
}

function totalDuration() {
  return Math.max(0.1, Number(elements.duration.value));
}

// Every stroke carries its own start and length. Spending the same slice of the
// clip on each layer is what makes the drawing read as one: the handful of coarse
// scribbles are slow enough to watch being drawn and leave the picture rough,
// then each finer layer rushes in over the same slice. Sharing the time out by
// stroke count instead gives every stroke the same speed, which fills the
// picture in evenly and has it looking finished by the middle.
function assignTiming() {
  const total = totalDuration();
  const count = state.strokes.length;
  if (!count) return;
  const bounds = [];
  for (let index = 0; index < count; index += 1) {
    const previous = bounds[bounds.length - 1];
    if (previous && state.strokes[index].layer === state.strokes[previous.start].layer) previous.end = index;
    else bounds.push({ start: index, end: index });
  }
  const even = elements.allocation.value === "even";
  let offset = 0;
  bounds.forEach((band) => {
    const length = band.end - band.start + 1;
    const share = even ? total / bounds.length : total * length / count;
    const simultaneous = MotionToolkit.clamp(Number(elements.simultaneous.value), 1, length);
    // The starts fill the slice so the last stroke of the layer lands exactly on
    // its far edge, and the next layer picks up from there.
    const interval = length <= 1 ? 0 : share / (length - 1 + simultaneous);
    const strokeTime = length <= 1 ? share : interval * simultaneous;
    for (let index = band.start; index <= band.end; index += 1) {
      state.strokes[index].start = offset + (index - band.start) * interval;
      state.strokes[index].span = strokeTime;
    }
    offset += share;
  });
}

// Starts rise with the index and so do the endings, so the finished strokes are
// always a prefix and a search can find where it ends.
function completedAt(elapsed) {
  let low = 0;
  let high = state.strokes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const stroke = state.strokes[middle];
    if (stroke.start + stroke.span <= elapsed) low = middle + 1;
    else high = middle;
  }
  return low;
}

function paintStroke(target, stroke, fraction, width, height, widthScale = 1, color = stroke.color) {
  const points = stroke.points;
  const progress = stroke.progress;
  const count = progress.length;
  target.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  target.lineWidth = Math.max(0.1, stroke.width * widthScale);
  target.globalAlpha = stroke.alpha;
  target.beginPath();
  target.moveTo(points[0] * width, points[1] * height);
  let index = 1;
  for (; index < count; index += 1) {
    if (progress[index] >= fraction) break;
    target.lineTo(points[index * 2] * width, points[index * 2 + 1] * height);
  }
  if (index < count) {
    const previous = progress[index - 1];
    const span = progress[index] - previous || 1;
    const amount = MotionToolkit.clamp((fraction - previous) / span, 0, 1);
    target.lineTo(
      MotionToolkit.lerp(points[index * 2 - 2], points[index * 2], amount) * width,
      MotionToolkit.lerp(points[index * 2 - 1], points[index * 2 + 1], amount) * height,
    );
  }
  target.stroke();
}

// Width and opacity are set per stroke inside paintStroke; only what every
// stroke shares is set here.
function applyPencil(target) {
  target.globalCompositeOperation = elements.blendMode.value === "multiply" ? "multiply" : "source-over";
  target.lineCap = "round";
  target.lineJoin = "round";
}

function resetPaint() {
  paintCanvas.width = elements.canvas.width;
  paintCanvas.height = elements.canvas.height;
  paintContext.setTransform(1, 0, 0, 1, 0, 0);
  paintContext.globalCompositeOperation = "source-over";
  paintContext.globalAlpha = 1;
  paintContext.fillStyle = elements.paperColor.value;
  paintContext.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  state.bakedCount = 0;
}

function bakeTo(target) {
  if (paintCanvas.width !== elements.canvas.width || paintCanvas.height !== elements.canvas.height) resetPaint();
  if (target < state.bakedCount) resetPaint();
  if (target <= state.bakedCount) return;
  applyPencil(paintContext);
  for (let index = state.bakedCount; index < target; index += 1) {
    paintStroke(paintContext, state.strokes[index], 1, paintCanvas.width, paintCanvas.height);
  }
  state.bakedCount = target;
}

function render(progress = player?.state.playhead || 0) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.fillStyle = elements.paperColor.value;
  context.fillRect(0, 0, width, height);
  if (!state.image) return;

  if (state.strokes.length) {
    const elapsed = progress * totalDuration();
    const completed = completedAt(elapsed);
    bakeTo(completed);
    context.drawImage(paintCanvas, 0, 0);
    applyPencil(context);
    // Everything still travelling sits right after the finished run.
    for (let index = completed; index < state.strokes.length; index += 1) {
      const stroke = state.strokes[index];
      if (stroke.start > elapsed) break;
      const local = stroke.span > 0 ? (elapsed - stroke.start) / stroke.span : 1;
      if (local <= 0) continue;
      paintStroke(context, stroke, MotionToolkit.ease(MotionToolkit.clamp(local, 0, 1), elements.easing.value), width, height);
    }
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
  }

  const overlay = Number(elements.overlay.value) / 100;
  if (overlay > 0) {
    const rect = imageRect();
    context.globalAlpha = overlay;
    context.drawImage(state.image, rect.x, rect.y, rect.width, rect.height);
    context.globalAlpha = 1;
  }
}

function updateLabels(progress = player?.state.playhead || 0) {
  elements.brushSizeValue.value = `${elements.brushSize.value}%`;
  // Layers past what the hatch spacing or the stroke budget allows are dropped,
  // so the label says how many actually ran.
  const requestedLayers = Number(elements.layers.value);
  elements.layersValue.value = state.layerCount && state.layerCount < requestedLayers
    ? `${requestedLayers} 層 / 有効 ${state.layerCount}`
    : `${requestedLayers} 層`;
  elements.roughnessValue.value = `${elements.roughness.value}%`;
  elements.pitchValue.value = `${elements.pitch.value} px`;
  elements.lineWidthValue.value = `${elements.lineWidth.value} px`;
  elements.pressureValue.value = `${elements.pressure.value}%`;
  elements.jitterValue.value = `${elements.jitter.value}%`;
  elements.baseAngleValue.value = `${elements.baseAngle.value}°`;
  elements.overlayValue.value = `${elements.overlay.value}%`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.baseAngle.disabled = elements.angleMode.value === "gradient";
  const count = state.strokes.length;
  // The coarse layer is the one whose strokes are slow enough to watch, so its
  // pace is what the label reports.
  const coarse = count ? state.strokes[0].span : 0;
  elements.simultaneousValue.value = `${elements.simultaneous.value}本 · 1層目 ${coarse.toFixed(2)}秒 / ${Math.round(coarse * 60)}f`;
  elements.strokeCount.value = count ? `${count}本` : "—";
  const drawn = count ? completedAt(progress * totalDuration()) : 0;
  elements.stageStatus.textContent = count
    ? `${drawn} / ${count}本 · ${state.layerCount}層`
    : "画像を読み込み中";
}

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  isReady: () => Boolean(state.image),
  render,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => `${state.imageName.replace(/\.[^.]+$/, "")}-pencil-hatch`,
});

function rebuildAndRender(message, accurate = true) {
  rebuildStrokes(accurate);
  resetPaint();
  player.reset();
  updateLabels();
  saveSettings();
  render();
  if (message) player.showToast(message);
}

function refresh() {
  updateLabels();
  saveSettings();
  render();
}

function makeSample() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 750;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 520);
  sky.addColorStop(0, "#2f6f9e");
  sky.addColorStop(0.55, "#8fc4dd");
  sky.addColorStop(1, "#f6d9a8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1200, 750);
  ctx.fillStyle = "#f7e6b8";
  ctx.beginPath();
  ctx.arc(905, 232, 96, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3c6f63";
  ctx.beginPath();
  ctx.moveTo(0, 545);
  ctx.lineTo(255, 300);
  ctx.lineTo(470, 520);
  ctx.lineTo(690, 355);
  ctx.lineTo(1200, 560);
  ctx.lineTo(1200, 750);
  ctx.lineTo(0, 750);
  ctx.fill();
  ctx.fillStyle = "#1f4a45";
  ctx.beginPath();
  ctx.moveTo(0, 640);
  ctx.lineTo(360, 470);
  ctx.lineTo(720, 655);
  ctx.lineTo(1200, 505);
  ctx.lineTo(1200, 750);
  ctx.lineTo(0, 750);
  ctx.fill();
  ctx.fillStyle = "#d6673f";
  ctx.fillRect(150, 560, 132, 118);
  ctx.fillStyle = "#8f3a22";
  ctx.beginPath();
  ctx.moveTo(128, 562);
  ctx.lineTo(216, 498);
  ctx.lineTo(304, 562);
  ctx.fill();
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = canvas.toDataURL("image/png");
  });
}

function updateImageUI() {
  elements.fileName.textContent = state.imageName;
  elements.fileMeta.textContent = state.imageBytes ? `${(state.imageBytes / 1024 / 1024).toFixed(1)} MB` : "内蔵サンプル";
  elements.imageDimensions.textContent = `${state.image.naturalWidth} × ${state.image.naturalHeight}`;
  const holder = elements.fileSummary.querySelector(".file-thumbnail");
  holder.replaceChildren();
  const thumbnail = new Image();
  thumbnail.src = state.image.src;
  thumbnail.alt = "";
  holder.append(thumbnail);
}

function setImage(image, name, bytes = 0, url = "") {
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.image = image;
  state.imageName = name;
  state.imageBytes = bytes;
  state.imageUrl = url;
  updateImageUI();
  rebuildStrokes();
  resetPaint();
  player.reset();
  player.update();
  updateLabels();
  render();
}

async function handleImageFile(file) {
  if (!file) return;
  try {
    const loaded = await MotionToolkit.loadImageFile(file);
    setImage(loaded.image, loaded.name, loaded.bytes, loaded.url);
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
elements.sample.addEventListener("click", async () => setImage(await makeSample(), "sample-pencil.png"));

// Everything that changes where the strokes land has to lay them out again.
// Dragging gets the quick test paint so the preview keeps up; letting go, or
// typing a value, settles on the accurate one.
[elements.brushSize, elements.layers, elements.roughness, elements.pitch, elements.lineWidth, elements.pressure, elements.jitter, elements.baseAngle]
  .forEach((control) => {
    control.addEventListener("input", () => rebuildAndRender(undefined, false));
    control.addEventListener("change", () => rebuildAndRender());
  });
[elements.imageFit, elements.blendMode, elements.angleMode, elements.order]
  .forEach((control) => control.addEventListener("change", () => rebuildAndRender()));
elements.paperColor.addEventListener("input", () => rebuildAndRender());
// Retiming keeps the strokes as they are, so the baked prefix stays valid.
function retime() {
  assignTiming();
  player.reset();
  refresh();
}

[elements.duration, elements.simultaneous].forEach((control) => control.addEventListener("input", retime));
elements.allocation.addEventListener("change", retime);
elements.easing.addEventListener("change", refresh);
elements.overlay.addEventListener("input", refresh);
elements.shuffle.addEventListener("click", () => {
  state.seed = Date.now();
  rebuildAndRender("手ブレと順番を再抽選しました");
});
elements.outputSize.addEventListener("change", () => {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  rebuildAndRender();
});

(async function init() {
  restoreSettings();
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  resetPaint();
  updateLabels();
  render();
  setImage(await makeSample(), "sample-pencil.png");
})();
