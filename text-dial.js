"use strict";

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 1000;
const MAX_CHARACTERS = 12;
const DIAL_SETTINGS_KEY = "motion-lab:dial-settings:v1";
const FONT_DATABASE_NAME = "motion-lab-assets";
const FONT_STORE_NAME = "fonts";
const FONT_ASSET_KEY = "dial-type-local-font";

const HIRAGANA = [..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"];
const KATAKANA = [..."アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"];
const DIGITS = [..."0123456789"];
const UPPERCASE = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const LOWERCASE = [..."abcdefghijklmnopqrstuvwxyz"];
const SMALL_KANA = new Set([..."ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ"]);

const elements = {
  canvas: document.querySelector("#dialCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  characterOptions: document.querySelector("#characterOptions"),
  toggleAllButton: document.querySelector("#toggleAllButton"),
  directionInputs: [...document.querySelectorAll('input[name="direction"]')],
  alternateDirectionLabel: document.querySelector("#alternateDirectionLabel"),
  shiftAmount: document.querySelector("#shiftAmount"),
  shiftAmountValue: document.querySelector("#shiftAmountValue"),
  visibleNeighbors: document.querySelector("#visibleNeighbors"),
  visibleNeighborsValue: document.querySelector("#visibleNeighborsValue"),
  returnOrder: document.querySelector("#returnOrder"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  stagger: document.querySelector("#stagger"),
  staggerValue: document.querySelector("#staggerValue"),
  totalDurationValue: document.querySelector("#totalDurationValue"),
  easing: document.querySelector("#easing"),
  fontStyle: document.querySelector("#fontStyle"),
  fontFile: document.querySelector("#fontFile"),
  fontFileName: document.querySelector("#fontFileName"),
  textColor: document.querySelector("#textColor"),
  dialColor: document.querySelector("#dialColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  colorControls: [...document.querySelectorAll('.color-control input[type="color"]')],
  stageStatus: document.querySelector("#stageStatus"),
  restartButton: document.querySelector("#restartButton"),
  playButton: document.querySelector("#playButton"),
  timeline: document.querySelector("#timeline"),
  currentTime: document.querySelector("#currentTime"),
  totalTime: document.querySelector("#totalTime"),
  previewSpeed: document.querySelector("#previewSpeed"),
  imageTime: document.querySelector("#imageTime"),
  imageTimeValue: document.querySelector("#imageTimeValue"),
  imageExportButton: document.querySelector("#imageExportButton"),
  exportButton: document.querySelector("#exportButton"),
  exportProgress: document.querySelector("#exportProgress"),
  exportProgressBar: document.querySelector("#exportProgressBar"),
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d");
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;

const state = {
  characters: [],
  animated: [],
  playhead: 0,
  isPlaying: false,
  isExporting: false,
  startedAt: 0,
  pausedAt: 0,
  rafId: 0,
  toastTimer: 0,
  alternateDirections: [],
  randomReturnRanks: [],
  localFontFamily: "",
  localFontName: "",
};

function openFontDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(FONT_DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(FONT_STORE_NAME)) {
        request.result.createObjectStore(FONT_STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function writeFontAsset(asset) {
  const database = await openFontDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(FONT_STORE_NAME, "readwrite");
    transaction.objectStore(FONT_STORE_NAME).put(asset, FONT_ASSET_KEY);
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  database.close();
}

async function readFontAsset() {
  const database = await openFontDatabase();
  const asset = await new Promise((resolve, reject) => {
    const request = database.transaction(FONT_STORE_NAME, "readonly")
      .objectStore(FONT_STORE_NAME).get(FONT_ASSET_KEY);
    request.addEventListener("success", () => resolve(request.result || null));
    request.addEventListener("error", () => reject(request.error));
  });
  database.close();
  return asset;
}

async function deleteFontAsset() {
  try {
    const database = await openFontDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(FONT_STORE_NAME, "readwrite");
      transaction.objectStore(FONT_STORE_NAME).delete(FONT_ASSET_KEY);
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () => reject(transaction.error));
    });
    database.close();
  } catch {
    // There may be no stored font to remove.
  }
}

function saveDialSettings() {
  MotionStorage.write(DIAL_SETTINGS_KEY, {
    text: elements.textInput.value,
    animated: state.animated,
    direction: currentDirection(),
    duration: elements.duration.value,
    stagger: elements.stagger.value,
    easing: elements.easing.value,
    fontStyle: elements.fontStyle.value,
    textColor: elements.textColor.value,
    dialColor: elements.dialColor.value,
    backgroundColor: elements.backgroundColor.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    alternateDirections: state.alternateDirections,
    shiftAmount: elements.shiftAmount.value,
    visibleNeighbors: elements.visibleNeighbors.value,
    returnOrder: elements.returnOrder.value,
    randomReturnRanks: state.randomReturnRanks,
    localFontName: state.localFontName,
  });
}

function restoreDialSettings() {
  const settings = MotionStorage.read(DIAL_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;

  if (typeof settings.text === "string") {
    elements.textInput.value = splitCharacters(settings.text).join("");
  }
  const directions = new Set(elements.directionInputs.map((input) => input.value));
  if (directions.has(settings.direction)) {
    elements.directionInputs.forEach((input) => {
      input.checked = input.value === settings.direction;
    });
  }
  const controls = {
    stagger: elements.stagger,
    duration: elements.duration,
    shiftAmount: elements.shiftAmount,
    visibleNeighbors: elements.visibleNeighbors,
    returnOrder: elements.returnOrder,
    easing: elements.easing,
    fontStyle: elements.fontStyle,
    textColor: elements.textColor,
    dialColor: elements.dialColor,
    backgroundColor: elements.backgroundColor,
    previewSpeed: elements.previewSpeed,
  };
  Object.entries(controls).forEach(([name, control]) => MotionStorage.restoreControl(control, settings[name]));
  elements.colorControls.forEach((input) => {
    input.nextElementSibling.value = input.value.toUpperCase();
  });
  state.alternateDirections = Array.isArray(settings.alternateDirections)
    ? settings.alternateDirections.map((direction) => direction === 1 ? 1 : direction === -1 ? -1 : 0)
    : [];
  state.randomReturnRanks = Array.isArray(settings.randomReturnRanks)
    ? settings.randomReturnRanks.map((rank) => Number.isInteger(rank) ? rank : 0)
    : [];
  return settings;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function splitCharacters(value) {
  const characters = segmenter
    ? [...segmenter.segment(value)].map((part) => part.segment)
    : Array.from(value);
  return characters.slice(0, MAX_CHARACTERS);
}

function currentDirection() {
  return elements.directionInputs.find((input) => input.checked)?.value || "alternate";
}

function characterParts(character) {
  const decomposed = [...character.normalize("NFD")];
  const markCode = decomposed.find((item) => item === "\u3099" || item === "\u309a");
  const base = decomposed.find((item) => item !== "\u3099" && item !== "\u309a") || character;
  return {
    base,
    mark: markCode === "\u3099" ? "゛" : markCode === "\u309a" ? "゜" : "",
  };
}

function canAnimateCharacter(character) {
  const { base } = characterParts(character);
  return Boolean(character.trim()) && !SMALL_KANA.has(base);
}

function directionForIndex(index) {
  const direction = currentDirection();
  if (direction === "before") return -1;
  if (direction === "after") return 1;
  return state.alternateDirections[index] || (index % 2 === 0 ? -1 : 1);
}

function getSequence(character) {
  const { base } = characterParts(character);
  const knownSequence = [HIRAGANA, KATAKANA, DIGITS, UPPERCASE, LOWERCASE]
    .find((sequence) => sequence.includes(base));
  if (knownSequence) return knownSequence;

  const inputSequence = [...new Set(state.characters
    .filter((item) => item.trim())
    .map((item) => characterParts(item).base))];
  if (inputSequence.length > 1) return inputSequence;
  return [base];
}

function neighborCharacter(character, offset) {
  const { base } = characterParts(character);
  const sequence = getSequence(character);
  const index = sequence.indexOf(base);
  if (index < 0 || sequence.length < 2) return base;
  return sequence[(index + offset % sequence.length + sequence.length) % sequence.length];
}

function randomizeAlternateDirections() {
  state.alternateDirections = state.characters.map((character) => {
    if (!canAnimateCharacter(character)) return 0;
    return Math.random() < 0.5 ? -1 : 1;
  });
  state.playhead = 0;
  stopPlayback();
  saveDialSettings();
  showToast("各文字の前後をランダムにしました");
}

function ease(progress) {
  const t = clamp(progress, 0, 1);
  switch (elements.easing.value) {
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "spring":
      return 1 - Math.exp(-6 * t) * Math.cos(9 * t);
    case "easeOut":
      return 1 - Math.pow(1 - t, 3);
    default:
      return t;
  }
}

function animatedIndices() {
  return state.animated
    .map((isAnimated, index) => isAnimated ? index : -1)
    .filter((index) => index >= 0);
}

function returnRank(index) {
  const indices = animatedIndices();
  const position = indices.indexOf(index);
  if (position < 0 || elements.returnOrder.value === "together") return 0;
  if (elements.returnOrder.value === "right") return indices.length - position - 1;
  if (elements.returnOrder.value === "random") return state.randomReturnRanks[index] ?? position;
  return position;
}

function maxReturnRank() {
  return animatedIndices().reduce((maximum, index) => Math.max(maximum, returnRank(index)), 0);
}

function randomizeReturnOrder() {
  const indices = animatedIndices();
  const shuffled = [...indices];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  state.randomReturnRanks = state.characters.map(() => 0);
  shuffled.forEach((characterIndex, rank) => {
    state.randomReturnRanks[characterIndex] = rank;
  });
}

function getTotalDuration() {
  const hasAnimatedCharacter = state.animated.some(Boolean);
  if (!hasAnimatedCharacter) return Number(elements.duration.value);
  return Math.min(90, Number(elements.duration.value) + maxReturnRank() * Number(elements.stagger.value));
}

function syncDialTimeLimits() {
  const finalDelay = state.animated.some(Boolean)
    ? maxReturnRank() * Number(elements.stagger.value)
    : 0;
  const maxDuration = Math.max(0.5, 90 - finalDelay);
  elements.duration.max = String(maxDuration);
  elements.duration.value = String(clamp(Number(elements.duration.value), 0.5, maxDuration));
  const totalDuration = getTotalDuration();
  elements.imageTime.max = String(totalDuration);
  elements.imageTime.value = String(clamp(Number(elements.imageTime.value), 0, totalDuration));
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
}

function localProgress(index, playhead) {
  if (!state.animated[index]) return 1;
  const elapsed = playhead * getTotalDuration();
  const delay = returnRank(index) * Number(elements.stagger.value);
  return clamp((elapsed - delay) / Number(elements.duration.value), 0, 1);
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "MS Gothic", monospace';
  return '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
}

async function applyLocalFont(buffer, name) {
  const family = `DialTypeLocal${Date.now()}`;
  const font = new FontFace(family, buffer);
  await font.load();
  document.fonts.add(font);
  state.localFontFamily = family;
  state.localFontName = name;
  elements.fontFileName.textContent = name;
  saveDialSettings();
  render();
}

async function loadLocalFont(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) {
    showToast("30MB以下のフォントを選択してください");
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    await applyLocalFont(buffer, file.name);
    await writeFontAsset({ buffer, name: file.name });
    showToast(`${file.name}を適用しました`);
  } catch {
    showToast("フォントを読み込めませんでした");
  }
}

async function restoreLocalFont(settings) {
  if (!settings?.localFontName) return;
  try {
    const asset = await readFontAsset();
    if (!asset?.buffer) throw new Error("Stored font was not found");
    await applyLocalFont(asset.buffer, asset.name || settings.localFontName);
  } catch {
    state.localFontFamily = "";
    state.localFontName = "";
    elements.fontFileName.textContent = "端末内のフォント";
    saveDialSettings();
  }
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function smoothstep(edgeStart, edgeEnd, value) {
  const amount = clamp((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function mixRgb(from, to, amount) {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

function drawDial(x, y, width, height, character, index, playhead) {
  const dialColor = elements.dialColor.value;
  const textColor = elements.textColor.value;
  const settledColor = "#e0041d";
  const { base, mark } = characterParts(character);
  const local = localProgress(index, playhead);
  const completed = !state.animated[index] || local >= 0.9999;
  const shiftAmount = Number(elements.shiftAmount.value);
  const animatedOffset = state.animated[index] ? directionForIndex(index) * shiftAmount * (1 - ease(local)) : 0;
  const rowHeight = height * 0.34;
  const centerY = y + height / 2;
  const fontSize = Math.min(width * 0.61, 92);

  context.save();
  context.shadowColor = "rgba(26, 36, 42, 0.13)";
  context.shadowBlur = 22;
  context.shadowOffsetY = 9;
  context.fillStyle = dialColor;
  roundedRectPath(context, x, y, width, height, 8);
  context.fill();
  context.restore();

  context.save();
  roundedRectPath(context, x, y, width, height, 8);
  context.clip();
  context.fillStyle = dialColor;
  context.fillRect(x, y, width, height);

  const centerBand = context.createLinearGradient(x, centerY - rowHeight / 2, x, centerY + rowHeight / 2);
  centerBand.addColorStop(0, "rgba(10, 134, 119, 0.035)");
  centerBand.addColorStop(0.5, "rgba(10, 134, 119, 0.08)");
  centerBand.addColorStop(1, "rgba(10, 134, 119, 0.035)");
  context.fillStyle = centerBand;
  context.fillRect(x, centerY - rowHeight / 2, width, rowHeight);

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${fontSize}px ${fontFamily()}`;
  const centerRgb = hexToRgb(textColor);
  const dialRgb = hexToRgb(dialColor);

  const visibleNeighbors = Number(elements.visibleNeighbors.value);
  const initialOffset = directionForIndex(index) * shiftAmount;
  const initialFirstRow = Math.ceil(initialOffset - visibleNeighbors);
  const initialLastRow = Math.floor(initialOffset + visibleNeighbors);
  const relativeRows = state.animated[index]
    ? Array.from(
      { length: initialLastRow - initialFirstRow + 1 },
      (_, row) => initialFirstRow + row,
    )
    : [0];
  relativeRows.forEach((relative) => {
    const glyph = relative === 0 ? base : neighborCharacter(character, relative);
    const glyphY = centerY + (relative - animatedOffset) * rowHeight;
    const distance = Math.abs(glyphY - centerY) / rowHeight;
    if (distance > visibleNeighbors + 0.001) return;
    const visibility = 1 - smoothstep(0.16, 1.02, distance);
    const targetRgb = relative === 0 && completed ? hexToRgb(settledColor) : centerRgb;
    const glyphRgb = mixRgb(dialRgb, targetRgb, visibility);
    context.fillStyle = `rgb(${glyphRgb.r}, ${glyphRgb.g}, ${glyphRgb.b})`;
    context.fillText(glyph, x + width / 2, glyphY + 2);
  });

  context.strokeStyle = "rgba(31, 43, 50, 0.13)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, centerY - rowHeight / 2);
  context.lineTo(x + width, centerY - rowHeight / 2);
  context.moveTo(x, centerY + rowHeight / 2);
  context.lineTo(x + width, centerY + rowHeight / 2);
  context.stroke();

  const topFade = context.createLinearGradient(0, y, 0, y + height * 0.48);
  topFade.addColorStop(0, dialColor);
  topFade.addColorStop(1, `${dialColor}00`);
  context.fillStyle = topFade;
  context.fillRect(x, y, width, height * 0.48);

  const bottomFade = context.createLinearGradient(0, y + height * 0.52, 0, y + height);
  bottomFade.addColorStop(0, `${dialColor}00`);
  bottomFade.addColorStop(1, dialColor);
  context.fillStyle = bottomFade;
  context.fillRect(x, y + height * 0.52, width, height * 0.48);
  context.restore();

  context.strokeStyle = state.animated[index] ? "rgba(8, 126, 112, 0.55)" : "rgba(88, 101, 108, 0.32)";
  context.lineWidth = state.animated[index] ? 3 : 2;
  roundedRectPath(context, x, y, width, height, 8);
  context.stroke();

  if (mark) {
    context.save();
    context.fillStyle = completed ? settledColor : textColor;
    context.font = `900 ${Math.min(width * 0.48, 80)}px ${fontFamily()}`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    const markMetrics = context.measureText(mark);
    const visibleCenterX = x + width * 0.72;
    const visibleCenterY = centerY - rowHeight * 0.34;
    const markX = visibleCenterX - (markMetrics.actualBoundingBoxRight - markMetrics.actualBoundingBoxLeft) / 2;
    const markY = visibleCenterY + (markMetrics.actualBoundingBoxAscent - markMetrics.actualBoundingBoxDescent) / 2;
    context.fillText(mark, markX, markY);
    context.restore();
  }

}

function render(playhead = state.playhead) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

  const count = Math.max(1, state.characters.length);
  const sidePadding = count <= 7 ? 70 : 100;
  const maxGap = count <= 7 ? 22 : 18;
  const maxDialWidth = count <= 4 ? 230 : count <= 7 ? 190 : 150;
  const dialWidth = clamp((OUTPUT_WIDTH - sidePadding * 2 - maxGap * (count - 1)) / count, 68, maxDialWidth);
  const gap = count > 1 ? Math.min(maxGap, (OUTPUT_WIDTH - sidePadding * 2 - dialWidth * count) / (count - 1)) : 0;
  const totalWidth = dialWidth * count + gap * (count - 1);
  const startX = (OUTPUT_WIDTH - totalWidth) / 2;
  const dialHeight = clamp(dialWidth * 2.35, 240, count <= 7 ? 430 : 350);
  const startY = (OUTPUT_HEIGHT - dialHeight) / 2;

  if (!state.characters.length) {
    context.fillStyle = elements.textColor.value;
    context.globalAlpha = 0.35;
    context.font = `700 44px ${fontFamily()}`;
    context.fillText("文字列を入力", OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2);
    context.restore();
    return;
  }

  state.characters.forEach((character, index) => {
    if (!character.trim()) return;
    drawDial(startX + index * (dialWidth + gap), startY, dialWidth, dialHeight, character, index, playhead);
  });

  const rowHeight = dialHeight * 0.34;
  const framePaddingX = 16;
  const framePaddingY = 12;
  context.save();
  context.strokeStyle = "#e0ad22";
  context.lineWidth = 9;
  roundedRectPath(
    context,
    startX - framePaddingX,
    startY + dialHeight / 2 - rowHeight / 2 - framePaddingY,
    totalWidth + framePaddingX * 2,
    rowHeight + framePaddingY * 2,
    14,
  );
  context.stroke();
  context.restore();
  context.restore();
}

function rebuildCharacterOptions(preserve = true) {
  const nextCharacters = splitCharacters(elements.textInput.value);
  if (elements.textInput.value !== nextCharacters.join("")) {
    elements.textInput.value = nextCharacters.join("");
  }
  const previousCharacters = state.characters;
  const previousAnimated = state.animated;
  const previousDirections = state.alternateDirections;
  state.characters = nextCharacters;
  state.animated = nextCharacters.map((character, index) => {
    if (!canAnimateCharacter(character)) return false;
    return preserve && previousCharacters[index] === character ? previousAnimated[index] : true;
  });
  state.alternateDirections = nextCharacters.map((character, index) => {
    if (!canAnimateCharacter(character)) return 0;
    return preserve && previousCharacters[index] === character ? previousDirections[index] || 0 : 0;
  });
  if (elements.returnOrder.value === "random" && state.randomReturnRanks.length !== nextCharacters.length) {
    randomizeReturnOrder();
  }

  elements.characterOptions.replaceChildren();
  state.characters.forEach((character, index) => {
    const label = document.createElement("label");
    const isAvailable = canAnimateCharacter(character);
    label.className = `character-option${isAvailable ? "" : " is-space"}`;
    label.title = isAvailable ? `${character}を動かす` : `${character.trim() ? "小さい文字" : "空白"}は固定`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.animated[index];
    input.disabled = !isAvailable;
    input.addEventListener("change", () => {
      state.animated[index] = input.checked;
      if (elements.returnOrder.value === "random") randomizeReturnOrder();
      state.playhead = 0;
      updateUI();
      saveDialSettings();
      render();
    });
    const text = document.createElement("span");
    text.textContent = character.trim() ? character : "·";
    label.append(input, text);
    elements.characterOptions.append(label);
  });

  state.playhead = 0;
  stopPlayback(false);
  updateUI();
  render();
}

function updateUI() {
  syncDialTimeLimits();
  const count = state.characters.length;
  const animatedCount = state.animated.filter(Boolean).length;
  const totalDuration = getTotalDuration();
  const directionLabels = { before: "1つ前", alternate: "前後", after: "1つ後" };
  const orderLabels = { left: "左から", right: "右から", together: "同時", random: "ランダム" };
  elements.characterCount.value = `${count} / ${MAX_CHARACTERS}`;
  elements.toggleAllButton.textContent = animatedCount ? "すべて固定" : "すべて動かす";
  const moveTime = Number(elements.duration.value);
  const startInterval = elements.returnOrder.value === "together" ? 0 : Number(elements.stagger.value);
  elements.durationValue.value = `${moveTime.toFixed(1)} 秒 / ${Math.round(moveTime * 60)}f`;
  elements.staggerValue.value = elements.returnOrder.value === "together" ? "同時" : `${startInterval.toFixed(2)} 秒 / ${Math.round(startInterval * 60)}f`;
  elements.stagger.disabled = elements.returnOrder.value === "together";
  elements.shiftAmountValue.value = `${elements.shiftAmount.value} 文字`;
  elements.visibleNeighborsValue.value = `${elements.visibleNeighbors.value} 文字`;
  elements.totalDurationValue.value = `${totalDuration.toFixed(1)} 秒`;
  elements.stageStatus.textContent = `${count}文字 · ${directionLabels[currentDirection()]} · ${orderLabels[elements.returnOrder.value]}`;
  elements.timeline.value = String(Math.round(state.playhead * 1000));
  elements.currentTime.value = formatTime(state.playhead * totalDuration);
  elements.totalTime.value = formatTime(totalDuration);
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
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
  state.playhead = clamp(state.pausedAt + (timestamp - state.startedAt) * speed / durationMs, 0, 1);
  render();
  updateUI();
  if (state.playhead >= 1) {
    stopPlayback(false);
    return;
  }
  state.rafId = requestAnimationFrame(animate);
}

function startPlayback() {
  if (state.isExporting || !state.characters.length) return;
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
  if (renderFrame) render();
  updateUI();
}

function supportedMimeType() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
}

async function exportVideo() {
  if (state.isExporting || !state.characters.length) return;
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
  const durationMs = getTotalDuration() * 1000;
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
  anchor.download = "dial-type.webm";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);

  state.isExporting = false;
  elements.exportButton.disabled = false;
  elements.exportButton.lastChild.textContent = " 動画を書き出す";
  elements.exportProgress.hidden = true;
  showToast(`WebMを書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
}

function exportImage() {
  if (!state.characters.length) return;
  stopPlayback(false);
  const totalDuration = getTotalDuration();
  state.playhead = totalDuration ? Number(elements.imageTime.value) / totalDuration : 0;
  state.playhead = clamp(state.playhead, 0, 1);
  render(state.playhead);
  updateUI();
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNGを作成できませんでした");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dial-type-${Number(elements.imageTime.value).toFixed(1)}s.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`${elements.imageTimeValue.value}のPNGを書き出しました`);
  }, "image/png");
}

elements.textInput.addEventListener("input", () => {
  rebuildCharacterOptions(true);
  saveDialSettings();
});
elements.toggleAllButton.addEventListener("click", () => {
  const shouldAnimate = !state.animated.some(Boolean);
  state.animated = state.characters.map((character) => canAnimateCharacter(character) ? shouldAnimate : false);
  if (elements.returnOrder.value === "random") randomizeReturnOrder();
  rebuildCharacterOptions(true);
  saveDialSettings();
});

elements.returnOrder.addEventListener("change", () => {
  if (elements.returnOrder.value === "random") randomizeReturnOrder();
  state.playhead = 0;
  stopPlayback();
  saveDialSettings();
});

elements.shiftAmount.addEventListener("input", () => {
  state.playhead = 0;
  stopPlayback();
  saveDialSettings();
});

elements.visibleNeighbors.addEventListener("input", () => {
  state.playhead = 0;
  stopPlayback();
  saveDialSettings();
});

elements.directionInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.value === "alternate") {
      state.alternateDirections = state.characters.map(() => 0);
    }
    state.playhead = 0;
    stopPlayback();
    saveDialSettings();
  });
});

let alternateWasSelected = false;
elements.alternateDirectionLabel.addEventListener("pointerdown", () => {
  alternateWasSelected = currentDirection() === "alternate";
});
elements.alternateDirectionLabel.addEventListener("click", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (alternateWasSelected || (event.detail === 0 && currentDirection() === "alternate")) {
    randomizeAlternateDirections();
  }
  alternateWasSelected = false;
});

[elements.duration, elements.stagger].forEach((input) => {
  input.addEventListener("input", () => {
    state.playhead = 0;
    stopPlayback();
    saveDialSettings();
  });
});

elements.easing.addEventListener("change", () => {
  saveDialSettings();
  render();
});
elements.fontStyle.addEventListener("change", () => {
  state.localFontFamily = "";
  state.localFontName = "";
  elements.fontFileName.textContent = "端末内のフォント";
  deleteFontAsset();
  saveDialSettings();
  render();
});
elements.fontFile.addEventListener("change", async () => {
  await loadLocalFont(elements.fontFile.files[0]);
  elements.fontFile.value = "";
});
elements.colorControls.forEach((input) => {
  input.addEventListener("input", () => {
    input.nextElementSibling.value = input.value.toUpperCase();
    saveDialSettings();
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
  saveDialSettings();
  if (state.isPlaying) {
    stopPlayback();
    startPlayback();
  }
});
elements.imageTime.addEventListener("input", () => {
  elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
  saveDialSettings();
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
  const restoredSettings = restoreDialSettings();
  rebuildCharacterOptions(false);
  if (restoredSettings) {
    const restoredAnimated = Array.isArray(restoredSettings.animated) ? restoredSettings.animated : [];
    const restoredDirections = Array.isArray(restoredSettings.alternateDirections) ? restoredSettings.alternateDirections : [];
    state.animated = state.characters.map((character, index) => canAnimateCharacter(character) && restoredAnimated[index] !== false);
    state.alternateDirections = state.characters.map((character, index) => {
      if (!canAnimateCharacter(character)) return 0;
      return restoredDirections[index] === 1 ? 1 : restoredDirections[index] === -1 ? -1 : 0;
    });
    state.randomReturnRanks = Array.isArray(restoredSettings.randomReturnRanks)
      ? state.characters.map((_, index) => Number.isInteger(restoredSettings.randomReturnRanks[index])
        ? restoredSettings.randomReturnRanks[index]
        : 0)
      : [];
    if (elements.returnOrder.value === "random" && state.randomReturnRanks.length !== state.characters.length) {
      randomizeReturnOrder();
    }
    rebuildCharacterOptions(true);
    MotionStorage.restoreControl(elements.imageTime, restoredSettings.imageTime);
    updateUI();
    render();
    await restoreLocalFont(restoredSettings);
  }
})();
