"use strict";

const OUTPUT_WIDTH = 800;
const OUTPUT_HEIGHT = 800;
const KANJI_SETTINGS_KEY = "motion-lab:reverse-kanji-settings:v4";
const DATA_CACHE_PREFIX = "motion-lab:hanzi-writer-jp:";
const DATA_CACHE_INDEX_KEY = "motion-lab:hanzi-writer-jp-cache-index:v1";
const MAX_DATA_CACHE_ENTRIES = 24;
const SOURCE_WIDTH = 1024;
const SOURCE_BASELINE = 900;
const CHARACTER_PADDING = 32;
const REVEAL_WIDTH = 120;

const elements = {
  canvas: document.querySelector("#kanjiCanvas"),
  characterInput: document.querySelector("#characterInput"),
  dataStatus: document.querySelector("#dataStatus"),
  strokeCount: document.querySelector("#strokeCount"),
  strokeOrderMode: document.querySelector("#strokeOrderMode"),
  orderSummary: document.querySelector("#orderSummary"),
  directionSummary: document.querySelector("#directionSummary"),
  orderShuffleButton: document.querySelector("#orderShuffleButton"),
  strokeLimit: document.querySelector("#strokeLimit"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  strokeDuration: document.querySelector("#strokeDuration"),
  strokeDurationValue: document.querySelector("#strokeDurationValue"),
  strokeInterval: document.querySelector("#strokeInterval"),
  strokeIntervalValue: document.querySelector("#strokeIntervalValue"),
  easing: document.querySelector("#easing"),
  guideOpacity: document.querySelector("#guideOpacity"),
  guideOpacityValue: document.querySelector("#guideOpacityValue"),
  inkColor: document.querySelector("#inkColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  colorControls: [...document.querySelectorAll('.color-control input[type="color"]')],
  stageStatus: document.querySelector("#stageStatus"),
  canvasMessage: document.querySelector("#canvasMessage"),
  restartButton: document.querySelector("#restartButton"),
  playButton: document.querySelector("#playButton"),
  timeline: document.querySelector("#timeline"),
  currentTime: document.querySelector("#currentTime"),
  totalTime: document.querySelector("#totalTime"),
  previewSpeed: document.querySelector("#previewSpeed"),
  imageTime: document.querySelector("#imageTime"),
  imageTimeValue: document.querySelector("#imageTimeValue"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
  imageExportButton: document.querySelector("#imageExportButton"),
  exportButton: document.querySelector("#exportButton"),
  exportProgress: document.querySelector("#exportProgress"),
  exportProgressBar: document.querySelector("#exportProgressBar"),
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d");
const strokeCanvas = document.createElement("canvas");
const strokeContext = strokeCanvas.getContext("2d");
strokeCanvas.width = OUTPUT_WIDTH;
strokeCanvas.height = OUTPUT_HEIGHT;

const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ja", { granularity: "grapheme" })
  : null;

const state = {
  character: "逆",
  sourceStrokes: [],
  strokes: [],
  playhead: 0,
  isPlaying: false,
  isExporting: false,
  isLoading: false,
  startedAt: 0,
  rafId: 0,
  toastTimer: 0,
  loadTimer: 0,
  loadRequestId: 0,
  loadController: null,
  strokeLimitPreference: "all",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function splitCharacters(value) {
  const normalized = value.normalize("NFC");
  return segmenter
    ? [...segmenter.segment(normalized)].map((part) => part.segment)
    : Array.from(normalized);
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function ease(progress) {
  const value = clamp(progress, 0, 1);
  if (elements.easing.value === "easeIn") return value * value * value;
  if (elements.easing.value === "easeOut") return 1 - Math.pow(1 - value, 3);
  if (elements.easing.value === "easeInOut") {
    return value < 0.5
      ? 4 * value * value * value
      : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }
  return value;
}

function saveSettings() {
  MotionStorage.write(KANJI_SETTINGS_KEY, {
    character: state.character,
    strokeOrderMode: elements.strokeOrderMode.value,
    strokeLimit: elements.strokeLimit.value,
    duration: elements.duration.value,
    strokeDuration: elements.strokeDuration.value,
    strokeInterval: elements.strokeInterval.value,
    easing: elements.easing.value,
    guideOpacity: elements.guideOpacity.value,
    inkColor: elements.inkColor.value,
    backgroundColor: elements.backgroundColor.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(KANJI_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.character === "string" && splitCharacters(settings.character).length) {
    state.character = splitCharacters(settings.character)[0];
    elements.characterInput.value = state.character;
  }
  const controls = {
    strokeOrderMode: elements.strokeOrderMode,
    duration: elements.duration,
    strokeDuration: elements.strokeDuration,
    strokeInterval: elements.strokeInterval,
    easing: elements.easing,
    guideOpacity: elements.guideOpacity,
    inkColor: elements.inkColor,
    backgroundColor: elements.backgroundColor,
    previewSpeed: elements.previewSpeed,
    outputSize: elements.outputSize,
  };
  Object.entries(controls).forEach(([name, control]) => {
    MotionStorage.restoreControl(control, settings[name]);
  });
  if (settings.strokeLimit === "all"
    || (Number.isInteger(Number(settings.strokeLimit)) && Number(settings.strokeLimit) >= 1)) {
    state.strokeLimitPreference = String(settings.strokeLimit);
  }
  elements.colorControls.forEach((input) => {
    input.nextElementSibling.value = input.value.toUpperCase();
  });
  return settings;
}

function readDataCache(character) {
  try {
    const value = localStorage.getItem(`${DATA_CACHE_PREFIX}${character}`);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeDataCache(character, data) {
  try {
    localStorage.setItem(`${DATA_CACHE_PREFIX}${character}`, JSON.stringify(data));
    const savedIndex = JSON.parse(localStorage.getItem(DATA_CACHE_INDEX_KEY) || "[]");
    const index = [character, ...savedIndex.filter((item) => item !== character)];
    while (index.length > MAX_DATA_CACHE_ENTRIES) {
      const expired = index.pop();
      localStorage.removeItem(`${DATA_CACHE_PREFIX}${expired}`);
    }
    localStorage.setItem(DATA_CACHE_INDEX_KEY, JSON.stringify(index));
  } catch {
    // The current character remains usable if browser storage is unavailable.
  }
}

async function fetchCharacterData(character, signal) {
  const cached = readDataCache(character);
  if (cached) return cached;

  const encodedCharacter = encodeURIComponent(character);
  const urls = [
    `https://cdn.jsdelivr.net/npm/hanzi-writer-data-jp@0/${encodedCharacter}.json`,
    `https://cdn.jsdelivr.net/gh/chanind/hanzi-writer-data-jp@master/data/${encodedCharacter}.json`,
    `https://raw.githubusercontent.com/chanind/hanzi-writer-data-jp/master/data/${encodedCharacter}.json`,
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal, mode: "cors" });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (!Array.isArray(data.strokes) || !Array.isArray(data.medians)) {
        throw new Error("Invalid character data");
      }
      writeDataCache(character, data);
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("Character data could not be loaded");
}

function parseCharacterData(data) {
  if (!data.strokes.length || data.strokes.length !== data.medians.length) {
    throw new Error("Stroke outlines and medians do not match");
  }

  const forwardStrokes = data.strokes.map((pathData, index) => {
    const median = data.medians[index]
      .filter((point) => Array.isArray(point) && point.length >= 2)
      .map((point) => ({ x: Number(point[0]), y: Number(point[1]) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (median.length < 2) throw new Error("A stroke median is incomplete");

    const extendedMedian = extendMedianToOutline(new Path2D(pathData), median);
    const cumulative = [0];
    let length = 0;
    for (let pointIndex = 1; pointIndex < extendedMedian.length; pointIndex += 1) {
      const from = extendedMedian[pointIndex - 1];
      const to = extendedMedian[pointIndex];
      length += Math.hypot(to.x - from.x, to.y - from.y);
      cumulative.push(length);
    }
    return {
      number: index + 1,
      shape: new Path2D(pathData),
      median: extendedMedian,
      cumulative,
      length,
    };
  });
  return forwardStrokes;
}

function shuffledStrokes(strokes) {
  const shuffled = [...strokes];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function applyStrokeOrder() {
  const mode = elements.strokeOrderMode.value;
  if (mode === "reverse") {
    state.strokes = [...state.sourceStrokes].reverse();
  } else if (mode === "random") {
    state.strokes = shuffledStrokes(state.sourceStrokes);
  } else {
    state.strokes = [...state.sourceStrokes];
  }
}

function strokeLimit() {
  if (elements.strokeLimit.value === "all") return state.strokes.length;
  return clamp(Math.round(Number(elements.strokeLimit.value) || 1), 1, state.strokes.length);
}

function animatedStrokes() {
  return state.strokes.slice(0, strokeLimit());
}

function rebuildStrokeLimitOptions() {
  const previousValue = state.strokeLimitPreference || elements.strokeLimit.value || "all";
  elements.strokeLimit.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "最後まで";
  elements.strokeLimit.append(allOption);

  state.strokes.forEach((_, index) => {
    const option = document.createElement("option");
    option.value = String(index + 1);
    option.textContent = `第${index + 1}画まで`;
    elements.strokeLimit.append(option);
  });

  const canRestore = previousValue === "all"
    || (Number(previousValue) >= 1 && Number(previousValue) <= state.strokes.length);
  elements.strokeLimit.value = canRestore ? previousValue : "all";
  state.strokeLimitPreference = elements.strokeLimit.value;
}

function pointOutsideStroke(shape, edge, neighbor) {
  const deltaX = edge.x - neighbor.x;
  const deltaY = edge.y - neighbor.y;
  const vectorLength = Math.hypot(deltaX, deltaY) || 1;
  const directionX = deltaX / vectorLength;
  const directionY = deltaY / vectorLength;
  let exitDistance = REVEAL_WIDTH;

  // Keep the round reveal cap completely outside the outline at progress zero.
  // It can then move continuously through bends without a join suddenly
  // appearing, while still entering the terminal edge a few pixels at a time.
  for (let distance = 2; distance <= SOURCE_WIDTH; distance += 2) {
    const point = {
      x: edge.x + directionX * distance,
      y: edge.y + directionY * distance,
    };
    if (!strokeContext.isPointInPath(shape, point.x, point.y)) {
      exitDistance = distance;
      break;
    }
  }
  const guardedDistance = exitDistance + REVEAL_WIDTH / 2 + 2;
  return {
    x: edge.x + directionX * guardedDistance,
    y: edge.y + directionY * guardedDistance,
  };
}

function extendMedianToOutline(shape, median) {
  const start = pointOutsideStroke(shape, median[0], median[1]);
  const lastIndex = median.length - 1;
  const end = pointOutsideStroke(shape, median[lastIndex], median[lastIndex - 1]);
  return [start, ...median, end];
}

function setDataStatus(message, type = "loading") {
  elements.dataStatus.lastElementChild.textContent = message;
  elements.dataStatus.classList.toggle("is-ready", type === "ready");
  elements.dataStatus.classList.toggle("is-error", type === "error");
}

function setCanvasMessage(message = "") {
  elements.canvasMessage.textContent = message;
  elements.canvasMessage.hidden = !message;
}

async function loadStrokeData(character) {
  const requestId = ++state.loadRequestId;
  state.loadController?.abort();
  state.loadController = new AbortController();
  state.isLoading = true;
  state.sourceStrokes = [];
  state.strokes = [];
  state.playhead = 0;
  syncIntervalLimit();
  stopPlayback(false);
  setDataStatus("日本語用の画データを読み込み中");
  setCanvasMessage("正しい書き順データを読み込んでいます…");
  updateUI();
  render();

  try {
    const data = await fetchCharacterData(character, state.loadController.signal);
    const strokes = parseCharacterData(data);
    if (requestId !== state.loadRequestId) return;
    state.sourceStrokes = strokes;
    applyStrokeOrder();
    rebuildStrokeLimitOptions();
    state.isLoading = false;
    syncIntervalLimit();
    saveSettings();
    setDataStatus(`${strokes.length}画の書き順データを読み込み済み`, "ready");
    setCanvasMessage();
    updateUI();
    render();
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.loadRequestId) return;
    state.isLoading = false;
    setDataStatus("日本語用の画データが見つかりません", "error");
    setCanvasMessage("この文字の画データを取得できませんでした。漢字1文字とネット接続を確認してください。");
    updateUI();
    render();
  }
}

function applyCharacterTransform(ctx) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const scaledPadding = CHARACTER_PADDING * Math.min(width, height) / OUTPUT_WIDTH;
  const availableWidth = width - scaledPadding * 2;
  const availableHeight = height - scaledPadding * 2;
  const scale = Math.min(availableWidth / SOURCE_WIDTH, availableHeight / SOURCE_WIDTH);
  const x = width / 2 - SOURCE_WIDTH * scale / 2;
  const y = height / 2 + SOURCE_BASELINE * scale / 2;
  ctx.setTransform(scale, 0, 0, -scale, x, y);
}

function resizeOutputCanvas() {
  const dimensions = MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  strokeCanvas.width = dimensions.width;
  strokeCanvas.height = dimensions.height;
}

function strokeAmounts(progress) {
  const strokes = animatedStrokes();
  if (!strokes.length) return state.strokes.map(() => 0);
  const duration = Number(elements.duration.value);
  const strokeDuration = Math.max(0.01, Number(elements.strokeDuration.value));
  const interval = Number(elements.strokeInterval.value);
  const cursor = clamp(progress, 0, 1) * duration;
  return state.strokes.map((stroke, index) => {
    if (index >= strokes.length) return 0;
    const startTime = index * interval;
    const amount = ease((cursor - startTime) / strokeDuration);
    return clamp(amount, 0, 1);
  });
}

function traceReverseMedian(ctx, stroke, amount) {
  if (amount <= 0) return;
  const targetDistance = stroke.length * (1 - clamp(amount, 0, 1));
  const points = stroke.median;
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);

  let index = points.length - 2;
  while (index >= 0 && stroke.cumulative[index] >= targetDistance) {
    ctx.lineTo(points[index].x, points[index].y);
    index -= 1;
  }
  if (index >= 0 && index + 1 < points.length) {
    const from = points[index];
    const to = points[index + 1];
    const segmentLength = stroke.cumulative[index + 1] - stroke.cumulative[index] || 1;
    const mix = (targetDistance - stroke.cumulative[index]) / segmentLength;
    ctx.lineTo(
      from.x + (to.x - from.x) * mix,
      from.y + (to.y - from.y) * mix,
    );
  }
  ctx.stroke();
}

function traceForwardMedian(ctx, stroke, amount) {
  if (amount <= 0) return;
  const targetDistance = stroke.length * clamp(amount, 0, 1);
  const points = stroke.median;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  let index = 1;
  while (index < points.length && stroke.cumulative[index] <= targetDistance) {
    ctx.lineTo(points[index].x, points[index].y);
    index += 1;
  }
  if (index < points.length) {
    const from = points[index - 1];
    const to = points[index];
    const segmentLength = stroke.cumulative[index] - stroke.cumulative[index - 1] || 1;
    const mix = (targetDistance - stroke.cumulative[index - 1]) / segmentLength;
    ctx.lineTo(
      from.x + (to.x - from.x) * mix,
      from.y + (to.y - from.y) * mix,
    );
  }
  ctx.stroke();
}

function drawCompleteStroke(ctx, stroke, color, alpha = 1) {
  ctx.save();
  applyCharacterTransform(ctx);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill(stroke.shape);
  ctx.restore();
}

function drawPartialStroke(stroke, amount) {
  strokeContext.save();
  strokeContext.setTransform(1, 0, 0, 1, 0, 0);
  strokeContext.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
  applyCharacterTransform(strokeContext);
  strokeContext.clip(stroke.shape);
  strokeContext.strokeStyle = elements.inkColor.value;
  strokeContext.lineWidth = REVEAL_WIDTH;
  strokeContext.lineCap = "round";
  strokeContext.lineJoin = "round";
  if (elements.strokeOrderMode.value === "reverse") {
    traceReverseMedian(strokeContext, stroke, amount);
  } else {
    traceForwardMedian(strokeContext, stroke, amount);
  }
  strokeContext.restore();
  context.drawImage(strokeCanvas, 0, 0);
}

function render(progress = state.playhead) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  if (state.strokes.length) {
    const guideOpacity = Number(elements.guideOpacity.value) / 100;
    if (guideOpacity > 0) {
      state.strokes.forEach((stroke) => {
        drawCompleteStroke(context, stroke, elements.inkColor.value, guideOpacity);
      });
    }

    const amounts = strokeAmounts(progress);
    state.strokes.forEach((stroke, index) => {
      const amount = amounts[index];
      if (amount <= 0) return;
      if (amount >= 0.9999) drawCompleteStroke(context, stroke, elements.inkColor.value);
      else drawPartialStroke(stroke, amount);
    });
  }
  context.restore();
}

function activeStrokeNumber() {
  const amounts = strokeAmounts(state.playhead).slice(0, strokeLimit());
  const activeIndex = amounts.findIndex((amount) => amount < 1);
  if (activeIndex < 0) return null;
  return state.strokes[activeIndex]?.number || null;
}

function syncTimeLimits() {
  const duration = Number(elements.duration.value);
  elements.imageTime.max = String(duration);
  elements.imageTime.value = String(clamp(Number(elements.imageTime.value), 0, duration));
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
}

function syncIntervalLimit() {
  const strokeCount = strokeLimit();
  if (!strokeCount) {
    elements.strokeInterval.max = "10";
    elements.strokeInterval.disabled = true;
    return;
  }
  elements.strokeInterval.max = "10";
  elements.strokeInterval.value = String(clamp(Number(elements.strokeInterval.value), 0, 10));
  elements.strokeInterval.disabled = strokeCount <= 1;
}

function updateUI() {
  const duration = Number(elements.duration.value);
  const hasData = state.strokes.length > 0;
  const animatedCount = strokeLimit();
  const mode = elements.strokeOrderMode.value;
  const modeSummaries = {
    normal: ["最初 → 最後", "始点 → 終点"],
    random: ["ランダム", "始点 → 終点"],
    reverse: ["最後 → 最初", "終点 → 始点"],
  };
  const [orderSummary, directionSummary] = modeSummaries[mode];
  elements.orderSummary.textContent = orderSummary;
  elements.directionSummary.textContent = directionSummary;
  elements.orderShuffleButton.hidden = mode !== "random";
  elements.durationValue.value = `${duration.toFixed(1)} 秒`;
  elements.strokeDurationValue.value = `${Number(elements.strokeDuration.value).toFixed(2)} 秒`;
  elements.strokeIntervalValue.value = `${Number(elements.strokeInterval.value).toFixed(2)} 秒`;
  elements.guideOpacityValue.value = `${elements.guideOpacity.value}%`;
  elements.strokeCount.value = hasData ? `${state.strokes.length} 画` : "— 画";
  elements.timeline.value = String(Math.round(state.playhead * 1000));
  elements.currentTime.value = formatTime(state.playhead * duration);
  elements.totalTime.value = formatTime(duration);
  elements.imageTime.max = String(duration);
  elements.imageTime.value = String(clamp(state.playhead * duration, 0, duration));
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
  elements.playButton.textContent = state.isPlaying ? "Ⅱ" : "▶";
  elements.playButton.setAttribute("aria-label", state.isPlaying ? "一時停止" : "再生");
  elements.playButton.disabled = !hasData || state.isLoading || state.isExporting;
  elements.restartButton.disabled = !hasData || state.isLoading || state.isExporting;
  elements.strokeOrderMode.disabled = state.isLoading || state.isExporting;
  elements.strokeLimit.disabled = !hasData || state.isLoading || state.isExporting;
  elements.strokeDuration.disabled = !hasData || state.isLoading || state.isExporting;
  elements.orderShuffleButton.disabled = !hasData || state.isLoading || state.isExporting;
  elements.outputSize.disabled = state.isExporting;
  elements.exportButton.disabled = !hasData || state.isLoading || state.isExporting;
  elements.imageExportButton.disabled = !hasData || state.isLoading || state.isExporting;

  if (state.isLoading) {
    elements.stageStatus.textContent = "画データを読み込み中";
  } else if (!hasData) {
    elements.stageStatus.textContent = "画データなし";
  } else {
    const active = activeStrokeNumber();
    if (!active) {
      elements.stageStatus.textContent = `${animatedCount}/${state.strokes.length}画 · 完成後待機`;
    } else if (mode === "reverse") {
      elements.stageStatus.textContent = `${animatedCount}/${state.strokes.length}画 · 第${active}画を終点から描画`;
    } else if (mode === "random") {
      elements.stageStatus.textContent = `${animatedCount}/${state.strokes.length}画 · ランダム順で第${active}画を描画`;
    } else {
      elements.stageStatus.textContent = `${animatedCount}/${state.strokes.length}画 · 第${active}画を通常順で描画`;
    }
  }
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function animate(timestamp) {
  if (!state.isPlaying) return;
  const durationMs = Number(elements.duration.value) * 1000;
  const speed = Number(elements.previewSpeed.value);
  state.playhead = clamp((timestamp - state.startedAt) * speed / durationMs, 0, 1);
  render();
  updateUI();
  if (state.playhead >= 1) {
    state.isPlaying = false;
    updateUI();
    return;
  }
  state.rafId = requestAnimationFrame(animate);
}

function startPlayback() {
  if (!state.strokes.length || state.isLoading || state.isExporting) return;
  if (state.playhead >= 1) {
    if (elements.strokeOrderMode.value === "random") applyStrokeOrder();
    state.playhead = 0;
    render();
  }
  state.isPlaying = true;
  const speed = Number(elements.previewSpeed.value);
  state.startedAt = performance.now() - state.playhead * Number(elements.duration.value) * 1000 / speed;
  updateUI();
  state.rafId = requestAnimationFrame(animate);
}

function stopPlayback(renderFrame = true) {
  state.isPlaying = false;
  cancelAnimationFrame(state.rafId);
  updateUI();
  if (renderFrame) render();
}

function supportedMimeType() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
}

function safeFileCharacter() {
  return state.character.replace(/[\\/:*?"<>|]/g, "") || "kanji";
}

async function exportVideo() {
  if (state.isExporting || !state.strokes.length) return;
  if (!elements.canvas.captureStream || !window.MediaRecorder) {
    showToast("このブラウザはWebM書き出しに対応していません");
    return;
  }
  const mimeType = supportedMimeType();
  const stream = elements.canvas.captureStream(60);
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 12_000_000,
  });
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  state.isExporting = true;
  stopPlayback(false);
  updateUI();
  elements.exportButton.lastChild.textContent = " 書き出し中";
  elements.exportProgress.hidden = false;
  elements.exportProgressBar.style.width = "0%";
  const durationMs = Number(elements.duration.value) * 1000;
  const startedAt = performance.now();
  const finished = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  recorder.start(250);

  await new Promise((resolve) => {
    function recordFrame(now) {
      const progress = clamp((now - startedAt) / durationMs, 0, 1);
      state.playhead = progress;
      render(progress);
      updateUI();
      elements.exportProgressBar.style.width = `${progress * 100}%`;
      if (progress < 1) requestAnimationFrame(recordFrame);
      else window.setTimeout(resolve, 100);
    }
    requestAnimationFrame(recordFrame);
  });

  recorder.stop();
  await finished;
  stream.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileCharacter()}-kanji-writer-${elements.strokeOrderMode.value}.webm`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  state.isExporting = false;
  elements.exportButton.lastChild.textContent = " 動画を書き出す";
  elements.exportProgress.hidden = true;
  updateUI();
  showToast(`WebMを書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
}

function exportImage() {
  if (!state.strokes.length) return;
  stopPlayback(false);
  const duration = Number(elements.duration.value);
  const seconds = state.playhead * duration;
  render();
  updateUI();
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNGを作成できませんでした");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileCharacter()}-kanji-writer-${elements.strokeOrderMode.value}-${seconds.toFixed(1)}s.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`${elements.imageTimeValue.value}のPNGを書き出しました`);
  }, "image/png");
}

elements.characterInput.addEventListener("input", () => {
  const [character = ""] = splitCharacters(elements.characterInput.value);
  elements.characterInput.value = character;
  state.character = character;
  clearTimeout(state.loadTimer);
  state.loadController?.abort();
  state.sourceStrokes = [];
  state.strokes = [];
  state.playhead = 0;
  syncIntervalLimit();
  stopPlayback();
  saveSettings();
  if (!character) {
    state.isLoading = false;
    setDataStatus("漢字を1文字入力してください", "error");
    setCanvasMessage("左の欄に漢字を1文字入力してください。");
    updateUI();
    return;
  }
  state.loadTimer = window.setTimeout(() => loadStrokeData(character), 220);
});

function resetStrokeOrder(announce = false) {
  if (!state.sourceStrokes.length) {
    saveSettings();
    updateUI();
    return;
  }
  state.playhead = 0;
  stopPlayback(false);
  applyStrokeOrder();
  syncIntervalLimit();
  saveSettings();
  updateUI();
  render();
  if (announce) showToast("ランダムな画順を更新しました");
}

elements.strokeOrderMode.addEventListener("change", () => resetStrokeOrder(false));
elements.orderShuffleButton.addEventListener("click", () => resetStrokeOrder(true));
elements.strokeLimit.addEventListener("change", () => {
  state.strokeLimitPreference = elements.strokeLimit.value;
  syncIntervalLimit();
  saveSettings();
  updateUI();
  render();
});
elements.duration.addEventListener("input", () => {
  syncTimeLimits();
  syncIntervalLimit();
  saveSettings();
  updateUI();
  render();
});
elements.strokeDuration.addEventListener("input", () => {
  saveSettings();
  updateUI();
  render();
});
elements.strokeInterval.addEventListener("input", () => {
  saveSettings();
  updateUI();
  render();
});
elements.easing.addEventListener("change", () => {
  saveSettings();
  render();
  updateUI();
});
elements.guideOpacity.addEventListener("input", () => {
  saveSettings();
  updateUI();
  render();
});
elements.colorControls.forEach((input) => {
  input.addEventListener("input", () => {
    input.nextElementSibling.value = input.value.toUpperCase();
    saveSettings();
    render();
  });
});
elements.playButton.addEventListener("click", () => state.isPlaying ? stopPlayback() : startPlayback());
elements.restartButton.addEventListener("click", () => {
  state.playhead = 0;
  stopPlayback();
});
elements.timeline.addEventListener("input", () => {
  state.playhead = Number(elements.timeline.value) / 1000;
  stopPlayback();
});
elements.previewSpeed.addEventListener("change", () => {
  saveSettings();
  if (state.isPlaying) {
    stopPlayback(false);
    startPlayback();
  }
});
elements.imageTime.addEventListener("input", () => {
  const duration = Number(elements.duration.value);
  state.playhead = duration ? clamp(Number(elements.imageTime.value) / duration, 0, 1) : 0;
  stopPlayback();
  saveSettings();
});
elements.outputSize.addEventListener("change", () => {
  resizeOutputCanvas();
  saveSettings();
  render();
});
elements.exportButton.addEventListener("click", exportVideo);
elements.imageExportButton.addEventListener("click", exportImage);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !["INPUT", "SELECT", "BUTTON"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    if (state.isPlaying) stopPlayback();
    else startPlayback();
  }
});

(async function init() {
  const settings = restoreSettings();
  resizeOutputCanvas();
  syncTimeLimits();
  syncIntervalLimit();
  MotionStorage.restoreControl(elements.imageTime, settings?.imageTime);
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
  updateUI();
  render();
  await loadStrokeData(state.character);
})();
