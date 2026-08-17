"use strict";

const PENCIL_HATCH_SETTINGS_KEY = "motion-lab:pencil-hatch-settings:v2";
// The drawing is planned on a small copy of the picture, and each layer is also
// test painted at this size so the next one can read back what really landed.
// Nothing finer than this copy can ever be drawn, so it sets the smallest detail
// the tool is able to see. A slider being dragged plans on the draft size and
// settles on the full one when it is let go.
const ANALYSIS_LONG_EDGE = 800;
const ANALYSIS_DRAFT_EDGE = 320;
// A stroke now runs the length of a shape rather than filling a small square, so
// the same amount of colour takes far fewer of them. This is what the drawing may
// spend before it has to stop working: at the lowest roughness a picture really
// does use most of it, and that is what buys a finish close to the photograph.
const MAX_STROKES = 90000;
// What a drawing planned while a slider is moving is allowed to cost. The full
// plan runs the moment the slider is let go.
const DRAFT_STROKES = 1600;
const DRAFT_LAYERS = 3;
const DRAFT_SAMPLE_SCALE = 2.2;
// Below this much mean colour error a patch is already right, whatever the
// roughness slider says, so a matching area is never gone over again.
const ERROR_FLOOR = 2;
const MAX_PASSES = 96;
const TAU = Math.PI * 2;
// Palette search: k-means over a subsample, seeded far apart so a picture always
// resolves to the same set of pencils. The count is not asked for — the search
// starts from more pencils than any picture needs and then folds together the
// ones too close to tell apart, so a flat picture ends up with a few and a busy
// one with many.
const PALETTE_SAMPLES = 9000;
const PALETTE_ROUNDS = 7;
const PALETTE_MAX = 32;
// Two pencils this close in RGB are the same pencil.
const PALETTE_MERGE = 21;
// A shape smaller than this share of the picture is not a shape, it is noise in
// the quantised map, and is folded into the area around it.
const REGION_FRACTION = 0.00035;
// Layers run until the paper is this close to the picture, so how many it takes
// is the picture's business rather than a setting. A layer is a full sweep of the
// picture at a new angle, not a finer grid, so a handful of them is all it takes.
const FIDELITY_TARGET = 2.2;
// A layer that improves the drawing by less than this share of what was left is
// not worth drawing, and neither is the one after it.
const FIDELITY_GAIN = 0.06;
const MAX_LAYERS = 10;
// Speckle removal on the quantised map, so a shape has a clean edge to be filled
// up to instead of a rim of stray pixels. A pixel is only overruled when its
// neighbours agree this strongly, so a thin feature is not smoothed away.
const SMOOTH_ROUNDS = 1;
const SMOOTH_MAJORITY = 6;
const MERGE_ROUNDS = 3;
// How long a stroke may be, as a share of the short edge of the picture, and the
// least it is ever cut to. The length is not a setting: a hand draws the length of
// whatever it is filling, so it comes from the size of the shape, and later layers
// work shorter as the drawing gets more careful.
const STROKE_LENGTH_MAX = 0.35;
const STROKE_LENGTH_MIN = 18;
const STROKE_LENGTH_LAYER = 0.3;

// A stroke is cut short wherever the colour under it moves this far from what it
// has been carrying, which is what puts an edge in the drawing: the line stops on
// the eyebrow and a new one, in a new colour, starts there. Every layer halves it,
// so the drawing gets finer by working in shorter and shorter strokes over more
// and more even colour -- which is also what stops a stroke averaging over a
// mixture and darkening the light half of it past saving.
const SPLIT_TOLERANCE = 10;
const SPLIT_FLOOR = 2;
// How sharply a line may turn when it is set to follow the form.
const FOLLOW_TURN = 0.55;
// Layer angles are offsets from the shape's own axis, so the passes cross the
// ones under them without losing the direction the shape asked for.
const LAYER_ANGLES = [0, 34, -30, 62, 16];
const ANGLE_JITTER = 0.16;
// How often a pass is sampled, in canvas pixels. This is also how precisely a
// stroke can stop at the edge of a shape, so it has to stay small: sampling every
// 13px, as it once did, left a ragged band of bare paper along every boundary.
const SAMPLE_MIN = 5;
const SAMPLE_MAX = 12;
// A shape whose two axes are this close in length has no direction worth
// following, so it takes the base angle instead of a meaningless one.
const ROUND_SHAPE = 0.16;
// The pencil. Its width is what the spacing, the wander, the overshoot and the
// smallest stroke are all measured against, and there is only one pencil.
const LINE_WIDTH = 2;
// How far a hatched shape bows, as a share of the length of its lines.
const CURVE_REACH = 0.07;

// The grain of the paper, in canvas pixels, and how thin the line is left where
// the grain bites into it. The line itself always runs the whole way: what the
// tooth takes is width off its edges, not the line in two.
const TOOTH_SCALE = 2.2;
const SCRATCH_CORE = 0.34;

const elements = {
  canvas: document.querySelector("#previewCanvas"), fileInput: document.querySelector("#fileInput"), sample: document.querySelector("#sampleButton"),
  fileName: document.querySelector("#fileName"), fileMeta: document.querySelector("#fileMeta"), fileSummary: document.querySelector("#fileSummary"), imageDimensions: document.querySelector("#imageDimensions"),
  imageFit: document.querySelector("#imageFit"), strokeCount: document.querySelector("#strokeCount"),
  roughness: document.querySelector("#roughness"), roughnessValue: document.querySelector("#roughnessValue"),
  density: document.querySelector("#density"), densityValue: document.querySelector("#densityValue"),
  pressure: document.querySelector("#pressure"), pressureValue: document.querySelector("#pressureValue"),
  jitter: document.querySelector("#jitter"), jitterValue: document.querySelector("#jitterValue"),
  overflow: document.querySelector("#overflow"), overflowValue: document.querySelector("#overflowValue"),
  scratch: document.querySelector("#scratch"), scratchValue: document.querySelector("#scratchValue"),
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
// Reading the picture, choosing the pencils and cutting it into shapes depends on
// nothing but the picture, the sheet it is laid on and the size being drawn. It
// is the most expensive part of a rebuild and it is held here, so moving the
// pencil sliders never pays for it again.
const plans = new Map();
const state = { image: null, imageToken: 0, imageName: "sample-pencil.png", imageBytes: 0, imageUrl: "", seed: Date.now(), strokes: [], bakedCount: 0, layerCount: 0, regionCount: 0, paletteCount: 0, fidelity: 0 };
let player = null;

function saveSettings() {
  MotionStorage.write(PENCIL_HATCH_SETTINGS_KEY, {
    seed: state.seed, imageFit: elements.imageFit.value,
    roughness: elements.roughness.value, density: elements.density.value, pressure: elements.pressure.value,
    jitter: elements.jitter.value, overflow: elements.overflow.value, scratch: elements.scratch.value, blendMode: elements.blendMode.value, angleMode: elements.angleMode.value,
    baseAngle: elements.baseAngle.value,
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
  ["imageFit", "roughness", "density", "pressure", "jitter", "overflow", "scratch", "blendMode", "angleMode", "baseAngle", "paperColor", "overlay", "order", "allocation", "duration", "simultaneous", "easing", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
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

function buildAnalysis(longEdge) {
  const scale = longEdge / Math.max(elements.canvas.width, elements.canvas.height);
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

// An illustrator works from a handful of pencils, not from every colour in the
// photograph. k-means over a subsample picks that set; the centres are seeded far
// apart so a picture always resolves to the same pencils for a given seed.
function quantizeColors(source, count, random) {
  const total = source.width * source.height;
  const stride = Math.max(1, Math.floor(total / PALETTE_SAMPLES));
  const picks = [];
  for (let index = 0; index < total; index += stride) picks.push(index * 4);
  const centers = [];
  const first = picks[Math.floor(random() * picks.length)];
  centers.push([source.data[first], source.data[first + 1], source.data[first + 2]]);
  while (centers.length < count) {
    let bestPick = picks[0];
    let bestDistance = -1;
    for (const offset of picks) {
      let nearest = Infinity;
      for (const center of centers) {
        const distance = (source.data[offset] - center[0]) ** 2 + (source.data[offset + 1] - center[1]) ** 2 + (source.data[offset + 2] - center[2]) ** 2;
        if (distance < nearest) nearest = distance;
      }
      if (nearest > bestDistance) { bestDistance = nearest; bestPick = offset; }
    }
    if (bestDistance <= 0) break;
    centers.push([source.data[bestPick], source.data[bestPick + 1], source.data[bestPick + 2]]);
  }

  const sums = centers.map(() => [0, 0, 0, 0]);
  for (let round = 0; round < PALETTE_ROUNDS; round += 1) {
    sums.forEach((entry) => { entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0; });
    for (const offset of picks) {
      let best = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < centers.length; index += 1) {
        const center = centers[index];
        const distance = (source.data[offset] - center[0]) ** 2 + (source.data[offset + 1] - center[1]) ** 2 + (source.data[offset + 2] - center[2]) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = index; }
      }
      sums[best][0] += source.data[offset];
      sums[best][1] += source.data[offset + 1];
      sums[best][2] += source.data[offset + 2];
      sums[best][3] += 1;
    }
    // An empty pencil keeps its place rather than collapsing onto another one.
    for (let index = 0; index < centers.length; index += 1) {
      if (!sums[index][3]) continue;
      centers[index][0] = sums[index][0] / sums[index][3];
      centers[index][1] = sums[index][1] / sums[index][3];
      centers[index][2] = sums[index][2] / sums[index][3];
    }
  }

  // How many pixels each pencil ended up carrying, so the fold below moves the
  // rare one onto the common one rather than the other way about.
  const weight = centers.map(() => 0);
  for (const offset of picks) {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < centers.length; index += 1) {
      const center = centers[index];
      const distance = (source.data[offset] - center[0]) ** 2 + (source.data[offset + 1] - center[1]) ** 2 + (source.data[offset + 2] - center[2]) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    }
    weight[best] += 1;
  }

  // Fold together every pair too close to tell apart, closest first. What is left
  // is the set of pencils the picture actually asked for.
  const alive = centers.map((center, index) => ({ center, weight: weight[index], index }))
    .filter((entry) => entry.weight > 0);
  for (;;) {
    let first = -1;
    let second = -1;
    let closest = PALETTE_MERGE * PALETTE_MERGE;
    for (let a = 0; a < alive.length; a += 1) {
      for (let b = a + 1; b < alive.length; b += 1) {
        const distance = (alive[a].center[0] - alive[b].center[0]) ** 2 + (alive[a].center[1] - alive[b].center[1]) ** 2 + (alive[a].center[2] - alive[b].center[2]) ** 2;
        if (distance < closest) { closest = distance; first = a; second = b; }
      }
    }
    if (first < 0 || alive.length <= 2) break;
    const keep = alive[first].weight >= alive[second].weight ? alive[first] : alive[second];
    const gone = keep === alive[first] ? alive[second] : alive[first];
    const total = keep.weight + gone.weight;
    for (let channel = 0; channel < 3; channel += 1) {
      keep.center[channel] = (keep.center[channel] * keep.weight + gone.center[channel] * gone.weight) / total;
    }
    keep.weight = total;
    alive.splice(alive.indexOf(gone), 1);
  }

  const palette = alive.map((entry) => entry.center);
  const labels = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    let best = 0;
    let bestDistance = Infinity;
    for (let center = 0; center < palette.length; center += 1) {
      const entry = palette[center];
      const distance = (source.data[offset] - entry[0]) ** 2 + (source.data[offset + 1] - entry[1]) ** 2 + (source.data[offset + 2] - entry[2]) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = center; }
    }
    labels[index] = best;
  }
  return { labels, count: palette.length };
}

// A majority filter, so the shapes come out with edges a pencil can be filled up
// to instead of a fringe of single stray pixels.
function smoothLabels(labels, width, height, count) {
  const tally = new Uint16Array(count);
  const touched = new Uint8Array(8);
  let source = labels;
  for (let round = 0; round < SMOOTH_ROUNDS; round += 1) {
    const next = new Uint8Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let seenCount = 0;
        const own = source[y * width + x];
        let best = own;
        let bestCount = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const sampleY = MotionToolkit.clamp(y + dy, 0, height - 1);
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const sampleX = MotionToolkit.clamp(x + dx, 0, width - 1);
            const label = source[sampleY * width + sampleX];
            if (!tally[label]) { touched[seenCount] = label; seenCount += 1; }
            tally[label] += 1;
            if (tally[label] > bestCount) { bestCount = tally[label]; best = label; }
          }
        }
        // A stray pixel is overruled; a thin line, whose neighbours are split, is
        // left alone, because that line is the detail the drawing is here for.
        next[y * width + x] = bestCount >= SMOOTH_MAJORITY ? best : own;
        // Only the handful of labels this pixel saw are cleared. Wiping the whole
        // palette for every pixel cost more than the filter itself.
        for (let seen = 0; seen < seenCount; seen += 1) tally[touched[seen]] = 0;
      }
    }
    source = next;
  }
  return source;
}

// The quantised map is cut into connected shapes, then anything too small to be
// worth a pencil is folded into the neighbour it shares the most border with.
// What comes out is the set of areas the drawing is built from.
function buildRegions(labels, width, height, minArea) {
  const regionOf = new Int32Array(width * height).fill(-1);
  const stack = new Int32Array(width * height);
  const parent = [];
  const area = [];
  const adjacency = [];

  for (let start = 0; start < regionOf.length; start += 1) {
    if (regionOf[start] !== -1) continue;
    const id = parent.length;
    parent.push(id);
    adjacency.push(new Map());
    const label = labels[start];
    let size = 0;
    let top = 0;
    stack[top] = start;
    top += 1;
    regionOf[start] = id;
    while (top > 0) {
      top -= 1;
      const index = stack[top];
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0 && regionOf[index - 1] === -1 && labels[index - 1] === label) { regionOf[index - 1] = id; stack[top] = index - 1; top += 1; }
      if (x + 1 < width && regionOf[index + 1] === -1 && labels[index + 1] === label) { regionOf[index + 1] = id; stack[top] = index + 1; top += 1; }
      if (y > 0 && regionOf[index - width] === -1 && labels[index - width] === label) { regionOf[index - width] = id; stack[top] = index - width; top += 1; }
      if (y + 1 < height && regionOf[index + width] === -1 && labels[index + width] === label) { regionOf[index + width] = id; stack[top] = index + width; top += 1; }
    }
    area.push(size);
  }

  const touch = (first, second) => {
    if (first === second) return;
    adjacency[first].set(second, (adjacency[first].get(second) || 0) + 1);
    adjacency[second].set(first, (adjacency[second].get(first) || 0) + 1);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width) touch(regionOf[index], regionOf[index + 1]);
      if (y + 1 < height) touch(regionOf[index], regionOf[index + width]);
    }
  }

  const find = (id) => {
    let root = id;
    while (parent[root] !== root) root = parent[root];
    while (parent[id] !== root) { const next = parent[id]; parent[id] = root; id = next; }
    return root;
  };
  for (let round = 0; round < MERGE_ROUNDS; round += 1) {
    const small = [];
    for (let id = 0; id < parent.length; id += 1) {
      if (find(id) !== id || area[id] >= minArea) continue;
      small.push(id);
    }
    if (!small.length) break;
    small.sort((first, second) => area[first] - area[second]);
    let merged = 0;
    for (const id of small) {
      if (find(id) !== id) continue;
      let best = -1;
      let bestScore = -1;
      adjacency[id].forEach((shared, other) => {
        const root = find(other);
        if (root === id) return;
        // Most shared border wins; a larger neighbour breaks the tie, so a sliver
        // is absorbed by the area it really belongs to.
        const score = shared + area[root] / (width * height);
        if (score > bestScore) { bestScore = score; best = root; }
      });
      if (best < 0) continue;
      parent[id] = best;
      area[best] += area[id];
      adjacency[id].forEach((shared, other) => {
        const root = find(other);
        if (root === best) return;
        adjacency[best].set(root, (adjacency[best].get(root) || 0) + shared);
        adjacency[root].set(best, (adjacency[root].get(best) || 0) + shared);
      });
      adjacency[id].clear();
      merged += 1;
    }
    if (!merged) break;
  }

  const compact = new Map();
  for (let index = 0; index < regionOf.length; index += 1) {
    const root = find(regionOf[index]);
    let id = compact.get(root);
    if (id === undefined) { id = compact.size; compact.set(root, id); }
    regionOf[index] = id;
  }
  return { regionOf, count: compact.size };
}

// Area, centroid, colour and the axis the shape lies along. The axis is what a
// pencil follows: strokes run the length of a shape, not across it.
function measureRegions(regionOf, count, source, width, height) {
  const regions = [];
  for (let id = 0; id < count; id += 1) {
    regions.push({
      id, area: 0, sumX: 0, sumY: 0, sumXX: 0, sumXY: 0, sumYY: 0, red: 0, green: 0, blue: 0,
      lightRed: 0, lightGreen: 0, lightBlue: 0, lightCount: 0,
      minX: width, maxX: -1, minY: height, maxY: -1,
    });
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const region = regions[regionOf[index]];
      region.area += 1;
      region.sumX += x; region.sumY += y;
      region.sumXX += x * x; region.sumXY += x * y; region.sumYY += y * y;
      region.red += source.data[index * 4];
      region.green += source.data[index * 4 + 1];
      region.blue += source.data[index * 4 + 2];
      if (x < region.minX) region.minX = x;
      if (x > region.maxX) region.maxX = x;
      if (y < region.minY) region.minY = y;
      if (y > region.maxY) region.maxY = y;
    }
  }
  // A coloured pencil is worked light to dark: the paper can always be darkened
  // but never lightened again, least of all under a multiply blend. So the shape
  // is blocked in with the colour of its light half, and everything after that
  // only ever adds. Blocking in with the plain mean instead leaves every highlight
  // inside a shape permanently out of reach.
  regions.forEach((region) => {
    region.meanLuminance = (region.red * 0.299 + region.green * 0.587 + region.blue * 0.114) / Math.max(1, region.area);
  });
  for (let index = 0; index < regionOf.length; index += 1) {
    const region = regions[regionOf[index]];
    const red = source.data[index * 4];
    const green = source.data[index * 4 + 1];
    const blue = source.data[index * 4 + 2];
    if (red * 0.299 + green * 0.587 + blue * 0.114 < region.meanLuminance) continue;
    region.lightRed += red;
    region.lightGreen += green;
    region.lightBlue += blue;
    region.lightCount += 1;
  }
  regions.forEach((region) => {
    const area = Math.max(1, region.area);
    const lit = Math.max(1, region.lightCount);
    region.light = region.lightCount
      ? [region.lightRed / lit, region.lightGreen / lit, region.lightBlue / lit]
      : [region.red / area, region.green / area, region.blue / area];
    region.centerX = region.sumX / area;
    region.centerY = region.sumY / area;
    region.color = [region.red / area, region.green / area, region.blue / area];
    const varianceX = region.sumXX / area - region.centerX * region.centerX;
    const varianceY = region.sumYY / area - region.centerY * region.centerY;
    const covariance = region.sumXY / area - region.centerX * region.centerY;
    region.axis = 0.5 * Math.atan2(2 * covariance, varianceX - varianceY);
    const spread = varianceX + varianceY;
    const split = Math.hypot(varianceX - varianceY, 2 * covariance);
    // How much longer the shape is than it is wide. A round shape has no
    // direction worth following, so it is left to the base angle.
    region.elongation = spread > 0 ? split / spread : 0;
  });
  // Drawn in reading order, one shape finished before the hand moves on.
  regions.sort((first, second) => (first.centerY - second.centerY) || (first.centerX - second.centerX));
  regions.forEach((region, index) => { region.order = index; });
  return regions;
}

// The colour to lay down so that one stroke at this opacity carries what is
// already on the paper to what the picture wants. Solving for the opacity
// matters: assuming a solid stroke leaves every layer short of the target.
function solveColor(target, current, alpha, multiply) {
  const kept = current * (1 - alpha);
  if (multiply) {
    if (current <= 1) return 255;
    return MotionToolkit.clamp(Math.round((target - kept) / (current * alpha) * 255), 0, 255);
  }
  return MotionToolkit.clamp(Math.round((target - kept) / alpha), 0, 255);
}

// The tooth of the paper: fixed to the sheet rather than to the stroke, so every
// pass that crosses a given spot skips in the same place and the drawing reads as
// one pencil on one paper instead of as noise laid on noise.
function toothAt(x, y, seed) {
  let hash = Math.imul(Math.floor(x / TOOTH_SCALE) | 0, 0x85ebca6b) ^ Math.imul(Math.floor(y / TOOTH_SCALE) | 0, 0xc2b2ae35) ^ seed;
  hash = Math.imul(hash ^ (hash >>> 13), 0x27d4eb2d);
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}

// One layer of hatching for one shape: lines the width of the shape, spaced by the
// pitch, clipped to the shape, and cut into strokes a hand could draw in one go --
// and cut again wherever the colour under the line changes, which is what puts the
// detail in. Filling small squares with scribbles, as this used to, could only get
// finer by making the squares smaller, and a square four pixels across is not a
// pencil stroke at all.
function sweepRegion(region, angle, options, random, out) {
  const {
    regionOf, analysisWidth, analysisHeight, scaleX, scaleY, pitch, jitter, overshoot,
    scratch, toothSeed, sampleStep, strokeLength, blockIn, follow, source, proof, luminance, tolerance, curve,
  } = options;
  const id = region.id;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const left = region.minX / scaleX;
  const right = (region.maxX + 1) / scaleX;
  const top = region.minY / scaleY;
  const bottom = (region.maxY + 1) / scaleY;
  let uMin = Infinity; let uMax = -Infinity; let vMin = Infinity; let vMax = -Infinity;
  for (const corner of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
    const u = corner[0] * cos + corner[1] * sin;
    const v = -corner[0] * sin + corner[1] * cos;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const span = uMax - uMin;
  const reach = vMax - vMin;
  if (span <= 0 || reach <= 0) return;
  const lines = MotionToolkit.clamp(Math.ceil(reach / pitch), 1, 4096);
  // The shape is hatched with one bow, not a different one per line: lines that
  // curve together keep their spacing, while lines that curve apart open gaps
  // nothing later can close. Each line still takes a little more or less of it.
  const bow = (random() - 0.5) * 2 * curve * span * CURVE_REACH;
  const lean = 0.35 + random() * 0.4;
  const steps = MotionToolkit.clamp(Math.ceil(span / sampleStep), 2, 4096);
  const stride = span / steps;
  const sample = (x, y) => {
    const sampleX = Math.floor(x * scaleX);
    const sampleY = Math.floor(y * scaleY);
    if (sampleX < 0 || sampleY < 0 || sampleX >= analysisWidth || sampleY >= analysisHeight) return -1;
    const index = sampleY * analysisWidth + sampleX;
    return regionOf[index] === id ? index : -1;
  };

  for (let line = 0; line < lines; line += 1) {
    // The hand comes back the other way on the next line, so consecutive strokes
    // are neighbours and the drawing reads as one continuous piece of work.
    const forward = line % 2 === 0;
    const across = vMin + reach * (line + 0.5) / lines + (random() - 0.5) * pitch * 0.22;
    // A hand wanders slowly, so the drift is two slow waves with their own rate and
    // phase rather than noise, which would read as static.
    const slowRate = 0.8 + random() * 1.5;
    const fastRate = 2.4 + random() * 2.8;
    const slowPhase = random() * TAU;
    const fastPhase = random() * TAU;
    let directionX = forward ? cos : -cos;
    let directionY = forward ? sin : -sin;
    const curveShare = 0.88 + random() * 0.24;

    // The line is laid out first, wobble and all, and then read for where it is on
    // the shape and what colour it is over.
    const trail = new Float64Array((steps + 1) * 2);
    if (follow) {
      // Set to follow the form, a line turns towards the contour of the picture at
      // every step instead of running straight.
      let x = (forward ? uMin : uMax) * cos - across * sin;
      let y = (forward ? uMin : uMax) * sin + across * cos;
      for (let step = 0; step <= steps; step += 1) {
        trail[step * 2] = x;
        trail[step * 2 + 1] = y;
        const local = contourAngle(luminance, analysisWidth, analysisHeight,
          Math.floor(x * scaleX), Math.floor(y * scaleY), Math.atan2(directionY, directionX));
        let turnX = Math.cos(local);
        let turnY = Math.sin(local);
        if (turnX * directionX + turnY * directionY < 0) { turnX = -turnX; turnY = -turnY; }
        directionX += (turnX - directionX) * FOLLOW_TURN;
        directionY += (turnY - directionY) * FOLLOW_TURN;
        const length = Math.hypot(directionX, directionY) || 1;
        directionX /= length;
        directionY /= length;
        const travel = step / steps;
        const wave = Math.sin(travel * slowRate * TAU + slowPhase) * 0.64 + Math.sin(travel * fastRate * TAU + fastPhase) * 0.36;
        x += directionX * stride - directionY * wave * jitter * 0.12;
        y += directionY * stride + directionX * wave * jitter * 0.12;
      }
    } else {
      for (let step = 0; step <= steps; step += 1) {
        const travel = step / steps;
        const along = forward ? uMin + span * travel : uMax - span * travel;
        const wave = Math.sin(travel * slowRate * TAU + slowPhase) * 0.64 + Math.sin(travel * fastRate * TAU + fastPhase) * 0.36;
        // Where this point sits on the shape, rather than how far into the stroke
        // it is, so the bow of a line drawn right to left matches its neighbours.
        const place = forward ? travel : 1 - travel;
        const offset = across + wave * jitter + bow * curveShare * Math.sin(Math.PI * Math.pow(place, lean * 2));
        trail[step * 2] = along * cos - offset * sin;
        trail[step * 2 + 1] = along * sin + offset * cos;
      }
    }

    let points = null;
    let bites = null;
    let count = 0;
    let targetRed = 0; let targetGreen = 0; let targetBlue = 0;
    let currentRed = 0; let currentGreen = 0; let currentBlue = 0;
    let drawn = 0;
    let cut = strokeLength * (0.7 + random() * 0.6);
    let position = 0;
    let lastX = 0;
    let lastY = 0;
    let stepX = forward ? cos : -cos;
    let stepY = forward ? sin : -sin;

    const record = (x, y) => {
      points.push(x, y);
      if (bites) bites.push(toothAt(x, y, toothSeed) > scratch ? 1 : 0);
    };
    const open = (x, y) => {
      points = [];
      bites = scratch > 0 ? [] : null;
      count = 0;
      drawn = 0;
      targetRed = 0; targetGreen = 0; targetBlue = 0;
      currentRed = 0; currentGreen = 0; currentBlue = 0;
      // The pencil comes down a little before the shape and leaves a little after,
      // which is the bit of hand that keeps it from reading as a fill.
      record(x - stepX * overshoot * (0.3 + random() * 0.7), y - stepY * overshoot * (0.3 + random() * 0.7));
      record(x, y);
      lastX = x;
      lastY = y;
    };
    const close = () => {
      if (!points || !count) { points = null; return; }
      record(lastX + stepX * overshoot * (0.3 + random() * 0.7), lastY + stepY * overshoot * (0.3 + random() * 0.7));
      const target = blockIn ? region.light.slice() : [targetRed / count, targetGreen / count, targetBlue / count];
      const current = [currentRed / count, currentGreen / count, currentBlue / count];
      out.push({
        points, bites, target, current, count,
        error: (Math.abs(target[0] - current[0]) + Math.abs(target[1] - current[1]) + Math.abs(target[2] - current[2])) / 3,
        // Line by line down the shape, and along each line as the hand travels.
        scan: region.order + (line + position / (steps + 2)) / (lines + 1),
        center: lastY,
        rank: random(),
      });
      points = null;
    };
    const take = (index, x, y) => {
      targetRed += source.data[index * 4];
      targetGreen += source.data[index * 4 + 1];
      targetBlue += source.data[index * 4 + 2];
      currentRed += proof[index * 4];
      currentGreen += proof[index * 4 + 1];
      currentBlue += proof[index * 4 + 2];
      count += 1;
      lastX = x;
      lastY = y;
    };
    // Where the line crosses the edge of the shape, found by halving the gap
    // between two samples, so the stroke stops on the form rather than a sample
    // short of it.
    const edge = (step, wantInside) => {
      let low = 0;
      let high = 1;
      const fromX = trail[step * 2];
      const fromY = trail[step * 2 + 1];
      const toX = trail[step * 2 + 2];
      const toY = trail[step * 2 + 3];
      for (let probe = 0; probe < 4; probe += 1) {
        const middle = (low + high) / 2;
        const inside = sample(fromX + (toX - fromX) * middle, fromY + (toY - fromY) * middle) >= 0;
        if (inside === wantInside) low = middle;
        else high = middle;
      }
      const pick = wantInside ? low : high;
      return [fromX + (toX - fromX) * pick, fromY + (toY - fromY) * pick];
    };

    let previous = sample(trail[0], trail[1]);
    if (previous >= 0) { open(trail[0], trail[1]); take(previous, trail[0], trail[1]); }
    for (let step = 1; step <= steps; step += 1) {
      const x = trail[step * 2];
      const y = trail[step * 2 + 1];
      const index = sample(x, y);
      position = step;
      if (step > 0) {
        const runX = x - trail[step * 2 - 2];
        const runY = y - trail[step * 2 - 1];
        const length = Math.hypot(runX, runY) || 1;
        stepX = runX / length;
        stepY = runY / length;
        drawn += length;
      }
      if ((index >= 0) !== (previous >= 0)) {
        const crossing = edge(step - 1, previous >= 0);
        if (previous >= 0) {
          if (points) { record(crossing[0], crossing[1]); lastX = crossing[0]; lastY = crossing[1]; close(); }
        } else if (index >= 0) {
          open(crossing[0], crossing[1]);
        }
      }
      if (index >= 0) {
        if (!points) open(x, y);
        // A stroke ends when the hand would lift it, and again when the picture
        // under it stops being the colour the stroke is carrying.
        const changed = !blockIn && count > 2
          && (Math.abs(source.data[index * 4] - targetRed / count)
            + Math.abs(source.data[index * 4 + 1] - targetGreen / count)
            + Math.abs(source.data[index * 4 + 2] - targetBlue / count)) / 3 > tolerance;
        if (changed || drawn >= cut) {
          close();
          cut = strokeLength * (0.7 + random() * 0.6);
          drawn = 0;
          open(x, y);
        }
        record(x, y);
        take(index, x, y);
      } else close();
      previous = index;
    }
    close();
  }
}

// Distances are stored as fractions of the stroke so a partial draw advances at
// an even speed no matter how many turns or lifts the stroke has.
function measureStroke(points) {
  const count = points.length / 2;
  const progress = new Float32Array(count);
  let total = 0;
  for (let index = 1; index < count; index += 1) {
    const x = points[index * 2];
    const previousX = points[index * 2 - 2];
    // Lifting the pencil costs no time, so the hand travels at one speed.
    if (!Number.isNaN(x) && !Number.isNaN(previousX)) {
      total += Math.hypot(x - previousX, points[index * 2 + 1] - points[index * 2 - 1]);
    }
    progress[index] = total;
  }
  if (total > 0) for (let index = 0; index < count; index += 1) progress[index] /= total;
  else for (let index = 0; index < count; index += 1) progress[index] = index / Math.max(1, count - 1);
  return progress;
}

function pushStroke(points, bites, extras) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const normalized = new Float32Array(points.length);
  for (let index = 0; index < points.length; index += 2) {
    normalized[index] = points[index] / width;
    normalized[index + 1] = points[index + 1] / height;
  }
  // How far the pencil actually travels, and where it starts and ends. A hand
  // moves at roughly one speed, so this is what a stroke's time is worked out
  // from, and the ends are what tells the hand how far it had to reach.
  let travel = 0;
  for (let index = 2; index < points.length; index += 2) {
    if (Number.isNaN(points[index]) || Number.isNaN(points[index - 2])) continue;
    travel += Math.hypot(points[index] - points[index - 2], points[index + 1] - points[index - 1]);
  }
  const last = points.length - 2;
  const stroke = {
    points: normalized, progress: measureStroke(points), travel,
    fromX: points[0], fromY: points[1], toX: points[last], toY: points[last + 1],
    ...extras,
  };
  if (bites) stroke.bite = Uint8Array.from(bites);
  state.strokes.push(stroke);
}

function rebuildStrokes(accurate = true) {
  state.strokes = [];
  state.bakedCount = 0;
  state.layerCount = 0;
  state.regionCount = 0;
  state.paletteCount = 0;
  state.fidelity = 0;
  if (!state.image) return;
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const random = MotionToolkit.seededRandom(state.seed);
  const longEdge = accurate ? ANALYSIS_LONG_EDGE : ANALYSIS_DRAFT_EDGE;
  const key = [state.imageToken, width, height, elements.imageFit.value, elements.paperColor.value, longEdge, state.seed].join(":");
  let plan = plans.get(key) || null;

  if (!plan) {
    // The picture is first reduced to the set of pencils it asks for, then cut
    // into the areas those pencils describe. Everything after this paints areas,
    // never a grid. Neither the number of pencils nor the size of the areas is a
    // setting: both come out of the picture. The palette draws from a stream of
    // its own, so a cached plan and a fresh one leave the strokes identical.
    const source = buildAnalysis(longEdge);
    const palette = quantizeColors(source, PALETTE_MAX, MotionToolkit.seededRandom(state.seed ^ 0x9e3779b9));
    const labels = smoothLabels(palette.labels, source.width, source.height, palette.count);
    const minArea = Math.max(8, source.width * source.height * REGION_FRACTION);
    const { regionOf, count } = buildRegions(labels, source.width, source.height, minArea);
    plan = {
      source, regionOf, paletteCount: palette.count,
      luminance: luminanceField(source),
      regions: measureRegions(regionOf, count, source, source.width, source.height),
    };
    // One slot for the dragging preview and one for the settled drawing.
    if (plans.size >= 2) plans.delete(plans.keys().next().value);
    plans.set(key, plan);
  }
  const source = plan.source;
  const analysisWidth = source.width;
  const analysisHeight = source.height;
  const luminance = plan.luminance;
  const regionOf = plan.regionOf;
  const regions = plan.regions;
  state.paletteCount = plan.paletteCount;
  state.regionCount = regions.length;

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
  // Hatching leaves paper showing between its passes, so a patch only travels
  // part of the way to the colour its stroke carries. Each layer measures the
  // share of the aimed move that actually happened and hands it to the next one,
  // which then aims past its target by exactly that much.
  let coverage = 0.8;
  let settled = Infinity;

  // The longest stroke the picture allows, which a shape then takes as much of as
  // its own size warrants.
  const longest = STROKE_LENGTH_MAX * Math.min(width, height);
  const lineWidth = LINE_WIDTH;
  // Spacing is given as the share of the paper the passes cover: at 100% the lines
  // touch, at 50% half the paper is left showing between them. Asking for it in
  // pixels made the gaps depend on the pencil, which is not how a hand works.
  const density = MotionToolkit.clamp(Number(elements.density.value), 10, 100) / 100;
  const pitch = Math.max(0.6, lineWidth / density);
  // One setting for how steady the hand is. It wanders across the line, never by
  // more than a fraction of the spacing -- a wobble wider than the gap between
  // lines has them crossing and leaving holes the density cannot close -- and it
  // bows the whole run of lines, which is what makes a shape read as drawn by a
  // wrist rather than filled by a machine.
  const unsteady = MotionToolkit.clamp(Number(elements.jitter.value), 0, 150) / 100;
  const jitter = unsteady * pitch * 0.5;
  const overshoot = Number(elements.overflow.value) / 100 * lineWidth * 4;
  // How much of the line the paper refuses to take. The tooth does not cut the
  // line, it bites width off its edges.
  const scratch = MotionToolkit.clamp(Number(elements.scratch.value), 0, 100) / 100 * 0.62;
  const multiply = elements.blendMode.value === "multiply";
  // Roughness is a share of the strokes, not an amount of colour error: whatever
  // the picture and whatever the layer, moving the slider always changes how much
  // gets gone over again.
  const leave = MotionToolkit.clamp(Number(elements.roughness.value), 0, 100) / 100;
  const baseAngle = Number(elements.baseAngle.value) * Math.PI / 180;
  const angleMode = elements.angleMode.value;
  const pressure = Number(elements.pressure.value) / 100;
  const scaleX = analysisWidth / width;
  const scaleY = analysisHeight / height;
  const sweepOptions = {
    regionOf, analysisWidth, analysisHeight, scaleX, scaleY, pitch, jitter, overshoot,
    scratch, toothSeed: state.seed | 0, strokeLength: longest, source, luminance, proof, curve: unsteady,
    sampleStep: MotionToolkit.clamp(longest / 12, SAMPLE_MIN, SAMPLE_MAX) * (accurate ? 1 : DRAFT_SAMPLE_SCALE),
    follow: angleMode === "gradient", blockIn: true,
  };

  // Layers are not counted out in advance, and a layer is a whole sweep of the
  // picture at a new angle rather than a finer grid. Each one is laid down, tested,
  // and the next only happens if the paper is still off the picture.
  const maxLayers = accurate ? MAX_LAYERS : DRAFT_LAYERS;
  const strokeBudget = accurate ? MAX_STROKES : DRAFT_STROKES;
  for (let layer = 0; layer < maxLayers; layer += 1) {
    const layerStart = state.strokes.length;
    const before = proof;
    sweepOptions.proof = proof;
    // The first layer lays one flat colour over each shape, the way an illustration
    // is blocked in. Only the layers after it chase the photograph, so the shading
    // arrives on top of a drawing rather than instead of one.
    sweepOptions.blockIn = layer === 0;
    // Each layer works in shorter strokes over more even colour than the one below.
    sweepOptions.tolerance = Math.max(SPLIT_FLOOR, SPLIT_TOLERANCE / Math.pow(2, layer));
    const candidates = [];
    for (const region of regions) {
      // The shape's own axis, turned by this layer's crossing angle. A round shape
      // has no axis worth following and takes the base angle instead.
      const shapeAngle = region.elongation < ROUND_SHAPE ? baseAngle : region.axis + baseAngle;
      const turn = LAYER_ANGLES[layer % LAYER_ANGLES.length] * Math.PI / 180;
      const angle = (angleMode === "fixed" ? baseAngle : shapeAngle) + turn + (random() - 0.5) * ANGLE_JITTER;
      // A hand draws the length of what it is filling: a broad sky takes long
      // sweeps, a thumbnail of a shape takes short ones, and every layer works a
      // little shorter than the one below it as the drawing gets more careful.
      const across = Math.sqrt(region.area / (scaleX * scaleY));
      sweepOptions.strokeLength = MotionToolkit.clamp(
        across * 0.8 / (1 + layer * STROKE_LENGTH_LAYER),
        Math.max(STROKE_LENGTH_MIN, lineWidth * 6),
        longest,
      );
      sweepRegion(region, angle, sweepOptions, random, candidates);
    }

    // The block-in covers the paper whatever happens. After it, roughness keeps only
    // the worst share of what the layer found, so flat areas are left as they were
    // laid down and the work goes where the drawing is still wrong. Counted out
    // rather than thresholded on the error itself: a picture whose strokes are all
    // about equally wrong would otherwise ignore the slider entirely. What is left
    // of the budget caps it, and both cuts keep the worst, so running out costs the
    // drawing its flattest parts rather than whichever shapes came last.
    let kept = candidates;
    if (layer > 0) kept = candidates.filter((candidate) => candidate.error >= ERROR_FLOOR);
    const room = Math.max(0, strokeBudget - state.strokes.length);
    const wanted = layer === 0 ? kept.length : Math.round(kept.length * (1 - leave));
    const keepCount = Math.min(room, wanted);
    if (keepCount < kept.length) {
      kept.sort((first, second) => second.error - first.error);
      kept.length = keepCount;
    }
    // Back into the order the hand would walk them.
    kept.sort((first, second) => first.scan - second.scan);

    for (const candidate of kept) {
      const targetRed = candidate.target[0]; const targetGreen = candidate.target[1]; const targetBlue = candidate.target[2];
      const currentRed = candidate.current[0]; const currentGreen = candidate.current[1]; const currentBlue = candidate.current[2];
      // No two strokes are pressed the same, and the colour has to be solved for the
      // opacity this one will actually carry. Aim past the target by the share of the
      // move the last layer failed to deliver.
      const alpha = MotionToolkit.clamp(pressure * (0.72 + random() * 0.56), 0.02, 1);
      // Reach past the target along the line from where the paper is now. The three
      // channels are pulled back together rather than each clipping on its own, which
      // is what would turn a dark colour into flat black.
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
      // Ink laid over ink can only ever darken. Where the drawing has to come back
      // up -- a highlight inside a shape, or somewhere an earlier layer went too
      // far -- that stroke is laid down opaque instead, which is what reaching for
      // a pale pencil does. Without this the multiply blend puts a floor under how
      // close the drawing can get, and the picture stays muddy in the light places.
      const over = multiply && aimRed + aimGreen + aimBlue > currentRed + currentGreen + currentBlue + 1.5;
      const blended = multiply && !over;
      const color = [
        solveColor(aimRed, currentRed, alpha, blended),
        solveColor(aimGreen, currentGreen, alpha, blended),
        solveColor(aimBlue, currentBlue, alpha, blended),
      ];
      // What this stroke leaves behind over the backdrop it was solved for, so the
      // test paint can lay it down without asking the canvas to multiply.
      const proofColor = blended
        ? [currentRed * color[0] / 255, currentGreen * color[1] / 255, currentBlue * color[2] / 255].map(Math.round)
        : color;
      pushStroke(candidate.points, candidate.bites, {
        color, proofColor, blend: blended ? "multiply" : "source-over",
        // No two pencils are sharpened the same.
        width: lineWidth * (0.78 + random() * 0.5),
        alpha, layer,
        scan: candidate.scan,
        center: candidate.center / height,
        luminance: targetRed * 0.299 + targetGreen * 0.587 + targetBlue * 0.114,
        error: candidate.error,
        rank: candidate.rank,
      });
    }

    // A layer that found nothing left to correct is not one the drawing has, so the
    // count only rises when strokes were actually laid down.
    if (state.strokes.length > layerStart) state.layerCount = layer + 1;
    else break;

    // Nothing reads the proof after the last layer, and the last layer is much the
    // largest, so it is never test painted.
    if (layer + 1 >= maxLayers || state.strokes.length >= strokeBudget) break;

    // Paint the finished layer for real, then read it back. Strokes inside one layer
    // all work from the same picture, so their order never matters. Asking the canvas
    // to multiply costs about 170ms a rebuild, so a moving slider never does it: the
    // test paint lays down each stroke's product directly. Settling on release does
    // the real blend.
    const trueBlend = accurate;
    for (let index = layerStart; index < state.strokes.length; index += 1) {
      const stroke = state.strokes[index];
      if (trueBlend) paintStroke(proofContext, stroke, 1, analysisWidth, analysisHeight, scaleX);
      else {
        // The quick path lays each stroke's product down directly rather than
        // asking the canvas to blend, which costs about 170ms a rebuild.
        const blend = stroke.blend;
        stroke.blend = "source-over";
        paintStroke(proofContext, stroke, 1, analysisWidth, analysisHeight, scaleX, stroke.proofColor);
        stroke.blend = blend;
      }
    }
    proof = proofContext.getImageData(0, 0, analysisWidth, analysisHeight).data;

    let actualMove = 0;
    let neededMove = 0;
    let remaining = 0;
    let counted = 0;
    // Both of these are means over the whole sheet, so a quarter of the pixels says
    // the same thing as all of them.
    for (let index = 0; index < proof.length; index += 8) {
      counted += 1;
      actualMove += (Math.abs(proof[index] - before[index])
        + Math.abs(proof[index + 1] - before[index + 1])
        + Math.abs(proof[index + 2] - before[index + 2])) / 3;
      remaining += (Math.abs(proof[index] - source.data[index])
        + Math.abs(proof[index + 1] - source.data[index + 1])
        + Math.abs(proof[index + 2] - source.data[index + 2])) / 3;
      neededMove += (Math.abs(source.data[index] - before[index])
        + Math.abs(source.data[index + 1] - before[index + 1])
        + Math.abs(source.data[index + 2] - before[index + 2])) / 3;
    }
    // Held well off zero on purpose: a small measured coverage would ask the next
    // layer to aim far past the target, and in the dark parts that clamps at black
    // and takes the colour with it.
    // Both halves are read off the same pixels of the same sheet, so the ratio is
    // exactly "the share of the move the paper took". Weighing the intended move
    // by stroke samples instead, as this once did, compared two different things
    // and always came out at 1, which left every layer aiming short.
    // Aiming past the target was inherited from an earlier design and does more harm
    // than good now that a stroke covers a long run of the picture: it overshoots,
    // and ink laid too dark cannot be taken back. Kept as a measurement only.
    if (neededMove > 0) coverage = 1;
    // How far the paper still is from the picture. This, and nothing else, decides
    // whether another layer happens.
    state.fidelity = remaining / Math.max(1, counted);
    // Another layer only happens while the last one still bought something. A thick
    // pencil cannot resolve any more of the picture and stops here of its own
    // accord; a thin one keeps finding work. That is what makes the line width the
    // dial for how far the drawing goes, and for what it costs.
    if (state.fidelity < FIDELITY_TARGET || settled - state.fidelity < settled * FIDELITY_GAIN) break;
    settled = state.fidelity;
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
  // Array.prototype.sort is stable, so the block-in to detail order survives
  // whichever order the strokes inside a layer are asked to take.
  state.strokes.sort((first, second) => (first.layer - second.layer) || (orderKey(first) - orderKey(second)));
}

function totalDuration() {
  return Math.max(0.1, Number(elements.duration.value));
}

// Every stroke carries its own start and length. Spending the same slice of the
// clip on each layer is what makes the drawing read as one: the block-in is slow
// enough to watch and leaves the picture flat, then each finer layer rushes in
// over the same slice.
//
// Inside a layer the hand behaves like a hand. It draws at one speed, so a stroke
// the width of the sky takes longer than a dash in a doorway -- giving every
// stroke the same time, as this used to, is what made the drawing look machined.
// It also has to reach: when the next stroke starts far from where the last one
// ended, a moment goes by before the pencil comes down again.
const REACH_SPEED = 3.4;
const REACH_LIMIT = 0.55;
const SPEED_SCATTER = 0.34;

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
  const paced = elements.allocation.value !== "count";
  const random = MotionToolkit.seededRandom(state.seed ^ 0x5bf03635);
  let offset = 0;

  bounds.forEach((band) => {
    const length = band.end - band.start + 1;
    const share = even ? total / bounds.length : total * length / count;
    const simultaneous = MotionToolkit.clamp(Number(elements.simultaneous.value), 1, length);
    if (length <= 1) {
      state.strokes[band.start].start = offset;
      state.strokes[band.start].span = share;
      offset += share;
      return;
    }

    // First in units of distance: how long each stroke is, plus the reach to it
    // from wherever the pencil was left, plus a little scatter so no two strokes
    // are drawn at exactly the same speed.
    const costs = new Float64Array(length);
    const reaches = new Float64Array(length);
    let ground = 0;
    let previous = null;
    for (let index = band.start; index <= band.end; index += 1) {
      const stroke = state.strokes[index];
      const slot = index - band.start;
      const scatter = 1 + (random() - 0.5) * SPEED_SCATTER;
      costs[slot] = Math.max(1, (paced ? stroke.travel : 1) * scatter);
      if (previous) {
        const away = Math.hypot(stroke.fromX - previous.toX, stroke.fromY - previous.toY);
        // Reaching is quicker than drawing, and a jump across the picture still
        // only costs a moment.
        reaches[slot] = Math.min(away / REACH_SPEED, costs[slot] * REACH_LIMIT);
      }
      ground += costs[slot] + reaches[slot];
      previous = stroke;
    }

    // Then in units of time: the whole band is worth `share` seconds, and about
    // `simultaneous` strokes are in flight at once.
    const seconds = share * simultaneous / Math.max(1, ground);
    let clock = 0;
    for (let index = band.start; index <= band.end; index += 1) {
      const slot = index - band.start;
      clock += reaches[slot] * seconds;
      const stroke = state.strokes[index];
      stroke.start = offset + clock / simultaneous;
      stroke.span = costs[slot] * seconds;
      clock += costs[slot] * seconds;
    }
    // The last stroke of a layer lands exactly on its far edge, and the next layer
    // picks up from there.
    const last = state.strokes[band.end];
    const reachedEnd = last.start + last.span - offset;
    if (reachedEnd > 0) {
      const squeeze = share / reachedEnd;
      for (let index = band.start; index <= band.end; index += 1) {
        const stroke = state.strokes[index];
        stroke.start = offset + (stroke.start - offset) * squeeze;
        stroke.span = stroke.span * squeeze;
      }
    }
    offset += share;
  });

  // A stroke that started earlier can still be running when a shorter one that
  // started later has finished, so the finished ones are no longer a clean prefix.
  // Carrying the furthest ending so far keeps the search below honest.
  let furthest = 0;
  for (const stroke of state.strokes) {
    furthest = Math.max(furthest, stroke.start + stroke.span);
    stroke.settled = furthest;
  }
}

// Starts rise with the index, and so does the furthest ending so far, so a search
// finds where the strokes that are certainly finished stop. Anything after that is
// drawn stroke by stroke, whether it is still travelling or already done.
function completedAt(elapsed) {
  let low = 0;
  let high = state.strokes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const stroke = state.strokes[middle];
    if (stroke.settled <= elapsed) low = middle + 1;
    else high = middle;
  }
  return low;
}

// A stroke lifts off the paper where its shape ends, stored as a NaN point, so
// the path is drawn as a run of subpaths rather than as one line. Where the tooth
// of the paper bit into it the line is not cut in two: that stretch is drawn thin
// instead of full width, in a pass of its own. The two passes never cover the same
// pixel, which matters under a multiply blend, where painting a pixel twice
// darkens it twice and no later stroke can lift it again.
function tracePath(target, stroke, fraction, width, height, want) {
  const points = stroke.points;
  const progress = stroke.progress;
  const bite = stroke.bite;
  const count = progress.length;
  target.beginPath();
  let down = false;
  let drew = false;
  for (let index = 0; index < count; index += 1) {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    if (Number.isNaN(x) || (bite && want >= 0 && bite[index] !== want)) { down = false; continue; }
    if (progress[index] <= fraction) {
      if (down) target.lineTo(x * width, y * height);
      else {
        // Doubled on purpose: a run of one point is a grain of colour, and a lone
        // moveTo would leave nothing behind.
        target.moveTo(x * width, y * height);
        target.lineTo(x * width, y * height);
        down = true;
      }
      drew = true;
      continue;
    }
    if (down) {
      const previous = progress[index - 1];
      const span = progress[index] - previous || 1;
      const amount = MotionToolkit.clamp((fraction - previous) / span, 0, 1);
      target.lineTo(
        MotionToolkit.lerp(points[index * 2 - 2], x, amount) * width,
        MotionToolkit.lerp(points[index * 2 - 1], y, amount) * height,
      );
      drew = true;
    }
    break;
  }
  if (drew) target.stroke();
}

function paintStroke(target, stroke, fraction, width, height, widthScale = 1, color = stroke.color) {
  const full = Math.max(0.1, stroke.width * widthScale);
  target.globalCompositeOperation = stroke.blend;
  target.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  target.globalAlpha = stroke.alpha;
  if (!stroke.bite) {
    target.lineWidth = full;
    tracePath(target, stroke, fraction, width, height, -1);
    return;
  }
  target.lineWidth = full;
  tracePath(target, stroke, fraction, width, height, 1);
  target.lineWidth = Math.max(0.1, full * SCRATCH_CORE);
  tracePath(target, stroke, fraction, width, height, 0);
}

// Width and opacity are set per stroke inside paintStroke; only what every
// stroke shares is set here.
function applyPencil(target) {
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
      // A hand leans into a stroke and lifts off it. The chosen easing still leads;
      // this only rounds the ends of it.
      const eased = MotionToolkit.ease(MotionToolkit.clamp(local, 0, 1), elements.easing.value);
      paintStroke(context, stroke, eased + (eased * eased * (3 - 2 * eased) - eased) * 0.3, width, height);
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
  // Roughness is a share of the patches, so the label says what it leaves alone
  // rather than a number that means nothing on its own.
  const leave = Number(elements.roughness.value);
  elements.roughnessValue.value = leave >= 100 ? "下塗りのみ" : `${leave}% · 残り${100 - leave}%を塗り重ね`;
  // The spacing in pixels follows from the pencil, so it is shown rather than set.
  const spacing = LINE_WIDTH / (Math.max(10, Number(elements.density.value)) / 100);
  elements.densityValue.value = `${elements.density.value}% · 間隔 ${spacing.toFixed(1)} px`;
  elements.pressureValue.value = `${elements.pressure.value}%`;
  elements.jitterValue.value = `${elements.jitter.value}%`;
  elements.overflowValue.value = `${elements.overflow.value}%`;
  elements.scratchValue.value = `${elements.scratch.value}%`;
  elements.baseAngleValue.value = `${elements.baseAngle.value}°`;
  elements.overlayValue.value = `${elements.overlay.value}%`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.baseAngle.disabled = elements.angleMode.value === "gradient";
  const count = state.strokes.length;
  // Strokes no longer all take the same time, so the label reports what the
  // block-in averages rather than what its first stroke happens to be.
  let coarse = 0;
  if (count) {
    let strokes = 0;
    for (const stroke of state.strokes) {
      if (stroke.layer !== state.strokes[0].layer) break;
      coarse += stroke.span;
      strokes += 1;
    }
    coarse /= Math.max(1, strokes);
  }
  elements.simultaneousValue.value = `${elements.simultaneous.value}本 · 1層目 平均${coarse.toFixed(2)}秒 / ${Math.round(coarse * 60)}f`;
  // The palette, the areas and the number of layers are all read off the picture,
  // so they are reported instead of being asked for.
  elements.strokeCount.value = count ? `${state.paletteCount}色 / ${state.regionCount}面 / ${count}本` : "—";
  const drawn = count ? completedAt(progress * totalDuration()) : 0;
  elements.stageStatus.textContent = count
    ? `${drawn} / ${count}本 · ${state.paletteCount}色 · ${state.regionCount}面 · ${state.layerCount}層 · 誤差 ${state.fidelity.toFixed(1)}`
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
  state.imageToken += 1;
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
[elements.roughness, elements.density, elements.pressure, elements.jitter, elements.overflow, elements.scratch, elements.baseAngle]
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
