"use strict";

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 1000;
const PROCESS_LIMIT = 760;
const ALPHA_THRESHOLD = 12;
const OUTLINE_SETTINGS_KEY = "motion-lab:outline-settings:v1";

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  canvasShell: document.querySelector("#canvasShell"),
  fileInput: document.querySelector("#fileInput"),
  sampleButton: document.querySelector("#sampleButton"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
  fileSummary: document.querySelector("#fileSummary"),
  imageStatus: document.querySelector("#imageStatus"),
  imageDimensions: document.querySelector("#imageDimensions"),
  pointCount: document.querySelector("#pointCount"),
  lineWidth: document.querySelector("#lineWidth"),
  lineWidthValue: document.querySelector("#lineWidthValue"),
  lineColor: document.querySelector("#lineColor"),
  lineColorValue: document.querySelector("#lineColorValue"),
  opacity: document.querySelector("#opacity"),
  opacityValue: document.querySelector("#opacityValue"),
  backgroundColor: document.querySelector("#backgroundColor"),
  backgroundColorValue: document.querySelector("#backgroundColorValue"),
  originButton: document.querySelector("#originButton"),
  originValue: document.querySelector("#originValue"),
  originHint: document.querySelector("#originHint"),
  fitButton: document.querySelector("#fitButton"),
  playButton: document.querySelector("#playButton"),
  restartButton: document.querySelector("#restartButton"),
  timeline: document.querySelector("#timeline"),
  currentTime: document.querySelector("#currentTime"),
  totalTime: document.querySelector("#totalTime"),
  previewSpeed: document.querySelector("#previewSpeed"),
  tailFrom: document.querySelector("#tailFrom"),
  tailTo: document.querySelector("#tailTo"),
  headFrom: document.querySelector("#headFrom"),
  headTo: document.querySelector("#headTo"),
  swapRangeButton: document.querySelector("#swapRangeButton"),
  presetButtons: [...document.querySelectorAll(".preset-button")],
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  easing: document.querySelector("#easing"),
  imageTime: document.querySelector("#imageTime"),
  imageTimeValue: document.querySelector("#imageTimeValue"),
  imageExportButton: document.querySelector("#imageExportButton"),
  exportButton: document.querySelector("#exportButton"),
  exportProgress: document.querySelector("#exportProgress"),
  exportProgressBar: document.querySelector("#exportProgressBar"),
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d");

const state = {
  image: null,
  imageName: "sample-shape.png",
  imageBytes: 0,
  processWidth: 0,
  processHeight: 0,
  contour: [],
  cumulative: [],
  totalLength: 0,
  bounds: null,
  transform: null,
  playhead: 0,
  isPlaying: false,
  isPickingOrigin: false,
  startedAt: 0,
  pausedAt: 0,
  rafId: 0,
  toastTimer: 0,
  isExporting: false,
};

function saveOutlineSettings() {
  const activePreset = elements.presetButtons.find((button) => button.classList.contains("is-active"));
  MotionStorage.write(OUTLINE_SETTINGS_KEY, {
    lineWidth: elements.lineWidth.value,
    lineColor: elements.lineColor.value,
    opacity: elements.opacity.value,
    backgroundColor: elements.backgroundColor.value,
    tailFrom: elements.tailFrom.value,
    tailTo: elements.tailTo.value,
    headFrom: elements.headFrom.value,
    headTo: elements.headTo.value,
    duration: elements.duration.value,
    easing: elements.easing.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    preset: activePreset?.dataset.preset || null,
  });
}

function restoreOutlineSettings() {
  const settings = MotionStorage.read(OUTLINE_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;

  const controls = {
    lineWidth: elements.lineWidth,
    lineColor: elements.lineColor,
    opacity: elements.opacity,
    backgroundColor: elements.backgroundColor,
    tailFrom: elements.tailFrom,
    tailTo: elements.tailTo,
    headFrom: elements.headFrom,
    headTo: elements.headTo,
    duration: elements.duration,
    easing: elements.easing,
    previewSpeed: elements.previewSpeed,
  };
  Object.entries(controls).forEach(([name, control]) => MotionStorage.restoreControl(control, settings[name]));
  syncOutlineImageTime();
  MotionStorage.restoreControl(elements.imageTime, settings.imageTime);

  const presetNames = new Set(elements.presetButtons.map((button) => button.dataset.preset));
  elements.presetButtons.forEach((button) => {
    button.classList.toggle("is-active", presetNames.has(settings.preset) && button.dataset.preset === settings.preset);
  });
  elements.lineWidthValue.value = `${elements.lineWidth.value} px`;
  elements.lineColorValue.value = elements.lineColor.value.toUpperCase();
  elements.opacityValue.value = `${elements.opacity.value}%`;
  elements.backgroundColorValue.value = elements.backgroundColor.value.toUpperCase();
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  syncOutlineImageTime();
  updateTimelineUI();
}

function syncOutlineImageTime() {
  const duration = Number(elements.duration.value);
  elements.imageTime.max = String(duration);
  elements.imageTime.value = String(clamp(Number(elements.imageTime.value), 0, duration));
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function ease(progress) {
  const t = clamp(progress, 0, 1);
  switch (elements.easing.value) {
    case "easeIn":
      return t * t * t;
    case "easeOut":
      return 1 - Math.pow(1 - t, 3);
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    default:
      return t;
  }
}

function getRangeValues(progress) {
  const eased = ease(progress);
  return {
    tail: lerp(Number(elements.tailFrom.value), Number(elements.tailTo.value), eased),
    head: lerp(Number(elements.headFrom.value), Number(elements.headTo.value), eased),
  };
}

function updateTimelineUI() {
  const duration = Number(elements.duration.value);
  elements.timeline.value = String(Math.round(state.playhead * 1000));
  elements.currentTime.value = formatTime(state.playhead * duration);
  elements.totalTime.value = formatTime(duration);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function setStatus(message, isWarning = false) {
  elements.imageStatus.lastElementChild.textContent = message;
  elements.imageStatus.classList.toggle("is-warning", isWarning);
}

function rebuildContourMetrics() {
  state.cumulative = [0];
  let total = 0;
  for (let index = 0; index < state.contour.length; index += 1) {
    const a = state.contour[index];
    const b = state.contour[(index + 1) % state.contour.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    state.cumulative.push(total);
  }
  state.totalLength = total;
  state.bounds = OutlineTrace.bounds(state.contour);
  state.transform = calculateTransform();
  elements.pointCount.value = `${state.contour.length.toLocaleString("ja-JP")} 点`;
}

function calculateTransform() {
  if (!state.bounds) return null;
  const width = Math.max(1, state.bounds.maxX - state.bounds.minX);
  const height = Math.max(1, state.bounds.maxY - state.bounds.minY);
  const margin = 92;
  const scale = Math.min((OUTPUT_WIDTH - margin * 2) / width, (OUTPUT_HEIGHT - margin * 2) / height);
  return {
    scale,
    x: (OUTPUT_WIDTH - width * scale) / 2 - state.bounds.minX * scale,
    y: (OUTPUT_HEIGHT - height * scale) / 2 - state.bounds.minY * scale,
  };
}

async function processImage(image, fileName, fileBytes = 0) {
  const scale = Math.min(1, PROCESS_LIMIT / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const processingCanvas = document.createElement("canvas");
  processingCanvas.width = width;
  processingCanvas.height = height;
  const processingContext = processingCanvas.getContext("2d", { willReadFrequently: true });
  processingContext.clearRect(0, 0, width, height);
  processingContext.drawImage(image, 0, 0, width, height);
  const pixels = processingContext.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  let transparentPixels = 0;

  for (let index = 0; index < mask.length; index += 1) {
    const alpha = pixels[index * 4 + 3];
    mask[index] = alpha >= ALPHA_THRESHOLD ? 1 : 0;
    if (alpha < 250) transparentPixels += 1;
  }

  const component = OutlineTrace.findLargestComponent(mask, width, height);
  if (!component.length) throw new Error("不透明な要素を検出できませんでした");

  const rawContour = OutlineTrace.buildOuterContour(component, width, height);
  if (rawContour.length < 4) throw new Error("輪郭を作成できませんでした");

  state.image = image;
  state.imageName = fileName;
  state.imageBytes = fileBytes;
  state.processWidth = width;
  state.processHeight = height;
  state.contour = OutlineTrace.smooth(OutlineTrace.simplify(rawContour), 2);
  state.playhead = 0;
  rebuildContourMetrics();
  updateImageUI(transparentPixels > 0);
  stopPlayback();
  render();
}

function updateImageUI(hasTransparency) {
  elements.fileName.textContent = state.imageName;
  elements.fileMeta.textContent = state.imageBytes
    ? `${(state.imageBytes / 1024).toFixed(state.imageBytes > 1024 * 1024 ? 0 : 1)} KB`
    : "内蔵サンプル";
  elements.imageDimensions.textContent = `${state.image.naturalWidth} × ${state.image.naturalHeight}`;
  setStatus(hasTransparency ? "最大要素の輪郭を検出" : "透過部分がありません", !hasTransparency);

  const oldThumbnail = elements.fileSummary.querySelector("img");
  if (oldThumbnail) oldThumbnail.remove();
  const thumbnail = new Image();
  thumbnail.src = state.image.src;
  thumbnail.alt = "";
  elements.fileSummary.querySelector(".file-thumbnail").append(thumbnail);
}

function pointAtDistance(distance) {
  const wrapped = ((distance % state.totalLength) + state.totalLength) % state.totalLength;
  let low = 0;
  let high = state.cumulative.length - 1;
  while (low < high - 1) {
    const middle = Math.floor((low + high) / 2);
    if (state.cumulative[middle] <= wrapped) low = middle;
    else high = middle;
  }
  const start = state.contour[low % state.contour.length];
  const end = state.contour[(low + 1) % state.contour.length];
  const segmentLength = state.cumulative[low + 1] - state.cumulative[low] || 1;
  const amount = (wrapped - state.cumulative[low]) / segmentLength;
  return { x: lerp(start.x, end.x, amount), y: lerp(start.y, end.y, amount) };
}

function traceDistanceRange(ctx, fromDistance, toDistance) {
  if (!state.totalLength || toDistance <= fromDistance) return;
  const visibleLength = toDistance - fromDistance;

  // Once a complete lap is visible, keep one closed contour on the canvas.
  // This avoids a one-frame seam when the animated end crosses 100%, 200%, ...
  if (visibleLength >= state.totalLength - 0.001) {
    const start = pointAtDistance(fromDistance);
    ctx.moveTo(start.x, start.y);
    const startCycle = Math.floor(fromDistance / state.totalLength);
    for (let index = 1; index <= state.contour.length; index += 1) {
      const distance = startCycle * state.totalLength + state.cumulative[index];
      if (distance > fromDistance + 0.001) {
        const point = pointAtDistance(distance);
        ctx.lineTo(point.x, point.y);
      }
    }
    for (let index = 1; index < state.contour.length; index += 1) {
      const point = pointAtDistance((startCycle + 1) * state.totalLength + state.cumulative[index]);
      if (state.cumulative[index] < fromDistance - startCycle * state.totalLength) {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.closePath();
    return;
  }

  const maxVisibleDistance = state.totalLength * 5;
  const limitedFrom = Math.max(toDistance - maxVisibleDistance, fromDistance);
  let current = limitedFrom;
  const start = pointAtDistance(current);
  ctx.moveTo(start.x, start.y);

  while (current < toDistance) {
    const wrapped = ((current % state.totalLength) + state.totalLength) % state.totalLength;
    const nextBoundary = current + (state.totalLength - wrapped || state.totalLength);
    const target = Math.min(nextBoundary, toDistance);
    const cycleStart = Math.floor(current / state.totalLength) * state.totalLength;

    for (let index = 1; index < state.cumulative.length; index += 1) {
      const candidate = cycleStart + state.cumulative[index];
      if (candidate > current + 0.001 && candidate < target - 0.001) {
        const point = state.contour[index % state.contour.length];
        ctx.lineTo(point.x, point.y);
      }
    }

    const point = pointAtDistance(target);
    ctx.lineTo(point.x, point.y);
    current = target;
    if (toDistance - current < 0.001) break;
  }
}

function render(progress = state.playhead) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

  if (!state.image || !state.transform || !state.contour.length) {
    context.restore();
    return;
  }

  const transform = state.transform;
  context.setTransform(transform.scale, 0, 0, transform.scale, transform.x, transform.y);

  const sourceOpacity = Number(elements.opacity.value) / 100;
  if (sourceOpacity > 0) {
    context.save();
    context.globalAlpha = sourceOpacity;
    context.drawImage(state.image, 0, 0, state.processWidth, state.processHeight);
    context.restore();
  }

  const range = getRangeValues(progress);
  const from = Math.min(range.tail, range.head) * state.totalLength / 100;
  const to = Math.max(range.tail, range.head) * state.totalLength / 100;

  context.beginPath();
  traceDistanceRange(context, from, to);
  context.lineWidth = Number(elements.lineWidth.value) / transform.scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = elements.lineColor.value;
  context.stroke();

  if (state.isPickingOrigin) {
    const start = state.contour[0];
    const markerRadius = 11 / transform.scale;
    context.beginPath();
    context.arc(start.x, start.y, markerRadius, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
    context.lineWidth = 4 / transform.scale;
    context.strokeStyle = "#de6d4f";
    context.stroke();
  }

  context.restore();
}

function animate(timestamp) {
  if (!state.isPlaying) return;
  const durationMs = Number(elements.duration.value) * 1000;
  const speed = Number(elements.previewSpeed.value);
  const elapsed = (timestamp - state.startedAt) * speed;
  state.playhead = clamp(state.pausedAt + elapsed / durationMs, 0, 1);
  render();
  updateTimelineUI();

  if (state.playhead >= 1) {
    stopPlayback(false);
    return;
  }
  state.rafId = requestAnimationFrame(animate);
}

function startPlayback() {
  if (state.isExporting || !state.contour.length) return;
  if (state.playhead >= 1) state.playhead = 0;
  state.isPlaying = true;
  state.pausedAt = state.playhead;
  state.startedAt = performance.now();
  elements.playButton.textContent = "Ⅱ";
  elements.playButton.setAttribute("aria-label", "一時停止");
  state.rafId = requestAnimationFrame(animate);
}

function stopPlayback(renderFrame = true) {
  state.isPlaying = false;
  cancelAnimationFrame(state.rafId);
  elements.playButton.textContent = "▶";
  elements.playButton.setAttribute("aria-label", "再生");
  if (renderFrame) {
    render();
    updateTimelineUI();
  }
}

function toggleOriginPicker(force) {
  state.isPickingOrigin = typeof force === "boolean" ? force : !state.isPickingOrigin;
  document.querySelector(".origin-section").classList.toggle("is-selecting", state.isPickingOrigin);
  elements.canvasShell.classList.toggle("is-picking", state.isPickingOrigin);
  elements.originHint.hidden = !state.isPickingOrigin;
  elements.originButton.setAttribute("aria-pressed", String(state.isPickingOrigin));
  elements.originButton.lastChild.textContent = state.isPickingOrigin ? " 選択を終了" : " 始点を選択";
  render();
}

function selectOriginFromCanvas(event) {
  if (!state.isPickingOrigin || !state.transform || !state.contour.length) return;
  const rect = elements.canvas.getBoundingClientRect();
  const canvasX = (event.clientX - rect.left) * OUTPUT_WIDTH / rect.width;
  const canvasY = (event.clientY - rect.top) * OUTPUT_HEIGHT / rect.height;
  const x = (canvasX - state.transform.x) / state.transform.scale;
  const y = (canvasY - state.transform.y) / state.transform.scale;

  let closestIndex = 0;
  let closestDistance = Infinity;
  state.contour.forEach((point, index) => {
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  const previousOriginDistance = state.cumulative[closestIndex] || 0;
  state.contour = [...state.contour.slice(closestIndex), ...state.contour.slice(0, closestIndex)];
  rebuildContourMetrics();
  elements.originValue.value = `${(previousOriginDistance / state.totalLength * 100).toFixed(1)}%`;
  toggleOriginPicker(false);
  render();
  showToast("輪郭の始点を更新しました");
}

function applyPreset(name) {
  const values = {
    draw: [0, 0, 0, 100],
    loop: [0, 100, 18, 118],
    expand: [0, 100, 0, 200],
  }[name];
  if (!values) return;
  [elements.tailFrom.value, elements.tailTo.value, elements.headFrom.value, elements.headTo.value] = values;
  elements.presetButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.preset === name));
  state.playhead = 0;
  stopPlayback();
  saveOutlineSettings();
}

function clearPresetSelection() {
  elements.presetButtons.forEach((button) => button.classList.remove("is-active"));
}

function makeSampleImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f5f7f8";
  ctx.beginPath();
  ctx.moveTo(170, 365);
  ctx.bezierCurveTo(190, 175, 390, 95, 568, 188);
  ctx.bezierCurveTo(680, 247, 743, 396, 672, 510);
  ctx.bezierCurveTo(598, 628, 402, 642, 270, 548);
  ctx.bezierCurveTo(205, 502, 158, 445, 170, 365);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#de6d4f";
  ctx.beginPath();
  ctx.arc(788, 198, 46, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#14b89a";
  ctx.fillRect(766, 530, 76, 76);

  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = canvas.toDataURL("image/png");
  });
}

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("画像ファイルを選択してください");
    return;
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = async () => {
    try {
      await processImage(image, file.name, file.size);
      showToast("最大の要素から輪郭を作成しました");
    } catch (error) {
      showToast(error.message || "画像を処理できませんでした");
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("画像を読み込めませんでした");
  };
  image.src = url;
}

function supportedMimeType() {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
}

async function exportVideo() {
  if (state.isExporting || !state.contour.length) return;
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
  stopPlayback();
  elements.exportButton.disabled = true;
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
      updateTimelineUI();
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
  const baseName = state.imageName.replace(/\.[^.]+$/, "") || "outline";
  anchor.href = url;
  anchor.download = `${baseName}-outline.webm`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);

  state.isExporting = false;
  elements.exportButton.disabled = false;
  elements.exportButton.lastChild.textContent = " 動画を書き出す";
  elements.exportProgress.hidden = true;
  showToast(`WebMを書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
}

function exportImage() {
  if (!state.contour.length) return;
  stopPlayback(false);
  const duration = Number(elements.duration.value);
  state.playhead = duration ? Number(elements.imageTime.value) / duration : 0;
  state.playhead = clamp(state.playhead, 0, 1);
  render(state.playhead);
  updateTimelineUI();
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNGを作成できませんでした");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const baseName = state.imageName.replace(/\.[^.]+$/, "") || "outline";
    anchor.href = url;
    anchor.download = `${baseName}-outline-${Number(elements.imageTime.value).toFixed(1)}s.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`${elements.imageTimeValue.value}のPNGを書き出しました`);
  }, "image/png");
}

elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  loadFile(file);
  elements.fileInput.value = "";
});

elements.sampleButton.addEventListener("click", async () => {
  const image = await makeSampleImage();
  await processImage(image, "sample-shape.png");
  showToast("サンプル画像を読み込みました");
});

elements.playButton.addEventListener("click", () => {
  if (state.isPlaying) stopPlayback();
  else startPlayback();
});

elements.restartButton.addEventListener("click", () => {
  state.playhead = 0;
  stopPlayback();
});

elements.timeline.addEventListener("input", () => {
  state.playhead = Number(elements.timeline.value) / 1000;
  stopPlayback();
});

elements.originButton.addEventListener("click", () => toggleOriginPicker());
elements.canvas.addEventListener("click", selectOriginFromCanvas);
elements.fitButton.addEventListener("click", () => {
  state.playhead = 0;
  stopPlayback();
});

elements.presetButtons.forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

[elements.tailFrom, elements.tailTo, elements.headFrom, elements.headTo].forEach((input) => {
  input.addEventListener("input", () => {
    clearPresetSelection();
    saveOutlineSettings();
    render();
  });
});

elements.swapRangeButton.addEventListener("click", () => {
  [elements.tailFrom.value, elements.headFrom.value] = [elements.headFrom.value, elements.tailFrom.value];
  [elements.tailTo.value, elements.headTo.value] = [elements.headTo.value, elements.tailTo.value];
  clearPresetSelection();
  saveOutlineSettings();
  render();
});

elements.lineWidth.addEventListener("input", () => {
  elements.lineWidthValue.value = `${elements.lineWidth.value} px`;
  saveOutlineSettings();
  render();
});

elements.lineColor.addEventListener("input", () => {
  elements.lineColorValue.value = elements.lineColor.value.toUpperCase();
  saveOutlineSettings();
  render();
});

elements.opacity.addEventListener("input", () => {
  elements.opacityValue.value = `${elements.opacity.value}%`;
  saveOutlineSettings();
  render();
});

elements.backgroundColor.addEventListener("input", () => {
  elements.backgroundColorValue.value = elements.backgroundColor.value.toUpperCase();
  saveOutlineSettings();
  render();
});

elements.duration.addEventListener("input", () => {
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  syncOutlineImageTime();
  saveOutlineSettings();
  updateTimelineUI();
});

elements.imageTime.addEventListener("input", () => {
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
  saveOutlineSettings();
});

elements.easing.addEventListener("change", () => {
  saveOutlineSettings();
  render();
});
elements.previewSpeed.addEventListener("change", () => {
  saveOutlineSettings();
  if (state.isPlaying) {
    stopPlayback();
    startPlayback();
  }
});
elements.exportButton.addEventListener("click", exportVideo);
elements.imageExportButton.addEventListener("click", exportImage);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !["INPUT", "SELECT", "BUTTON"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    if (state.isPlaying) stopPlayback();
    else startPlayback();
  }
  if (event.key === "Escape" && state.isPickingOrigin) toggleOriginPicker(false);
});

(async function init() {
  try {
    restoreOutlineSettings();
    const image = await makeSampleImage();
    await processImage(image, "sample-shape.png");
  } catch (error) {
    showToast("初期プレビューを作成できませんでした");
    console.error(error);
  }
})();
