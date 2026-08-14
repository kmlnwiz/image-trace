"use strict";

const COLOR_FOCUS_SETTINGS_KEY = "motion-lab:color-focus-settings:v1";
const PREVIEW_MAX_DIMENSION = 1400;
const MAX_SOURCE_PIXELS = 64_000_000;

const COLOR_FAMILIES = [
  { id: "red", name: "赤系", center: 0, halfWidth: 15, start: 345, end: 15 },
  { id: "orange", name: "橙系", center: 30, halfWidth: 15, start: 15, end: 45 },
  { id: "yellow", name: "黄系", center: 60, halfWidth: 15, start: 45, end: 75 },
  { id: "green", name: "緑系", center: 120, halfWidth: 45, start: 75, end: 165 },
  { id: "cyan", name: "青緑系", center: 180, halfWidth: 15, start: 165, end: 195 },
  { id: "blue", name: "青系", center: 225, halfWidth: 30, start: 195, end: 255 },
  { id: "purple", name: "紫系", center: 272.5, halfWidth: 17.5, start: 255, end: 290 },
  { id: "pink", name: "桃系", center: 317.5, halfWidth: 27.5, start: 290, end: 345 },
  { id: "neutral", name: "白黒系", isNeutral: true },
];

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  canvasShell: document.querySelector("#canvasShell"),
  processingOverlay: document.querySelector("#processingOverlay"),
  fileInput: document.querySelector("#fileInput"),
  sampleButton: document.querySelector("#sampleButton"),
  dropZone: document.querySelector("#dropZone"),
  fileThumbnail: document.querySelector("#fileThumbnail"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
  imageDimensions: document.querySelector("#imageDimensions"),
  imageStatus: document.querySelector("#imageStatus"),
  familyGrid: document.querySelector("#familyGrid"),
  familyButtons: [...document.querySelectorAll(".family-button")],
  originalButton: document.querySelector("#originalButton"),
  compareButton: document.querySelector("#compareButton"),
  previewMeta: document.querySelector("#previewMeta"),
  selectedSwatch: document.querySelector("#selectedSwatch"),
  selectedName: document.querySelector("#selectedName"),
  outputModeButtons: [...document.querySelectorAll(".mode-button")],
  outputModeSummary: document.querySelector("#outputModeSummary"),
  otherLegendMark: document.querySelector("#otherLegendMark"),
  otherLegendLabel: document.querySelector("#otherLegendLabel"),
  saturationThreshold: document.querySelector("#saturationThreshold"),
  saturationValue: document.querySelector("#saturationValue"),
  hueExpansion: document.querySelector("#hueExpansion"),
  hueExpansionValue: document.querySelector("#hueExpansionValue"),
  edgeSoftness: document.querySelector("#edgeSoftness"),
  edgeSoftnessValue: document.querySelector("#edgeSoftnessValue"),
  colorStrength: document.querySelector("#colorStrength"),
  colorStrengthValue: document.querySelector("#colorStrengthValue"),
  resetButton: document.querySelector("#resetButton"),
  exportDimensions: document.querySelector("#exportDimensions"),
  exportButton: document.querySelector("#exportButton"),
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d", { willReadFrequently: true });

const state = {
  source: null,
  sourceObjectUrl: null,
  sourceWidth: 0,
  sourceHeight: 0,
  fileName: "color-garden.png",
  fileBytes: 0,
  previewSource: null,
  previewOutput: null,
  selectedFamily: "red",
  outputMode: "grayscale",
  isComparing: false,
  isExporting: false,
  renderFrame: 0,
  toastTimer: 0,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function getFamily(familyId = state.selectedFamily) {
  return COLOR_FAMILIES.find((family) => family.id === familyId) || COLOR_FAMILIES[0];
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3000);
}

function setImageStatus(message, isWarning = false) {
  elements.imageStatus.lastElementChild.textContent = message;
  elements.imageStatus.classList.toggle("is-warning", isWarning);
}

function setProcessing(isProcessing, label = "色を解析中") {
  elements.processingOverlay.querySelector("strong").textContent = label;
  elements.processingOverlay.hidden = !isProcessing;
}

function saveSettings() {
  MotionStorage.write(COLOR_FOCUS_SETTINGS_KEY, {
    selectedFamily: state.selectedFamily,
    outputMode: state.outputMode,
    saturationThreshold: elements.saturationThreshold.value,
    hueExpansion: elements.hueExpansion.value,
    edgeSoftness: elements.edgeSoftness.value,
    colorStrength: elements.colorStrength.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(COLOR_FOCUS_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return;

  if (COLOR_FAMILIES.some((family) => family.id === settings.selectedFamily)) {
    state.selectedFamily = settings.selectedFamily;
  }
  if (["grayscale", "transparent"].includes(settings.outputMode)) {
    state.outputMode = settings.outputMode;
  }
  MotionStorage.restoreControl(elements.saturationThreshold, settings.saturationThreshold);
  MotionStorage.restoreControl(elements.hueExpansion, settings.hueExpansion);
  MotionStorage.restoreControl(elements.edgeSoftness, settings.edgeSoftness);
  MotionStorage.restoreControl(elements.colorStrength, settings.colorStrength);
}

function updateControlLabels() {
  const expansion = Number(elements.hueExpansion.value);
  elements.saturationValue.value = `${elements.saturationThreshold.value}%`;
  elements.hueExpansionValue.value = expansion === 0 ? "標準" : `${expansion > 0 ? "+" : ""}${expansion}°`;
  elements.edgeSoftnessValue.value = `${elements.edgeSoftness.value}°`;
  elements.colorStrengthValue.value = `${elements.colorStrength.value}%`;
}

function updateSelectedFamilyUI() {
  const family = getFamily();
  elements.familyButtons.forEach((button) => {
    const isActive = button.dataset.family === family.id;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-checked", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  elements.selectedName.textContent = family.name;
  elements.selectedSwatch.className = `selected-swatch swatch-${family.id}`;
  [elements.hueExpansion, elements.edgeSoftness, elements.colorStrength].forEach((control) => {
    control.disabled = Boolean(family.isNeutral);
    control.closest(".field-block").classList.toggle("is-disabled", Boolean(family.isNeutral));
  });
  const otherDisplay = state.outputMode === "transparent" ? "その他を透明表示" : "その他をモノクロ表示";
  elements.previewMeta.textContent = state.isComparing ? "元画像を表示中" : `${family.name}だけを着色・${otherDisplay}`;
}

function updateOutputModeUI() {
  const isTransparent = state.outputMode === "transparent";
  elements.outputModeButtons.forEach((button) => {
    const isActive = button.dataset.outputMode === state.outputMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-checked", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });
  elements.outputModeSummary.textContent = isTransparent ? "完全透過" : "モノクロ";
  elements.otherLegendLabel.textContent = isTransparent ? "透明部分" : "その他";
  elements.otherLegendMark.className = isTransparent ? "legend-transparent" : "legend-gray";
  updateSelectedFamilyUI();
}

function setOutputMode(outputMode) {
  if (!["grayscale", "transparent"].includes(outputMode)) return;
  state.outputMode = outputMode;
  state.isComparing = false;
  updateCompareUI();
  updateOutputModeUI();
  saveSettings();
  scheduleRender();
}

function setSelectedFamily(familyId, announce = false) {
  if (!COLOR_FAMILIES.some((family) => family.id === familyId)) return;
  state.selectedFamily = familyId;
  state.isComparing = false;
  updateCompareUI();
  updateSelectedFamilyUI();
  saveSettings();
  scheduleRender();
  if (announce) showToast(`${getFamily().name}を選択しました`);
}

function updateCompareUI() {
  elements.compareButton.setAttribute("aria-pressed", String(state.isComparing));
  elements.compareButton.lastChild.textContent = state.isComparing ? " 加工結果に戻る" : " 元画像と比較";
  updateSelectedFamilyUI();
}

function setCompare(isComparing) {
  state.isComparing = Boolean(isComparing);
  updateCompareUI();
  drawCurrentPreview();
}

function normalizeHue(hue) {
  return ((hue % 360) + 360) % 360;
}

function circularHueDistance(first, second) {
  const difference = Math.abs(normalizeHue(first) - normalizeHue(second));
  return Math.min(difference, 360 - difference);
}

function rgbToHueAndSaturation(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const saturation = maximum === 0 ? 0 : delta / maximum;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }

  return { hue: normalizeHue(hue), saturation };
}

function hueIsInFamily(hue, family) {
  if (family.start > family.end) return hue >= family.start || hue < family.end;
  return hue >= family.start && hue < family.end;
}

function familyFromHue(hue) {
  return COLOR_FAMILIES.find((family) => !family.isNeutral && hueIsInFamily(hue, family)) || COLOR_FAMILIES[0];
}

function familyIdFromHue(hue) {
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 45) return "orange";
  if (hue < 75) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "cyan";
  if (hue < 255) return "blue";
  if (hue < 290) return "purple";
  return "pink";
}

function selectedColorAmount(hue, saturation, family, threshold, expansion, softness) {
  if (family.isNeutral) return saturation <= threshold ? 1 : 0;
  if (saturation <= threshold) return 0;

  const fullWidth = Math.max(2, family.halfWidth + expansion);
  const distance = circularHueDistance(hue, family.center);
  if (distance <= fullWidth) return 1;
  if (softness <= 0 || distance >= fullWidth + softness) return 0;
  const transition = 1 - (distance - fullWidth) / softness;
  return transition * transition * (3 - 2 * transition);
}

function processImageData(sourceImageData, collectStatistics = false) {
  const output = new ImageData(sourceImageData.width, sourceImageData.height);
  const source = sourceImageData.data;
  const target = output.data;
  const colorStrength = Number(elements.colorStrength.value) / 100;
  const saturationThreshold = Number(elements.saturationThreshold.value) / 100;
  const hueExpansion = Number(elements.hueExpansion.value);
  const edgeSoftness = Number(elements.edgeSoftness.value);
  const selectedFamily = getFamily();
  const makeOtherPixelsTransparent = state.outputMode === "transparent";
  const counts = Object.fromEntries(COLOR_FAMILIES.map((family) => [family.id, 0]));
  let classifiedPixelCount = 0;

  for (let index = 0; index < source.length; index += 4) {
    const red = source[index];
    const green = source[index + 1];
    const blue = source[index + 2];
    const alpha = source[index + 3];

    if (alpha === 0) continue;

    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const delta = maximum - minimum;
    const saturation = maximum === 0 ? 0 : delta / maximum;
    let hue = 0;

    if (delta !== 0) {
      if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
      if (hue < 0) hue += 360;
    }

    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const selectionAmount = selectedColorAmount(
      hue,
      saturation,
      selectedFamily,
      saturationThreshold,
      hueExpansion,
      edgeSoftness,
    );
    const colorAmount = selectedFamily.isNeutral ? 0 : selectionAmount * colorStrength;

    target[index] = clamp(Math.round(gray + (red - gray) * colorAmount), 0, 255);
    target[index + 1] = clamp(Math.round(gray + (green - gray) * colorAmount), 0, 255);
    target[index + 2] = clamp(Math.round(gray + (blue - gray) * colorAmount), 0, 255);
    target[index + 3] = makeOtherPixelsTransparent ? Math.round(alpha * selectionAmount) : alpha;

    if (collectStatistics && alpha >= 32) {
      const familyId = saturation <= saturationThreshold ? "neutral" : familyIdFromHue(hue);
      counts[familyId] += 1;
      classifiedPixelCount += 1;
    }
  }

  return { output, counts, classifiedPixelCount };
}

function formatPercentage(value, total) {
  if (!total || !value) return "0%";
  const percentage = (value / total) * 100;
  return percentage < 1 ? "<1%" : `${Math.round(percentage)}%`;
}

function updateFamilyStatistics(counts, total) {
  elements.familyButtons.forEach((button) => {
    button.querySelector("output").value = formatPercentage(counts[button.dataset.family], total);
  });
}

function drawCurrentPreview() {
  const imageData = state.isComparing ? state.previewSource : state.previewOutput;
  if (!imageData) return;
  context.putImageData(imageData, 0, 0);
}

function fitCanvasToShell() {
  if (!state.previewSource) return;
  const shellStyle = getComputedStyle(elements.canvasShell);
  const horizontalPadding = parseFloat(shellStyle.paddingLeft) + parseFloat(shellStyle.paddingRight) + 2;
  const verticalPadding = parseFloat(shellStyle.paddingTop) + parseFloat(shellStyle.paddingBottom) + 2;
  const availableWidth = Math.max(1, elements.canvasShell.clientWidth - horizontalPadding);
  const availableHeight = Math.max(1, elements.canvasShell.clientHeight - verticalPadding);
  const imageRatio = elements.canvas.width / elements.canvas.height;
  let displayWidth = availableWidth;
  let displayHeight = displayWidth / imageRatio;

  if (displayHeight > availableHeight) {
    displayHeight = availableHeight;
    displayWidth = displayHeight * imageRatio;
  }

  elements.canvas.style.width = `${Math.floor(displayWidth)}px`;
  elements.canvas.style.height = `${Math.floor(displayHeight)}px`;
}

function renderPreview() {
  state.renderFrame = 0;
  if (!state.previewSource) return;
  const result = processImageData(state.previewSource, true);
  state.previewOutput = result.output;
  updateFamilyStatistics(result.counts, result.classifiedPixelCount);
  drawCurrentPreview();
}

function scheduleRender() {
  cancelAnimationFrame(state.renderFrame);
  state.renderFrame = requestAnimationFrame(renderPreview);
}

function formatFileSize(bytes) {
  if (!bytes) return "内蔵サンプル";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function sourceDimensions(source) {
  return {
    width: source.naturalWidth || source.width,
    height: source.naturalHeight || source.height,
  };
}

function updateThumbnail(source) {
  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.width = 92;
  thumbnailCanvas.height = 80;
  const thumbnailContext = thumbnailCanvas.getContext("2d");
  const { width, height } = sourceDimensions(source);
  const scale = Math.max(thumbnailCanvas.width / width, thumbnailCanvas.height / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  thumbnailContext.drawImage(
    source,
    (thumbnailCanvas.width - drawWidth) / 2,
    (thumbnailCanvas.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  const image = new Image();
  image.src = thumbnailCanvas.toDataURL("image/png");
  image.alt = "";
  elements.fileThumbnail.replaceChildren(image);
}

async function loadSource(source, fileName, fileBytes = 0, sourceObjectUrl = null) {
  setProcessing(true);
  await nextFrame();

  try {
    const { width, height } = sourceDimensions(source);
    if (!width || !height) throw new Error("画像サイズを取得できませんでした");
    if (width * height > MAX_SOURCE_PIXELS) {
      throw new Error("画像が大きすぎます（最大約6,400万画素）");
    }

    if (state.sourceObjectUrl) URL.revokeObjectURL(state.sourceObjectUrl);
    state.source = source;
    state.sourceObjectUrl = sourceObjectUrl;
    state.sourceWidth = width;
    state.sourceHeight = height;
    state.fileName = fileName;
    state.fileBytes = fileBytes;

    const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(width, height));
    const previewWidth = Math.max(1, Math.round(width * scale));
    const previewHeight = Math.max(1, Math.round(height * scale));
    const previewSourceCanvas = document.createElement("canvas");
    previewSourceCanvas.width = previewWidth;
    previewSourceCanvas.height = previewHeight;
    const previewSourceContext = previewSourceCanvas.getContext("2d", { willReadFrequently: true });
    previewSourceContext.drawImage(source, 0, 0, previewWidth, previewHeight);

    elements.canvas.width = previewWidth;
    elements.canvas.height = previewHeight;
    state.previewSource = previewSourceContext.getImageData(0, 0, previewWidth, previewHeight);
    state.previewOutput = null;

    elements.fileName.textContent = fileName;
    elements.fileMeta.textContent = formatFileSize(fileBytes);
    elements.imageDimensions.value = `${width.toLocaleString("ja-JP")} × ${height.toLocaleString("ja-JP")}`;
    elements.exportDimensions.textContent = `${width.toLocaleString("ja-JP")} × ${height.toLocaleString("ja-JP")}`;
    setImageStatus(`${COLOR_FAMILIES.length}系統の色を解析`, false);
    updateThumbnail(source);
    renderPreview();
    fitCanvasToShell();
  } finally {
    setProcessing(false);
  }
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした"));
    image.src = url;
  });
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("画像ファイルを選択してください");
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(objectUrl);
    await loadSource(image, file.name, file.size, objectUrl);
    elements.fileInput.value = "";
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    showToast(error.message || "画像を読み込めませんでした");
  }
}

const roundedRectPath = MotionToolkit.roundedRectPath;

function createSampleIllustration() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f7f2e9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#d7e9e7";
  roundedRectPath(ctx, 58, 56, 1084, 688, 38);
  ctx.fill();

  ctx.fillStyle = "#efb43f";
  ctx.beginPath();
  ctx.arc(954, 176, 77, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#748bb3";
  ctx.beginPath();
  ctx.moveTo(58, 580);
  ctx.lineTo(360, 245);
  ctx.lineTo(608, 580);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#6c5b9a";
  ctx.beginPath();
  ctx.moveTo(330, 580);
  ctx.lineTo(650, 315);
  ctx.lineTo(905, 580);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#4f925e";
  ctx.beginPath();
  ctx.moveTo(58, 540);
  ctx.bezierCurveTo(270, 465, 440, 610, 628, 523);
  ctx.bezierCurveTo(836, 426, 974, 507, 1142, 455);
  ctx.lineTo(1142, 744);
  ctx.lineTo(58, 744);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#2e9188";
  ctx.beginPath();
  ctx.moveTo(58, 636);
  ctx.bezierCurveTo(300, 538, 494, 732, 729, 609);
  ctx.bezierCurveTo(900, 519, 1047, 598, 1142, 557);
  ctx.lineTo(1142, 744);
  ctx.lineTo(58, 744);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#315d46";
  ctx.lineWidth = 15;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(855, 630);
  ctx.quadraticCurveTo(826, 492, 854, 350);
  ctx.stroke();

  ctx.fillStyle = "#db5148";
  for (let petal = 0; petal < 6; petal += 1) {
    ctx.save();
    ctx.translate(854, 344);
    ctx.rotate((Math.PI * 2 * petal) / 6);
    ctx.beginPath();
    ctx.ellipse(0, -53, 27, 58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = "#f2a43e";
  ctx.beginPath();
  ctx.arc(854, 344, 35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#cf5987";
  ctx.beginPath();
  ctx.ellipse(781, 483, 58, 25, -0.55, 0, Math.PI * 2);
  ctx.ellipse(919, 469, 61, 25, 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e66a43";
  roundedRectPath(ctx, 158, 529, 250, 145, 18);
  ctx.fill();
  ctx.fillStyle = "#f4d358";
  roundedRectPath(ctx, 190, 565, 75, 73, 9);
  ctx.fill();
  ctx.fillStyle = "#3d78ad";
  roundedRectPath(ctx, 296, 565, 78, 73, 9);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.74)";
  roundedRectPath(ctx, 88, 84, 322, 78, 16);
  ctx.fill();
  ctx.fillStyle = "#26343c";
  ctx.font = "700 29px 'Segoe UI', sans-serif";
  ctx.fillText("COLOR GARDEN", 118, 133);

  return canvas;
}

async function loadSample() {
  try {
    const sample = createSampleIllustration();
    await loadSource(sample, "color-garden.png");
  } catch (error) {
    showToast(error.message || "サンプルを作成できませんでした");
  }
}

function pickFamilyFromCanvas(event) {
  if (!state.previewSource) return;
  const bounds = elements.canvas.getBoundingClientRect();
  const x = clamp(Math.floor(((event.clientX - bounds.left) / bounds.width) * elements.canvas.width), 0, elements.canvas.width - 1);
  const y = clamp(Math.floor(((event.clientY - bounds.top) / bounds.height) * elements.canvas.height), 0, elements.canvas.height - 1);
  const index = (y * elements.canvas.width + x) * 4;
  const data = state.previewSource.data;
  const alpha = data[index + 3];
  const color = rgbToHueAndSaturation(data[index], data[index + 1], data[index + 2]);

  if (alpha < 24) {
    showToast("透明部分です。色のある場所をクリックしてください");
    return;
  }
  const threshold = Number(elements.saturationThreshold.value) / 100;
  const familyId = color.saturation <= threshold ? "neutral" : familyFromHue(color.hue).id;
  setSelectedFamily(familyId, true);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNGを作成できませんでした"));
    }, "image/png");
  });
}

async function exportPng() {
  if (!state.source || state.isExporting) return;
  state.isExporting = true;
  elements.exportButton.disabled = true;
  elements.exportButton.lastChild.textContent = " 処理中…";
  setProcessing(true, "PNGを作成中");
  await nextFrame();

  try {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.sourceWidth;
    exportCanvas.height = state.sourceHeight;
    const exportContext = exportCanvas.getContext("2d", { willReadFrequently: true });
    exportContext.drawImage(state.source, 0, 0, state.sourceWidth, state.sourceHeight);
    const sourceImageData = exportContext.getImageData(0, 0, state.sourceWidth, state.sourceHeight);
    const { output } = processImageData(sourceImageData);
    exportContext.putImageData(output, 0, 0);
    const blob = await canvasToBlob(exportCanvas);
    const baseName = state.fileName.replace(/\.[^.]+$/, "") || "color-focus";
    downloadBlob(blob, `${baseName}-${state.selectedFamily}.png`);
    showToast("PNGを書き出しました");
  } catch (error) {
    showToast(error.message || "PNGを書き出せませんでした");
  } finally {
    state.isExporting = false;
    elements.exportButton.disabled = false;
    elements.exportButton.lastChild.textContent = " PNGを書き出す";
    setProcessing(false);
  }
}

function resetTuning() {
  state.outputMode = "grayscale";
  elements.saturationThreshold.value = "18";
  elements.hueExpansion.value = "0";
  elements.edgeSoftness.value = "8";
  elements.colorStrength.value = "100";
  updateControlLabels();
  updateOutputModeUI();
  saveSettings();
  scheduleRender();
  showToast("色の判定を初期値に戻しました");
}

elements.familyButtons.forEach((button, buttonIndex) => {
  button.addEventListener("click", () => setSelectedFamily(button.dataset.family));
  button.addEventListener("keydown", (event) => {
    const direction = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 }[event.key];
    if (!direction) return;
    event.preventDefault();
    const targetIndex = (buttonIndex + direction + elements.familyButtons.length) % elements.familyButtons.length;
    const target = elements.familyButtons[targetIndex];
    setSelectedFamily(target.dataset.family);
    target.focus();
  });
});

elements.outputModeButtons.forEach((button, buttonIndex) => {
  button.addEventListener("click", () => setOutputMode(button.dataset.outputMode));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const target = elements.outputModeButtons[(buttonIndex + 1) % elements.outputModeButtons.length];
    setOutputMode(target.dataset.outputMode);
    target.focus();
  });
});

[elements.saturationThreshold, elements.hueExpansion, elements.edgeSoftness, elements.colorStrength].forEach((control) => {
  control.addEventListener("input", () => {
    updateControlLabels();
    scheduleRender();
  });
  control.addEventListener("change", saveSettings);
});

elements.fileInput.addEventListener("change", () => handleFile(elements.fileInput.files?.[0]));
elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.sampleButton.addEventListener("click", loadSample);
elements.canvas.addEventListener("click", pickFamilyFromCanvas);
elements.compareButton.addEventListener("click", () => setCompare(!state.isComparing));
elements.originalButton.addEventListener("click", () => setCompare(true));
elements.resetButton.addEventListener("click", resetTuning);
elements.exportButton.addEventListener("click", exportPng);

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => handleFile(event.dataTransfer?.files?.[0]));

window.addEventListener("beforeunload", () => {
  if (state.sourceObjectUrl) URL.revokeObjectURL(state.sourceObjectUrl);
});

window.addEventListener("resize", fitCanvasToShell);
if ("ResizeObserver" in window) {
  new ResizeObserver(fitCanvasToShell).observe(elements.canvasShell);
}

restoreSettings();
updateControlLabels();
updateCompareUI();
updateOutputModeUI();
loadSample();
