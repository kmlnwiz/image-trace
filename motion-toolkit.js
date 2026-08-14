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

  // --- WebM muxing -------------------------------------------------------
  // MediaRecorder stamps frames with wall clock time, so a render slower than
  // 1/60 s stretches the clip and makes playback stutter. Encoding through
  // WebCodecs and writing the container by hand lets every frame carry the
  // timestamp its index demands, no matter how long the drawing took.

  const TIMESTAMP_SCALE_NS = 1_000_000; // one millisecond per tick
  const textEncoder = new TextEncoder();

  function concatBytes(chunks) {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function ebmlId(id) {
    const bytes = [];
    let remaining = id;
    while (remaining > 0) {
      bytes.unshift(remaining % 256);
      remaining = Math.floor(remaining / 256);
    }
    return Uint8Array.from(bytes);
  }

  function ebmlSize(size) {
    for (let length = 1; length <= 8; length += 1) {
      if (size < Math.pow(2, 7 * length) - 1) {
        const bytes = new Uint8Array(length);
        let remaining = size;
        for (let index = length - 1; index >= 0; index -= 1) {
          bytes[index] = remaining % 256;
          remaining = Math.floor(remaining / 256);
        }
        bytes[0] |= 1 << (8 - length);
        return bytes;
      }
    }
    throw new Error("EBML element is too large");
  }

  function ebmlUint(value) {
    const bytes = [];
    let remaining = Math.max(0, Math.round(value));
    do {
      bytes.unshift(remaining % 256);
      remaining = Math.floor(remaining / 256);
    } while (remaining > 0);
    return Uint8Array.from(bytes);
  }

  function ebmlFloat(value) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, false);
    return new Uint8Array(buffer);
  }

  function ebmlElement(id, payload) {
    const body = payload instanceof Uint8Array ? payload : concatBytes(payload);
    return concatBytes([ebmlId(id), ebmlSize(body.length), body]);
  }

  function simpleBlock(relativeMs, isKeyFrame, data) {
    const payload = new Uint8Array(4 + data.length);
    payload[0] = 0x81; // track number 1, written as a single byte VINT
    new DataView(payload.buffer).setInt16(1, relativeMs, false);
    payload[3] = isKeyFrame ? 0x80 : 0x00;
    payload.set(data, 4);
    return ebmlElement(0xA3, payload);
  }

  // frames: [{ timestampMs, isKeyFrame, data }] in presentation order.
  function buildWebmBlob({ width, height, codecId, frames, durationMs, frameDurationNs }) {
    const clusters = [];
    for (const frame of frames) {
      const last = clusters[clusters.length - 1];
      // A block timestamp is a signed 16 bit offset, so every key frame opens a
      // fresh cluster and keeps the offsets tiny.
      if (!last || frame.isKeyFrame || frame.timestampMs - last.timestampMs > 30_000) {
        clusters.push({ timestampMs: frame.timestampMs, blocks: [] });
      }
      const cluster = clusters[clusters.length - 1];
      cluster.blocks.push(simpleBlock(frame.timestampMs - cluster.timestampMs, frame.isKeyFrame, frame.data));
    }

    const header = ebmlElement(0x1A45DFA3, [
      ebmlElement(0x4286, ebmlUint(1)),
      ebmlElement(0x42F7, ebmlUint(1)),
      ebmlElement(0x42F2, ebmlUint(4)),
      ebmlElement(0x42F3, ebmlUint(8)),
      ebmlElement(0x4282, textEncoder.encode("webm")),
      ebmlElement(0x4287, ebmlUint(2)),
      ebmlElement(0x4285, ebmlUint(2)),
    ]);
    const info = ebmlElement(0x1549A966, [
      ebmlElement(0x2AD7B1, ebmlUint(TIMESTAMP_SCALE_NS)),
      ebmlElement(0x4D80, textEncoder.encode("Motion Lab")),
      ebmlElement(0x5741, textEncoder.encode("Motion Lab")),
      ebmlElement(0x4489, ebmlFloat(durationMs)),
    ]);
    const tracks = ebmlElement(0x1654AE6B, ebmlElement(0xAE, [
      ebmlElement(0xD7, ebmlUint(1)),
      ebmlElement(0x73C5, ebmlUint(1)),
      ebmlElement(0x9C, ebmlUint(0)),
      ebmlElement(0x83, ebmlUint(1)),
      ebmlElement(0x23E383, ebmlUint(frameDurationNs)),
      ebmlElement(0x86, textEncoder.encode(codecId)),
      ebmlElement(0xE0, [
        ebmlElement(0xB0, ebmlUint(width)),
        ebmlElement(0xBA, ebmlUint(height)),
      ]),
    ]));

    const clusterBytes = clusters.map((cluster) => ebmlElement(0x1F43B675, [
      ebmlElement(0xE7, ebmlUint(cluster.timestampMs)),
      ...cluster.blocks,
    ]));
    // Cue positions are relative to the first byte inside the segment.
    let position = info.length + tracks.length;
    const cuePoints = clusters.map((cluster, index) => {
      const point = ebmlElement(0xBB, [
        ebmlElement(0xB3, ebmlUint(cluster.timestampMs)),
        ebmlElement(0xB7, [
          ebmlElement(0xF7, ebmlUint(1)),
          ebmlElement(0xF1, ebmlUint(position)),
        ]),
      ]);
      position += clusterBytes[index].length;
      return point;
    });
    const cues = ebmlElement(0x1C53BB6B, cuePoints);
    const segment = ebmlElement(0x18538067, [info, tracks, ...clusterBytes, cues]);
    return new Blob([header, segment], { type: "video/webm" });
  }

  // setTimeout is clamped to once per second in a hidden tab, which would stall an
  // export the moment the user switches away. A MessageChannel is not throttled.
  const yieldChannel = new MessageChannel();
  const yieldQueue = [];
  yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
  yieldChannel.port1.start();

  function nextTask() {
    return new Promise((resolve) => {
      yieldQueue.push(resolve);
      yieldChannel.port2.postMessage(0);
    });
  }

  async function pickVideoCodec(width, height, bitrate) {
    if (typeof window.VideoEncoder !== "function" || typeof window.VideoFrame !== "function") return null;
    // Levels are listed high to low: the first one the browser accepts wins.
    const candidates = [
      { codec: "vp09.00.41.08", codecId: "V_VP9" },
      { codec: "vp09.00.10.08", codecId: "V_VP9" },
      { codec: "vp8", codecId: "V_VP8" },
    ];
    for (const candidate of candidates) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: candidate.codec,
          width,
          height,
          bitrate,
          framerate: EXPORT_FPS,
        });
        if (support?.supported) return candidate;
      } catch {
        // Try the next codec; an unsupported config throws in some builds.
      }
    }
    return null;
  }

  // Renders `totalFrames` frames and returns a WebM blob. Every frame is stamped
  // from its index rather than from the clock, so a render slower than 1/60 s only
  // makes the export take longer — it never drops a frame or stretches the clip.
  // `render(playhead)` receives a normalised 0..1 position and must draw synchronously.
  async function renderWebm({ canvas, totalFrames, render, onProgress, videoBitsPerSecond }) {
    const frames = Math.max(2, Math.round(totalFrames));
    const bitrate = videoBitsPerSecond || 12_000_000;
    const codec = await pickVideoCodec(canvas.width, canvas.height, bitrate);
    if (codec) {
      try {
        return await encodeWithWebCodecs({ canvas, totalFrames: frames, render, onProgress, bitrate, codec });
      } catch (error) {
        console.warn("WebCodecsでの書き出しに失敗したため従来の方式に切り替えます", error);
      }
    }
    return recordWithMediaRecorder({ canvas, totalFrames: frames, render, onProgress, bitrate });
  }

  async function encodeWithWebCodecs({ canvas, totalFrames, render, onProgress, bitrate, codec }) {
    const width = canvas.width;
    const height = canvas.height;
    const encoded = [];
    let encoderError = null;
    const encoder = new VideoEncoder({
      output(chunk) {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encoded.push({
          timestampMs: Math.round(chunk.timestamp / 1000),
          isKeyFrame: chunk.type === "key",
          data,
        });
      },
      error(error) {
        encoderError = error;
      },
    });
    encoder.configure({ codec: codec.codec, width, height, bitrate, framerate: EXPORT_FPS, latencyMode: "quality" });
    try {
      for (let frame = 0; frame < totalFrames; frame += 1) {
        if (encoderError) throw encoderError;
        render(frame / (totalFrames - 1));
        const videoFrame = new VideoFrame(canvas, {
          timestamp: Math.round((frame * 1_000_000) / EXPORT_FPS),
          duration: Math.round(1_000_000 / EXPORT_FPS),
        });
        // A key frame every second keeps clusters small and seeking responsive.
        encoder.encode(videoFrame, { keyFrame: frame % EXPORT_FPS === 0 });
        videoFrame.close();
        if (frame % 6 === 5 || frame === totalFrames - 1) {
          onProgress?.((frame + 1) / totalFrames);
          await nextTask();
        }
        // Let the encoder drain so a long clip does not pile up in memory.
        while (encoder.encodeQueueSize > 16 && !encoderError) await nextTask();
      }
      await encoder.flush();
      if (encoderError) throw encoderError;
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
    encoded.sort((left, right) => left.timestampMs - right.timestampMs);
    return buildWebmBlob({
      width,
      height,
      codecId: codec.codecId,
      frames: encoded,
      durationMs: (totalFrames * 1000) / EXPORT_FPS,
      frameDurationNs: Math.round(1_000_000_000 / EXPORT_FPS),
    });
  }

  async function recordWithMediaRecorder({ canvas, totalFrames, render, onProgress, bitrate }) {
    if (!canvas.captureStream || !window.MediaRecorder) {
      throw new Error("このブラウザはWebM書き出しに対応していません");
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
      videoBitsPerSecond: bitrate,
    });
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    const finished = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    // Draw the first frame before recording so the stream starts from the head of the animation.
    render(0);
    recorder.start(250);
    await new Promise((resolve) => {
      let startedAt = 0;
      let frame = 0;
      function recordFrame(now) {
        if (!startedAt) startedAt = now;
        // Half a frame of slack keeps a jittery rAF from skipping a slot and halving the frame rate.
        if (now >= startedAt + frame * FRAME_MS - FRAME_MS / 2) {
          render(frame / (totalFrames - 1));
          pushFrame();
          onProgress?.((frame + 1) / totalFrames);
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
    return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
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

    function setExportProgress(progress) {
      if (elements.progressBar) elements.progressBar.style.width = `${clamp(progress, 0, 1) * 100}%`;
    }

    function beginExport() {
      state.isExporting = true;
      stop(false);
      update();
      if (elements.videoExport?.lastChild) elements.videoExport.lastChild.textContent = " 書き出し中";
      if (elements.progress) elements.progress.hidden = false;
      setExportProgress(0);
    }

    function endExport() {
      state.isExporting = false;
      if (elements.videoExport?.lastChild) elements.videoExport.lastChild.textContent = " 動画を書き出す";
      if (elements.progress) elements.progress.hidden = true;
      update();
    }

    function frameCount() {
      // Frames are counted, not sampled from the clock, so the clip always holds the requested length.
      return Math.max(2, Math.round(duration() * EXPORT_FPS));
    }

    function renderFrameAt(frame, totalFrames) {
      state.playhead = frame / (totalFrames - 1);
      render();
    }

    async function exportVideo() {
      if (!available() || state.isExporting) return;
      // Claim the export before the first await so a double click cannot start two runs.
      beginExport();
      const totalFrames = frameCount();
      try {
        const blob = await renderWebm({
          canvas,
          totalFrames,
          videoBitsPerSecond: options.videoBitsPerSecond,
          render(playhead) {
            state.playhead = playhead;
            render();
          },
          onProgress(progress) {
            setExportProgress(progress);
            update();
          },
        });
        downloadBlob(blob, `${safeFileName(options.getFileBase?.(), "motion")}.webm`);
        endExport();
        showToast(`WebMを書き出しました (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
      } catch (error) {
        endExport();
        showToast(error?.message || "動画を書き出せませんでした");
      }
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
    downloadBlob,
    renderWebm,
    createPlayer,
  };
})();
