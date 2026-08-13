"use strict";

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 1000;
const MAX_CHARACTERS = 12;

const HIRAGANA = [..."ぁあぃいぅうぇえぉおかがきぎくぐけげこござじずぜぞさしすせそただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわをんゔー"];
const KATAKANA = [..."ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヲンヴー"];
const DIGITS = [..."0123456789"];
const UPPERCASE = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const LOWERCASE = [..."abcdefghijklmnopqrstuvwxyz"];

const elements = {
  canvas: document.querySelector("#dialCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  characterOptions: document.querySelector("#characterOptions"),
  toggleAllButton: document.querySelector("#toggleAllButton"),
  directionInputs: [...document.querySelectorAll('input[name="direction"]')],
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  stagger: document.querySelector("#stagger"),
  staggerValue: document.querySelector("#staggerValue"),
  totalDurationValue: document.querySelector("#totalDurationValue"),
  easing: document.querySelector("#easing"),
  fontStyle: document.querySelector("#fontStyle"),
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
};

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

function directionForIndex(index) {
  const direction = currentDirection();
  if (direction === "before") return -1;
  if (direction === "after") return 1;
  return index % 2 === 0 ? -1 : 1;
}

function getSequence(character) {
  const knownSequence = [HIRAGANA, KATAKANA, DIGITS, UPPERCASE, LOWERCASE]
    .find((sequence) => sequence.includes(character));
  if (knownSequence) return knownSequence;

  const inputSequence = [...new Set(state.characters.filter((item) => item.trim()))];
  if (inputSequence.length > 1) return inputSequence;
  return [character];
}

function neighborCharacter(character, offset) {
  const sequence = getSequence(character);
  const index = sequence.indexOf(character);
  if (index < 0 || sequence.length < 2) return character;
  return sequence[(index + offset % sequence.length + sequence.length) % sequence.length];
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

function lastAnimatedIndex() {
  let last = 0;
  state.animated.forEach((isAnimated, index) => {
    if (isAnimated) last = index;
  });
  return last;
}

function getTotalDuration() {
  const hasAnimatedCharacter = state.animated.some(Boolean);
  if (!hasAnimatedCharacter) return Number(elements.duration.value);
  return Number(elements.duration.value) + lastAnimatedIndex() * Number(elements.stagger.value);
}

function localProgress(index, playhead) {
  if (!state.animated[index]) return 1;
  const elapsed = playhead * getTotalDuration();
  const delay = index * Number(elements.stagger.value);
  return clamp((elapsed - delay) / Number(elements.duration.value), 0, 1);
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function fontFamily() {
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "MS Gothic", monospace';
  return '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
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

function drawDial(x, y, width, height, character, index, playhead) {
  const dialColor = elements.dialColor.value;
  const textColor = elements.textColor.value;
  const local = localProgress(index, playhead);
  const animatedOffset = state.animated[index] ? directionForIndex(index) * (1 - ease(local)) : 0;
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

  for (let relative = -2; relative <= 2; relative += 1) {
    const glyph = neighborCharacter(character, relative);
    const glyphY = centerY + (relative - animatedOffset) * rowHeight;
    const distance = Math.abs(glyphY - centerY) / rowHeight;
    const alpha = clamp(1 - distance * 0.55, 0.12, 1);
    context.fillStyle = `rgba(${centerRgb.r}, ${centerRgb.g}, ${centerRgb.b}, ${alpha})`;
    context.fillText(glyph, x + width / 2, glyphY + 2);
  }

  context.strokeStyle = "rgba(31, 43, 50, 0.13)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, centerY - rowHeight / 2);
  context.lineTo(x + width, centerY - rowHeight / 2);
  context.moveTo(x, centerY + rowHeight / 2);
  context.lineTo(x + width, centerY + rowHeight / 2);
  context.stroke();

  const topFade = context.createLinearGradient(0, y, 0, y + height * 0.3);
  topFade.addColorStop(0, dialColor);
  topFade.addColorStop(1, `${dialColor}00`);
  context.fillStyle = topFade;
  context.fillRect(x, y, width, height * 0.3);

  const bottomFade = context.createLinearGradient(0, y + height * 0.7, 0, y + height);
  bottomFade.addColorStop(0, `${dialColor}00`);
  bottomFade.addColorStop(1, dialColor);
  context.fillStyle = bottomFade;
  context.fillRect(x, y + height * 0.7, width, height * 0.3);
  context.restore();

  context.strokeStyle = state.animated[index] ? "rgba(8, 126, 112, 0.55)" : "rgba(88, 101, 108, 0.32)";
  context.lineWidth = state.animated[index] ? 3 : 2;
  roundedRectPath(context, x, y, width, height, 8);
  context.stroke();

  context.fillStyle = state.animated[index] ? "#de6d4f" : "#aeb8bd";
  context.fillRect(x + width * 0.34, y + height + 20, width * 0.32, 5);
}

function render(playhead = state.playhead) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

  const count = Math.max(1, state.characters.length);
  const sidePadding = 100;
  const maxGap = 18;
  const dialWidth = clamp((OUTPUT_WIDTH - sidePadding * 2 - maxGap * (count - 1)) / count, 68, 150);
  const gap = count > 1 ? Math.min(maxGap, (OUTPUT_WIDTH - sidePadding * 2 - dialWidth * count) / (count - 1)) : 0;
  const totalWidth = dialWidth * count + gap * (count - 1);
  const startX = (OUTPUT_WIDTH - totalWidth) / 2;
  const dialHeight = clamp(dialWidth * 2.45, 240, 350);
  const startY = (OUTPUT_HEIGHT - dialHeight) / 2 - 10;

  context.fillStyle = elements.textColor.value;
  context.globalAlpha = 0.52;
  context.font = `700 22px ${fontFamily()}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("DIAL TYPE", OUTPUT_WIDTH / 2, startY - 82);
  context.globalAlpha = 1;

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
  context.restore();
}

function rebuildCharacterOptions(preserve = true) {
  const nextCharacters = splitCharacters(elements.textInput.value);
  if (elements.textInput.value !== nextCharacters.join("")) {
    elements.textInput.value = nextCharacters.join("");
  }
  const previousCharacters = state.characters;
  const previousAnimated = state.animated;
  state.characters = nextCharacters;
  state.animated = nextCharacters.map((character, index) => {
    if (!character.trim()) return false;
    return preserve && previousCharacters[index] === character ? previousAnimated[index] : true;
  });

  elements.characterOptions.replaceChildren();
  state.characters.forEach((character, index) => {
    const label = document.createElement("label");
    label.className = `character-option${character.trim() ? "" : " is-space"}`;
    label.title = character.trim() ? `${character}を動かす` : "空白";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.animated[index];
    input.disabled = !character.trim();
    input.addEventListener("change", () => {
      state.animated[index] = input.checked;
      state.playhead = 0;
      updateUI();
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
  const count = state.characters.length;
  const animatedCount = state.animated.filter(Boolean).length;
  const totalDuration = getTotalDuration();
  const directionLabels = { before: "1つ前", alternate: "前後", after: "1つ後" };
  elements.characterCount.value = `${count} / ${MAX_CHARACTERS}`;
  elements.toggleAllButton.textContent = animatedCount ? "すべて固定" : "すべて動かす";
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.staggerValue.value = `${Number(elements.stagger.value).toFixed(2)} 秒`;
  elements.totalDurationValue.value = `${totalDuration.toFixed(1)} 秒`;
  elements.stageStatus.textContent = `${count}文字 · ${directionLabels[currentDirection()]}`;
  elements.timeline.value = String(Math.round(state.playhead * 1000));
  elements.currentTime.value = formatTime(state.playhead * totalDuration);
  elements.totalTime.value = formatTime(totalDuration);
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

elements.textInput.addEventListener("input", () => rebuildCharacterOptions(true));
elements.toggleAllButton.addEventListener("click", () => {
  const shouldAnimate = !state.animated.some(Boolean);
  state.animated = state.characters.map((character) => character.trim() ? shouldAnimate : false);
  rebuildCharacterOptions(true);
});

elements.directionInputs.forEach((input) => {
  input.addEventListener("change", () => {
    state.playhead = 0;
    stopPlayback();
  });
});

[elements.duration, elements.stagger].forEach((input) => {
  input.addEventListener("input", () => {
    state.playhead = 0;
    stopPlayback();
  });
});

[elements.easing, elements.fontStyle].forEach((input) => input.addEventListener("change", render));
elements.colorControls.forEach((input) => {
  input.addEventListener("input", () => {
    input.nextElementSibling.value = input.value.toUpperCase();
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
  if (state.isPlaying) {
    stopPlayback();
    startPlayback();
  }
});
elements.exportButton.addEventListener("click", exportVideo);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !["INPUT", "SELECT", "BUTTON"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    if (state.isPlaying) stopPlayback();
    else startPlayback();
  }
});

rebuildCharacterOptions(false);
