"use strict";

(function exposeMotionToolkit() {
  const EXPORT_FPS = 60;
  const FRAME_MS = 1000 / EXPORT_FPS;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function ease(progress, name = "easeInOut") {
    const t = clamp(progress, 0, 1);
    if (name === "linear") return t;
    if (name === "easeIn") return t * t * t;
    if (name === "easeOut") return 1 - Math.pow(1 - t, 3);
    if (name === "backOut") {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds - minutes * 60;
    return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
  }

  function graphemes(value, locale = "ja") {
    const normalized = String(value ?? "").normalize("NFC");
    if (typeof Intl.Segmenter !== "function") return Array.from(normalized);
    return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(normalized)]
      .map((part) => part.segment);
  }

  function hashSeed(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    let value = (Number(seed) || 1) >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ result >>> 15, result | 1);
      result ^= result + Math.imul(result ^ result >>> 7, result | 61);
      return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
  }

  function safeFileName(value, fallback = "motion") {
    return String(value || fallback).replace(/[\\/:*?"<>|]/g, "").trim() || fallback;
  }

  function supportedMimeType() {
    const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return types.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("画像ファイルを選択してください"));
        return;
      }
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({ image, url, name: file.name, bytes: file.size });
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("画像を読み込めませんでした"));
      };
      image.src = url;
    });
  }

  function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight, padding = 0) {
    const availableWidth = Math.max(1, targetWidth - padding * 2);
    const availableHeight = Math.max(1, targetHeight - padding * 2);
    const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height, scale };
  }

  function outputDimensions(value, fallbackWidth = 1600, fallbackHeight = 1000) {
    const match = String(value || "").match(/^(\d+)x(\d+)$/i);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    const squareSize = Number(value);
    if (Number.isFinite(squareSize) && squareSize > 0) return { width: squareSize, height: squareSize };
    return { width: fallbackWidth, height: fallbackHeight };
  }

  function resizeOutputCanvas(canvas, value, dimensionsLabel = null, fallbackWidth = 1600, fallbackHeight = 1000) {
    const { width, height } = outputDimensions(value, fallbackWidth, fallbackHeight);
    canvas.width = width;
    canvas.height = height;
    canvas.style.aspectRatio = `${width} / ${height}`;
    if (dimensionsLabel) {
      const divisor = greatestCommonDivisor(width, height);
      dimensionsLabel.textContent = `${width / divisor}:${height / divisor} · ${width} × ${height}`;
    }
    return { width, height };
  }

  function greatestCommonDivisor(a, b) {
    let left = Math.abs(a);
    let right = Math.abs(b);
    while (right) [left, right] = [right, left % right];
    return left || 1;
  }

  function createPlayer(options) {
    const canvas = options.canvas;
    const elements = {
      play: document.querySelector("#playButton"),
      restart: document.querySelector("#restartButton"),
      timeline: document.querySelector("#timeline"),
      current: document.querySelector("#currentTime"),
      total: document.querySelector("#totalTime"),
      speed: document.querySelector("#previewSpeed"),
      imageTime: document.querySelector("#imageTime"),
      imageTimeValue: document.querySelector("#imageTimeValue"),
      imageExport: document.querySelector("#imageExportButton"),
      videoExport: document.querySelector("#exportButton"),
      progress: document.querySelector("#exportProgress"),
      progressBar: document.querySelector("#exportProgressBar"),
      toast: document.querySelector("#toast"),
      outputSize: document.querySelector("#outputSize"),
    };
    const state = {
      playhead: 0,
      isPlaying: false,
      isExporting: false,
      startedAt: 0,
      rafId: 0,
      toastTimer: 0,
    };

    function duration() {
      return Math.max(0.1, Number(options.getDuration()) || 0.1);
    }

    function available() {
      return options.isReady ? Boolean(options.isReady()) : true;
    }

    if (elements.imageTime) {
      state.playhead = clamp(Number(elements.imageTime.value) / duration(), 0, 1);
    }

    function showToast(message) {
      if (!elements.toast) return;
      clearTimeout(state.toastTimer);
      elements.toast.textContent = message;
      elements.toast.hidden = false;
      state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3200);
    }

    function update() {
      const total = duration();
      if (elements.timeline) elements.timeline.value = String(Math.round(state.playhead * 1000));
      if (elements.current) elements.current.value = formatTime(state.playhead * total);
      if (elements.total) elements.total.value = formatTime(total);
      if (elements.play) {
        elements.play.textContent = state.isPlaying ? "Ⅱ" : "▶";
        elements.play.setAttribute("aria-label", state.isPlaying ? "一時停止" : "再生");
        elements.play.disabled = !available() || state.isExporting;
      }
      if (elements.restart) elements.restart.disabled = !available() || state.isExporting;
      if (elements.imageTime) {
        elements.imageTime.max = String(total);
        elements.imageTime.value = String(clamp(state.playhead * total, 0, total));
      }
      if (elements.imageTimeValue && elements.imageTime) {
        elements.imageTimeValue.value = `${Number(elements.imageTime.value).toFixed(1)} 秒`;
      }
      if (elements.imageExport) elements.imageExport.disabled = !available() || state.isExporting;
      if (elements.videoExport) elements.videoExport.disabled = !available() || state.isExporting;
      if (elements.outputSize) elements.outputSize.disabled = state.isExporting;
      options.onUpdate?.(state.playhead, state);
    }

    function render() {
      options.render(state.playhead);
    }

    function stop(renderFrame = true) {
      state.isPlaying = false;
      cancelAnimationFrame(state.rafId);
      update();
      if (renderFrame) render();
    }

    function tick(timestamp) {
      if (!state.isPlaying) return;
      const speed = Number(elements.speed?.value || 1);
      const rawPlayhead = (timestamp - state.startedAt) * speed / (duration() * 1000);
      state.playhead = options.loop ? rawPlayhead % 1 : clamp(rawPlayhead, 0, 1);
      render();
      update();
      if (options.loop) {
        if (rawPlayhead >= 1) {
          state.startedAt += Math.floor(rawPlayhead) * duration() * 1000 / speed;
          options.onLoop?.();
        }
        state.rafId = requestAnimationFrame(tick);
      } else if (state.playhead >= 1) {
        state.isPlaying = false;
        update();
        options.onFinish?.();
      } else {
        state.rafId = requestAnimationFrame(tick);
      }
    }

    function play() {
      if (!available() || state.isExporting) return;
      if (state.playhead >= 1) {
        state.playhead = 0;
        options.onReplay?.();
      }
      state.isPlaying = true;
      const speed = Number(elements.speed?.value || 1);
      state.startedAt = performance.now() - state.playhead * duration() * 1000 / speed;
      update();
      state.rafId = requestAnimationFrame(tick);
    }

    function reset() {
      state.playhead = 0;
      stop();
    }

    function setProgress(progress, renderFrame = true) {
      state.playhead = clamp(progress, 0, 1);
      stop(false);
      if (renderFrame) render();
      update();
    }

    async function exportVideo() {
      if (!available() || state.isExporting) return;
      if (!canvas.captureStream || !window.MediaRecorder) {
        showToast("このブラウザはWebM書き出しに対応していません");
        return;
      }
      // A 0 fps stream only emits frames we push, so every rendered frame lands in the file.
      let stream = canvas.captureStream(0);
      let videoTrack = stream.getVideoTracks()[0];
      const manualFrames = typeof videoTrack?.requestFrame === "function";
      if (!manualFrames) {
        stream.getTracks().forEach((track) => track.stop());
        stream = canvas.captureStream(EXPORT_FPS);
        videoTrack = stream.getVideoTracks()[0];
      }
      const pushFrame = manualFrames ? () => videoTrack.requestFrame() : () => {};
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: options.videoBitsPerSecond || 12_000_000,
      });
      const chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      state.isExporting = true;
      stop(false);
      update();
      if (elements.videoExport?.lastChild) elements.videoExport.lastChild.textContent = " 書き出し中";
      if (elements.progress) elements.progress.hidden = false;
      if (elements.progressBar) elements.progressBar.style.width = "0%";
      // Frames are counted, not sampled from the clock, so the clip always holds the requested length.
      const totalFrames = Math.max(2, Math.round(duration() * EXPORT_FPS));
      const finished = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
      // Draw the first frame before recording so the stream starts from the head of the animation.
      state.playhead = 0;
      render();
      recorder.start(250);
      await new Promise((resolve) => {
        let startedAt = 0;
        let frame = 0;
        function recordFrame(now) {
          if (!startedAt) startedAt = now;
          // Half a frame of slack keeps a jittery rAF from skipping a slot and halving the frame rate.
          if (now >= startedAt + frame * FRAME_MS - FRAME_MS / 2) {
            state.playhead = frame / (totalFrames - 1);
            render();
            update();
            pushFrame();
            if (elements.progressBar) elements.progressBar.style.width = `${state.playhead * 100}%`;
            frame += 1;
          }
          if (frame < totalFrames) requestAnimationFrame(recordFrame);
          // Hold the last frame for its own display time before closing the file.
          else window.setTimeout(resolve, FRAME_MS);
        }
        requestAnimationFrame(recordFrame);
      });
      pushFrame();
      recorder.stop();
      await finished;
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      downloadBlob(blob, `${safeFileName(options.getFileBase?.(), "motion")}.webm`);
      state.isExporting = false;
      if (elements.videoExport?.lastChild) elements.videoExport.lastChild.textContent = " 動画を書き出す";
      if (elements.progress) elements.progress.hidden = true;
      update();
      showToast(`WebMを書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    }

    function exportImage() {
      if (!available() || state.isExporting) return;
      stop(false);
      const seconds = state.playhead * duration();
      render();
      update();
      canvas.toBlob((blob) => {
        if (!blob) {
          showToast("PNGを作成できませんでした");
          return;
        }
        const base = safeFileName(options.getFileBase?.(), "motion");
        downloadBlob(blob, `${base}-${seconds.toFixed(1)}s.png`);
        showToast(`${seconds.toFixed(1)} 秒のPNGを書き出しました`);
      }, "image/png");
    }

    elements.play?.addEventListener("click", () => state.isPlaying ? stop() : play());
    elements.restart?.addEventListener("click", reset);
    elements.timeline?.addEventListener("input", () => setProgress(Number(elements.timeline.value) / 1000));
    elements.speed?.addEventListener("change", () => {
      options.onControlChange?.();
      if (state.isPlaying) {
        stop(false);
        play();
      }
    });
    elements.imageTime?.addEventListener("input", () => {
      setProgress(Number(elements.imageTime.value) / duration());
      options.onControlChange?.();
    });
    elements.imageExport?.addEventListener("click", exportImage);
    elements.videoExport?.addEventListener("click", exportVideo);
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && !["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        if (state.isPlaying) stop();
        else play();
      }
    });

    update();
    return { state, play, stop, reset, setProgress, render, update, showToast, exportVideo, exportImage };
  }

  window.MotionToolkit = {
    clamp,
    lerp,
    ease,
    formatTime,
    graphemes,
    hashSeed,
    seededRandom,
    safeFileName,
    loadImageFile,
    containRect,
    outputDimensions,
    resizeOutputCanvas,
    createPlayer,
  };
})();
