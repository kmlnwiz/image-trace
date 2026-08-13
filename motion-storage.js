"use strict";

const MotionStorage = Object.freeze({
  read(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The tools remain usable when storage is unavailable.
    }
  },

  restoreControl(control, value) {
    if (value === undefined || value === null) return;
    if (control instanceof HTMLSelectElement) {
      if ([...control.options].some((option) => option.value === String(value))) {
        control.value = String(value);
      }
      return;
    }
    if (control.type === "color") {
      if (/^#[0-9a-f]{6}$/i.test(String(value))) control.value = String(value);
      return;
    }
    const number = Number(value);
    const min = control.min === "" ? -Infinity : Number(control.min);
    const max = control.max === "" ? Infinity : Number(control.max);
    if (Number.isFinite(number) && number >= min && number <= max) {
      control.value = String(number);
    }
  },
});
