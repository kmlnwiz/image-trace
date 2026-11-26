"use strict";

// Mirrors the tool's preview canvas into a separate window that can be made
// fullscreen (F11 / F key), with its own play, restart and seek controls that
// drive the original transport.
(function setupPreviewPopout() {
  const SOURCE_SELECTOR = "#previewCanvas, #kanjiCanvas, #dialCanvas, #reelCanvas";
  const WINDOW_NAME = "motion-lab-preview";
  const IDLE_MS = 2200;
  const source = document.querySelector(SOURCE_SELECTOR) || document.querySelector(".tool-stage canvas");
  const header = document.querySelector(".tool-header");
  if (!source || !header) return;

  const transport = {
    play: document.querySelector("#playButton"),
    restart: document.querySelector("#restartButton"),
    timeline: document.querySelector("#timeline"),
    current: document.querySelector("#currentTime"),
    total: document.querySelector("#totalTime"),
    background: document.querySelector("#backgroundColor"),
  };

  let popup = null;
  let view = null;

  // ---- Frame scheduling ---------------------------------------------------
  // A fullscreen window on the same display occludes this one, and browsers
  // stop animation frames for occluded windows. While the preview window is
  // visible, every frame this page asks for is scheduled on that window instead,
  // so playback keeps running. Ids handed out here are negative so they never
  // collide with native ones.
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map();
  let nextId = -1;

  function hostWindow() {
    try {
      if (popup && !popup.closed && popup.document.visibilityState === "visible") return popup;
    } catch {
      // A window that went away mid-check simply stops hosting frames.
    }
    return null;
  }

  function schedule(id, entry) {
    const host = hostWindow();
    const run = () => {
      pending.delete(id);
      entry.callback(performance.now());
      // Copy right after the tool drew so the mirror never lags a frame behind.
      if (entry.host) view?.draw();
    };
    entry.host = host;
    entry.handle = host ? host.requestAnimationFrame(run) : nativeRequest(run);
  }

  window.requestAnimationFrame = (callback) => {
    const id = nextId--;
    const entry = { callback, host: null, handle: 0 };
    pending.set(id, entry);
    schedule(id, entry);
    return id;
  };

  window.cancelAnimationFrame = (id) => {
    const entry = pending.get(id);
    if (!entry) {
      nativeCancel(id);
      return;
    }
    pending.delete(id);
    cancelEntry(entry);
  };

  function cancelEntry(entry) {
    try {
      if (entry.host) entry.host.cancelAnimationFrame(entry.handle);
      else nativeCancel(entry.handle);
    } catch {
      // The hosting window is already gone; nothing left to cancel.
    }
  }

  // Moves queued frames to whichever window can run them now.
  function rehome() {
    pending.forEach((entry, id) => {
      const wanted = hostWindow();
      if (entry.host === wanted) return;
      cancelEntry(entry);
      schedule(id, entry);
    });
  }

  // ---- Header button ------------------------------------------------------
  const actions = header.querySelector(".header-actions, .header-nav, .dial-nav, .kanji-nav") || header.appendChild(Object.assign(document.createElement("div"), { className: "header-actions" }));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "popout-button";
  button.textContent = "別ウィンドウ";
  button.title = "プレビューを別ウィンドウで再生（F11 / F で全画面）";
  button.setAttribute("aria-pressed", "false");
  actions.append(button);

  function toast(message) {
    const node = document.querySelector("#toast");
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    window.setTimeout(() => { node.hidden = true; }, 3200);
  }

  button.addEventListener("click", () => {
    if (popup && !popup.closed) {
      popup.focus();
      return;
    }
    // 1280x720 keeps the 16:9 shape of the 1920x1080 fullscreen target.
    const opened = window.open("", WINDOW_NAME, "popup=yes,width=1280,height=720");
    if (!opened) {
      toast("ポップアップがブロックされました。ブラウザの設定で許可してください");
      return;
    }
    popup = opened;
    view = buildView(opened);
    button.setAttribute("aria-pressed", "true");
    rehome();
  });

  function closed() {
    view?.stop();
    popup = null;
    view = null;
    button.setAttribute("aria-pressed", "false");
    rehome();
  }

  window.addEventListener("pagehide", () => {
    try {
      popup?.close();
    } catch {
      // Closing is best effort.
    }
  });

  // ---- Preview window -----------------------------------------------------
  function buildView(win) {
    const doc = win.document;
    doc.open();
    doc.write("<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"></head><body></body></html>");
    doc.close();
    doc.title = `${document.title} — プレビュー`;
    const style = doc.createElement("style");
    style.textContent = `
      html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
      body { font: 12px/1.4 system-ui, sans-serif; color: #fff; user-select: none; }
      body.is-idle, body.is-idle * { cursor: none; }
      canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
      .bar { position: fixed; left: 50%; bottom: 20px; width: min(720px, calc(100vw - 32px)); transform: translateX(-50%); box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; background: rgba(20, 20, 20, 0.78); backdrop-filter: blur(8px); transition: opacity 0.25s; }
      body.is-idle .bar { opacity: 0; pointer-events: none; }
      button { width: 34px; height: 34px; flex: 0 0 34px; border: 0; border-radius: 6px; color: #fff; font-size: 15px; background: rgba(255, 255, 255, 0.12); cursor: pointer; }
      button:hover { background: rgba(255, 255, 255, 0.24); }
      button:disabled { opacity: 0.35; cursor: default; }
      .play { background: #E0041D; }
      .play:hover { background: #f01a33; }
      input[type=range] { flex: 1 1 auto; min-width: 0; accent-color: #E0041D; }
      .time { flex: 0 0 auto; font-variant-numeric: tabular-nums; opacity: 0.85; }
      .spacer { flex: 1 1 auto; }
    `;
    doc.head.append(style);

    const canvas = doc.createElement("canvas");
    const context = canvas.getContext("2d");
    const bar = doc.createElement("div");
    bar.className = "bar";
    const hasTransport = Boolean(transport.play);
    bar.innerHTML = hasTransport
      ? `<button class="restart" type="button" title="先頭に戻る（Home）">↺</button><button class="play" type="button" title="再生 / 一時停止（Space）">▶</button><input class="seek" type="range" min="0" max="1000" step="1" value="0" aria-label="再生位置" /><span class="time">0:00.0 / 0:00.0</span><button class="full" type="button" title="全画面（F）">⛶</button>`
      : `<span class="spacer"></span><button class="full" type="button" title="全画面（F）">⛶</button>`;
    doc.body.append(canvas, bar);

    const ui = {
      restart: bar.querySelector(".restart"),
      play: bar.querySelector(".play"),
      seek: bar.querySelector(".seek"),
      time: bar.querySelector(".time"),
      full: bar.querySelector(".full"),
    };

    // Corner sampling is the fallback for tools without a background color input.
    const probe = doc.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const probeContext = probe.getContext("2d", { willReadFrequently: true });
    let sampled = "#000000";
    let frame = 0;

    function backgroundColor() {
      if (transport.background?.value) return transport.background.value;
      if (frame % 30 === 0) {
        try {
          probeContext.clearRect(0, 0, 1, 1);
          probeContext.drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1);
          const [r, g, b, a] = probeContext.getImageData(0, 0, 1, 1).data;
          sampled = a > 0 ? `rgb(${r}, ${g}, ${b})` : "#000000";
        } catch {
          // A tainted canvas cannot be read; keep the last known color.
        }
      }
      return sampled;
    }

    function resize() {
      const ratio = win.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(win.innerWidth * ratio));
      const height = Math.max(1, Math.round(win.innerHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function draw() {
      frame += 1;
      resize();
      const fill = backgroundColor();
      doc.body.style.background = fill;
      context.fillStyle = fill;
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!source.width || !source.height) return;
      const fit = MotionToolkit.containRect(source.width, source.height, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, fit.x, fit.y, fit.width, fit.height);
    }

    function syncControls() {
      if (!hasTransport) return;
      ui.play.textContent = transport.play.textContent.trim() === "Ⅱ" ? "Ⅱ" : "▶";
      ui.play.disabled = transport.play.disabled;
      if (ui.restart) ui.restart.disabled = Boolean(transport.restart?.disabled);
      if (transport.timeline) {
        ui.seek.disabled = transport.timeline.disabled;
        if (!seeking) ui.seek.value = transport.timeline.value;
      } else {
        ui.seek.hidden = true;
      }
      const current = transport.current?.value ?? transport.current?.textContent ?? "";
      const total = transport.total?.value ?? transport.total?.textContent ?? "";
      ui.time.textContent = `${current} / ${total}`;
    }

    let alive = true;

    function loop() {
      if (!alive || win.closed) return;
      draw();
      syncControls();
      win.requestAnimationFrame(loop);
    }

    // ---- Controls: everything goes through the original transport so each
    // tool's own play / seek logic stays the single source of truth.
    let seeking = false;

    function togglePlay() {
      if (transport.play && !transport.play.disabled) transport.play.click();
    }

    function restart() {
      if (transport.restart && !transport.restart.disabled) transport.restart.click();
    }

    function pointer(type) {
      // createPlayer pauses on pointerdown and resumes on pointerup.
      transport.timeline?.dispatchEvent(new PointerEvent(type, { bubbles: true }));
    }

    function seekTo(value) {
      if (!transport.timeline || transport.timeline.disabled) return;
      transport.timeline.value = String(MotionToolkit.clamp(Math.round(value), 0, 1000));
      transport.timeline.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function seekBy(seconds) {
      const total = MotionToolkit.parseTime(transport.total?.value ?? transport.total?.textContent ?? "");
      if (!transport.timeline || !total) return;
      pointer("pointerdown");
      seekTo(Number(transport.timeline.value) + seconds / total * 1000);
      pointer("pointerup");
    }

    function toggleFullscreen() {
      try {
        if (doc.fullscreenElement) doc.exitFullscreen();
        else doc.documentElement.requestFullscreen();
      } catch {
        // F11 still works when the fullscreen API is refused.
      }
    }

    ui.play?.addEventListener("click", togglePlay);
    ui.restart?.addEventListener("click", restart);
    ui.full.addEventListener("click", toggleFullscreen);
    ui.seek?.addEventListener("pointerdown", () => {
      seeking = true;
      pointer("pointerdown");
    });
    ui.seek?.addEventListener("input", () => seekTo(Number(ui.seek.value)));
    function endSeek() {
      if (!seeking) return;
      seeking = false;
      pointer("pointerup");
    }
    ui.seek?.addEventListener("pointerup", endSeek);
    ui.seek?.addEventListener("pointercancel", endSeek);
    win.addEventListener("pointerup", endSeek);
    canvas.addEventListener("click", togglePlay);
    canvas.addEventListener("dblclick", toggleFullscreen);

    win.addEventListener("keydown", (event) => {
      if (event.target === ui.seek && event.key.startsWith("Arrow")) return;
      const handled = {
        " ": togglePlay,
        k: togglePlay,
        Home: restart,
        r: restart,
        f: toggleFullscreen,
        ArrowLeft: () => seekBy(-1),
        ArrowRight: () => seekBy(1),
      }[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!handled) return;
      event.preventDefault();
      handled();
      wake();
    });

    let idleTimer = 0;
    function wake() {
      doc.body.classList.remove("is-idle");
      win.clearTimeout(idleTimer);
      idleTimer = win.setTimeout(() => {
        if (!bar.matches(":hover") && !seeking) doc.body.classList.add("is-idle");
      }, IDLE_MS);
    }
    win.addEventListener("pointermove", wake);
    win.addEventListener("pointerdown", wake);

    doc.addEventListener("visibilitychange", rehome);
    win.addEventListener("pagehide", closed);
    win.addEventListener("beforeunload", closed);

    wake();
    win.focus();
    win.requestAnimationFrame(loop);
    return { draw, stop() { alive = false; } };
  }
})();
