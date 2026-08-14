"use strict";

// Every numeric setting used to be drag-only: the slider moved and an <output>
// echoed the result. This layer puts a text box where that echo was, so a value
// can be typed exactly, and keeps the two in sync in both directions without any
// tool having to know about it.
(function exposeMotionControls() {
  const NUMBER_PATTERN = /-?\d+(?:[.,]\d+)?/;

  // The value display carries the number plus whatever the tool appends to it
  // ("2.0 秒 / 120f"). Only the trailing part is needed here: the number itself
  // always comes from the slider, so the two can never drift apart, and a
  // display that spells its value out in words ("標準") still gets a field.
  function unitOf(text) {
    const source = String(text ?? "").trim();
    const match = source.match(NUMBER_PATTERN);
    if (!match) return source;
    return source.slice(match.index + match[0].length).trim();
  }

  function snapToStep(value, range) {
    const step = Number(range.step);
    const min = Number(range.min);
    if (!Number.isFinite(step) || step <= 0) return value;
    const base = Number.isFinite(min) ? min : 0;
    const snapped = base + Math.round((value - base) / step) * step;
    // Re-round through the step's own precision so 0.1 steps stay short.
    const decimals = (String(range.step).split(".")[1] || "").length;
    return Number(snapped.toFixed(decimals));
  }

  function clampToRange(value, range) {
    const min = Number(range.min);
    const max = Number(range.max);
    let result = value;
    if (Number.isFinite(min)) result = Math.max(min, result);
    if (Number.isFinite(max)) result = Math.min(max, result);
    return result;
  }

  // The value display sits either in a <label for="…"> beside the slider or in
  // the section heading as "<id>Value"; both spellings are in use.
  function findOutput(range) {
    if (!range.id) return null;
    const named = document.querySelector(`output#${CSS.escape(`${range.id}Value`)}`);
    if (named) return named;
    return document.querySelector(`label[for="${CSS.escape(range.id)}"] output`);
  }

  function upgradeRange(range) {
    const output = findOutput(range);
    if (!output || output.dataset.valueField === "on") return;

    const field = document.createElement("span");
    field.className = "value-field";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "value-input";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = range.value;
    const unit = document.createElement("span");
    unit.className = "value-input-unit";
    unit.textContent = unitOf(output.textContent);
    const labelText = document.querySelector(`label[for="${CSS.escape(range.id)}"] span`)?.textContent?.trim();
    input.setAttribute("aria-label", labelText ? `${labelText}（数値入力）` : `${range.id} の数値`);
    field.append(input, unit);

    output.dataset.valueField = "on";
    output.style.display = "none";
    output.after(field);

    function pull() {
      unit.textContent = unitOf(output.textContent);
      if (document.activeElement === input) return;
      input.value = range.value;
      input.classList.remove("is-invalid");
    }

    function push(value, fireChange) {
      range.value = String(value);
      range.dispatchEvent(new Event("input", { bubbles: true }));
      if (fireChange) range.dispatchEvent(new Event("change", { bubbles: true }));
    }

    input.addEventListener("input", () => {
      const parsed = Number(input.value.replace(",", "."));
      // An out of range or half typed number just waits; the slider keeps its value.
      if (!input.value.trim() || !Number.isFinite(parsed) || clampToRange(parsed, range) !== parsed) {
        input.classList.add("is-invalid");
        return;
      }
      input.classList.remove("is-invalid");
      push(snapToStep(parsed, range), false);
    });

    function commit() {
      const parsed = Number(input.value.replace(",", "."));
      if (!Number.isFinite(parsed)) {
        pull();
        input.classList.remove("is-invalid");
        return;
      }
      push(snapToStep(clampToRange(parsed, range), range), true);
      input.classList.remove("is-invalid");
      pull();
    }

    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        return;
      }
      // Arrow keys nudge by one step, matching the slider they replace.
      const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const step = Number(range.step) || 1;
      const current = Number(input.value.replace(",", ".")) || Number(range.value) || 0;
      push(snapToStep(clampToRange(current + direction * step, range), range), true);
      pull();
    });

    new MutationObserver(pull).observe(output, { childList: true, characterData: true, subtree: true });
    // Dragging the slider, or a tool clamping it, has to be reflected too — the
    // display text does not always change when the value does.
    range.addEventListener("input", pull);
    range.addEventListener("change", pull);
    pull();
  }

  function upgradeNumericFields(root = document) {
    [...root.querySelectorAll('input[type="range"]')]
      .filter((range) => range.id && range.id !== "timeline" && !range.closest(".transport"))
      .forEach(upgradeRange);
  }

  // Thirteen tools each re-stated "write the hex back into the swatch label".
  // Doing it here keeps that wiring out of every new tool.
  function syncColorOutputs(root = document) {
    [...root.querySelectorAll('.color-control input[type="color"]')].forEach((control) => {
      const output = control.nextElementSibling;
      if (!output || output.tagName !== "OUTPUT" || control.dataset.colorSync === "on") return;
      control.dataset.colorSync = "on";
      const write = () => { output.value = control.value.toUpperCase(); };
      control.addEventListener("input", write);
      control.addEventListener("change", write);
      write();
    });
  }

  window.MotionControls = { upgradeNumericFields, syncColorOutputs };

  function upgradeAll() {
    upgradeNumericFields();
    syncColorOutputs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", upgradeAll, { once: true });
  } else {
    upgradeAll();
  }
})();
