"use strict";

const WORD_CONVEYOR_SETTINGS_KEY = "motion-lab:word-conveyor-settings:v4";
const FONT_ASSET_KEY = "word-conveyor-local-font";

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  direction: document.querySelector("#direction"),
  sentenceGap: document.querySelector("#sentenceGap"),
  sentenceGapValue: document.querySelector("#sentenceGapValue"),
  randomStart: document.querySelector("#randomStartButton"),
  fontStyle: document.querySelector("#fontStyle"),
  fontFile: document.querySelector("#fontFile"),
  fontFileName: document.querySelector("#fontFileName"),
  fontClear: document.querySelector("#fontClearButton"),
  fontSize: document.querySelector("#fontSize"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  textColor: document.querySelector("#textColor"),
  cardColor: document.querySelector("#cardColor"),
  beltColor: document.querySelector("#beltColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  previewSpeed: document.querySelector("#previewSpeed"),
  imageTime: document.querySelector("#imageTime"),
  stageStatus: document.querySelector("#stageStatus"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
};

const context = elements.canvas.getContext("2d");
const ledCanvas = document.createElement("canvas");
ledCanvas.width = elements.canvas.width;
ledCanvas.height = 470;
const ledContext = ledCanvas.getContext("2d");
const state = {
  startOffset: Math.random(),
  localFontFamily: "",
  localFontName: "",
  lastFontStyle: elements.fontStyle.value,
};
let player = null;

const fontStore = MotionFonts.createFontStore(FONT_ASSET_KEY);

function conveyorText() {
  return MotionToolkit.graphemes(elements.textInput.value).slice(0, 60).join("");
}

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "Noto Sans Mono CJK JP", Consolas, monospace';
  return '"Yu Gothic", "Hiragino Sans", "Noto Sans JP", sans-serif';
}

function updateFontUI() {
  elements.fontFileName.textContent = state.localFontName || "端末内のフォント";
  elements.fontClear.hidden = !state.localFontName;
}

function saveSettings() {
  MotionStorage.write(WORD_CONVEYOR_SETTINGS_KEY, {
    text: elements.textInput.value,
    direction: elements.direction.value,
    sentenceGap: elements.sentenceGap.value,
    fontStyle: elements.fontStyle.value,
    localFontName: state.localFontName,
    fontSize: elements.fontSize.value,
    textColor: elements.textColor.value,
    cardColor: elements.cardColor.value,
    beltColor: elements.beltColor.value,
    backgroundColor: elements.backgroundColor.value,
    duration: elements.duration.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(WORD_CONVEYOR_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.text === "string") elements.textInput.value = settings.text;
  ["direction", "sentenceGap", "fontStyle", "fontSize", "textColor", "cardColor", "beltColor", "backgroundColor", "duration", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  state.lastFontStyle = elements.fontStyle.value;
  return settings;
}

async function applyLocalFont(buffer, name) {
  const family = await MotionFonts.registerFontFile(buffer, "WordConveyorLocal");
  state.localFontFamily = family;
  state.localFontName = name;
  updateFontUI();
  saveSettings();
  render();
}

async function loadLocalFont(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) {
    player.showToast("30MB以下のフォントを選択してください");
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    await applyLocalFont(buffer, file.name);
    await fontStore.write({ buffer, name: file.name });
    player.showToast(`${file.name}を適用しました`);
  } catch {
    player.showToast("フォントを読み込めませんでした");
  }
}

async function restoreLocalFont(settings) {
  if (!settings?.localFontName) return;
  try {
    const asset = await fontStore.read();
    if (!asset?.buffer) throw new Error("Stored font was not found");
    await applyLocalFont(asset.buffer, asset.name || settings.localFontName);
  } catch {
    state.localFontFamily = "";
    state.localFontName = "";
    updateFontUI();
    saveSettings();
  }
}

async function clearLocalFont(showMessage = false) {
  state.localFontFamily = "";
  state.localFontName = "";
  updateFontUI();
  await fontStore.remove();
  saveSettings();
  render();
  if (showMessage) player.showToast("端末内フォントを解除しました");
}

function textGeometry(text) {
  const fontSize = Number(elements.fontSize.value);
  context.font = `800 ${fontSize}px ${fontFamily()}`;
  const measuredWidth = context.measureText(text).width;
  return { measuredWidth, pitch: measuredWidth + Number(elements.sentenceGap.value) };
}

function loopShift(progress, pitch) {
  const direction = elements.direction.value === "right" ? 1 : -1;
  return direction * (state.startOffset + progress) * pitch;
}

function drawBackground() {
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  context.save();
  context.globalAlpha = 0.12;
  context.strokeStyle = elements.beltColor.value;
  context.lineWidth = 2;
  for (let x = -elements.canvas.height; x < elements.canvas.width + elements.canvas.height; x += 72) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + elements.canvas.height, elements.canvas.height);
    context.stroke();
  }
  context.restore();
}

function drawSignFrame() {
  const frameY = 170;
  const frameHeight = 660;
  context.save();
  context.shadowColor = "rgba(12, 24, 34, .24)";
  context.shadowBlur = 30;
  context.shadowOffsetY = 16;
  context.fillStyle = elements.beltColor.value;
  context.fillRect(0, frameY, elements.canvas.width, frameHeight);
  context.shadowColor = "transparent";
  context.globalAlpha = 0.28;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, frameY + 24);
  context.lineTo(elements.canvas.width, frameY + 24);
  context.moveTo(0, frameY + frameHeight - 24);
  context.lineTo(elements.canvas.width, frameY + frameHeight - 24);
  context.stroke();
  for (let x = 54; x < elements.canvas.width; x += 150) {
    context.fillStyle = "rgba(0,0,0,.28)";
    context.beginPath();
    context.arc(x, frameY + 55, 8, 0, Math.PI * 2);
    context.arc(x, frameY + frameHeight - 55, 8, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawCardBand() {
  context.save();
  context.shadowColor = "rgba(0, 0, 0, .42)";
  context.shadowBlur = 16;
  context.fillStyle = elements.cardColor.value;
  context.fillRect(0, 265, elements.canvas.width, 470);
  context.shadowColor = "transparent";
  context.fillStyle = "rgba(255,255,255,.07)";
  for (let y = 272; y < 729; y += 14) {
    for (let x = 7; x < elements.canvas.width; x += 14) {
      context.beginPath();
      context.arc(x, y, 3.2, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function drawLedSentence(text, positions) {
  ledContext.clearRect(0, 0, ledCanvas.width, ledCanvas.height);
  ledContext.globalCompositeOperation = "source-over";
  ledContext.fillStyle = "#ffffff";
  ledContext.font = `800 ${Number(elements.fontSize.value)}px ${fontFamily()}`;
  ledContext.textAlign = "center";
  ledContext.textBaseline = "middle";
  positions.forEach((x) => ledContext.fillText(text, x, ledCanvas.height / 2));
  ledContext.globalCompositeOperation = "source-in";
  ledContext.beginPath();
  for (let y = 7; y < ledCanvas.height; y += 14) {
    for (let x = 7; x < ledCanvas.width; x += 14) {
      ledContext.moveTo(x + 5, y);
      ledContext.arc(x, y, 5, 0, Math.PI * 2);
    }
  }
  ledContext.fillStyle = elements.textColor.value;
  ledContext.fill();
  ledContext.globalCompositeOperation = "source-over";
  context.save();
  context.shadowColor = elements.textColor.value;
  context.shadowBlur = 20;
  context.drawImage(ledCanvas, 0, 265);
  context.restore();
}

function render(progress = player?.state.playhead || 0) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  drawBackground();
  const text = conveyorText();
  if (!text.trim()) {
    context.fillStyle = "rgba(23,33,40,.68)";
    context.font = `700 54px ${fontFamily()}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("左の欄に文章を入力", elements.canvas.width / 2, elements.canvas.height / 2);
    context.restore();
    return;
  }

  const geometry = textGeometry(text);
  const shift = loopShift(progress, geometry.pitch);
  drawSignFrame();
  drawCardBand();
  const first = Math.floor((-shift - geometry.measuredWidth) / geometry.pitch) - 1;
  const last = Math.ceil((elements.canvas.width - shift + geometry.measuredWidth) / geometry.pitch) + 1;
  const positions = [];
  for (let index = first; index <= last; index += 1) positions.push(index * geometry.pitch + shift);
  drawLedSentence(text, positions);
  context.restore();
}

function updateLabels() {
  const count = MotionToolkit.graphemes(elements.textInput.value).slice(0, 60).length;
  elements.characterCount.value = `${count} / 60`;
  elements.sentenceGapValue.value = `${elements.sentenceGap.value} px`;
  elements.fontSizeValue.value = `${elements.fontSize.value} px`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒 / 周`;
  [elements.textColor, elements.cardColor, elements.beltColor, elements.backgroundColor]
    .forEach((control) => { control.nextElementSibling.value = control.value.toUpperCase(); });
  const directionLabel = elements.direction.value === "right" ? "左から右" : "右から左";
  elements.stageStatus.textContent = `${directionLabel}へループ · 開始 ${Math.round(state.startOffset * 100)}%`;
}

function resetAndRender() {
  player.reset();
  player.update();
  updateLabels();
  saveSettings();
  render();
}

function resizeOutputCanvas() {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions);
  ledCanvas.width = elements.canvas.width;
  ledCanvas.height = 470;
}

const restoredSettings = restoreSettings();
resizeOutputCanvas();
updateFontUI();

player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => elements.duration.value,
  isReady: () => Boolean(conveyorText().trim()),
  render,
  loop: true,
  onUpdate: updateLabels,
  onControlChange: saveSettings,
  getFileBase: () => `${conveyorText() || "word"}-conveyor-loop`,
});

elements.textInput.addEventListener("input", resetAndRender);
[elements.sentenceGap, elements.fontSize, elements.duration].forEach((control) => control.addEventListener("input", resetAndRender));
elements.direction.addEventListener("change", resetAndRender);
elements.randomStart.addEventListener("click", () => {
  state.startOffset = Math.random();
  resetAndRender();
  player.showToast("開始位置をランダムにしました");
});
elements.fontStyle.addEventListener("change", async () => {
  if (elements.fontStyle.value !== state.lastFontStyle) await clearLocalFont(false);
  state.lastFontStyle = elements.fontStyle.value;
  resetAndRender();
});
elements.fontFile.addEventListener("change", async () => {
  await loadLocalFont(elements.fontFile.files[0]);
  elements.fontFile.value = "";
});
elements.fontClear.addEventListener("click", () => clearLocalFont(true));
elements.outputSize.addEventListener("change", () => {
  resizeOutputCanvas();
  resetAndRender();
});
[elements.textColor, elements.cardColor, elements.beltColor, elements.backgroundColor]
  .forEach((control) => control.addEventListener("input", resetAndRender));

updateLabels();
render();
restoreLocalFont(restoredSettings);
