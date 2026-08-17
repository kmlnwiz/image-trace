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

  // Accepts what formatTime writes ("1:23.4") as well as a plain "83.4".
  function parseTime(text) {
    const source = String(text ?? "").trim();
    if (!source) return null;
    const parts = source.split(":");
    if (parts.length > 2) return null;
    const numbers = parts.map((part) => Number(part.replace(/[^\d.]/g, "")));
    if (numbers.some((value) => !Number.isFinite(value))) return null;
    return parts.length === 2 ? numbers[0] * 60 + numbers[1] : numbers[0];
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

  // Six tools carried their own copy of this. The width may be negative or near
  // zero while a panel is mid flip, so the radius is clamped against the
  // magnitude and never goes below zero.
  function roundedRectPath(ctx, x, y, width, height, radius) {
    const limit = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + limit, y);
    ctx.arcTo(x + width, y, x + width, y + height, limit);
    ctx.arcTo(x + width, y + height, x, y + height, limit);
    ctx.arcTo(x, y + height, x, y, limit);
    ctx.arcTo(x, y, x + width, y, limit);
    ctx.closePath();
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

  // --- MP4 muxing --------------------------------------------------------
  // The same idea as the WebM writer above, in the other container: H.264 out of
  // WebCodecs and the ISO base media boxes written by hand. The moov box is put
  // in front of the media so the file starts playing without being fully read.

  const MP4_TIMESCALE = 90_000;

  function u8(...values) {
    return Uint8Array.from(values);
  }

  function u16(value) {
    return u8((value >> 8) & 255, value & 255);
  }

  function u32(value) {
    return u8((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
  }

  function mp4Box(type, ...payload) {
    const body = concatBytes(payload.map((part) => (part instanceof Uint8Array ? part : concatBytes(part))));
    return concatBytes([u32(body.length + 8), textEncoder.encode(type), body]);
  }

  // A full box carries a version and flags before its payload.
  function mp4FullBox(type, version, flags, ...payload) {
    return mp4Box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...payload);
  }

  function mp4Table(entries) {
    return concatBytes([u32(entries.length), ...entries]);
  }

  // samples: [{ data, isKeyFrame, decodeDuration, presentationOffset }] in decode
  // order. `description` is the avcC payload the encoder handed over.
  function buildMp4Blob({ width, height, samples, description, durationTicks }) {
    const matrix = concatBytes([
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
    ]);
    const mvhd = mp4FullBox("mvhd", 0, 0,
      u32(0), u32(0), u32(MP4_TIMESCALE), u32(durationTicks),
      u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
      matrix, u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(2));
    const tkhd = mp4FullBox("tkhd", 0, 3,
      u32(0), u32(0), u32(1), u32(0), u32(durationTicks),
      u32(0), u32(0), u16(0), u16(0), u16(0), u16(0),
      matrix, u32(width * 65536), u32(height * 65536));
    const mdhd = mp4FullBox("mdhd", 0, 0,
      u32(0), u32(0), u32(MP4_TIMESCALE), u32(durationTicks), u16(0x55C4), u16(0));
    const hdlr = mp4FullBox("hdlr", 0, 0,
      u32(0), textEncoder.encode("vide"), u32(0), u32(0), u32(0),
      textEncoder.encode("Motion Lab\0"));
    const dinf = mp4Box("dinf", mp4FullBox("dref", 0, 0, u32(1), mp4FullBox("url ", 0, 1)));

    const avcC = mp4Box("avcC", description);
    const avc1 = mp4Box("avc1",
      u8(0, 0, 0, 0, 0, 0), u16(1),
      u16(0), u16(0), u32(0), u32(0), u32(0),
      u16(width), u16(height),
      u32(0x00480000), u32(0x00480000), u32(0), u16(1),
      new Uint8Array(32),
      u16(0x0018), u16(0xFFFF),
      avcC);
    const stsd = mp4FullBox("stsd", 0, 0, u32(1), avc1);

    // Runs of equal duration are written once, which is nearly always one run.
    const timeRuns = [];
    for (const sample of samples) {
      const last = timeRuns[timeRuns.length - 1];
      if (last && last.delta === sample.decodeDuration) last.count += 1;
      else timeRuns.push({ count: 1, delta: sample.decodeDuration });
    }
    const stts = mp4FullBox("stts", 0, 0, mp4Table(timeRuns.map((run) => concatBytes([u32(run.count), u32(run.delta)]))));

    const syncs = [];
    samples.forEach((sample, index) => { if (sample.isKeyFrame) syncs.push(u32(index + 1)); });
    const stss = mp4FullBox("stss", 0, 0, mp4Table(syncs));

    // Only needed when the encoder reordered frames, which it does not unless it
    // chose to use B frames.
    const shifted = samples.some((sample) => sample.presentationOffset !== 0);
    const offsetRuns = [];
    if (shifted) {
      for (const sample of samples) {
        const last = offsetRuns[offsetRuns.length - 1];
        if (last && last.offset === sample.presentationOffset) last.count += 1;
        else offsetRuns.push({ count: 1, offset: sample.presentationOffset });
      }
    }
    const ctts = shifted
      ? mp4FullBox("ctts", 0, 0, mp4Table(offsetRuns.map((run) => concatBytes([u32(run.count), u32(run.offset)]))))
      : null;

    const stsc = mp4FullBox("stsc", 0, 0, mp4Table([concatBytes([u32(1), u32(samples.length), u32(1)])]));
    const stsz = mp4FullBox("stsz", 0, 0, u32(0), mp4Table(samples.map((sample) => u32(sample.data.length))));

    const build = (mediaStart) => {
      const stco = mp4FullBox("stco", 0, 0, mp4Table([u32(mediaStart)]));
      const stbl = mp4Box("stbl", stsd, stts, ...(ctts ? [ctts] : []), stss, stsc, stsz, stco);
      const minf = mp4Box("minf", mp4Box("vmhd", u8(0, 0, 0, 1), u16(0), u16(0), u16(0), u16(0)), dinf, stbl);
      const mdia = mp4Box("mdia", mdhd, hdlr, minf);
      const trak = mp4Box("trak", tkhd, mdia);
      return mp4Box("moov", mvhd, trak);
    };
    const ftyp = mp4Box("ftyp", textEncoder.encode("isom"), u32(0x200),
      textEncoder.encode("isom"), textEncoder.encode("iso2"), textEncoder.encode("avc1"), textEncoder.encode("mp41"));
    // The chunk offset has to point past the header, and the header's own size does
    // not depend on the value it holds, so one dry run is enough to find it.
    const moovSize = build(0).length;
    const moov = build(ftyp.length + moovSize + 8);
    const media = concatBytes(samples.map((sample) => sample.data));
    return new Blob([ftyp, moov, u32(media.length + 8), textEncoder.encode("mdat"), media], { type: "video/mp4" });
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

  const VIDEO_FORMATS = {
    webm: {
      extension: "webm", label: "WebM",
      // Levels are listed high to low: the first one the browser accepts wins.
      candidates: [
        { codec: "vp09.00.41.08", codecId: "V_VP9" },
        { codec: "vp09.00.10.08", codecId: "V_VP9" },
        { codec: "vp8", codecId: "V_VP8" },
      ],
    },
    mp4: {
      extension: "mp4", label: "MP4",
      // High, then main, then baseline. The avc format gives length prefixed NAL
      // units and an avcC description, which is what the MP4 writer wants.
      candidates: [
        { codec: "avc1.640028", avc: true },
        { codec: "avc1.4D0028", avc: true },
        { codec: "avc1.42001F", avc: true },
      ],
    },
  };

  async function pickVideoCodec(width, height, bitrate, format) {
    if (typeof window.VideoEncoder !== "function" || typeof window.VideoFrame !== "function") return null;
    const candidates = (VIDEO_FORMATS[format] || VIDEO_FORMATS.webm).candidates;
    for (const candidate of candidates) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: candidate.codec,
          width,
          height,
          bitrate,
          framerate: EXPORT_FPS,
          ...(candidate.avc ? { avc: { format: "avc" } } : {}),
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
  // `format` is "webm" or "mp4". MP4 needs H.264, which not every browser will
  // encode; when it cannot, the export falls back to WebM rather than failing, and
  // the returned blob says which one it is.
  async function renderWebm({ canvas, totalFrames, render, onProgress, videoBitsPerSecond, format }) {
    const frames = Math.max(2, Math.round(totalFrames));
    const bitrate = videoBitsPerSecond || 12_000_000;
    const wanted = VIDEO_FORMATS[format] ? format : "webm";
    for (const attempt of wanted === "mp4" ? ["mp4", "webm"] : ["webm"]) {
      const codec = await pickVideoCodec(canvas.width, canvas.height, bitrate, attempt);
      if (!codec) continue;
      try {
        return await encodeWithWebCodecs({ canvas, totalFrames: frames, render, onProgress, bitrate, codec, format: attempt });
      } catch (error) {
        console.warn("WebCodecsでの書き出しに失敗したため別の方式に切り替えます", error);
      }
    }
    return recordWithMediaRecorder({ canvas, totalFrames: frames, render, onProgress, bitrate });
  }

  async function encodeWithWebCodecs({ canvas, totalFrames, render, onProgress, bitrate, codec, format }) {
    const width = canvas.width;
    const height = canvas.height;
    const encoded = [];
    let encoderError = null;
    let description = null;
    const encoder = new VideoEncoder({
      output(chunk, metadata) {
        // The parameter sets arrive alongside the first chunk and are what the MP4
        // sample description is built from.
        if (!description && metadata?.decoderConfig?.description) {
          const source = metadata.decoderConfig.description;
          description = new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encoded.push({
          timestamp: chunk.timestamp,
          timestampMs: Math.round(chunk.timestamp / 1000),
          isKeyFrame: chunk.type === "key",
          data,
        });
      },
      error(error) {
        encoderError = error;
      },
    });
    encoder.configure({
      codec: codec.codec, width, height, bitrate, framerate: EXPORT_FPS, latencyMode: "quality",
      ...(codec.avc ? { avc: { format: "avc" } } : {}),
    });
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
    if (format === "mp4") {
      if (!description) throw new Error("MP4のヘッダー情報を取得できませんでした");
      // Decode order is what the file stores; where the encoder reordered frames the
      // difference is carried in each sample's presentation offset.
      const ticks = MP4_TIMESCALE / EXPORT_FPS;
      const presentation = encoded.map((frame) => frame.timestamp).sort((left, right) => left - right);
      const samples = encoded.map((frame, index) => ({
        data: frame.data,
        isKeyFrame: frame.isKeyFrame,
        decodeDuration: Math.round(ticks),
        presentationOffset: Math.max(0, Math.round((frame.timestamp - presentation[index]) * MP4_TIMESCALE / 1_000_000)),
      }));
      return buildMp4Blob({
        width,
        height,
        samples,
        description,
        durationTicks: Math.round(totalFrames * ticks),
      });
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

  // The chosen container is a preference of the workshop rather than of one tool,
  // so it is remembered once and every page picks it up.
  const EXPORT_FORMAT_KEY = "motion-lab:export-format:v1";

  function exportFormat(select) {
    const control = select || document.querySelector("#outputFormat");
    const value = control?.value;
    if (VIDEO_FORMATS[value]) return value;
    try {
      const stored = window.localStorage?.getItem(EXPORT_FORMAT_KEY);
      if (VIDEO_FORMATS[stored]) return stored;
    } catch {
      // The tools remain usable when storage is unavailable.
    }
    return "webm";
  }

  function rememberExportFormat(value) {
    if (!VIDEO_FORMATS[value]) return;
    try {
      window.localStorage?.setItem(EXPORT_FORMAT_KEY, value);
    } catch {
      // The tools remain usable when storage is unavailable.
    }
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
      outputFormat: document.querySelector("#outputFormat"),
    };
    if (elements.outputFormat) {
      const stored = exportFormat(null);
      if (VIDEO_FORMATS[stored]) elements.outputFormat.value = stored;
      elements.outputFormat.addEventListener("change", () => rememberExportFormat(elements.outputFormat.value));
    }
    const state = {
      playhead: 0,
      isPlaying: false,
      isExporting: false,
      isScrubbing: false,
      resumeAfterScrub: false,
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
      // While a drag is in flight the pointer owns the handle position.
      if (elements.timeline && !state.isScrubbing) elements.timeline.value = String(Math.round(state.playhead * 1000));
      if (elements.current && document.activeElement !== elements.current) {
        elements.current.value = formatTime(state.playhead * total);
      }
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
      const wanted = exportFormat(elements.outputFormat);
      try {
        const blob = await renderWebm({
          canvas,
          totalFrames,
          format: wanted,
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
        // What came back is what gets written: asking for MP4 on a browser that
        // cannot encode H.264 still produces a file, and the toast says which.
        const made = blob.type.includes("mp4") ? "mp4" : "webm";
        downloadBlob(blob, `${safeFileName(options.getFileBase?.(), "motion")}.${made}`);
        endExport();
        const size = `${(blob.size / 1024 / 1024).toFixed(1)} MB`;
        showToast(made === wanted
          ? `${VIDEO_FORMATS[made].label}を書き出しました (${size})`
          : `MP4に対応していないため${VIDEO_FORMATS[made].label}で書き出しました (${size})`);
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
    // Grabbing the bar pauses, and letting go resumes if it was playing, so a
    // scrub never has to be paid for with a second click on play.
    elements.timeline?.addEventListener("pointerdown", () => {
      state.isScrubbing = true;
      state.resumeAfterScrub = state.isPlaying;
    });
    function endScrub() {
      if (!state.isScrubbing) return;
      state.isScrubbing = false;
      if (state.resumeAfterScrub && !state.isExporting) play();
      state.resumeAfterScrub = false;
      update();
    }
    elements.timeline?.addEventListener("pointerup", endScrub);
    elements.timeline?.addEventListener("pointercancel", endScrub);
    window.addEventListener("pointerup", endScrub);
    elements.current?.addEventListener("change", () => {
      const seconds = parseTime(elements.current.value);
      if (seconds === null) {
        update();
        return;
      }
      setProgress(clamp(seconds, 0, duration()) / duration());
    });
    elements.current?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        elements.current.blur();
      }
    });
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
    parseTime,
    graphemes,
    hashSeed,
    seededRandom,
    safeFileName,
    loadImageFile,
    containRect,
    outputDimensions,
    resizeOutputCanvas,
    roundedRectPath,
    downloadBlob,
    renderWebm,
    exportFormat,
    rememberExportFormat,
    createPlayer,
  };
})();
