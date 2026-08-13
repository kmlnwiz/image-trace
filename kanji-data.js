"use strict";

(function exposeKanjiData() {
  const CACHE_PREFIX = "motion-lab:hanzi-writer-jp:";
  const CACHE_INDEX_KEY = "motion-lab:hanzi-writer-jp-cache-index:v1";
  const MAX_CACHE_ENTRIES = 24;

  function readCache(character) {
    try {
      const value = localStorage.getItem(`${CACHE_PREFIX}${character}`);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function writeCache(character, data) {
    try {
      localStorage.setItem(`${CACHE_PREFIX}${character}`, JSON.stringify(data));
      const saved = JSON.parse(localStorage.getItem(CACHE_INDEX_KEY) || "[]");
      const index = [character, ...saved.filter((item) => item !== character)];
      while (index.length > MAX_CACHE_ENTRIES) {
        localStorage.removeItem(`${CACHE_PREFIX}${index.pop()}`);
      }
      localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    } catch {
      // The loaded character is still usable without persistent storage.
    }
  }

  async function fetchCharacter(character, signal) {
    const cached = readCache(character);
    if (cached) return cached;
    const encoded = encodeURIComponent(character);
    const urls = [
      `https://cdn.jsdelivr.net/npm/hanzi-writer-data-jp@0/${encoded}.json`,
      `https://cdn.jsdelivr.net/gh/chanind/hanzi-writer-data-jp@master/data/${encoded}.json`,
      `https://raw.githubusercontent.com/chanind/hanzi-writer-data-jp/master/data/${encoded}.json`,
    ];
    let lastError;
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal, mode: "cors" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.strokes) || !data.strokes.length) throw new Error("Invalid character data");
        writeCache(character, data);
        return data;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        lastError = error;
      }
    }
    throw lastError || new Error("Character data could not be loaded");
  }

  function boundsFromMedian(median, pathData) {
    const points = Array.isArray(median) ? [...median] : [];
    const values = String(pathData).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      points.push([values[index], values[index + 1]]);
    }
    if (!points.length) return { minX: 384, maxX: 640, minY: 384, maxY: 640, cx: 512, cy: 512 };
    const xs = points.map((point) => Number(point[0]));
    const ys = points.map((point) => Number(point[1]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  function parse(data) {
    const radicalSet = new Set(Array.isArray(data.radStrokes) ? data.radStrokes.map(Number) : []);
    return {
      strokes: data.strokes.map((pathData, index) => ({
        number: index + 1,
        shape: new Path2D(pathData),
        bounds: boundsFromMedian(data.medians?.[index], pathData),
      })),
      radicalIndices: [...radicalSet].filter((index) => index >= 0 && index < data.strokes.length),
    };
  }

  window.KanjiMotionData = { fetchCharacter, parse };
})();
