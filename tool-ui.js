"use strict";

(function setupSharedToolUI() {
  const page = document.body.dataset.toolKey || location.pathname.split("/").pop().replace(/\.html$/i, "") || "tool";
  const presetStorageKey = `motion-lab:presets:${page}:v1`;
  const pendingStorageKey = `motion-lab:preset-pending:${page}:v1`;
  const noticeStorageKey = "motion-lab:preset-notice:v1";
  const settingsKeys = {
    outline: "motion-lab:outline-settings:v1",
    "text-dial": "motion-lab:dial-settings:v1",
    "text-reel": "motion-lab:text-reel-settings:v1",
    "reverse-kanji": "motion-lab:reverse-kanji-settings:v4",
    "random-kanji": "motion-lab:random-kanji-settings:v1",
    "color-focus": "motion-lab:color-focus-settings:v1",
    "slice-motion": "motion-lab:slice-motion-settings:v1",
    "flip-panels": "motion-lab:flip-panels-settings:v1",
    "stroke-assemble": "motion-lab:stroke-assemble-settings:v1",
    "radical-highlight": "motion-lab:radical-highlight-settings:v1",
  };
  const settingsKey = settingsKeys[page];

  function buildSharedPanelLayout() {
    const shell = document.querySelector(".tool-shell-compact");
    const leftPanel = shell?.querySelector(":scope > .tool-sidebar-left");
    const sections = leftPanel ? [...leftPanel.querySelectorAll(":scope > .tool-panel-right")] : [];
    if (!shell || !leftPanel || !sections.length) return;
    const rightPanel = document.createElement("aside");
    rightPanel.className = `${[...leftPanel.classList].filter((name) => !["tool-sidebar-left"].includes(name)).join(" ")} tool-sidebar-right`;
    rightPanel.setAttribute("aria-label", "動きと出力の設定");
    sections.forEach((section) => rightPanel.append(section));
    shell.append(rightPanel);
    shell.classList.remove("tool-shell-compact");
  }

  buildSharedPanelLayout();

  function showToast(message) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function readPresets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(presetStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch {
      return [];
    }
  }

  function writePresets(presets) {
    localStorage.setItem(presetStorageKey, JSON.stringify(presets));
  }

  function controlKey(control, index) {
    if (control.id) return `id:${control.id}`;
    if (control.name) return `name:${control.name}:${control.type || control.tagName}:${control.value}`;
    return `index:${index}:${control.tagName}:${control.type || ""}`;
  }

  function presetControls() {
    return [...document.querySelectorAll("main input, main select, main textarea")]
      .filter((control) => control.type !== "file" && !control.closest(".transport") && control.id !== "timeline");
  }

  function captureControls() {
    const values = {};
    presetControls().forEach((control, index) => {
      const key = controlKey(control, index);
      if (control.type === "checkbox" || control.type === "radio") values[key] = { checked: control.checked };
      else values[key] = { value: control.value };
    });
    return values;
  }

  function applyControls(values) {
    if (!values || typeof values !== "object") return;
    const changed = [];
    presetControls().forEach((control, index) => {
      const saved = values[controlKey(control, index)];
      if (!saved) return;
      if (Object.hasOwn(saved, "checked")) control.checked = Boolean(saved.checked);
      else if (Object.hasOwn(saved, "value")) control.value = saved.value;
      changed.push(control);
    });
    changed.forEach((control) => {
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function reloadWithNotice(message) {
    sessionStorage.setItem(noticeStorageKey, message);
    location.reload();
  }

  const header = document.querySelector(".tool-header");
  if (!header || !settingsKey) return;

  const menu = document.createElement("details");
  menu.className = "tool-preset-menu";
  const summary = document.createElement("summary");
  summary.textContent = "プリセット";
  const panel = document.createElement("div");
  panel.className = "tool-preset-panel";
  const label = document.createElement("label");
  label.htmlFor = "toolPresetSlot";
  label.textContent = "保存先";
  const select = document.createElement("select");
  select.id = "toolPresetSlot";
  select.setAttribute("aria-label", "プリセットの保存先");
  const actions = document.createElement("div");
  actions.className = "tool-preset-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "保存";
  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.textContent = "読込";
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "is-danger";
  resetButton.textContent = "初期化";
  actions.append(saveButton, loadButton, resetButton);
  panel.append(label, select, actions);
  menu.append(summary, panel);

  function refreshSlots() {
    const presets = readPresets();
    const selected = select.value || "0";
    select.replaceChildren();
    for (let index = 0; index < 3; index += 1) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = presets[index] ? `プリセット ${index + 1} ・ 保存済み` : `プリセット ${index + 1} ・ 空き`;
      select.append(option);
    }
    select.value = selected;
    loadButton.disabled = !presets[Number(select.value)];
  }

  const rightGroup = header.querySelector(".header-actions, .header-nav, .dial-nav, .kanji-nav");
  if (rightGroup) rightGroup.prepend(menu);
  else header.append(menu);

  select.addEventListener("change", refreshSlots);
  saveButton.addEventListener("click", () => {
    try {
      const presets = readPresets();
      const index = Number(select.value);
      presets[index] = {
        savedAt: new Date().toISOString(),
        settings: localStorage.getItem(settingsKey),
        controls: captureControls(),
      };
      writePresets(presets);
      refreshSlots();
      menu.open = false;
      showToast(`プリセット ${index + 1} に保存しました`);
    } catch {
      showToast("プリセットを保存できませんでした");
    }
  });
  loadButton.addEventListener("click", () => {
    try {
      const index = Number(select.value);
      const preset = readPresets()[index];
      if (!preset) return;
      if (typeof preset.settings === "string") localStorage.setItem(settingsKey, preset.settings);
      else localStorage.removeItem(settingsKey);
      sessionStorage.setItem(pendingStorageKey, JSON.stringify(preset.controls || {}));
      reloadWithNotice(`プリセット ${index + 1} を読み込みました`);
    } catch {
      showToast("プリセットを読み込めませんでした");
    }
  });
  resetButton.addEventListener("click", () => {
    try {
      localStorage.removeItem(settingsKey);
      sessionStorage.removeItem(pendingStorageKey);
      reloadWithNotice("設定を初期値へ戻しました");
    } catch {
      showToast("設定を初期化できませんでした");
    }
  });
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });

  refreshSlots();
  try {
    const pending = sessionStorage.getItem(pendingStorageKey);
    if (pending) {
      sessionStorage.removeItem(pendingStorageKey);
      window.setTimeout(() => applyControls(JSON.parse(pending)), 0);
    }
    const notice = sessionStorage.getItem(noticeStorageKey);
    if (notice) {
      sessionStorage.removeItem(noticeStorageKey);
      window.setTimeout(() => showToast(notice), 180);
    }
  } catch {
    // The tools remain usable when browser storage is unavailable.
  }
})();
