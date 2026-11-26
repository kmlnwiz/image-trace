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
  const PREFS_KEY = "motion-lab:popout:v1";
  const COUNTDOWN_CHOICES = [0, 3, 5, 10];

  function readPrefs() {
    const stored = MotionStorage.read(PREFS_KEY) || {};
    return {
      cover: stored.cover === true,
      countdown: COUNTDOWN_CHOICES.includes(stored.countdown) ? stored.countdown : 0,
      barHidden: stored.barHidden === true,
    };
  }

  function buildView(win) {
    const doc = win.document;
    doc.open();
    doc.write("<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"></head><body></body></html>");
    doc.close();
    doc.title = `${document.title} — プレビュー`;
    const style = doc.createElement("style");
    style.textContent = `
      html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
      body { display: grid; grid-template-rows: minmax(0, 1fr) auto; font: 12px/1.4 system-ui, sans-serif; color: #fff; user-select: none; }
      body.is-idle, body.is-idle * { cursor: none; }
      .stage { position: relative; min-height: 0; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      .bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #161616; border-top: 1px solid #2a2a2a; }
      body.bar-collapsed .bar { display: none; }
      button, select { height: 34px; border: 0; border-radius: 6px; color: #fff; font: inherit; background: rgba(255, 255, 255, 0.12); cursor: pointer; }
      button { min-width: 34px; flex: 0 0 auto; padding: 0 10px; font-size: 13px; }
      select { padding: 0 6px; }
      select option { color: #000; }
      button:hover, select:hover { background: rgba(255, 255, 255, 0.24); }
      button:disabled { opacity: 0.35; cursor: default; }
      .play { background: #E0041D; }
      .play:hover { background: #f01a33; }
      .cover[aria-pressed="true"] { background: #E0041D; }
      input[type=range] { flex: 1 1 auto; min-width: 80px; accent-color: #E0041D; }
      .time { flex: 0 0 auto; font-variant-numeric: tabular-nums; opacity: 0.85; }
      .spacer { flex: 1 1 auto; }
      label { display: flex; align-items: center; gap: 6px; opacity: 0.9; }
      .hint { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px; background: rgba(20, 20, 20, 0.8); opacity: 0; transition: opacity 0.3s; pointer-events: none; white-space: nowrap; }
      .hint.is-visible { opacity: 1; }
    `;
    doc.head.append(style);

    const hasTransport = Boolean(transport.play);
    const stage = doc.createElement("div");
    stage.className = "stage";
    const canvas = doc.createElement("canvas");
    const context = canvas.getContext("2d");
    const hint = doc.createElement("div");
    hint.className = "hint";
    stage.append(canvas, hint);
    const bar = doc.createElement("div");
    bar.className = "bar";
    const countdownOptions = COUNTDOWN_CHOICES.map((value) => `<option value="${value}">${value ? `${value}秒` : "なし"}</option>`).join("");
    bar.innerHTML = hasTransport
      ? `<button class="restart" type="button" title="先頭に戻る（Home / R）">↺</button><button class="play" type="button" title="再生 / 一時停止（Space / K）">▶</button><input class="seek" type="range" min="0" max="1000" step="1" value="0" aria-label="再生位置" /><span class="time">0:00.0 / 0:00.0</span><button class="cover" type="button" aria-pressed="false" title="再生が始まるまで背景色だけを表示（C）">開始前を隠す</button><label title="再生前のカウントダウン">カウントダウン<select class="countdown">${countdownOptions}</select></label><button class="full" type="button" title="全画面（F）">⛶</button>`
      : `<span class="spacer"></span><button class="full" type="button" title="全画面（F）">⛶</button>`;
    doc.body.append(stage, bar);

    const ui = {
      restart: bar.querySelector(".restart"),
      play: bar.querySelector(".play"),
      seek: bar.querySelector(".seek"),
      time: bar.querySelector(".time"),
      cover: bar.querySelector(".cover"),
      countdown: bar.querySelector(".countdown"),
      full: bar.querySelector(".full"),
    };

    const prefs = readPrefs();
    const view = {
      alive: true,
      playing: false,
      // While true only the background shows, so the first frame is not seen before playback.
      covered: hasTransport && prefs.cover,
      countdownEnd: 0,
      seeking: false,
      frame: 0,
    };
    if (ui.countdown) ui.countdown.value = String(prefs.countdown);
    if (ui.cover) ui.cover.setAttribute("aria-pressed", String(prefs.cover));

    function savePrefs() {
      MotionStorage.write(PREFS_KEY, prefs);
    }

    let hintTimer = 0;
    function showHint(message) {
      hint.textContent = message;
      hint.classList.add("is-visible");
      win.clearTimeout(hintTimer);
      hintTimer = win.setTimeout(() => hint.classList.remove("is-visible"), 1800);
    }

    // Corner sampling is the fallback for tools without a background color input.
    const probe = doc.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const probeContext = probe.getContext("2d", { willReadFrequently: true });
    let sampled = "#000000";

    function backgroundColor() {
      if (transport.background?.value) return transport.background.value;
      if (view.frame % 30 === 0) {
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

    // Picks black or white digits so the countdown reads on any background.
    function inkFor(fill) {
      context.fillStyle = fill;
      const hex = /^#([0-9a-f]{6})$/i.exec(context.fillStyle)?.[1] || "000000";
      const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
      return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#FFFFFF";
    }

    function resize() {
      const ratio = win.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(stage.clientWidth * ratio));
      const height = Math.max(1, Math.round(stage.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function drawCountdown(fill) {
      const remaining = Math.max(0, view.countdownEnd - win.performance.now());
      const seconds = Math.ceil(remaining / 1000);
      const within = (remaining % 1000) / 1000 || 1;
      const size = Math.min(canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const ink = inkFor(fill);
      if (!view.covered) {
        // Keep the paused frame faintly visible behind the numbers.
        context.globalAlpha = 0.72;
        context.fillStyle = fill;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalAlpha = 1;
      }
      context.lineWidth = size * 0.012;
      context.strokeStyle = ink;
      context.globalAlpha = 0.18;
      context.beginPath();
      context.arc(cx, cy, size * 0.2, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 0.9;
      context.beginPath();
      context.arc(cx, cy, size * 0.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * within);
      context.stroke();
      context.globalAlpha = 1;
      context.fillStyle = ink;
      context.font = `700 ${Math.round(size * 0.22)}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(seconds), cx, cy + size * 0.01);
    }

    function draw() {
      view.frame += 1;
      resize();
      const fill = backgroundColor();
      doc.body.style.background = fill;
      context.fillStyle = fill;
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!view.covered && source.width && source.height) {
        const fit = MotionToolkit.containRect(source.width, source.height, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(source, fit.x, fit.y, fit.width, fit.height);
      }
      if (view.countdownEnd) drawCountdown(fill);
    }

    function isPlaying() {
      return transport.play?.textContent.trim() === "Ⅱ";
    }

    function syncControls() {
      view.playing = isPlaying();
      // Playback started from either window reveals the picture.
      if (view.playing) {
        view.covered = false;
        view.countdownEnd = 0;
      }
      // The bar is docked below the picture and folds away while playing, so it never covers it.
      doc.body.classList.toggle("bar-collapsed", prefs.barHidden || view.playing || Boolean(view.countdownEnd));
      if (!hasTransport) return;
      ui.play.textContent = view.playing ? "Ⅱ" : "▶";
      ui.play.disabled = transport.play.disabled;
      if (ui.restart) ui.restart.disabled = Boolean(transport.restart?.disabled);
      if (transport.timeline) {
        ui.seek.disabled = transport.timeline.disabled;
        if (!view.seeking) ui.seek.value = transport.timeline.value;
      } else {
        ui.seek.hidden = true;
      }
      const current = transport.current?.value ?? transport.current?.textContent ?? "";
      const total = transport.total?.value ?? transport.total?.textContent ?? "";
      ui.time.textContent = `${current} / ${total}`;
    }

    function loop() {
      if (!view.alive || win.closed) return;
      if (view.countdownEnd && win.performance.now() >= view.countdownEnd) {
        view.countdownEnd = 0;
        if (!isPlaying() && transport.play && !transport.play.disabled) transport.play.click();
      }
      syncControls();
      draw();
      win.requestAnimationFrame(loop);
    }

    // ---- Controls: everything goes through the original transport so each
    // tool's own play / seek logic stays the single source of truth.
    function cancelCountdown() {
      if (!view.countdownEnd) return false;
      view.countdownEnd = 0;
      showHint("カウントダウンを取り消しました");
      return true;
    }

    function togglePlay() {
      if (!transport.play || transport.play.disabled) return;
      if (cancelCountdown()) return;
      if (isPlaying() || !prefs.countdown) {
        transport.play.click();
        return;
      }
      view.countdownEnd = win.performance.now() + prefs.countdown * 1000;
      hint.classList.remove("is-visible");
    }

    function restart() {
      if (!transport.restart || transport.restart.disabled) return;
      view.countdownEnd = 0;
      transport.restart.click();
      view.covered = prefs.cover;
    }

    function pointer(type) {
      // createPlayer pauses on pointerdown and resumes on pointerup.
      transport.timeline?.dispatchEvent(new PointerEvent(type, { bubbles: true }));
    }

    function seekTo(value) {
      if (!transport.timeline || transport.timeline.disabled) return;
      // Seeking means the frame is wanted on screen.
      view.covered = false;
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

    function toggleCover() {
      if (!hasTransport) return;
      prefs.cover = !prefs.cover;
      ui.cover.setAttribute("aria-pressed", String(prefs.cover));
      view.covered = prefs.cover && !isPlaying();
      savePrefs();
      showHint(prefs.cover ? "再生が始まるまで隠します" : "開始前も表示します");
    }

    function toggleBar() {
      prefs.barHidden = !prefs.barHidden;
      savePrefs();
      showHint(prefs.barHidden ? "操作バーを隠しました（H で表示）" : "操作バーを表示しました");
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
    ui.cover?.addEventListener("click", toggleCover);
    ui.countdown?.addEventListener("change", () => {
      prefs.countdown = Number(ui.countdown.value);
      savePrefs();
    });
    ui.full.addEventListener("click", toggleFullscreen);
    ui.seek?.addEventListener("pointerdown", () => {
      view.seeking = true;
      pointer("pointerdown");
    });
    ui.seek?.addEventListener("input", () => seekTo(Number(ui.seek.value)));
    function endSeek() {
      if (!view.seeking) return;
      view.seeking = false;
      pointer("pointerup");
    }
    ui.seek?.addEventListener("pointerup", endSeek);
    ui.seek?.addEventListener("pointercancel", endSeek);
    win.addEventListener("pointerup", endSeek);

    // A double click toggles fullscreen, so a single click waits briefly to be sure it is one.
    let clickTimer = 0;
    canvas.addEventListener("click", (event) => {
      win.clearTimeout(clickTimer);
      if (event.detail > 1) return;
      clickTimer = win.setTimeout(togglePlay, 250);
    });
    canvas.addEventListener("dblclick", () => {
      win.clearTimeout(clickTimer);
      toggleFullscreen();
    });

    win.addEventListener("keydown", (event) => {
      if (event.target === ui.seek && event.key.startsWith("Arrow")) return;
      if (event.target === ui.countdown) return;
      const handled = {
        " ": togglePlay,
        k: togglePlay,
        Home: restart,
        r: restart,
        c: toggleCover,
        h: toggleBar,
        f: toggleFullscreen,
        Escape: cancelCountdown,
        ArrowLeft: () => seekBy(-1),
        ArrowRight: () => seekBy(1),
      }[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!handled) return;
      if (event.key !== "Escape") event.preventDefault();
      handled();
      wake();
    });

    let idleTimer = 0;
    function wake() {
      doc.body.classList.remove("is-idle");
      win.clearTimeout(idleTimer);
      idleTimer = win.setTimeout(() => {
        if (!bar.matches(":hover") && !view.seeking) doc.body.classList.add("is-idle");
      }, IDLE_MS);
    }
    win.addEventListener("pointermove", wake);
    win.addEventListener("pointerdown", wake);

    doc.addEventListener("visibilitychange", rehome);
    win.addEventListener("pagehide", closed);
    win.addEventListener("beforeunload", closed);

    wake();
    win.focus();
    syncControls();
    win.requestAnimationFrame(loop);
    return { draw, stop() { view.alive = false; } };
  }
})();
