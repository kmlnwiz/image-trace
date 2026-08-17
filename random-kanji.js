"use strict";

const OUTPUT_WIDTH = 800;
const OUTPUT_HEIGHT = 800;
const SOURCE_WIDTH = 1024;
const SOURCE_BASELINE = 900;
const CHARACTER_PADDING = 32;
const MAX_DURATION = 90;
const RANDOM_KANJI_SETTINGS_KEY = "motion-lab:random-kanji-settings:v1";
const DATA_CACHE_PREFIX = "motion-lab:hanzi-writer-jp:";
const DATA_CACHE_INDEX_KEY = "motion-lab:hanzi-writer-jp-cache-index:v1";
const MAX_DATA_CACHE_ENTRIES = 24;

const elements = {
  canvas: document.querySelector("#kanjiCanvas"),
  characterInput: document.querySelector("#characterInput"),
  dataStatus: document.querySelector("#dataStatus"),
  strokeCount: document.querySelector("#strokeCount"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  strokesPerStep: document.querySelector("#strokesPerStep"),
  strokesPerStepValue: document.querySelector("#strokesPerStepValue"),
  stepInterval: document.querySelector("#stepInterval"),
  stepIntervalValue: document.querySelector("#stepIntervalValue"),
  durationSummary: document.querySelector("#durationSummary"),
  displayMode: document.querySelector("#displayMode"),
  revealStyle: document.querySelector("#revealStyle"),
  shuffleButton: document.querySelector("#shuffleButton"),
  autoShuffle: document.querySelector("#autoShuffle"),
  sequencePreview: document.querySelector("#sequencePreview"),
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
const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ja", { granularity: "grapheme" })
  : null;

const state = {
  character: "舞",
  strokes: [],
  groups: [],
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

function saveSettings() {
  MotionStorage.write(RANDOM_KANJI_SETTINGS_KEY, {
    character: state.character,
    duration: elements.duration.value,
    strokesPerStep: elements.strokesPerStep.value,
    stepInterval: elements.stepInterval.value,
    displayMode: elements.displayMode.value,
    revealStyle: elements.revealStyle.value,
    autoShuffle: elements.autoShuffle.checked,
    guideOpacity: elements.guideOpacity.value,
    inkColor: elements.inkColor.value,
    backgroundColor: elements.backgroundColor.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(RANDOM_KANJI_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.character === "string" && splitCharacters(settings.character).length) {
    state.character = splitCharacters(settings.character)[0];
    elements.characterInput.value = state.character;
  }
  const controls = {
    duration: elements.duration,
    strokesPerStep: elements.strokesPerStep,
    stepInterval: elements.stepInterval,
    displayMode: elements.displayMode,
    revealStyle: elements.revealStyle,
    guideOpacity: elements.guideOpacity,
    inkColor: elements.inkColor,
    backgroundColor: elements.backgroundColor,
    previewSpeed: elements.previewSpeed,
    imageTime: elements.imageTime,
    outputSize: elements.outputSize,
  };
  Object.entries(controls).forEach(([name, control]) => {
    MotionStorage.restoreControl(control, settings[name]);
  });
  if (typeof settings.autoShuffle === "boolean") {
    elements.autoShuffle.checked = settings.autoShuffle;
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
      if (!Array.isArray(data.strokes) || !data.strokes.length) {
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
  if (!Array.isArray(data.strokes) || !data.strokes.length) {
    throw new Error("Stroke outlines are missing");
  }
  return data.strokes.map((pathData, index) => ({
    number: index + 1,
    shape: new Path2D(pathData),
  }));
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

function createRandomOrder() {
  const order = state.strokes.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

function buildGroups() {
  if (!state.strokes.length) {
    state.groups = [];
    renderSequencePreview();
    return;
  }
  const amount = Math.max(1, Number(elements.strokesPerStep.value) || 1);
  const duration = Number(elements.duration.value);
  const interval = Number(elements.stepInterval.value);
  const stepCount = Math.max(1, Math.ceil(duration / interval));
  state.groups = [];
  let cycle = 0;
  while (state.groups.length < stepCount) {
    const order = createRandomOrder();
    const cycleLength = Math.ceil(order.length / amount);
    for (let index = 0; index < order.length && state.groups.length < stepCount; index += amount) {
      state.groups.push({
        strokes: order.slice(index, index + amount),
        cycle,
        position: Math.floor(index / amount),
        cycleLength,
      });
    }
    cycle += 1;
  }
  renderSequencePreview();
}

function randomizeOrder(announce = false) {
  if (!state.strokes.length) return;
  buildGroups();
  state.playhead = 0;
  stopPlayback(false);
  syncTimingLimits();
  updateUI();
  render();
  if (announce) showToast("表示順をシャッフルしました");
}

function renderSequencePreview() {
  elements.sequencePreview.replaceChildren();
  const visibleGroups = state.groups.slice(0, 24);
  visibleGroups.forEach((group, index) => {
    const item = document.createElement("span");
    item.dataset.groupIndex = String(index);
    const numbers = group.strokes.map((strokeIndex) => state.strokes[strokeIndex].number).join("・");
    item.textContent = group.position === 0 ? `${group.cycle + 1}巡 ${numbers}` : numbers;
    item.title = `${group.cycle + 1}巡目 · 第${numbers.replaceAll("・", "・第")}画`;
    elements.sequencePreview.append(item);
  });
  if (state.groups.length > visibleGroups.length) {
    const more = document.createElement("span");
    more.className = "sequence-more";
    more.textContent = `+${state.groups.length - visibleGroups.length}`;
    elements.sequencePreview.append(more);
  }
}

function getTotalDuration() {
  return Number(elements.duration.value);
}

function syncTimingLimits() {
  const strokeCount = state.strokes.length;
  if (!strokeCount) {
    elements.duration.disabled = true;
    elements.strokesPerStep.disabled = true;
    elements.stepInterval.disabled = true;
    elements.imageTime.max = "0";
    elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
    return;
  }

  elements.strokesPerStep.max = String(Math.max(1, strokeCount));
  elements.strokesPerStep.value = String(clamp(Number(elements.strokesPerStep.value), 1, Math.max(1, strokeCount)));

  elements.duration.value = String(clamp(Number(elements.duration.value), 1, MAX_DURATION));
  const duration = getTotalDuration();
  elements.stepInterval.max = duration.toFixed(1);
  elements.stepInterval.value = String(clamp(Number(elements.stepInterval.value), 0.1, duration));
  elements.imageTime.max = String(duration);
  elements.imageTime.value = String(clamp(Number(elements.imageTime.value), 0, duration));
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
  elements.duration.disabled = false;
  elements.strokesPerStep.disabled = false;
  elements.stepInterval.disabled = false;
}

async function loadStrokeData(character) {
  const requestId = ++state.loadRequestId;
  state.loadController?.abort();
  state.loadController = new AbortController();
  state.isLoading = true;
  state.strokes = [];
  state.groups = [];
  state.playhead = 0;
  stopPlayback(false);
  syncTimingLimits();
  renderSequencePreview();
  setDataStatus("日本語用の画データを読み込み中");
  setCanvasMessage("漢字の画データを読み込んでいます…");
  updateUI();
  render();

  try {
    const data = await fetchCharacterData(character, state.loadController.signal);
    const strokes = parseCharacterData(data);
    if (requestId !== state.loadRequestId) return;
    state.strokes = strokes;
    state.isLoading = false;
    syncTimingLimits();
    buildGroups();
    setDataStatus(`${strokes.length}画をランダムに分割`, "ready");
    setCanvasMessage();
    saveSettings();
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
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
}

function drawStroke(stroke, alpha = 1) {
  context.save();
  applyCharacterTransform(context);
  context.globalAlpha = clamp(alpha, 0, 1);
  context.fillStyle = elements.inkColor.value;
  context.fill(stroke.shape);
  context.restore();
}

function groupAmounts(progress) {
  const interval = Number(elements.stepInterval.value);
  const cursor = clamp(progress, 0, 1) * getTotalDuration();
  const isInstant = elements.revealStyle.value === "instant";
  const fadeDuration = Math.min(0.35, Math.max(0.08, interval * 0.3));
  return state.groups.map((_, index) => {
    if (progress >= 1) return 1;
    const elapsed = cursor - index * interval;
    return isInstant ? Number(elapsed >= 0) : clamp(elapsed / fadeDuration, 0, 1);
  });
}

function activeGroupIndex(progress = state.playhead) {
  if (!state.groups.length) return -1;
  if (progress >= 1) return state.groups.length - 1;
  const cursor = clamp(progress, 0, 1) * getTotalDuration();
  return clamp(Math.floor(cursor / Number(elements.stepInterval.value)), 0, state.groups.length - 1);
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
      state.strokes.forEach((stroke) => drawStroke(stroke, guideOpacity));
    }

    const amounts = groupAmounts(progress);
    if (elements.displayMode.value === "replace") {
      const active = activeGroupIndex(progress);
      state.groups[active]?.strokes.forEach((strokeIndex) => drawStroke(state.strokes[strokeIndex], amounts[active]));
    } else {
      const active = activeGroupIndex(progress);
      const activeCycle = state.groups[active]?.cycle;
      state.groups.forEach((group, groupIndex) => {
        if (group.cycle !== activeCycle || groupIndex > active || amounts[groupIndex] <= 0) return;
        group.strokes.forEach((strokeIndex) => drawStroke(state.strokes[strokeIndex], amounts[groupIndex]));
      });
    }
  }
  context.restore();
}

function updateSequenceProgress() {
  const active = activeGroupIndex();
  const finished = state.playhead >= 1;
  [...elements.sequencePreview.children].forEach((item) => {
    const groupIndex = Number(item.dataset.groupIndex);
    item.classList.toggle("is-current", !finished && groupIndex === active);
    item.classList.toggle("is-done", Number.isFinite(groupIndex) && (finished || groupIndex < active));
  });
}

function updateUI() {
  const duration = getTotalDuration();
  const hasData = state.strokes.length > 0;
  elements.strokeCount.value = hasData ? `${state.strokes.length} 画` : "— 画";
  elements.durationValue.value = `${duration.toFixed(1)} 秒`;
  elements.strokesPerStepValue.value = `${elements.strokesPerStep.value} 画`;
  elements.stepIntervalValue.value = `${Number(elements.stepInterval.value).toFixed(1)} 秒`;
  const cycleCount = hasData ? state.groups[state.groups.length - 1].cycle + 1 : 0;
  elements.durationSummary.textContent = hasData ? `${cycleCount}巡目まで` : "— 巡";
  elements.guideOpacityValue.value = `${elements.guideOpacity.value}%`;
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
  elements.shuffleButton.disabled = !hasData || state.isLoading || state.isExporting;
  elements.outputSize.disabled = state.isExporting;
  elements.exportButton.disabled = !hasData || state.isLoading || state.isExporting;
  elements.imageExportButton.disabled = !hasData || state.isLoading || state.isExporting;

  if (state.isLoading) {
    elements.stageStatus.textContent = "画データを読み込み中";
  } else if (!hasData) {
    elements.stageStatus.textContent = "画データなし";
  } else {
    const active = activeGroupIndex();
    const group = state.groups[active];
    const numbers = group.strokes
      .map((strokeIndex) => `第${state.strokes[strokeIndex].number}画`)
      .join("・");
    const prefix = state.playhead >= 1 ? "終了" : `${group.cycle + 1}巡目`;
    elements.stageStatus.textContent = `${prefix} · ${group.position + 1}/${group.cycleLength}セット · ${numbers}`;
  }
  updateSequenceProgress();
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
  const durationMs = getTotalDuration() * 1000;
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
    if (elements.autoShuffle.checked) {
      buildGroups();
    }
    state.playhead = 0;
    render();
  }
  state.isPlaying = true;
  const speed = Number(elements.previewSpeed.value);
  state.startedAt = performance.now() - state.playhead * getTotalDuration() * 1000 / speed;
  updateUI();
  state.rafId = requestAnimationFrame(animate);
}

function stopPlayback(renderFrame = true) {
  state.isPlaying = false;
  cancelAnimationFrame(state.rafId);
  updateUI();
  if (renderFrame) render();
}

function safeFileCharacter() {
  return state.character.replace(/[\\/:*?"<>|]/g, "") || "kanji";
}

async function exportVideo() {
  if (state.isExporting || !state.strokes.length) return;
  state.isExporting = true;
  stopPlayback(false);
  updateUI();
  elements.exportButton.lastChild.textContent = " 書き出し中";
  elements.exportProgress.hidden = false;
  elements.exportProgressBar.style.width = "0%";
  try {
    const wanted = MotionToolkit.exportFormat();
    const blob = await MotionToolkit.renderWebm({
      format: wanted,
      canvas: elements.canvas,
      totalFrames: Math.round(getTotalDuration() * 60),
      render(playhead) {
        state.playhead = playhead;
        render(playhead);
      },
      onProgress(progress) {
        elements.exportProgressBar.style.width = `${progress * 100}%`;
        updateUI();
      },
    });
    // What came back is what gets written: a browser that cannot encode H.264
    // still produces a file, and the toast says which one it is.
    const made = blob.type.includes("mp4") ? "mp4" : "webm";
    MotionToolkit.downloadBlob(blob, `${safeFileCharacter()}-random-kanji.${made}`);
    showToast(made === wanted
      ? `${made === "mp4" ? "MP4" : "WebM"}を書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`
      : `MP4に対応していないためWebMで書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (error) {
    showToast(error?.message || "動画を書き出せませんでした");
  } finally {
    state.isExporting = false;
    elements.exportButton.lastChild.textContent = " 動画を書き出す";
    elements.exportProgress.hidden = true;
    updateUI();
  }
}

function exportImage() {
  if (!state.strokes.length) return;
  stopPlayback(false);
  const duration = getTotalDuration();
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
    anchor.download = `${safeFileCharacter()}-random-kanji-${seconds.toFixed(1)}s.png`;
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
  state.strokes = [];
  state.groups = [];
  state.playhead = 0;
  stopPlayback();
  syncTimingLimits();
  renderSequencePreview();
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

function rebuildAnimation() {
  state.playhead = 0;
  stopPlayback(false);
  syncTimingLimits();
  buildGroups();
  saveSettings();
  updateUI();
  render();
}

elements.duration.addEventListener("input", rebuildAnimation);
elements.strokesPerStep.addEventListener("input", rebuildAnimation);
elements.stepInterval.addEventListener("input", rebuildAnimation);
[elements.displayMode, elements.revealStyle].forEach((control) => {
  control.addEventListener("change", () => {
    saveSettings();
    updateUI();
    render();
  });
});
elements.shuffleButton.addEventListener("click", () => randomizeOrder(true));
elements.autoShuffle.addEventListener("change", saveSettings);
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
  const duration = getTotalDuration();
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
  restoreSettings();
  resizeOutputCanvas();
  syncTimingLimits();
  updateUI();
  render();
  await loadStrokeData(state.character);
})();
