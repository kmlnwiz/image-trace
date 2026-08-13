"use strict";

const RADICAL_SETTINGS_KEY = "motion-lab:radical-highlight-settings:v1";
const SOURCE_SIZE = 1024;
const SOURCE_BASELINE = 900;
const elements = {
  canvas: document.querySelector("#previewCanvas"), character: document.querySelector("#characterInput"),
  strokeCount: document.querySelector("#strokeCount"), dataStatus: document.querySelector("#dataStatus"),
  canvasMessage: document.querySelector("#canvasMessage"), strokePicker: document.querySelector("#strokePicker"),
  radicalHint: document.querySelector("#radicalHint"), autoSelect: document.querySelector("#autoSelectButton"),
  selectAll: document.querySelector("#selectAllButton"), clear: document.querySelector("#clearButton"),
  baseColor: document.querySelector("#baseColor"), baseOpacity: document.querySelector("#baseOpacity"),
  baseOpacityValue: document.querySelector("#baseOpacityValue"), highlightColor: document.querySelector("#highlightColor"),
  backgroundColor: document.querySelector("#backgroundColor"), outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"), stageStatus: document.querySelector("#stageStatus"),
  imageExport: document.querySelector("#imageExportButton"), toast: document.querySelector("#toast"),
};
const context = elements.canvas.getContext("2d");
const state = { character: "語", strokes: [], radicalIndices: [], selected: new Set(), loading: false, requestId: 0, controller: null, loadTimer: 0 };
let toastTimer = 0;

function saveSettings() {
  MotionStorage.write(RADICAL_SETTINGS_KEY, {
    character: state.character, selected: [...state.selected], baseColor: elements.baseColor.value,
    baseOpacity: elements.baseOpacity.value, highlightColor: elements.highlightColor.value,
    backgroundColor: elements.backgroundColor.value, outputSize: elements.outputSize.value,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(RADICAL_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.character === "string" && MotionToolkit.graphemes(settings.character).length) {
    state.character = MotionToolkit.graphemes(settings.character)[0];
    elements.character.value = state.character;
  }
  ["baseColor", "baseOpacity", "highlightColor", "backgroundColor", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  return Array.isArray(settings.selected) ? settings.selected.map(Number) : null;
}

function setStatus(message, type = "loading") {
  elements.dataStatus.lastElementChild.textContent = message;
  elements.dataStatus.classList.toggle("is-ready", type === "ready");
  elements.dataStatus.classList.toggle("is-error", type === "error");
}

function setMessage(message = "") {
  elements.canvasMessage.textContent = message;
  elements.canvasMessage.hidden = !message;
}

function applyCharacterTransform(ctx) {
  const size = elements.canvas.width;
  const padding = size * 0.045;
  const scale = (size - padding * 2) / SOURCE_SIZE;
  ctx.setTransform(scale, 0, 0, -scale, padding, size / 2 + SOURCE_BASELINE * scale / 2);
}

function drawStroke(stroke, color, alpha) {
  context.save();
  applyCharacterTransform(context);
  context.globalAlpha = MotionToolkit.clamp(alpha, 0, 1);
  context.fillStyle = color;
  context.fill(stroke.shape);
  context.restore();
}

function render() {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  const baseOpacity = Number(elements.baseOpacity.value) / 100;
  state.strokes.forEach((stroke, index) => {
    const selected = state.selected.has(index);
    drawStroke(stroke, selected ? elements.highlightColor.value : elements.baseColor.value, selected ? 1 : baseOpacity);
  });
  context.restore();
}

function updateLabels() {
  elements.strokeCount.value = state.strokes.length ? `${state.strokes.length} 画` : "— 画";
  elements.baseOpacityValue.value = `${elements.baseOpacity.value}%`;
  document.querySelectorAll('.color-control input[type="color"]').forEach((input) => { input.nextElementSibling.value = input.value.toUpperCase(); });
  elements.stageStatus.textContent = state.loading ? "画データを読み込み中" : state.strokes.length ? `${state.selected.size} / ${state.strokes.length}画を強調` : "画データなし";
}

function renderPicker() {
  elements.strokePicker.replaceChildren();
  state.strokes.forEach((stroke, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(stroke.number);
    button.classList.toggle("is-active", state.selected.has(index));
    button.setAttribute("aria-pressed", String(state.selected.has(index)));
    button.addEventListener("click", () => {
      if (state.selected.has(index)) state.selected.delete(index); else state.selected.add(index);
      renderPicker();
      updateLabels();
      saveSettings();
      render();
    });
    elements.strokePicker.append(button);
  });
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
}

function exportImage() {
  if (!state.strokes.length || state.loading) {
    showToast("画データの読み込み後に書き出してください");
    return;
  }
  render();
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNGを作成できませんでした");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${MotionToolkit.safeFileName(`${state.character}-radical-highlight`, "radical-highlight")}.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("PNGを書き出しました");
  }, "image/png");
}

function applyAutoSelection() {
  if (!state.strokes.length) return;
  const indices = state.radicalIndices.length ? state.radicalIndices : [0];
  state.selected = new Set(indices);
  elements.radicalHint.textContent = state.radicalIndices.length
    ? `登録された部首の${state.radicalIndices.length}画を選択中です。各番号を押して手動調整できます。`
    : "部首情報がないため第1画を選択しました。画番号で手動調整してください。";
  renderPicker();
  updateLabels();
  saveSettings();
  render();
}

async function loadCharacter(character, restoredSelection = null) {
  const requestId = ++state.requestId;
  state.controller?.abort();
  state.controller = new AbortController();
  state.loading = true;
  state.strokes = [];
  state.selected.clear();
  renderPicker();
  updateLabels();
  render();
  setStatus("日本語用の画データを読み込み中");
  setMessage("漢字の画データを読み込んでいます…");
  try {
    const parsed = KanjiMotionData.parse(await KanjiMotionData.fetchCharacter(character, state.controller.signal));
    if (requestId !== state.requestId) return;
    state.strokes = parsed.strokes;
    state.radicalIndices = parsed.radicalIndices;
    state.loading = false;
    if (Array.isArray(restoredSelection)) {
      state.selected = new Set(restoredSelection.filter((index) => index >= 0 && index < state.strokes.length));
      renderPicker();
      saveSettings();
    } else {
      applyAutoSelection();
    }
    setStatus(`${state.strokes.length}画を読み込みました`, "ready");
    setMessage();
    updateLabels();
    render();
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.requestId) return;
    state.loading = false;
    setStatus("画データを取得できません", "error");
    setMessage("この文字の画データを取得できませんでした。漢字1文字とネット接続を確認してください。");
    updateLabels();
    render();
  }
}

elements.character.addEventListener("input", () => {
  const [character = ""] = MotionToolkit.graphemes(elements.character.value);
  elements.character.value = character;
  state.character = character;
  clearTimeout(state.loadTimer);
  state.controller?.abort();
  state.strokes = [];
  state.selected.clear();
  renderPicker();
  updateLabels();
  render();
  saveSettings();
  if (!character) {
    state.loading = false;
    setStatus("漢字を1文字入力してください", "error");
    setMessage("左の欄に漢字を1文字入力してください。");
    updateLabels();
    return;
  }
  state.loadTimer = window.setTimeout(() => loadCharacter(character), 220);
});
elements.autoSelect.addEventListener("click", applyAutoSelection);
elements.selectAll.addEventListener("click", () => { state.selected = new Set(state.strokes.map((_, index) => index)); renderPicker(); updateLabels(); saveSettings(); render(); });
elements.clear.addEventListener("click", () => { state.selected.clear(); renderPicker(); updateLabels(); saveSettings(); render(); });
elements.baseOpacity.addEventListener("input", () => { updateLabels(); saveSettings(); render(); });
document.querySelectorAll('.color-control input[type="color"]').forEach((input) => input.addEventListener("input", () => { updateLabels(); saveSettings(); render(); }));
elements.outputSize.addEventListener("change", () => { const size = Number(elements.outputSize.value); elements.canvas.width = size; elements.canvas.height = size; elements.stageDimensions.textContent = `1:1 · ${size} × ${size}`; saveSettings(); render(); });
elements.imageExport.addEventListener("click", exportImage);

(async function init() {
  const restoredSelection = restoreSettings();
  const size = Number(elements.outputSize.value);
  elements.canvas.width = size;
  elements.canvas.height = size;
  elements.stageDimensions.textContent = `1:1 · ${size} × ${size}`;
  updateLabels();
  render();
  await loadCharacter(state.character, restoredSelection);
})();
