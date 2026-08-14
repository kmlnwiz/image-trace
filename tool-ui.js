"use strict";

(function setupSharedToolUI() {
  const page = document.body.dataset.toolKey || location.pathname.split("/").pop().replace(/\.html$/i, "") || "tool";
  const presetStorageKey = `motion-lab:presets:${page}:v2`;
  const legacyPresetStorageKey = `motion-lab:presets:${page}:v1`;
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
    "word-conveyor": "motion-lab:word-conveyor-settings:v4",
    "panel-reveal": "motion-lab:panel-reveal-settings:v2",
    "polyomino-motion": "motion-lab:polyomino-motion-settings:v1",
    "slide-puzzle": "motion-lab:slide-puzzle-settings:v1",
    "memory-flip": "motion-lab:memory-flip-settings:v1",
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
  window.MotionTools?.mountToolNav();

  function showToast(message) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function readPresets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(presetStorageKey) || "null");
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the legacy slots below.
    }
    return migrateLegacyPresets();
  }

  // The three numbered slots became a named list; carry whatever was saved over.
  function migrateLegacyPresets() {
    try {
      const legacy = JSON.parse(localStorage.getItem(legacyPresetStorageKey) || "[]");
      if (!Array.isArray(legacy)) return [];
      const migrated = legacy
        .map((preset, index) => (preset ? { ...preset, name: `プリセット ${index + 1}` } : null))
        .filter(Boolean);
      if (migrated.length) writePresets(migrated);
      return migrated;
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

  function presetControls(root = document) {
    const scope = root === document ? document.querySelectorAll("main input, main select, main textarea") : root.querySelectorAll("input, select, textarea");
    return [...scope]
      .filter((control) => control.type !== "file"
        && !control.closest(".transport")
        && control.id !== "timeline"
        // The typed mirrors of a slider follow it, so only the slider is stored.
        && !control.classList.contains("value-input"));
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
    notifyControls(changed);
  }

  function notifyControls(controls) {
    controls.forEach((control) => {
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // Restores the markup defaults rather than a stored snapshot, so a section
  // reset always lands on the values the tool shipped with.
  function resetControlsToDefaults(controls) {
    controls.forEach((control) => {
      if (control.tagName === "SELECT") {
        [...control.options].forEach((option) => { option.selected = option.defaultSelected; });
        if (control.selectedIndex < 0) control.selectedIndex = 0;
      } else if (control.type === "checkbox" || control.type === "radio") {
        control.checked = control.defaultChecked;
      } else {
        control.value = control.defaultValue;
      }
    });
    notifyControls(controls);
  }

  function resetSections() {
    return [...document.querySelectorAll("main section")]
      .map((section) => ({
        section,
        title: section.querySelector(".section-heading h2, h2")?.textContent?.trim() || "",
        controls: presetControls(section),
      }))
      .filter((entry) => entry.title && entry.controls.length);
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

  const saveRow = document.createElement("div");
  saveRow.className = "tool-preset-save";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "toolPresetName";
  nameInput.placeholder = "プリセット名";
  nameInput.maxLength = 40;
  nameInput.setAttribute("aria-label", "プリセット名");
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "保存";
  saveRow.append(nameInput, saveButton);

  const listHeading = document.createElement("p");
  listHeading.className = "tool-preset-heading";
  listHeading.textContent = "保存済み";
  const list = document.createElement("div");
  list.className = "tool-preset-list";

  const resetHeading = document.createElement("p");
  resetHeading.className = "tool-preset-heading";
  resetHeading.textContent = "初期化";
  const resetRow = document.createElement("div");
  resetRow.className = "tool-preset-reset";
  const resetSelect = document.createElement("select");
  resetSelect.id = "toolPresetResetScope";
  resetSelect.setAttribute("aria-label", "初期化する範囲");
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "is-danger";
  resetButton.textContent = "リセット";
  resetRow.append(resetSelect, resetButton);

  panel.append(saveRow, listHeading, list, resetHeading, resetRow);
  menu.append(summary, panel);

  function refreshResetScopes() {
    const sections = resetSections();
    resetSelect.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "すべての設定";
    resetSelect.append(all);
    sections.forEach((entry, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = entry.title;
      resetSelect.append(option);
    });
  }

  function refreshList() {
    const presets = readPresets();
    list.replaceChildren();
    if (!presets.length) {
      const empty = document.createElement("p");
      empty.className = "tool-preset-empty";
      empty.textContent = "保存されたプリセットはありません。";
      list.append(empty);
      return;
    }
    presets.forEach((preset, index) => {
      const row = document.createElement("div");
      row.className = "tool-preset-row";
      const name = document.createElement("span");
      name.className = "tool-preset-name";
      name.textContent = preset.name || `プリセット ${index + 1}`;
      name.title = preset.savedAt ? new Date(preset.savedAt).toLocaleString("ja-JP") : "";
      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.textContent = "読込";
      loadButton.addEventListener("click", () => loadPreset(index));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "is-danger";
      deleteButton.textContent = "削除";
      deleteButton.setAttribute("aria-label", `${name.textContent} を削除`);
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", () => deletePreset(index));
      row.append(name, loadButton, deleteButton);
      list.append(row);
    });
  }

  function loadPreset(index) {
    try {
      const preset = readPresets()[index];
      if (!preset) return;
      if (typeof preset.settings === "string") localStorage.setItem(settingsKey, preset.settings);
      else localStorage.removeItem(settingsKey);
      sessionStorage.setItem(pendingStorageKey, JSON.stringify(preset.controls || {}));
      reloadWithNotice(`「${preset.name || "プリセット"}」を読み込みました`);
    } catch {
      showToast("プリセットを読み込めませんでした");
    }
  }

  function deletePreset(index) {
    try {
      const presets = readPresets();
      const [removed] = presets.splice(index, 1);
      writePresets(presets);
      refreshList();
      showToast(`「${removed?.name || "プリセット"}」を削除しました`);
    } catch {
      showToast("プリセットを削除できませんでした");
    }
  }

  const rightGroup = header.querySelector(".header-actions, .header-nav, .dial-nav, .kanji-nav");
  const switcher = rightGroup?.querySelector(".tool-switcher");
  if (switcher) rightGroup.insertBefore(menu, switcher);
  else if (rightGroup) rightGroup.prepend(menu);
  else header.append(menu);

  saveButton.addEventListener("click", () => {
    try {
      const presets = readPresets();
      const name = nameInput.value.trim() || `プリセット ${presets.length + 1}`;
      const entry = { name, savedAt: new Date().toISOString(), settings: localStorage.getItem(settingsKey), controls: captureControls() };
      // Saving under an existing name overwrites it instead of piling up duplicates.
      const existing = presets.findIndex((preset) => (preset?.name || "") === name);
      if (existing >= 0) presets[existing] = entry;
      else presets.push(entry);
      writePresets(presets);
      nameInput.value = "";
      refreshList();
      showToast(`「${name}」に保存しました`);
    } catch {
      showToast("プリセットを保存できませんでした");
    }
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
  });

  resetButton.addEventListener("click", () => {
    try {
      if (resetSelect.value === "all") {
        localStorage.removeItem(settingsKey);
        sessionStorage.removeItem(pendingStorageKey);
        reloadWithNotice("設定を初期値へ戻しました");
        return;
      }
      const entry = resetSections()[Number(resetSelect.value)];
      if (!entry) return;
      resetControlsToDefaults(entry.controls);
      menu.open = false;
      showToast(`「${entry.title}」を初期値へ戻しました`);
    } catch {
      showToast("設定を初期化できませんでした");
    }
  });

  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("toggle", () => {
    if (menu.open) refreshResetScopes();
  });

  refreshList();
  refreshResetScopes();
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
