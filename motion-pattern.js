"use strict";

// The background tools all paint periodic fields instead of moving a loaded
// asset around, so what they share is different from the other families: a
// loop safe phase, a handful of wave shapes, colour ramp helpers and grain.
(function exposePatternHelpers() {
  const EXPORT_FPS = 60;

  function frac(value) {
    return value - Math.floor(value);
  }

  // The exporter walks the playhead from 0 to 1 inclusive, so a render that is
  // periodic in the playhead would repeat its opening frame at the very end.
  // Compressing the phase by one frame leaves the last frame one step short of
  // the loop point, which is what makes the clip join itself cleanly.
  function loopPhase(playhead, duration) {
    const seconds = Math.max(0.1, Number(duration) || 0.1);
    const frames = Math.max(2, Math.round(seconds * EXPORT_FPS));
    return frac(Number(playhead) * (frames - 1) / frames);
  }

  // Every shape starts at 0 for a phase of 0 so switching between them never
  // jumps the animation.
  function wave01(shape, value) {
    const position = frac(value);
    if (shape === "triangle") return 1 - Math.abs(position * 2 - 1);
    if (shape === "pulse") return position < 0.5 ? 0 : 1;
    if (shape === "saw") return position;
    return (1 - Math.cos(position * Math.PI * 2)) / 2;
  }

  function hexToRgb(hex) {
    const source = String(hex || "").trim().replace("#", "");
    const full = source.length === 3 ? source.split("").map((part) => part + part).join("") : source;
    const value = Number.parseInt(full, 16);
    if (full.length !== 6 || !Number.isFinite(value)) return { r: 0, g: 0, b: 0 };
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function mixRgb(from, to, amount) {
    const ratio = Math.max(0, Math.min(1, amount));
    return {
      r: Math.round(from.r + (to.r - from.r) * ratio),
      g: Math.round(from.g + (to.g - from.g) * ratio),
      b: Math.round(from.b + (to.b - from.b) * ratio),
    };
  }

  function rgbCss(rgb, alpha = 1) {
    return alpha >= 1 ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function mixHex(from, to, amount) {
    return rgbCss(mixRgb(hexToRgb(from), hexToRgb(to), amount));
  }

  // Samples a cyclic colour ramp. "smooth" blends into the next entry, and the
  // ramp always wraps so a phase of 1 lands back on the first colour.
  function paletteAt(colors, position, smooth = true) {
    if (!colors.length) return { r: 0, g: 0, b: 0 };
    const scaled = frac(position) * colors.length;
    const index = Math.min(colors.length - 1, Math.floor(scaled));
    const current = hexToRgb(colors[index]);
    if (!smooth) return current;
    return mixRgb(current, hexToRgb(colors[(index + 1) % colors.length]), scaled - index);
  }

  // A 256 entry lookup table so per pixel tools never parse a hex string inside
  // their loop.
  function paletteTable(colors, repeat = 1, smooth = true) {
    const table = new Uint8ClampedArray(256 * 3);
    for (let index = 0; index < 256; index += 1) {
      const color = paletteAt(colors, index / 256 * repeat, smooth);
      table[index * 3] = color.r;
      table[index * 3 + 1] = color.g;
      table[index * 3 + 2] = color.b;
    }
    return table;
  }

  function readPalette(inputs, count) {
    return inputs.slice(0, Math.max(1, Math.min(inputs.length, Number(count) || inputs.length))).map((input) => input.value);
  }

  function syncPaletteRows(rows, count) {
    rows.forEach((row, index) => { row.hidden = index >= Number(count); });
  }

  // Where a grid cell sits along the wave, as 0 to 1. The cell carries its own
  // seeded value so the random direction stays fixed while the phase moves.
  function gridField(mode, cell, angleDegrees = 0) {
    const x = (cell.column + 0.5) / Math.max(1, cell.columns);
    const y = (cell.row + 0.5) / Math.max(1, cell.rows);
    if (mode === "uniform") return 0;
    if (mode === "random") return cell.randomValue ?? 0;
    if (mode === "radial") return Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2;
    if (mode === "spiral") return (Math.atan2(y - 0.5, x - 0.5) + Math.PI) / (Math.PI * 2);
    const radians = Number(angleDegrees) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const extent = Math.abs(cos) + Math.abs(sin) || 1;
    return 0.5 + ((x - 0.5) * cos + (y - 0.5) * sin) / extent;
  }

  // Grain is a fixed overlay rather than a per frame draw: an animated one
  // would break the loop and cost a full canvas of random numbers every frame.
  const grainTiles = new Map();

  function grainTile(seed) {
    const key = String(seed);
    const cached = grainTiles.get(key);
    if (cached) return cached;
    const size = 160;
    const tile = document.createElement("canvas");
    tile.width = size;
    tile.height = size;
    const context = tile.getContext("2d");
    const image = context.createImageData(size, size);
    const random = MotionToolkit.seededRandom(seed);
    for (let index = 0; index < image.data.length; index += 4) {
      const level = Math.round(random() * 255);
      image.data[index] = level;
      image.data[index + 1] = level;
      image.data[index + 2] = level;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    if (grainTiles.size > 8) grainTiles.clear();
    grainTiles.set(key, tile);
    return tile;
  }

  function paintGrain(context, width, height, amount, seed) {
    if (!(amount > 0)) return;
    const pattern = context.createPattern(grainTile(seed), "repeat");
    if (!pattern) return;
    context.save();
    context.globalAlpha = Math.min(1, amount);
    context.globalCompositeOperation = "overlay";
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  window.MotionPattern = {
    frac,
    loopPhase,
    wave01,
    hexToRgb,
    mixRgb,
    rgbCss,
    mixHex,
    paletteAt,
    paletteTable,
    readPalette,
    syncPaletteRows,
    gridField,
    paintGrain,
  };
})();
